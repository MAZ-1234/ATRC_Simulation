/**
 * Scenario view derivations (DESIGN.md 6.3). Everything shown in the Scenario view is
 * computed here from window.SIM_SCENARIO (and, for "when it happened", from the loaded
 * Proposed run of the selected variant + seed). No value is typed in by hand: the only
 * hand-written knowledge is WHICH constants the source marks as assumptions "(A)", with
 * the file each mark comes from (ASSUMED below).
 */
import type {
  DriverState, LinkName, LinkProfile, Manoeuvre, RunData, Scenario, VariantInfo, VariantParams, Zone,
} from "../../data/types";
import {
  LINK_ORDER, bisectRight, camLabel, dec, fmtDbm, fmtFrac, fmtKm, fmtMbps, fmtMs, fmtNum, linkLabel,
  manoeuvreLabel, variantLabel, MINUS,
} from "../../data/loader";

// ------------------------------------------------------------------ assumption marks

/**
 * VariantParams keys marked "(A)" in edge_mlc/sim/scenario.py DEFAULTS. `lte` carries no
 * mark there (it is a scenario switch, not an assumed number), so it is not listed.
 */
export const ASSUMED_PARAMS: ReadonlySet<keyof VariantParams> = new Set<keyof VariantParams>([
  "ho_p_out", "ho_out_s", "jam_zone", "jam_ramp_km", "blackout_at", "blackout_s",
  "lte_route", "fade", "crater_cap", "buffer_scale",
]);

// ------------------------------------------------------------------ plain names

const STATE_LABEL: Record<DriverState, string> = {
  START: "Start",
  CRUISE_OUT: "Cruise out",
  CRATER_APPROACH: "Crater approach",
  CRATER_STOP1: "Crater stop 1",
  CRATER_REVERSE: "Crater reverse",
  CRATER_STOP2: "Crater stop 2",
  CRATER_TURN: "Crater turn",
  CRUISE_TO_ZONE: "Cruise to the contested zone",
  CONTESTED_OUT: "Contested zone, outbound",
  CRUISE_TO_SITE: "Cruise to the site",
  INSPECT: "Inspect",
  TURN_AROUND: "Turn around",
  RETURN: "Return",
  END: "End",
};
/** Driver state code -> plain words; the code goes in the tooltip. */
export function stateLabel(s: string): string {
  return (STATE_LABEL as Record<string, string>)[s] ?? s.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

const UPLOAD_LABEL: Record<string, string> = {
  scan_drive: "Scan while driving",
  lidar_crater: "Crater LiDAR scan",
  still: "Inspection still",
  clip: "Inspection clip",
  recording: "Recording chunk",
  lidar: "Route LiDAR chunk",
};
export function uploadLabel(idOrKind: string): string {
  return UPLOAD_LABEL[idOrKind] ?? idOrKind.replace(/_/g, " ");
}

/**
 * Sentence-case a label for use mid-sentence: lower-case the first letter only, and keep
 * names and acronyms ("4G overlap", "Starlink ...", "LiDAR") intact.
 */
export function lowerFirst(label: string): string {
  if (/^(Starlink|[A-Z0-9]{2})/.test(label) || /^\d/.test(label)) return label;
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/** Number with a true minus and trailing zeros dropped: 0.3 -> "0.3", -0.4 -> "−0.4". */
export function num(x: number, maxDecimals = 2): string {
  const s = Math.abs(x).toFixed(maxDecimals).replace(/\.?0+$/, "");
  return (x < 0 ? MINUS : "") + s;
}
/** "2.45–2.80 km" (two decimals, en dash). */
export function kmRange(a: number, b: number): string {
  return `${a.toFixed(2)}–${b.toFixed(2)} km`;
}
/** "0.2–1.2 s". */
export function secRange(a: number, b: number): string {
  return `${num(a, 2)}–${num(b, 2)} s`;
}
/** Fraction 0-1 as a whole or one-decimal percent: 0.35 -> "35%". */
export function pctOf(p: number): string {
  const v = p * 100;
  return `${Number.isInteger(Math.round(v * 10) / 10) ? Math.round(v) : v.toFixed(1)}%`;
}
/** Transition condition from scenario.driver.transitions in plain words. */
export function conditionText(cond: string, from: DriverState): string {
  let m = /^after\s+([\d.]+)\s*s$/.exec(cond);
  if (m) return `${num(Number(m[1]))} s after ${stateLabel(from).toLowerCase()}`;
  m = /^d\s*>=\s*([\d.]+)\s*km$/.exec(cond);
  if (m) return `Reaches ${fmtKm(Number(m[1]))}`;
  m = /^d\s*<=\s*([\d.]+)\s*km$/.exec(cond);
  if (m) return `Back at ${fmtKm(Number(m[1]))}`;
  return cond;
}

// ------------------------------------------------------------------ link state along km

export type LinkState = "good" | "degraded" | "down";

/** Limits a link must meet to count as "good": the config's fixed video limits. */
export interface GoodRule { maxRttMs: number; maxLoss: number }

/**
 * Same rule as the Replay link tracks and the truth spine (integrator: one definition
 * across the viewer): up, loss at most `limits.video.max_loss` and RTT at most
 * `limits.video.max_rtt_ms`, the fixed per-traffic limits both controllers share
 * (config/sim_themis.yaml `limits`).
 * DESIGN-GAP: the report's timeline (edge_mlc/sim/plots.py) hard-codes loss < 5% and
 * RTT < 250 ms; the viewer reads the config limit instead.
 */
export function goodRule(sc: Scenario): GoodRule {
  return { maxRttMs: sc.limits.video.max_rtt_ms, maxLoss: sc.limits.video.max_loss };
}

export function stateAt(p: { up: number[]; loss: number[]; rtt: number[] }, i: number, rule: GoodRule): LinkState {
  if (!p.up[i]) return "down";
  return p.loss[i] <= rule.maxLoss && p.rtt[i] <= rule.maxRttMs ? "good" : "degraded";
}

export interface Span { from: number; to: number; state: LinkState }

/** Runs of equal state over the km grid; each sample covers [km_i - h, km_i + h]. */
export function stateSpans(km: number[], p: LinkProfile, rule: GoodRule): Span[] {
  const out: Span[] = [];
  const h = km.length > 1 ? (km[1] - km[0]) / 2 : 0.005;
  for (let i = 0; i < km.length; i++) {
    const st = stateAt(p, i, rule);
    const a = Math.max(km[0], km[i] - h);
    const b = Math.min(km[km.length - 1], km[i] + h);
    const last = out[out.length - 1];
    if (last && last.state === st) last.to = b;
    else out.push({ from: a, to: b, state: st });
  }
  return out;
}

/** km ranges where `pred(i)` holds, as [from, to] using the grid values. */
export function rangesWhere(km: number[], pred: (i: number) => boolean): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= km.length; i++) {
    const ok = i < km.length && pred(i);
    if (ok && start < 0) start = i;
    if (!ok && start >= 0) { out.push([km[start], km[i - 1]]); start = -1; }
  }
  return out;
}

export function kmIndex(sc: Scenario, d: number): number {
  return Math.min(sc.km.length - 1, Math.max(0, bisectRight(sc.km, d + 1e-9)));
}

// ------------------------------------------------------------------ metrics

export type Metric = "cap" | "rtt" | "loss" | "sig";
export const METRICS: { value: Metric; label: string; title: string; unit: string }[] = [
  { value: "cap", label: "Capacity", title: "Uplink capacity", unit: "Mbps" },
  { value: "rtt", label: "RTT", title: "Round-trip time", unit: "ms" },
  { value: "loss", label: "Loss", title: "Packet loss", unit: "%" },
  { value: "sig", label: "Signal", title: "Signal strength", unit: "dBm" },
];

/** Value of a metric in display units (Mbps, ms, %, dBm); null when not reported. */
export function metricValue(p: LinkProfile, m: Metric, i: number): number | null {
  switch (m) {
    case "cap": return p.cap[i] / 1000;
    case "rtt": return p.rtt[i];
    case "loss": return p.loss[i] * 100;
    case "sig": return p.sig[i];
  }
}
export function fmtMetric(m: Metric, v: number | null | undefined): string {
  if (v === null || v === undefined) return "–";
  switch (m) {
    case "cap": return fmtMbps(v * 1000);
    case "rtt": return fmtMs(v);
    case "loss": return `${v < 10 ? v.toFixed(1) : Math.round(v)}%`;
    case "sig": return fmtDbm(v);
  }
}

/**
 * y domain of a metric over every variant (so switching variants keeps the axes still).
 * Only values where the link is up count, apart from signal (reported while down too).
 */
export function metricDomain(sc: Scenario, m: Metric): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of Object.values(sc.variants)) {
    for (const ln of LINK_ORDER) {
      const p = v.profile[ln];
      if (!p) continue;
      for (let i = 0; i < sc.km.length; i++) {
        if (m !== "sig" && !p.up[i]) continue;
        const x = metricValue(p, m, i);
        if (x === null) continue;
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
      if (m !== "sig") {
        const c = v.crater_starlink;
        if (ln === "starlink") for (let i = 0; i < c.km.length; i++) {
          const x = m === "cap" ? c.cap[i] / 1000 : m === "rtt" ? c.rtt[i] : c.loss[i] * 100;
          if (x > hi) hi = x;
        }
      }
    }
  }
  if (!Number.isFinite(lo)) return [0, 1];
  if (m === "sig") return [Math.floor(lo / 10) * 10, Math.ceil(hi / 10) * 10];
  return [0, hi];
}

/** Reference line per metric and link (the limit the band colouring uses). */
export function metricRefs(sc: Scenario, m: Metric, link: LinkName, rule: GoodRule): { value: number; label: string; assumed: boolean }[] {
  if (m === "rtt") return [{ value: rule.maxRttMs, label: `Driving camera limit ${fmtMs(rule.maxRttMs)}`, assumed: false }];
  if (m === "loss") return [{ value: rule.maxLoss * 100, label: `Driving camera limit ${fmtFrac(rule.maxLoss, 0)}`, assumed: false }];
  if (m === "sig") {
    const lc = sc.link_config.find((l) => l.name === link);
    if (lc?.signal_unusable !== undefined) return [{ value: lc.signal_unusable, label: `Unusable below ${fmtDbm(lc.signal_unusable)}`, assumed: true }];
  }
  return [];
}

// ------------------------------------------------------------------ variants

/** Plain sentence of what a variant changes against the nominal parameters. */
export function variantDiff(sc: Scenario, name: string): string[] {
  const v = sc.variants[name];
  const base = sc.variants.nominal?.params;
  if (!v || !base || name === "nominal") return [];
  const o = v.overrides;
  const out: string[] = [];
  if (o.ho_p_out !== undefined || o.ho_out_s !== undefined) {
    const p = v.params;
    out.push(`Starlink handover outage chance ${pctOf(p.ho_p_out)} (nominal ${pctOf(base.ho_p_out)}), `
      + `${secRange(p.ho_out_s[0], p.ho_out_s[1])} long (nominal ${secRange(base.ho_out_s[0], base.ho_out_s[1])})`);
  }
  if (o.jam_zone !== undefined) out.push(`Contested zone ${kmRange(v.params.jam_zone[0], v.params.jam_zone[1])} (nominal ${kmRange(base.jam_zone[0], base.jam_zone[1])})`);
  if (o.jam_ramp_km !== undefined) out.push(`jamming ramps over ${num(v.params.jam_ramp_km)} km (nominal ${num(base.jam_ramp_km)} km)`);
  if (o.blackout_at !== undefined) out.push(`blackout at ${fmtKm(v.params.blackout_at)} (nominal ${fmtKm(base.blackout_at)})`);
  if (o.blackout_s !== undefined) out.push(`${num(v.params.blackout_s)} s blackout (nominal ${num(base.blackout_s)} s)`);
  if (o.lte === false) out.push("No 4G anywhere on the route");
  if (o.lte_route === true) out.push("Cell-edge 4G along the whole route (nominal: only near the two towers)");
  if (o.fade !== undefined) {
    const w = v.params.fade[1] - v.params.fade[0];
    const wb = base.fade[1] - base.fade[0];
    out.push(`Radio fades over ${kmRange(v.params.fade[0], v.params.fade[1])}, ${num(w)} km (nominal ${kmRange(base.fade[0], base.fade[1])}, ${num(wb)} km)`);
  }
  if (o.crater_cap !== undefined) out.push(`Starlink in the crater ${fmtMbps(v.params.crater_cap)} (nominal ${fmtMbps(base.crater_cap)})`);
  if (o.buffer_scale !== undefined) out.push(`Modem buffers ×${num(v.params.buffer_scale)} (nominal ×${num(base.buffer_scale)})`);
  // Join: first clause capitalised, the rest joined with commas.
  return out;
}
export function variantSentence(sc: Scenario, name: string): string {
  const parts = variantDiff(sc, name);
  if (name === "nominal") return v0(sc, name);
  if (parts.length === 0) return "Same parameters as nominal.";
  const s = parts.map((p, i) => (i === 0 ? p : lowerFirst(p))).join("; ");
  return s.charAt(0).toUpperCase() + s.slice(1) + ".";
}
function v0(sc: Scenario, name: string): string {
  return sc.variants[name]?.description ?? "";
}
export function variantHasAssumed(sc: Scenario, name: string): boolean {
  const o = sc.variants[name]?.overrides ?? {};
  return (Object.keys(o) as (keyof VariantParams)[]).some((k) => ASSUMED_PARAMS.has(k));
}

// ------------------------------------------------------------------ zones

/** Zone kinds that share one highlight (the ramp is part of the contested zone). */
export function zoneKey(kind: Zone["kind"]): string {
  return kind === "jamming_ramp" ? "jamming" : kind;
}
export const SPAN_KINDS: ReadonlySet<string> = new Set(["fade", "obstruction", "crater", "jamming"]);

// ------------------------------------------------------------------ assumptions rail

export interface AssumptionItem {
  key: string;
  group: string;
  text: string;
  /** Zone keys (zoneKey) this item highlights on the route chart. */
  zones: string[];
  /** Where the (A) mark is in the source. */
  source: string;
  /** km to show in Replay (first outbound pass), if the item is a place. */
  km?: number;
}

function profileAt(sc: Scenario, v: VariantInfo, link: LinkName, d: number) {
  const i = kmIndex(sc, d);
  const p = v.profile[link];
  return { up: p.up[i], sig: p.sig[i], loss: p.loss[i], rtt: p.rtt[i], cap: p.cap[i] };
}

export function assumptionItems(sc: Scenario, variant: string): AssumptionItem[] {
  const v = sc.variants[variant];
  if (!v) return [];
  const P = v.params;
  const items: AssumptionItem[] = [];
  const zone = (k: string) => v.zones.find((z) => z.kind === k);
  const lc = (n: LinkName) => sc.link_config.find((l) => l.name === n);

  // Route and links ---------------------------------------------------------
  const f0 = profileAt(sc, v, "radio", P.fade[0]);
  const f1 = profileAt(sc, v, "radio", P.fade[1]);
  const radioUnusable = lc("radio")?.signal_unusable;
  items.push({
    key: "fade", group: "Route", zones: ["fade"], km: P.fade[0], source: "sim/scenario.py DEFAULTS fade; config signal_unusable",
    text: `Radio fades over the ridge, ${kmRange(P.fade[0], P.fade[1])}: ${fmtDbm(f0.sig)} to ${fmtDbm(f1.sig)}`
      + (radioUnusable !== undefined ? `, unusable below ${fmtDbm(radioUnusable)}.` : "."),
  });
  const nr = zone("no_radio");
  if (nr) {
    const mid = profileAt(sc, v, "radio", (nr.from_km + nr.to_km) / 2);
    items.push({
      key: "no_radio", group: "Route", zones: ["no_radio"], km: nr.from_km, source: "sim/scenario.py link_state (terrain beyond the ridge)",
      text: `Beyond ${fmtKm(nr.from_km)} the radio is ${mid.up ? "up" : "down"} at ${fmtDbm(mid.sig)}.`,
    });
  }
  const towers = v.zones.filter((z) => z.kind === "tower");
  const lteUnusable = lc("lte")?.signal_unusable;
  // No 4G (variant no_lte) is a scenario switch without an (A) mark, so it is not listed here.
  if (P.lte && towers.length) {
    const p = v.profile.lte;
    const usable = lteUnusable !== undefined
      ? rangesWhere(sc.km, (i) => p.up[i] === 1 && p.sig[i] !== null && (p.sig[i] as number) >= lteUnusable)
      : [];
    const list = (xs: string[]) => xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
    const fullRoute = usable.length === 1 && usable[0][0] <= sc.km[0] && usable[0][1] >= sc.km[sc.km.length - 1];
    items.push({
      key: "tower", group: "Route", zones: ["tower"], km: towers[towers.length - 1].from_km, source: "sim/scenario.py link_state (base and village towers)",
      text: `4G towers at ${list(towers.map((z) => fmtKm(z.from_km)))}.`
        + (lteUnusable !== undefined && usable.length && !fullRoute
          ? ` 4G stays above ${fmtDbm(lteUnusable)} over ${list(usable.map(([a, b]) => kmRange(a, b)))}.` : ""),
    });
  }
  const cov = zone("coverage");
  if (cov) {
    const sig = profileAt(sc, v, "lte", 1.0).sig;
    items.push({
      key: "coverage", group: "Route", zones: ["coverage"], km: cov.from_km, source: "sim/scenario.py make_ctx lte_edge; export_viewer.py EDGE_RSRP",
      text: `Cell-edge 4G along the whole route, drawn here at its mean of ${fmtDbm(sig)}. In the runs it fades in and out around that.`,
    });
  }
  const ob = zone("obstruction");
  if (ob) {
    const st = profileAt(sc, v, "starlink", (ob.from_km + ob.to_km) / 2);
    items.push({
      key: "obstruction", group: "Route", zones: ["obstruction"], km: ob.from_km, source: "sim/scenario.py link_state (dense tree cover)",
      text: `Dense trees at ${kmRange(ob.from_km, ob.to_km)}: Starlink ${st.up ? "up" : "down"}.`,
    });
  }
  const cr = zone("crater");
  if (cr) {
    const c = v.crater_starlink;
    const inside = c.km.map((_, i) => i).filter((i) => c.km[i] < cr.to_km - 1e-9);
    const caps = inside.map((i) => c.cap[i]);
    const cap = caps.length ? Math.max(...caps) : P.crater_cap;
    items.push({
      key: "crater", group: "Route", zones: ["crater"], km: cr.from_km, source: "sim/scenario.py DEFAULTS crater_cap",
      text: `In the crater (${kmRange(cr.from_km, cr.to_km)}) Starlink carries ${fmtMbps(cap)} while the driver is in a crater state.`,
    });
  }
  const jz = zone("jamming");
  if (jz) {
    const s = v.profile.starlink;
    const idx = sc.km.map((_, i) => i).filter((i) => sc.km[i] >= jz.from_km - 1e-9 && sc.km[i] <= jz.to_km + 1e-9);
    const outside = profileAt(sc, v, "starlink", Math.max(0, jz.from_km - 0.2));
    const maxLoss = Math.max(...idx.map((i) => s.loss[i]));
    const maxRtt = Math.max(...idx.map((i) => s.rtt[i]));
    const minCap = Math.min(...idx.map((i) => s.cap[i]));
    items.push({
      key: "jamming", group: "Route", zones: ["jamming"], km: jz.from_km, source: "sim/scenario.py DEFAULTS jam_zone, jam_ramp_km",
      text: `Contested zone ${kmRange(jz.from_km, jz.to_km)}, both directions. Jamming ramps up over ${num(P.jam_ramp_km)} km `
        + `to ${fmtFrac(maxLoss)} loss, +${fmtMs(maxRtt - outside.rtt)} RTT and ${fmtMbps(minCap)} on Starlink.`,
    });
  }
  items.push({
    key: "trigger", group: "Route", zones: ["trigger"], km: P.blackout_at, source: "sim/scenario.py DEFAULTS blackout_at, blackout_s",
    text: `Jammer blackout: Starlink down for ${num(P.blackout_s)} s the first time the vehicle passes ${fmtKm(P.blackout_at)}. Once per mission.`,
  });

  // Starlink -----------------------------------------------------------------
  const ho = sc.starlink_handover;
  items.push({
    key: "ho", group: "Starlink", zones: [], source: "sim/scenario.py DEFAULTS ho_p_out, ho_out_s",
    text: `Each handover causes an outage with chance ${pctOf(P.ho_p_out)}, lasting ${secRange(P.ho_out_s[0], P.ho_out_s[1])}.`,
  });
  items.push({
    key: "burst", group: "Starlink", zones: [], source: "sim/scenario.py make_ctx (gateway congestion burst)",
    text: `One gateway congestion burst at ${num(ho.congestion_burst.from_s)}–${num(ho.congestion_burst.to_s)} s adds ${fmtMs(ho.congestion_burst.extra_rtt_ms)} RTT, every seed.`,
  });

  // Links --------------------------------------------------------------------
  const caps = LINK_ORDER.map((n) => lc(n)).filter(Boolean).map((l) => `${linkLabel(l!.name)} ${fmtMbps(l!.nominal_kbps)}`);
  items.push({ key: "nominal", group: "Links", zones: [], source: "config/sim_themis.yaml links nominal_kbps", text: `Uplink at good signal: ${caps.join(", ")}.` });
  const unus = LINK_ORDER.map((n) => lc(n)).filter((l) => l?.signal_unusable !== undefined)
    .map((l) => `${linkLabel(l!.name)} below ${fmtDbm(l!.signal_unusable)}`);
  if (unus.length) items.push({ key: "unusable", group: "Links", zones: [], source: "config/sim_themis.yaml links signal_unusable", text: `Signal counted as unusable: ${unus.join(", ")}.` });
  const st = sc.link_config.find((l) => l.handover_schedule)?.handover_schedule;
  if (st) items.push({
    key: "prepost", group: "Links", zones: [], source: "config/sim_themis.yaml handover_schedule pre_s, post_s",
    text: `Handover risk window used by Proposed: ${num(st.pre_s)} s before to ${num(st.post_s)} s after each handover.`,
  });

  // Vehicle and operator ----------------------------------------------------
  const k = sc.constants;
  items.push({ key: "vmax", group: "Vehicle and operator", zones: [], source: "sim/engine.py VMAX", text: `Top speed ${num(k.VMAX_mps)} m/s at full throttle.` });
  items.push({ key: "fresh", group: "Vehicle and operator", zones: [], source: "sim/engine.py FRESH_S", text: `A view counts as live while its newest frame is under ${num(k.FRESH_S)} s old.` });
  items.push({ key: "creep", group: "Vehicle and operator", zones: [], source: "sim/engine.py CREEP_MPS, CREEP_AFTER_S", text: `Lost-link creep at ${num(k.CREEP_MPS)} m/s after ${num(k.CREEP_AFTER_S)} s without an executed command.` });
  items.push({ key: "hub", group: "Vehicle and operator", zones: [], source: "sim/engine.py HUB_TO_OP_MS", text: `Hub to operator delay ${fmtMs(k.HUB_TO_OP_MS)}.` });
  items.push({ key: "req", group: "Vehicle and operator", zones: [], source: "config/sim_themis.yaml requirements", text: "What the operator needs per manoeuvre (camera, frame age, frame rate, width): see the driver script table." });
  items.push({ key: "tmax", group: "Vehicle and operator", zones: [], source: "sim/scenario.py T_MAX", text: `A run stops at ${num(k.T_MAX_S / 60)} min (${num(k.T_MAX_S)} s) if the mission has not ended.` });

  // Uploads ------------------------------------------------------------------
  const dr = sc.driver;
  const req = [
    `${lowerFirst(uploadLabel(dr.scan_drive.id))} ${num(dr.scan_drive.size_mb)} MB`,
    ...Object.values(dr.events).flat().map((e) => `${lowerFirst(uploadLabel(e.id))} ${num(e.size_mb)} MB`),
  ];
  items.push({
    key: "uploads", group: "Uploads", zones: ["event", "site", "crater"], source: "sim/scenario.py Driver.EVENTS sizes; scan at 1.70 km",
    text: `Requested: ${req.join(", ")}.`,
  });
  items.push({
    key: "bg", group: "Uploads", zones: [], source: "sim/engine.py bg_chunks",
    text: `Background every ${num(dr.background_every_s)} s: ${dr.background_items.map((b) => `${lowerFirst(uploadLabel(b.kind))} ${num(b.size_mb)} MB`).join(" and ")}.`,
  });
  return items;
}

// ------------------------------------------------------------------ run lookups (km -> t)

/** First sample index where the vehicle reaches km `d` on the given leg; -1 if never. */
export function passIndex(run: RunData, d: number, leg: "out" | "back"): number {
  const S = run.samples;
  const n = S.t.length;
  if (leg === "out") {
    for (let i = 0; i < n; i++) if (S.dir[i] > 0 && S.d[i] >= d - 1e-4) return i;
    return -1;
  }
  for (let i = 0; i < n; i++) if (S.dir[i] < 0 && S.d[i] <= d + 1e-4) return i;
  return -1;
}
export function passTime(run: RunData | null, d: number, leg: "out" | "back"): number | null {
  if (!run) return null;
  const i = passIndex(run, d, leg);
  return i < 0 ? null : run.samples.t[i];
}

export interface StateEntry { state: DriverState; t: number; d: number }
/** First entry into each driver state, from run.state_changes. */
export function stateEntries(run: RunData | null): Map<string, StateEntry> {
  const m = new Map<string, StateEntry>();
  if (!run) return m;
  for (const [t, d, code] of run.state_changes) {
    const s = dec(run, "state", code);
    if (s && !m.has(s)) m.set(s, { state: s, t, d });
  }
  // The engine stops the moment the driver enters END (sim/engine.py: done -> mission_time),
  // so END is never logged as a state change; a completed run entered it at mission end.
  if (!m.has("END") && run.meta.completed) {
    const n = run.samples.d.length - 1;
    m.set("END", { state: "END", t: run.meta.mission_time_s, d: run.samples.d[n] });
  }
  return m;
}

/**
 * Throttle values the trace shows in a state that differ from the state table (the script
 * has position overrides, e.g. slower on the return through the contested zone).
 */
export function throttleOverrides(run: RunData | null, state: string, table: number): { thr: number; from: number; to: number } | null {
  if (!run) return null;
  const S = run.samples;
  let thr: number | null = null;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < S.t.length; i++) {
    if (dec(run, "state", S.state[i]) !== state) continue;
    const x = S.thr_int[i];
    if (Math.abs(x - table) > 1e-6 && !S.fs[i]) {
      if (thr === null) thr = x;
      if (Math.abs(x - thr) < 1e-6) { lo = Math.min(lo, S.d[i]); hi = Math.max(hi, S.d[i]); }
    }
  }
  return thr === null ? null : { thr, from: lo, to: hi };
}

/**
 * True manoeuvre in the first sample at or after time t (an upload created at t was
 * requested by the state the driver entered at t, which the next sample shows).
 */
export function manoeuvreAt(run: RunData, t: number): Manoeuvre | null {
  const i = Math.max(0, Math.min(run.samples.t.length - 1, bisectRight(run.samples.t, t - 1e-6) + 1));
  return dec(run, "man", run.samples.man[i]);
}

/** Requirement text: "Front camera, 0.5 s old at most, 10 fps or more, 320 px wide or more". */
export function requirementParts(sc: Scenario, man: Manoeuvre): { cam: string; age: string; fps: string; width: string } | null {
  const r = sc.requirements[man];
  if (!r) return null;
  return { cam: camLabel(r.cam), age: `${num(r.max_age_s)} s`, fps: `${num(r.min_fps)} fps`, width: `${num(r.min_w)} px` };
}

export { manoeuvreLabel, variantLabel, fmtNum };
