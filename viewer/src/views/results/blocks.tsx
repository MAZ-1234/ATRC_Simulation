/**
 * The Results sections (DESIGN.md 6.2), in reading order. Every claim is a template
 * filled from results.js; every threshold is read from scenario.js (requirements, crater
 * capacity, upload sizes). Moments for "Show in replay" are computed from the traces.
 * Words about how a controller decides follow edge_mlc/deciders/*.py and sim/*.py.
 */
import { useMemo, useState } from "react";
import { Button, Legend, ctrlVar, type LegendItem } from "../../components";
import {
  getResults, getScenario, getManifest, configLabel, variantLabel, segmentLabel, tableObjects,
  fmtRate, fmtNum, fmtCount, fmtMB, fmtPct, loadRun, peekRun, runIdFor, typicalSeed,
} from "../../data/loader";
import type { RunData } from "../../data/types";
import { Block } from "./Block";
import { DotFacets, facet, type DotFacet, type DotMark, type DotRow } from "./DotFacets";
import { LineBand, type Series } from "./LineBand";
import { RibbonPair } from "./Ribbons";
import { ReplayLink } from "./ReplayLink";
import { c, lc, textOf, type Parts } from "./prose";
import {
  sm, has, compare, pctPair, pairedWins, def, fpair, fv, scopeOf, sweepMetric, sourceInfo, variantsIn, nOf,
} from "./data";
import {
  bestTransition, craterMoment, firstManoeuvre, longestDivergence, longestNeither, segmentStart,
  uploadRequested, worstQueue, type MomentSpec,
} from "./moments";

// ------------------------------------------------------------------ shared bits

export const CI_NOTE = "Dot = mean, bar = 95% CI";
export const ENGINE_NOTE = "Interruptions are the simulator's own count (engine metric), not counted from traces.";

export function caption(n: number | string | null, extra?: string, table = "summary.csv"): string {
  const src = sourceInfo().dir;
  const nn = typeof n === "string" && /seed/.test(n) ? n : `${n ?? "–"} seeds`;
  return `${CI_NOTE}, n = ${nn}.${extra ? ` ${extra}` : ""} Source: ${src}/${table}.`;
}

export function configRows(configs: string[], subs: Record<string, string> = {}): DotRow[] {
  return configs.map((cfg) => ({ key: cfg, label: configLabel(cfg), config: cfg, sub: subs[cfg] }));
}

export const marksFor = (variant: string) => (row: DotRow, f: DotFacet): DotMark[] =>
  [{ config: row.config!, m: sm(row.config!, variant, f.key) }];

export const pairLegend: LegendItem[] = [
  { key: "b", label: "Baseline", mark: "dot", color: ctrlVar("Baseline"), edge: "var(--color-ctrl-baseline-edge)" },
  { key: "p", label: "Proposed", mark: "dot", color: ctrlVar("Proposed") },
];

/** Operator requirement for a true manoeuvre, from scenario.js (all (A)). */
export function req(man: "DRIVE" | "REVERSE" | "PRECISION" | "STOPPED") {
  return getScenario()?.requirements?.[man] ?? null;
}

export const minN = (...ns: (number | null)[]) => {
  const v = ns.filter((x): x is number => typeof x === "number");
  return v.length ? Math.min(...v) : null;
};

// ------------------------------------------------------------------ Headline

export function Headline({ variant }: { variant: string }) {
  const configs = ["Baseline", "Baseline + duplicate video", "Proposed"].filter((x) => has(x, variant));
  const rows = useMemo(() => configRows(configs), [variant]); // eslint-disable-line
  const facets = useMemo(() => [
    facet("useful_view_pct", { full: true }),
    facet("interruptions"), facet("longest_interruption_s"), facet("video_delay_p95_bulk_ms"),
    facet("req_mean_s"), facet("mission_time_s", { tickFormat: (v) => fmtCount(v) }), facet("dup_overhead_pct"),
  ], []);
  const P = sm("Proposed", variant, "useful_view_pct");
  const B = sm("Baseline", variant, "useful_view_pct");
  const D = sm("Baseline + duplicate video", variant, "useful_view_pct");
  const pb = compare(P, B, "higher");
  const [pp, bb] = pctPair(P.mean, B.mean);
  const claim: Parts = pb.aBetter
    ? [c("Proposed"), ` keeps a usable view for ${pp} of the mission. `, c("Baseline"), ` manages ${bb}.`]
    : [c("Baseline"), ` keeps a usable view for ${bb} of the mission. `, c("Proposed"), ` manages ${pp}.`];

  const detail: Parts = [];
  const wins = pairedWins("Proposed", "Baseline", variant, "useful_view_pct", "higher");
  if (wins.n > 0) detail.push(c("Proposed"), ` is ahead on ${wins.wins} of ${wins.n} seeds. `);
  const Pi = sm("Proposed", variant, "interruptions"), Bi = sm("Baseline", variant, "interruptions");
  const [pi, bi] = fpair("interruptions", Pi.mean, Bi.mean);
  detail.push(`It has ${pi} view interruptions per mission against ${bi}. `);
  if (D.mean !== null) {
    const ov = sm("Baseline + duplicate video", variant, "dup_overhead_pct");
    const [dd] = pctPair(D.mean, B.mean);
    detail.push("Duplicating video ", compare(D, B, "higher").aBetter ? "lifts " : "leaves ", c("Baseline"),
      ` ${compare(D, B, "higher").aBetter ? "to" : "at"} ${dd}, for ${fmtPct(ov.mean)} extra data. `);
  }
  const Pd = sm("Proposed", variant, "video_delay_p95_bulk_ms"), Bd = sm("Baseline", variant, "video_delay_p95_bulk_ms");
  if (Pd.mean !== null && Bd.mean !== null && Pd.mean > Bd.mean) {
    const [pd, bd] = fpair("video_delay_p95_bulk_ms", Pd.mean, Bd.mean);
    detail.push("One loss shows here: while uploading, ", c("Proposed"), `'s video delay p95 is ${pd} against ${bd}.`);
  }

  const r = req("DRIVE");
  const n = nOf("Proposed", variant);
  const spec: MomentSpec = useMemo(() => ({
    key: "headline", variant, needs: ["left", "right"], what: "the longest stretch only Proposed could see",
    compute: (p) => longestDivergence(p, "right", "the longest stretch only Proposed could see"),
  }), [variant]);
  return (
    <Block id="headline" title="Headline" scope={scopeOf(variant)} claim={claim} detail={detail}
      chart={
        <DotFacets title="Usable view, interruptions and costs by configuration" cols={3} rows={rows} facets={facets}
          marks={marksFor(variant)} n={n} labelWidth={176}
          ariaLabel={`Usable view: Proposed ${pp}, Baseline ${bb}, Baseline + duplicate video ${fmtPct(D.mean)}.`}
          caption={caption(n, ENGINE_NOTE)} />
      }
      caveat={r
        ? <>usable view is scored against the operator requirements, which are assumptions (A). Driving, for example, needs the {r.cam} camera at {r.min_fps} fps or more, at most {r.max_age_s} s old and at least {r.min_w} px wide.</>
        : <>usable view is scored against the operator requirements table, which is an assumption (A).</>}
      replay={<ReplayLink spec={spec} preload />}
    />
  );
}

// ------------------------------------------------------------------ When a link changes (Experiment A)

export function Transitions({ variant }: { variant: string }) {
  const configs = ["Baseline", "Baseline + duplicate video", "Proposed", "Proposed - mission", "Proposed - predict"].filter((x) => has(x, variant));
  const rows = useMemo(() => configRows(configs), [variant]); // eslint-disable-line
  const facets = useMemo(() => [
    facet("useful_transition_pct"), facet("interruptions_transition"),
    facet("n_transition_events"), facet("radio_leave_minus_fail_s", { ref: { value: 0, label: "Radio failed" } }),
  ], []);
  const P = sm("Proposed", variant, "useful_transition_pct");
  const B = sm("Baseline", variant, "useful_transition_pct");
  const D = sm("Baseline + duplicate video", variant, "useful_transition_pct");
  const [pp, bb] = pctPair(P.mean, B.mean);
  const claim: Parts = ["Around a link change, ", c("Proposed"), `'s view is usable ${pp} of the time; `, c("Baseline"), `'s ${bb}.`];

  const detail: Parts = [];
  const Pi = sm("Proposed", variant, "interruptions_transition"), Bi = sm("Baseline", variant, "interruptions_transition");
  const [pi, bi] = fpair("interruptions_transition", Pi.mean, Bi.mean);
  detail.push(`Interruptions starting inside these windows: ${pi} for `, c("Proposed"), `, ${bi} for `, c("Baseline"), ". ");
  if (D.mean !== null) {
    const [dd] = pctPair(D.mean, B.mean);
    const up = compare(D, B, "higher").aBetter;
    detail.push("Duplicating video ", up ? "lifts " : "leaves ", c("Baseline"), ` ${up ? "to" : "at"} ${dd}. `);
  }
  const Pr = sm("Proposed", variant, "radio_leave_minus_fail_s"), Br = sm("Baseline", variant, "radio_leave_minus_fail_s");
  const when = (v: number | null) => v === null ? "–" : v < 0 ? `${fmtNum(-v, 1)} s before it failed` : v > 0 ? `${fmtNum(v, 1)} s after it failed` : "as it failed";
  if (Pr.mean !== null && Br.mean !== null) {
    detail.push("At the ridge, the view left the radio ", `${when(Pr.mean)} on average for `, c("Proposed"), `, ${when(Br.mean)} for `, c("Baseline"), ".");
  }
  const ev = sm("Proposed", variant, "n_transition_events");
  const n = nOf("Proposed", variant);
  const spec: MomentSpec = useMemo(() => ({
    key: "transitions", variant, needs: ["left", "right"], what: "a link change", compute: bestTransition,
  }), [variant]);
  return (
    <Block id="transitions" title="When a link changes" scope={scopeOf(variant)} claim={claim} detail={detail}
      chart={
        <DotFacets title="Behaviour from 2 s before to 10 s after each link change" cols={2} rows={rows} facets={facets}
          marks={marksFor(variant)} n={n} labelWidth={176}
          ariaLabel={`Usable view around link changes: Proposed ${pp}, Baseline ${bb}.`}
          caption={caption(n, `${fmtNum(ev.mean, 1)} ground-truth link changes per mission (Proposed). Negative radio times: the view left before the radio failed. ${ENGINE_NOTE}`)} />
      }
      // DESIGN-GAP: the window bounds (2 s before, 10 s after) and the merge rule are constants in
      // sim/engine.py (metrics, transition_events); results.js does not export them.
      caveat={<>a window runs from 2 s before to 10 s after each ground-truth link change (a link going up or down, or the best true capacity changing sharply); overlapping windows are merged (sim/engine.py).</>}
      replay={<ReplayLink spec={spec} preload />}
    />
  );
}

// ------------------------------------------------------------------ Upload policies (Experiment B)

export const POLICY: Record<string, { name: string; sub: string }> = {
  "Proposed - uploads": { name: "Video-first", sub: "Proposed - uploads" },
  "Proposed (urgent_first)": { name: "Urgent-first", sub: "Proposed (urgent_first)" },
  Proposed: { name: "Adaptive", sub: "Proposed" },
};

export function policyRows(variant = "nominal"): DotRow[] {
  return Object.entries(POLICY).filter(([cfg]) => has(cfg, variant))
    .map(([cfg, p]) => ({ key: cfg, label: p.name, sub: p.sub, config: cfg }));
}
export const adaptive = () => c("Proposed", "adaptive");
export const Adaptive = () => c("Proposed", "Adaptive");
export const urgentFirst = (cap = false) => c("Proposed (urgent_first)", cap ? "Urgent-first" : "urgent-first");
export const videoFirst = (cap = false) => c("Proposed - uploads", cap ? "Video-first" : "video-first");

export function Uploads() {
  const variant = "nominal";
  const rows = useMemo(() => policyRows(variant), []);
  const r = req("DRIVE");
  const limit = r ? { ref: { value: r.min_fps, label: "Usability limit", kind: "limit" as const } } : {};
  const facets = useMemo(() => [
    facet("scan_drive_s"), facet("lidar_crater_s"), facet("still_s"), facet("clip_s"),
    facet("needed_fps_while_req_drive", limit), facet("fps_delivered_mean_DRIVE", limit),
    facet("interruptions"), facet("useful_view_pct"),
  ], []); // eslint-disable-line
  const A = sm("Proposed", variant, "needed_fps_while_req_drive");
  const U = sm("Proposed (urgent_first)", variant, "needed_fps_while_req_drive");
  const [aa, uu] = fpair("needed_fps_while_req_drive", A.mean, U.mean);
  const lim = r?.min_fps ?? null;
  const cam = r?.cam ?? "needed";
  const claim: Parts = [Adaptive(), ` keeps the ${cam} camera at ${aa} while the driving scan uploads; `, urgentFirst(), ` drops it to ${uu}.`];

  const detail: Parts = [];
  if (U.mean !== null && lim !== null) {
    const rel = U.mean < lim ? "below" : U.mean - lim < 0.5 ? "right at" : "above";
    detail.push(`Driving needs ${lim} fps or more (requirements, A), so `, urgentFirst(), ` runs ${rel} the limit. `);
  }
  const Ac = sm("Proposed", variant, "lidar_crater_s"), Uc = sm("Proposed (urgent_first)", variant, "lidar_crater_s"), Vc = sm("Proposed - uploads", variant, "lidar_crater_s");
  const [ac, uc] = fpair("lidar_crater_s", Ac.mean, Uc.mean);
  if (compare(Uc, Ac, "lower").aBetter) detail.push(urgentFirst(true), ` delivers the crater scan in ${uc}, `, adaptive(), ` in ${ac}`);
  else detail.push(Adaptive(), ` delivers the crater scan in ${ac}, `, urgentFirst(), ` in ${uc}`);
  if (Vc.mean !== null) detail.push(", ", videoFirst(), ` in ${fv("lidar_crater_s", Vc.mean)}. `);
  else detail.push(". ");
  const Ai = sm("Proposed", variant, "interruptions"), Ui = sm("Proposed (urgent_first)", variant, "interruptions");
  const [ai, ui] = fpair("interruptions", Ai.mean, Ui.mean);
  detail.push(Adaptive(), ` has ${ai} view interruptions, `, urgentFirst(), ` ${ui}.`);

  const n = minN(...rows.map((x) => nOf(x.config!, variant)));
  const spec: MomentSpec = useMemo(() => ({
    key: "uploads", variant, cmp: "Proposed (urgent_first)", needs: ["right"], what: "the scan requested while driving",
    compute: uploadRequested("scan_drive", "the scan requested while driving"),
  }), []);
  return (
    <Block id="uploads" title="Upload policies" scope={scopeOf(variant)} claim={claim} detail={detail}
      chart={
        <DotFacets title="What each upload policy delivers, and what the view pays for it" cols={4} minFacet={136} rows={rows} facets={facets}
          marks={marksFor(variant)} n={n} rowHeader="Upload policy" labelWidth={150}
          ariaLabel={`${cam} camera while the driving scan uploads: adaptive ${aa}, urgent-first ${uu}; the limit is ${lim ?? "–"} fps.`}
          caption={caption(n, lim !== null ? `Red dashed line: driving needs ${lim} fps or more (requirements, A). ${ENGINE_NOTE}` : ENGINE_NOTE)} />
      }
      caveat={<>the three policies share traffic shaping, the choice of upload link and camera allocation; only the order of uploads and video differs. Adaptive puts requested uploads first only while the detected manoeuvre is stopped or precision (deciders/proposed.py).</>}
      replay={<ReplayLink spec={spec} preload />}
    />
  );
}

// ------------------------------------------------------------------ Handover headroom

export const ORACLES = ["Oracle: perfect link choice", "Oracle: every up link"];

export function Handover() {
  const variants = ["nominal", "overlap", "overlap_harsh"].filter((v) => has(ORACLES[0], v) && has("Proposed", v));
  const configs = ["Baseline", "Proposed - predict", "Proposed", ...ORACLES].filter((x) => variants.every((v) => has(x, v)));
  const rows = useMemo(() => configRows(configs), []); // eslint-disable-line
  const facets = useMemo(() => [
    ...variants.map((v) => ({ ...facet("interruptions"), key: `${v}|interruptions`, title: `${variantLabel(v)}: view interruptions (count)` })),
    ...variants.map((v, i) => ({ ...facet("useful_view_pct"), key: `${v}|useful_view_pct`, title: `${variantLabel(v)}: usable view (%)`, newRow: i === 0 })),
  ], []); // eslint-disable-line
  const marks = (row: DotRow, f: DotFacet): DotMark[] => {
    const [v, metric] = f.key.split("|");
    return [{ config: row.config!, m: sm(row.config!, v, metric) }];
  };
  const at = (cfg: string, v: string, m: string) => sm(cfg, v, m).mean;
  const first = variants[0];
  const last = variants[variants.length - 1];
  const claim: Parts = [];
  const detail: Parts = [];
  if (first) {
    const [o, p] = fpair("interruptions", at(ORACLES[0], first, "interruptions"), at("Proposed", first, "interruptions"));
    claim.push(`On the ${lc(variantLabel(first))} mission, a perfect link choice has ${o} interruptions; `, c("Proposed"), ` has ${p}.`);
  }
  if (last && last !== first) {
    const [o, p] = fpair("interruptions", at(ORACLES[0], last, "interruptions"), at("Proposed", last, "interruptions"));
    detail.push(`On the ${lc(variantLabel(last))} variant, a perfect link choice has ${o} against `, c("Proposed"), `'s ${p}. `);
    const [eu, pu] = fpair("useful_view_pct", at(ORACLES[1], last, "useful_view_pct"), at("Proposed", last, "useful_view_pct"));
    detail.push(`Sending on every up link reaches ${eu} usable view there, against `, c("Proposed"), `'s ${pu}. `);
  }
  const allUp = sm(ORACLES[1], "nominal", "dup_overhead_pct");
  if (allUp.mean !== null) detail.push(`That oracle sends ${fmtPct(allUp.mean)} extra data on the nominal mission. `);
  detail.push("Both read the true link state, so neither is deployable.");
  const n = minN(...variants.map((v) => nOf("Proposed", v)));
  const spec: MomentSpec = useMemo(() => ({
    key: "handover", variant: "nominal", cmp: ORACLES[0], needs: ["left", "right"], what: "the longest stretch only the oracle could see",
    compute: (p) => longestDivergence(p, "left", "the longest stretch only the oracle could see"),
  }), []);
  const legend: LegendItem[] = [
    ...pairLegend,
    { key: "o", label: "Other configurations", mark: "ring", color: ctrlVar("other") },
    { key: "u", label: "Oracle interval: upper bound that reads ground truth, not deployable", mark: "dashed", color: ctrlVar("other") },
  ];
  return (
    <Block id="handover" title="Handover headroom" scope={`${variants.map(variantLabel).join(", ")}; n = ${n ?? "–"} seeds or more`} claim={claim} detail={detail}
      chart={
        <DotFacets title="Proposed against two oracles that read the true link state" cols={3} rows={rows} facets={facets}
          marks={marks} n={n} labelWidth={200} legend={<Legend items={legend} />}
          ariaLabel={textOf(claim)}
          caption={caption(variants.map((v) => `${nOf("Proposed", v) ?? "–"} (${lc(variantLabel(v))})`).join(", "), ENGINE_NOTE)} />
      }
      caveat={<>both oracles run Proposed and then overrule the needed camera's link with the simulator's true link state, which no deployed controller can see (sim/oracles.py). They are upper bounds, not deployable.</>}
      replay={<ReplayLink spec={spec} preload note="The oracle is on the left console for comparison only." />}
    />
  );
}

// ------------------------------------------------------------------ Variants

export function Variants() {
  const variants = variantsIn().filter((v) => has("Baseline", v) && has("Proposed", v));
  const rows = useMemo<DotRow[]>(() => variants.map((v) => ({ key: v, label: variantLabel(v) })), []); // eslint-disable-line
  const facets = useMemo(() => [facet("useful_view_pct"), facet("interruptions")], []);
  const marks = (row: DotRow, f: DotFacet): DotMark[] => [
    { config: "Baseline", m: sm("Baseline", row.key, f.key) },
    { config: "Proposed", m: sm("Proposed", row.key, f.key) },
  ];
  const stats = variants.map((v) => {
    const P = sm("Proposed", v, "useful_view_pct");
    const B = sm("Baseline", v, "useful_view_pct");
    const i = compare(sm("Proposed", v, "interruptions"), sm("Baseline", v, "interruptions"), "lower");
    return { v, P, B, cmp: compare(P, B, "higher"), fewerInt: i.aBetter };
  });
  const anyWins = stats.filter((x) => x.cmp.aBetter).length;
  const clearWins = stats.filter((x) => x.cmp.aBetter && x.cmp.clear).length;
  const claim: Parts = [c("Proposed"), ` has the higher usable view in ${anyWins} of ${variants.length} variants`,
    clearWins === anyWins && anyWins > 0 ? ", each with non-overlapping 95% intervals." : `; the 95% intervals do not overlap in ${clearWins}.`];
  const detail: Parts = [];
  const ranked = stats.filter((x) => x.cmp.diff !== null).sort((a, b) => a.cmp.diff! - b.cmp.diff!);
  const lo = ranked[0], hi = ranked[ranked.length - 1];
  if (lo) {
    const [pp, bb] = pctPair(lo.P.mean, lo.B.mean);
    detail.push(`The ${lo.cmp.aBetter ? "smallest margin" : "largest shortfall"} is ${lc(variantLabel(lo.v))}: ${pp} against ${bb}. `);
  }
  if (hi && hi !== lo && hi.cmp.aBetter) {
    const [pp, bb] = pctPair(hi.P.mean, hi.B.mean);
    detail.push(`The largest is ${lc(variantLabel(hi.v))}: ${pp} against ${bb}. `);
  }
  detail.push(c("Proposed"), ` has fewer view interruptions in ${stats.filter((x) => x.fewerInt).length} of ${variants.length}.`);
  const n = minN(...variants.map((v) => nOf("Proposed", v)));
  const src = sourceInfo();

  // Ribbon miniatures (DESIGN.md 6.2): the typical seed of every variant, loaded on request.
  const ribbonIds = variants.map((v) => {
    const seed = typicalSeed(v);
    return { v, seed, l: seed !== null ? runIdFor("Baseline", v, seed) : null, r: seed !== null ? runIdFor("Proposed", v, seed) : null };
  });
  const allIds = ribbonIds.flatMap((x) => [x.l, x.r]).filter((x): x is string => !!x);
  const bytes = (getManifest()?.runs ?? []).filter((r) => allIds.includes(r.id)).reduce((a, r) => a + r.bytes, 0);
  const [ribbonState, setRibbonState] = useState<"off" | "loading" | "on" | "error">(() => allIds.length > 0 && allIds.every((id) => peekRun(id)) ? "on" : "off");
  const loadRibbons = () => {
    setRibbonState("loading");
    // Sequential, so the page stays responsive while each 4 MB file parses.
    allIds.reduce<Promise<unknown>>((p, id) => p.then(() => loadRun(id)), Promise.resolve())
      .then(() => setRibbonState("on")).catch(() => setRibbonState("error"));
  };
  const extra = useMemo(() => ribbonState === "on" ? {
    width: 136,
    render: (row: DotRow, x: number, cy: number) => {
      const ids = ribbonIds.find((q) => q.v === row.key);
      const L = peekRun(ids?.l); const R = peekRun(ids?.r);
      return L && R ? <RibbonPair key={`rb-${row.key}`} x={x} cy={cy} left={L as RunData} right={R as RunData} w={120} /> : null;
    },
  } : undefined, [ribbonState]); // eslint-disable-line
  const seeds = Array.from(new Set(ribbonIds.map((x) => x.seed).filter((x) => x !== null)));
  const spec: MomentSpec = useMemo(() => ({
    key: "variants", variant: lo?.v ?? "nominal", needs: ["left", "right"], what: "the longest stretch only Baseline could see",
    compute: (p) => longestDivergence(p, "left", "the longest stretch only Baseline could see") ?? longestNeither(p, "the longest stretch neither could see"),
  }), [lo?.v]);
  return (
    <Block id="variants" title="Variants" scope={`${variants.length} variants, n = ${n ?? "–"} seeds or more`} claim={claim} detail={detail}
      chart={
        <DotFacets title="Usable view and interruptions in each scenario variant" cols={2} rows={rows} facets={facets} marks={marks}
          n={n} rowHeader="Variant" markHeader="Configuration" labelWidth={176}
          legend={<Legend items={[
            ...pairLegend,
            ...(ribbonState === "on" ? [{ key: "rb", label: `Ribbon: usable view over one mission (top Baseline, bottom Proposed; seed ${seeds.join(", ")})`, mark: "band" as const, color: ctrlVar("Proposed") }] : []),
          ]} />}
          extra={extra}
          actions={ribbonState !== "on" && allIds.length > 0 ? (
            <Button variant="quiet" onClick={loadRibbons} disabled={ribbonState === "loading"}>
              {ribbonState === "loading" ? "Loading ribbons" : ribbonState === "error" ? "Ribbons did not load. Try again" : `Show ribbons (loads ${allIds.length} traces, ${fmtMB(bytes / 1e6)})`}
            </Button>
          ) : undefined}
          ariaLabel={textOf(claim)}
          caption={caption(src.phrase, ENGINE_NOTE)} />
      }
      caveat={<>each variant changes one part of the scenario (scenario.py VARIANTS), and seed counts differ: {src.phrase}.</>}
      replay={<ReplayLink spec={spec} />}
    />
  );
}

// ------------------------------------------------------------------ Ablation

export const ABLATION: Record<string, string> = {
  "Proposed - mission": "mission-aware camera allocation",
  "Proposed - uploads": "adaptive upload scheduling",
  "Proposed - predict": "predictive switching",
};
const ABLATION_SUB: Record<string, string> = {
  Proposed: "all parts on",
  "Proposed - mission": "allocation by manoeuvre off",
  "Proposed - uploads": "uploads always after video",
  "Proposed - predict": "predictive switching off",
  Baseline: "reference",
};

export function Ablation({ variant }: { variant: string }) {
  const configs = ["Proposed", ...Object.keys(ABLATION), "Baseline"].filter((x) => has(x, variant));
  const rows = useMemo(() => configRows(configs, ABLATION_SUB), [variant]); // eslint-disable-line
  const facets = useMemo(() => [facet("useful_view_pct"), facet("interruptions"), facet("useful_crater"), facet("req_mean_s")], []);
  const P = sm("Proposed", variant, "useful_view_pct");
  const abl = Object.keys(ABLATION).filter((x) => has(x, variant)).map((cfg) => {
    const A = sm(cfg, variant, "useful_view_pct");
    return { cfg, A, drop: P.mean !== null && A.mean !== null ? P.mean - A.mean : null };
  });
  const sorted = abl.filter((x) => x.drop !== null).sort((a, b) => b.drop! - a.drop!);
  const top = sorted[0];
  const rest = sorted.slice(1);
  const claim: Parts = [];
  const detail: Parts = [];
  if (top) {
    const [pp, aa] = pctPair(P.mean, top.A.mean);
    claim.push(`Without ${ABLATION[top.cfg]}, usable view ${top.drop! > 0 ? "falls" : "rises"} from ${pp} to ${aa}.`);
    const Pc = sm("Proposed", variant, "useful_crater"), Ac = sm(top.cfg, variant, "useful_crater");
    if (Pc.mean !== null && Ac.mean !== null) {
      const [pc, ac] = pctPair(Pc.mean, Ac.mean);
      detail.push(`In the crater it ${Pc.mean > Ac.mean ? "falls" : "rises"} from ${pc} to ${ac}. `);
    }
  }
  if (rest.length) {
    const maxAbs = Math.max(...rest.map((x) => Math.abs(x.drop!)));
    detail.push(`Switching off ${rest.map((x) => ABLATION[x.cfg]).join(" or ")} moves it by ${fmtNum(maxAbs, maxAbs < 0.1 ? 2 : 1)} points at most`);
    const higher = rest.filter((x) => x.drop! < 0);
    if (higher.length) detail.push("; ", ...higher.flatMap((x, i) => [i ? " and " : "", c(x.cfg)]), " even scores slightly higher, which the last section reports.");
    else detail.push(".");
  }
  const n = nOf("Proposed", variant);
  const rv = req("REVERSE");
  const spec: MomentSpec = useMemo(() => ({
    key: "ablation", variant, needs: ["right"], what: "reversing", compute: firstManoeuvre("REVERSE"),
  }), [variant]);
  return (
    <Block id="ablation" title="Ablation" scope={scopeOf(variant)} claim={claim} detail={detail}
      chart={
        <DotFacets title="Proposed with one part switched off at a time" cols={2} rows={rows} facets={facets}
          marks={marksFor(variant)} n={n} ariaLabel={textOf(claim)} labelWidth={176} caption={caption(n, ENGINE_NOTE)} />
      }
      caveat={<>the ablation runs were scored, not exported as traces, so Replay shows Baseline against the full Proposed.</>}
      replay={<ReplayLink spec={spec} preload note={rv ? `Reversing needs the ${rv.cam} camera (requirements, A).` : undefined} />}
    />
  );
}

// ------------------------------------------------------------------ By segment

export function Segments({ variant }: { variant: string }) {
  const segs = (getScenario()?.segments ?? []).map((s) => s.name).filter((sg) => sm("Proposed", variant, `useful_${sg}`).mean !== null);
  const rows = useMemo<DotRow[]>(() => segs.map((sg) => ({ key: sg, label: segmentLabel(sg) })), [variant]); // eslint-disable-line
  const facets = useMemo<DotFacet[]>(() => [{ ...facet("useful_view_pct"), key: "seg", title: "Usable view in each segment (%)", domain: [0, 100] }], []);
  const marks = (row: DotRow): DotMark[] => [
    { config: "Baseline", m: sm("Baseline", variant, `useful_${row.key}`) },
    { config: "Proposed", m: sm("Proposed", variant, `useful_${row.key}`) },
  ];
  const gaps = segs.map((sg) => {
    const P = sm("Proposed", variant, `useful_${sg}`);
    const B = sm("Baseline", variant, `useful_${sg}`);
    return { sg, P, B, gap: P.mean !== null && B.mean !== null ? P.mean - B.mean : null, clear: compare(P, B, "higher").clear };
  }).filter((g) => g.gap !== null);
  const byGap = [...gaps].sort((a, b) => b.gap! - a.gap!);
  const top = byGap[0];
  const low = byGap[byGap.length - 1];
  const baseAhead = gaps.filter((g) => g.gap! < 0);
  const claim: Parts = [];
  const detail: Parts = [];
  const name = (sg: string) => lc(segmentLabel(sg));
  if (top) {
    const [pp, bb] = pctPair(top.P.mean, top.B.mean);
    claim.push(`The largest gap is in the ${name(top.sg)} segment: `, c("Proposed"), ` ${pp}, `, c("Baseline"), ` ${bb}.`);
  }
  if (baseAhead.length === 0) {
    detail.push(c("Proposed"), `'s mean is higher in all ${gaps.length} segments`);
    if (low && low !== top) {
      const [pp, bb] = pctPair(low.P.mean, low.B.mean);
      detail.push(`; the smallest gap is ${name(low.sg)}, ${pp} against ${bb}${low.clear ? "" : ", with overlapping 95% intervals"}.`);
    } else detail.push(".");
  } else {
    const worst = baseAhead.sort((a, b) => a.gap! - b.gap!)[0];
    const [bb, pp] = pctPair(worst.B.mean, worst.P.mean);
    detail.push(c("Baseline"), `'s mean is higher in ${baseAhead.length === 1 ? "one segment" : `${baseAhead.length} segments`}, `,
      baseAhead.map((g) => name(g.sg)).join(", "), baseAhead.length === 1 ? `: ${bb} against ${pp}` : `; most in ${name(worst.sg)}, ${bb} against ${pp}`,
      worst.clear ? "." : ", with overlapping 95% intervals.");
  }
  const n = nOf("Proposed", variant);
  const spec: MomentSpec = useMemo(() => ({
    key: `segments-${top?.sg}`, variant, needs: ["right"], what: `the start of the ${name(top?.sg ?? "")} segment`,
    compute: segmentStart(top?.sg ?? "", `the start of the ${name(top?.sg ?? "")} segment`),
  }), [variant, top?.sg]);
  return (
    <Block id="segments" title="By segment" scope={scopeOf(variant)} claim={claim} detail={detail}
      chart={
        <DotFacets title="Usable view in each scoring segment, in mission order" rows={rows} facets={facets} marks={marks} n={n}
          rowHeader="Segment" markHeader="Configuration" legend={<Legend items={pairLegend} />} labelWidth={176}
          ariaLabel={textOf(claim)} caption={caption(n)} />
      }
      caveat={<>segments split the route by position on each leg; the crater and the inspection stop are defined by driver state (scenario.py SEGMENTS).</>}
      replay={<ReplayLink spec={spec} preload />}
    />
  );
}

// ------------------------------------------------------------------ Crater capacity

export function Capacity() {
  const t = tableObjects(getResults()?.capacity);
  const configs = Array.from(new Set(t.map((r) => String(r.config))));
  const xValues = Array.from(new Set(t.map((r) => r.crater_cap))).filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
  const series: Series[] = configs.map((cfg) => ({
    config: cfg,
    points: xValues.map((x) => ({ x, m: sweepMetric(t.find((r) => r.config === cfg && r.crater_cap === x) ?? {}, "useful_crater") })),
  }));
  const nominalCap = getScenario()?.variants?.nominal?.params?.crater_cap ?? null;
  const at = (cfg: string, x: number | null) => series.find((s) => s.config === cfg)?.points.find((p) => p.x === x)?.m ?? null;
  const P = at("Proposed", nominalCap);
  const B = at("Baseline", nominalCap);
  const claim: Parts = [];
  const detail: Parts = [];
  if (P && B && nominalCap !== null) {
    const [pp, bb] = pctPair(P.mean, B.mean);
    claim.push(`With the nominal ${fmtRate(nominalCap)} crater link, `, c("Proposed"), `'s crater view is usable ${pp} of the time; `, c("Baseline"), `'s ${bb}.`);
  }
  const catchUp = xValues.find((x) => {
    const p = at("Proposed", x), b = at("Baseline", x);
    return p && b && p.lo !== null && b.hi !== null && b.hi >= p.lo;
  });
  if (xValues.length) {
    if (catchUp !== undefined) {
      detail.push(c("Baseline"), " first reaches ", c("Proposed"), `'s level (overlapping 95% intervals) at ${fmtRate(catchUp)}`);
      const p = at("Proposed", catchUp)!, b = at("Baseline", catchUp)!;
      if (b.mean !== null && p.mean !== null && b.mean > p.mean) {
        const [bb, pp] = pctPair(b.mean, p.mean);
        detail.push(`, where its mean is higher: ${bb} against ${pp}. `);
      } else detail.push(". ");
    } else {
      detail.push(c("Baseline"), " does not reach ", c("Proposed"), `'s level up to ${fmtRate(xValues[xValues.length - 1])}. `);
    }
    const x0 = xValues[0];
    const p0 = at("Proposed", x0), b0 = at("Baseline", x0);
    if (p0 && b0 && x0 !== nominalCap) {
      const [pp, bb] = pctPair(p0.mean, b0.mean);
      detail.push(`At ${fmtRate(x0)}, `, c("Proposed"), ` falls to ${pp} and `, c("Baseline"), ` to ${bb}.`);
    }
  }
  const ns = t.map((r) => r.n).filter((x): x is number => typeof x === "number");
  const n = ns.length ? Math.min(...ns) : null;
  const spec: MomentSpec = useMemo(() => ({ key: "capacity", variant: "nominal", needs: ["right"], what: "arriving at the crater", compute: craterMoment }), []);
  return (
    <Block id="capacity" title="Crater capacity" scope={`Nominal, n = ${n ?? "–"} seeds per point`} claim={claim} detail={detail}
      chart={
        <LineBand title="Usable view in the crater against the crater link's capacity" ariaLabel={textOf(claim)}
          series={series} xValues={xValues} xFmt={(v) => fmtRate(v)} xHeader="Crater link capacity" yTitle="Usable view in the crater (%)"
          yDomain={[0, 100]} yDp={1} yFmt={(v) => fmtPct(v)} n={n}
          refLine={nominalCap !== null ? { x: nominalCap, label: `Nominal: ${fmtRate(nominalCap)}` } : undefined}
          caption={`Line = mean, band = 95% CI, n = ${n ?? "–"} seeds per point. Capacity on a log scale. Source: ${sourceInfo().dir}/capacity.csv.`} />
      }
      caveat={<>the crater link capacity is a scenario assumption (A), and the sweep uses fewer seeds than the headline, so its nominal point differs slightly from the Headline's.</>}
      replay={<ReplayLink spec={spec} preload />}
    />
  );
}

// ------------------------------------------------------------------ Buffer size

export function Buffer() {
  const t = tableObjects(getResults()?.buffer);
  const configs = Array.from(new Set(t.map((r) => String(r.config))));
  const sizes = Array.from(new Set(t.map((r) => r.buffer_ms))).filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
  const nominalMs = t.find((r) => typeof r.buffer_scale === "number" && Math.abs((r.buffer_scale as number) - 1) < 1e-6)?.buffer_ms as number | undefined;
  const rows = useMemo<DotRow[]>(() => sizes.map((ms) => ({ key: String(ms), label: `${ms} ms${ms === nominalMs ? " (nominal)" : ""}` })), []); // eslint-disable-line
  const facets = useMemo(() => [facet("useful_view_pct"), facet("video_delay_p95_ms"), facet("interruptions")], []);
  const get = (cfg: string, ms: number, metric: string) => sweepMetric(t.find((r) => r.config === cfg && r.buffer_ms === ms) ?? {}, metric);
  const marks = (row: DotRow, f: DotFacet): DotMark[] => configs.map((cfg) => ({ config: cfg, m: get(cfg, Number(row.key), f.key) }));
  const range = (cfg: string) => {
    const v = sizes.map((ms) => get(cfg, ms, "useful_view_pct").mean).filter((x): x is number => x !== null);
    return v.length ? Math.max(...v) - Math.min(...v) : null;
  };
  const lo = sizes[0], hi = sizes[sizes.length - 1];
  const claim: Parts = [];
  const detail: Parts = [];
  if (sizes.length > 1) {
    const rb = range("Baseline"), rp = range("Proposed");
    const dp = Math.max(rb ?? 0, rp ?? 0) < 0.1 ? 2 : 1;
    claim.push(`From ${lo} to ${hi} ms of Starlink modem buffer, usable view moves by ${fmtNum(rb, dp)} points for `, c("Baseline"), ` and ${fmtNum(rp, dp)} for `, c("Proposed"), ".");
    const d = (cfg: string, ms: number) => get(cfg, ms, "video_delay_p95_ms").mean;
    const one = (cfg: string): Parts => {
      const [a, b] = fpair("video_delay_p95_ms", d(cfg, lo), d(cfg, hi));
      const down = (d(cfg, lo) ?? 0) < (d(cfg, hi) ?? 0);
      return [c(cfg), ` ${a} (${down ? "down from" : "against"} ${b})`];
    };
    detail.push(`Video delay p95 at ${lo} ms: `, ...one("Baseline"), ", ", ...one("Proposed"), ".");
  }
  const ns = t.map((r) => r.n).filter((x): x is number => typeof x === "number");
  const n = ns.length ? Math.min(...ns) : null;
  const spec: MomentSpec = useMemo(() => ({ key: "buffer", variant: "nominal", needs: ["left"], what: "the deepest Starlink modem queue (Baseline)", compute: worstQueue }), []);
  return (
    <Block id="buffer" title="Buffer size" scope={`Nominal, n = ${n ?? "–"} seeds per point`} claim={claim} detail={detail}
      chart={
        <DotFacets title="Sensitivity to the modem buffer size" cols={3} rows={rows} facets={facets} marks={marks} n={n}
          rowHeader="Starlink buffer" markHeader="Configuration" legend={<Legend items={pairLegend} />} labelWidth={176}
          ariaLabel={textOf(claim)} caption={caption(`${n ?? "–"} seeds per point`, ENGINE_NOTE, "buffer.csv")} />
      }
      caveat={<>the 4G modem buffer is scaled together with the Starlink buffer, and buffer sizes are scenario assumptions (A).</>}
      replay={<ReplayLink spec={spec} preload />}
    />
  );
}

export { def };
