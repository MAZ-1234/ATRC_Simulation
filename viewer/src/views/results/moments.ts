/**
 * "Show in replay" targets. Each result links to the moment in a trace that shows it,
 * computed from the trace itself (never a hand-typed time). Moments are measured on the
 * Proposed run (the right console, which also defines the chapters) unless a moment is
 * explicitly about the left run. Results are cached per run pair.
 */
import type { RunData } from "../../data/types";
import { computeChapters, computePairEvents } from "../../data/events";
import { dec, runIdFor, typicalSeed, configsFor } from "../../data/loader";

export interface Pair { left: RunData | null; right: RunData | null }
export interface Moment {
  /** Cursor time to open at, s. */
  t: number;
  /** Short words for the button: "crater", "longest stretch only Proposed could see". */
  what: string;
}

export interface MomentSpec {
  /** Cache key (unique per block). */
  key: string;
  variant: string;
  /** Default: the variant's typical seed (manifest.demo for nominal). */
  seed?: number;
  /** Left console configuration (default Baseline). Falls back to Baseline when not exported. */
  cmp?: string;
  /** Which runs `compute` needs ("right" = Proposed). */
  needs: ("left" | "right")[];
  /** Fallback words before the trace is loaded. */
  what: string;
  compute: (p: Pair) => Moment | null;
}

export interface Resolved {
  variant: string;
  seed: number | null;
  cmp: string;
  /** True when the requested left config was not exported and Baseline is shown instead. */
  cmpFallback: boolean;
  leftId: string | null;
  rightId: string | null;
}

export function resolve(spec: MomentSpec): Resolved {
  const seed = spec.seed ?? typicalSeed(spec.variant);
  const wanted = spec.cmp ?? "Baseline";
  const exported = seed !== null ? configsFor(spec.variant, seed) : [];
  const cmp = exported.includes(wanted) ? wanted : "Baseline";
  return {
    variant: spec.variant,
    seed,
    cmp,
    cmpFallback: cmp !== wanted,
    leftId: seed !== null ? runIdFor(cmp, spec.variant, seed) : null,
    rightId: seed !== null ? runIdFor("Proposed", spec.variant, seed) : null,
  };
}

// ------------------------------------------------------------------ helpers over a run

const back = (t: number, s: number) => Math.max(0, t - s);

function firstT(run: RunData, pred: (k: number) => boolean): number | null {
  const n = run.meta.n_samples;
  for (let k = 0; k < n; k++) if (pred(k)) return run.samples.t[k];
  return null;
}

/** Crater chapter (first crater sample), opened 5 s before like the tour. */
export function craterMoment(p: Pair): Moment | null {
  const run = p.right ?? p.left;
  if (!run) return null;
  const ch = computeChapters(run).find((c) => c.index === 2);
  return ch ? { t: ch.seekT, what: "arriving at the crater" } : null;
}

/** Longest stretch where only one side had a usable view. */
export function longestDivergence(p: Pair, side: "left" | "right", what: string): Moment | null {
  if (!p.left || !p.right) return null;
  const ev = computePairEvents(p.left, p.right);
  let best: { t: number; len: number } | null = null;
  for (const d of ev.divergences) {
    if (d.side !== side) continue;
    const len = d.end - d.t;
    if (!best || len > best.len) best = { t: d.t, len };
  }
  return best ? { t: back(best.t, 2), what } : null;
}

/** Longest stretch where neither controller had a usable view. */
export function longestNeither(p: Pair, what: string): Moment | null {
  if (!p.left || !p.right) return null;
  const ev = computePairEvents(p.left, p.right);
  let best: { t: number; len: number } | null = null;
  for (const s of ev.whoSaw) {
    if (s.cls !== "neither") continue;
    const len = s.to - s.from;
    if (!best || len > best.len) best = { t: s.from, len };
  }
  return best ? { t: back(best.t, 2), what } : null;
}

/**
 * The ground-truth link change (run.transitions, the Experiment A events) where the
 * right run's usable share in [t - 2, t + 10] beats the left run's by the most.
 */
export function bestTransition(p: Pair): Moment | null {
  if (!p.left || !p.right) return null;
  const share = (run: RunData, a: number, b: number) => {
    const { t, useful } = run.samples;
    let n = 0, u = 0;
    for (let k = 0; k < t.length; k++) {
      if (t[k] < a) continue;
      if (t[k] > b) break;
      n++; u += useful[k];
    }
    return n ? u / n : 0;
  };
  let best: { t: number; gap: number; kind: string } | null = null;
  for (const [t, kind] of p.right.transitions) {
    const gap = share(p.right, t - 2, t + 10) - share(p.left, t - 2, t + 10);
    if (!best || gap > best.gap) best = { t, gap, kind };
  }
  if (!best) return null;
  return { t: back(best.t, 2), what: best.kind === "up/down" ? "a link going down or up" : "a link losing capacity" };
}

/** When an upload was requested (created) in the right run. */
export function uploadRequested(id: string, what: string, lead = 0): (p: Pair) => Moment | null {
  return (p) => {
    const run = p.right ?? p.left;
    const u = run?.uploads.find((x) => x.id === id);
    return u ? { t: back(u.created_t, lead), what } : null;
  };
}

/** First sample of a true manoeuvre (e.g. REVERSE) in the right run, with its driver state. */
export function firstManoeuvre(man: string, lead = 3): (p: Pair) => Moment | null {
  return (p) => {
    const run = p.right;
    if (!run) return null;
    const code = run.enums.man.indexOf(man as never);
    if (code < 0) return null;
    const n = run.meta.n_samples;
    for (let k = 0; k < n; k++) {
      if (run.samples.man[k] !== code) continue;
      const st = dec(run, "state", run.samples.state[k]);
      const inCrater = run.samples.crater[k] === 1 || (st ?? "").startsWith("CRATER");
      return { t: back(run.samples.t[k], lead), what: inCrater ? "reversing in the crater" : "the first reversing manoeuvre" };
    }
    return null;
  };
}

/** First sample of a scoring segment in the right run. */
export function segmentStart(seg: string, what: string): (p: Pair) => Moment | null {
  return (p) => {
    const run = p.right;
    if (!run) return null;
    const code = run.enums.seg.indexOf(seg as never);
    if (code < 0) return null;
    const t = firstT(run, (k) => run.samples.seg[k] === code);
    return t === null ? null : { t: back(t, 3), what };
  };
}

/** First Starlink handover outage in the right run (opened 5 s before it). */
export function firstStarlinkOutage(p: Pair): Moment | null {
  const run = p.right;
  const o = run?.events.starlink_outages[0];
  return o ? { t: back(o[0], 5), what: "a Starlink handover outage" } : null;
}

/** Worst video delay of the needed camera while bulk data was being sent (right run). */
export function worstDelayWhileUploading(p: Pair): Moment | null {
  const run = p.right;
  if (!run) return null;
  const { bulk, prot } = run.samples;
  let best: { t: number; ms: number } | null = null;
  for (let k = 0; k < run.meta.n_samples; k++) {
    if (!bulk[k]) continue;
    const cam = dec(run, "cam", prot[k]);
    if (!cam) continue;
    const ms = run.cams[cam].lat[k];
    if (ms !== null && (!best || ms > best.ms)) best = { t: run.samples.t[k], ms };
  }
  return best ? { t: back(best.t, 2), what: "Proposed's worst video delay while uploading" } : null;
}

/** Largest Starlink modem queue delay in the left run. */
export function worstQueue(p: Pair): Moment | null {
  const run = p.left;
  if (!run) return null;
  const qd = run.truth.starlink?.qd;
  if (!qd) return null;
  let bi = -1;
  for (let k = 0; k < qd.length; k++) if (bi < 0 || qd[k] > qd[bi]) bi = k;
  return bi >= 0 ? { t: back(run.samples.t[bi], 3), what: "the deepest Starlink modem queue (Baseline)" } : null;
}

/** Near mission end of the right run, where the upload queue shows what is left. */
export function missionEnd(p: Pair): Moment | null {
  const run = p.right;
  return run ? { t: back(run.meta.mission_time_s, 5), what: "the end of the mission" } : null;
}
