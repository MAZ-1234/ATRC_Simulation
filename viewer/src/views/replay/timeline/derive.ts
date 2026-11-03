/**
 * Per-run derivations for the mission timeline, computed once per loaded run (WeakMap
 * cache) and never per frame. Nothing here re-scores: usability is `samples.useful`,
 * segments are `samples.seg`, manoeuvres are `samples.man`, link state is `truth`.
 *
 * Every track is a list of spans [t0, t1) in mission seconds with an integer value.
 * Span boundaries follow the convention of data/events.ts (who-saw lane): a span starts
 * at the time of its first sample and ends at the time of the first sample after it;
 * the last span ends one sample period after the last sample.
 */
import type { CamName, LinkName, RunData, Upload } from "../../../data/types";
import type { PairEvents, WhoSaw, WhoSawSpan } from "../../../data/events";
import { getScenario } from "../../../data/loader";
import { fmtKm } from "../../../format";

export interface Span { t0: number; t1: number; v: number }

/** Link truth class per sample, same rule as the report timeline (edge_mlc/sim/plots.py). */
export const LINK_DOWN = 0;
export const LINK_DEGRADED = 1;
export const LINK_GOOD = 2;
/** Capacity is drawn as bar height in this many steps of the link's nominal capacity. */
export const CAP_STEPS = 16;

/** Camera stream classes for the camera sub-rows (from the target ladder level). */
export const CAM_PAUSED = 0;
export const CAM_TRICKLE = 1;
export const CAM_LIVE = 2;

/** Bulk activity class per sample. */
export const BULK_NONE = 0;
export const BULK_BACKGROUND = 1;
export const BULK_REQUESTED = 2;

export interface RunDerived {
  /** Time just after the last sample, s (where this run's tracks end). */
  end: number;
  /** samples.useful as spans, v = 0 | 1. */
  useful: Span[];
  /** Per link: v = state * 100 + capacity step (0..CAP_STEPS). */
  links: Record<LinkName, Span[]>;
  /** Per camera: v = linkset code * 10 + CAM_* class (linkset -1 -> v < 0). */
  cams: Record<CamName, Span[]>;
  /** True manoeuvre, v = code into enums.man. */
  man: Span[];
  /** Scoring segment, v = code into enums.seg (-1 between segments). */
  seg: Span[];
  /** Bulk activity, v = BULK_*. */
  bulk: Span[];
  /** Requested (operator) uploads with their index into run.uploads. */
  requested: { u: number; up: Upload }[];
}

function rle(run: RunData, valueAt: (k: number) => number): Span[] {
  const t = run.samples.t;
  const n = run.meta.n_samples;
  const dt = run.meta.dt || 0.1;
  const out: Span[] = [];
  if (n === 0) return out;
  let v0 = valueAt(0);
  let k0 = 0;
  for (let k = 1; k < n; k++) {
    const v = valueAt(k);
    if (v !== v0) {
      out.push({ t0: t[k0], t1: t[k], v: v0 });
      v0 = v;
      k0 = k;
    }
  }
  out.push({ t0: t[k0], t1: t[n - 1] + dt, v: v0 });
  return out;
}

/** Nominal uplink capacity of a link from the scenario config, kbit/s (fallback: max seen). */
export function nominalKbps(run: RunData, link: LinkName): number {
  const cfg = getScenario()?.link_config.find((l) => l.name === link);
  if (cfg && cfg.nominal_kbps > 0) return cfg.nominal_kbps;
  let m = 0;
  for (const c of run.truth[link].cap) if (c > m) m = c;
  return m || 1;
}

/**
 * Link truth class at sample k. "Good" = up, loss and RTT within the video limits from
 * the run's config (`meta.limits.video`, used by both deciders); "degraded" = up but
 * outside them; "down" = not up.
 * DESIGN-GAP: edge_mlc/sim/plots.py hard-codes loss < 5% and RTT < 250 ms for the same
 * picture; the viewer reads the config's video limits instead (truth rule: thresholds
 * come from the data). Checked on nominal seed 17: the two rules disagree on 2 to 3 of
 * about 22,800 up samples per run (RTT between the report's 250 ms and the config's
 * limit), which is invisible at timeline scale.
 */
export function linkClassAt(run: RunData, link: LinkName, k: number): number {
  const T = run.truth[link];
  if (!T.up[k]) return LINK_DOWN;
  const lim = run.meta.limits.video;
  return T.loss[k] <= lim.max_loss && T.rtt[k] <= lim.max_rtt_ms ? LINK_GOOD : LINK_DEGRADED;
}

/** Camera class from a target ladder level. */
export function camClass(level: number): number {
  return level <= 0 ? CAM_PAUSED : level === 1 ? CAM_TRICKLE : CAM_LIVE;
}

const cache = new WeakMap<RunData, RunDerived>();

export function derive(run: RunData): RunDerived {
  const hit = cache.get(run);
  if (hit) return hit;
  const s = run.samples;
  const n = run.meta.n_samples;
  const dt = run.meta.dt || 0.1;

  const links = {} as Record<LinkName, Span[]>;
  for (const link of run.meta.links) {
    const nom = nominalKbps(run, link);
    const cap = run.truth[link].cap;
    links[link] = rle(run, (k) => {
      const cls = linkClassAt(run, link, k);
      const step = cls === LINK_DOWN ? 0 : Math.max(1, Math.min(CAP_STEPS, Math.round((cap[k] / nom) * CAP_STEPS)));
      return cls * 100 + step;
    });
  }

  const cams = {} as Record<CamName, Span[]>;
  for (const cam of run.meta.cams) {
    const c = run.cams[cam];
    cams[cam] = rle(run, (k) => {
      const set = c.tgt[k];
      const empty = set < 0 || (run.enums.linkset[set]?.length ?? 0) === 0;
      return empty ? -1 : set * 10 + camClass(c.tlevel[k]);
    });
  }

  const d: RunDerived = {
    end: n > 0 ? s.t[n - 1] + dt : 0,
    useful: rle(run, (k) => s.useful[k]),
    links,
    cams,
    man: rle(run, (k) => s.man[k]),
    seg: rle(run, (k) => s.seg[k]),
    bulk: rle(run, (k) => (s.bulk_req_kbps[k] > 0 ? BULK_REQUESTED : s.bulk_bg_kbps[k] > 0 ? BULK_BACKGROUND : BULK_NONE)),
    requested: run.uploads.map((up, u) => ({ u, up })).filter((x) => x.up.requested === 1),
  };
  cache.set(run, d);
  return d;
}

/** Index of the span containing t (or -1). Spans are sorted and contiguous. */
export function spanAt(spans: Span[], t: number): number {
  let lo = 0;
  let hi = spans.length - 1;
  if (hi < 0 || t < spans[0].t0 || t >= spans[hi].t1) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (spans[mid].t0 <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** First span index whose end is after t (start of a visible window). */
export function firstSpanAfter(spans: Span[], t: number): number {
  let lo = 0;
  let hi = spans.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (spans[mid].t1 <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Operator-facing name of an upload ("Crater scan", "Scan at 1.70 km", "Recording 3"). */
export function uploadName(up: Upload): string {
  if (up.id === "lidar_crater") return "Crater scan";
  if (up.id === "scan_drive") return `Scan at ${fmtKm(up.created_d)}`;
  if (up.id === "still") return "Still";
  if (up.id === "clip") return "Clip";
  const m = /^(rec|lidar)_(\d+)$/.exec(up.id);
  if (m) return m[1] === "rec" ? `Recording ${m[2]}` : `Lidar chunk ${m[2]}`;
  return up.kind.charAt(0).toUpperCase() + up.kind.slice(1);
}

// ------------------------------------------------------------------ pair derivations

export interface PairDerived {
  /** Time both runs still had samples, s (the shorter run's end). */
  commonEnd: number;
  /** End of the longer run, s. */
  fullEnd: number;
  /** Which config ran longer (null when both end within one sample). */
  longer: "left" | "right" | null;
  /**
   * Shared world tracks along the reference (right) run, continued on the longer run after
   * the reference run ends, so segment, link truth and manoeuvre cover the whole axis.
   * seg / man values are codes into the RIGHT run's enums.
   */
  seg: Span[];
  man: Span[];
  links: Record<LinkName, Span[]>;
  /**
   * Who-saw spans clipped to `commonEnd`. Past the shorter run's end there is nothing to
   * compare: that controller has finished its mission, which is not a lost view.
   */
  whoSaw: WhoSawSpan[];
  /** Seconds per class over the compared time (sum of clipped spans, 0.1 s resolution). */
  tally: Record<WhoSaw, number>;
}

const pairCache = new WeakMap<RunData, WeakMap<RunData, PairDerived>>();

/** Continue `a` (ending at aEnd) with the part of `b` after aEnd. */
function extend(a: Span[], b: Span[], aEnd: number, map: (v: number) => number = (v) => v): Span[] {
  const out = a.map((s) => ({ ...s }));
  for (const s of b) {
    if (s.t1 <= aEnd + 1e-6) continue;
    const v = map(s.v);
    const last = out[out.length - 1];
    // Same value across the join: one span, so labels and fills do not split there.
    if (last && last.v === v && Math.abs(last.t1 - Math.max(s.t0, aEnd)) < 1e-6) last.t1 = s.t1;
    else out.push({ t0: Math.max(s.t0, aEnd), t1: s.t1, v });
  }
  return out;
}

export function derivePair(left: RunData, right: RunData, events: PairEvents): PairDerived {
  let inner = pairCache.get(left);
  const hit = inner?.get(right);
  if (hit) return hit;
  const L = derive(left);
  const R = derive(right);
  const commonEnd = Math.min(L.end, R.end);
  const fullEnd = Math.max(L.end, R.end);
  const longer = Math.abs(L.end - R.end) < 0.05 ? null : L.end > R.end ? "left" : "right";

  // Left codes -> right codes (enums are per run); unknown names become -1.
  const recode = (from: readonly string[], to: readonly string[]) => (v: number) => (v < 0 ? v : to.indexOf(from[v]));
  const tail = longer === "left";
  const links = {} as Record<LinkName, Span[]>;
  for (const link of right.meta.links) links[link] = tail ? extend(R.links[link], L.links[link] ?? [], R.end) : R.links[link];

  const whoSaw: WhoSawSpan[] = [];
  const tally: Record<WhoSaw, number> = { both: 0, left_only: 0, right_only: 0, neither: 0 };
  for (const w of events.whoSaw) {
    if (w.from >= commonEnd - 1e-6) break;
    const to = Math.min(w.to, commonEnd);
    whoSaw.push({ from: w.from, to, cls: w.cls });
    tally[w.cls] += to - w.from;
  }
  for (const k of Object.keys(tally) as WhoSaw[]) tally[k] = Math.round(tally[k] * 10) / 10;

  const d: PairDerived = {
    commonEnd, fullEnd, longer,
    seg: tail ? extend(R.seg, L.seg, R.end, recode(left.enums.seg, right.enums.seg)) : R.seg,
    man: tail ? extend(R.man, L.man, R.end, recode(left.enums.man, right.enums.man)) : R.man,
    links, whoSaw, tally,
  };
  if (!inner) { inner = new WeakMap(); pairCache.set(left, inner); }
  inner.set(right, d);
  return d;
}
