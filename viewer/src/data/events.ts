/**
 * Replay events derived from a loaded run pair (no re-scoring: everything reads the
 * simulator's own `samples.useful`, `truth`, `state_changes` and `events`).
 *
 *   computePairEvents(left, right) -> { chapters, divergences, interruptions, whoSaw, tally }
 *   jumpTargets(events, filter)     -> sorted cursor times for J / K
 *
 * Both runs share the sample grid (t = 0.15 + 0.1 k), so index k is the same instant in
 * both. The who-saw lane, its tally and the divergences compare only while both runs have
 * samples (the shorter run's mission has ended after that); interruptions use each run's
 * own samples.
 */
import type { RunData, Zone } from "./types";
import { dec, getScenario, sampleIndexAt } from "./loader";
import { fmtKm, fmtMbps } from "../format";

export type JumpFilter = "divergences" | "interruptions" | "chapters" | "all";
export type Side = "left" | "right";

/** One tour chapter (DESIGN.md 6.1.1). */
export interface Chapter {
  /** 0..4 in mission order. */
  index: number;
  /** Full name: "2.35 km Crater: 1 Mbps, stop, scan, reverse". */
  label: string;
  /** Compact chip label: "2.35 km". */
  short: string;
  /** Moment the chapter happens in the reference (right) run, s. */
  t: number;
  /** Where the cursor goes when the chapter starts (t - 5 s, clamped to 0). */
  seekT: number;
  /** Where chapter playback stops (t + 10 s). */
  endT: number;
}

/** Usability class of one instant in the who-saw lane. */
export type WhoSaw = "both" | "left_only" | "right_only" | "neither";

/** A run of consecutive samples with the same who-saw class. */
export interface WhoSawSpan { from: number; to: number; cls: WhoSaw }

/** A divergence: a stretch where exactly one controller had a usable view. */
export interface Divergence { t: number; end: number; side: Side }

/** The start of a loss of usable view in one run. */
export interface Interruption { t: number; end: number; side: Side }

export interface PairEvents {
  chapters: Chapter[];
  divergences: Divergence[];
  interruptions: Interruption[];
  /** All who-saw spans covering the mission, in order. */
  whoSaw: WhoSawSpan[];
  /** Seconds in each class while both runs have samples (honest three-way count + both). */
  tally: Record<WhoSaw, number>;
  /** Max mission time of the two runs, s. */
  duration: number;
}

/**
 * Chapter names without the km prefix (DESIGN.md 6.1.1). The km prefix is the reference
 * vehicle's measured position at the chapter moment, and the crater capacity is the
 * variant's `crater_cap`, so nothing numeric here is typed in.
 * DESIGN-GAP: DESIGN.md writes "1.6 km Radio lost"; the traces lose the radio at about
 * 1.55 km (inside the fade), so the label follows the trace.
 */
const CHAPTER_NAMES: ((capKbps: number | undefined) => string)[] = [
  () => "Radio lost behind the ridge",
  () => "Trees block Starlink",
  (cap) => (cap !== undefined ? `Crater: ${fmtMbps(cap)}, stop, scan, reverse` : "Crater: stop, scan, reverse"),
  () => "Jammer blackout",
  () => "Inspection stop",
];

/** Minimum length for a divergence to become a J/K stop, s (shorter flickers are skipped). */
export const MIN_DIVERGENCE_S = 1.0;

function firstSample(run: RunData, pred: (k: number) => boolean): number | null {
  const n = run.meta.n_samples;
  for (let k = 0; k < n; k++) if (pred(k)) return run.samples.t[k];
  return null;
}

/** Chapter times measured on one run. Route thresholds come from the variant's zones. */
export function computeChapters(run: RunData): Chapter[] {
  const s = run.samples;
  const radio = run.truth.radio;
  const stateCode = (name: string) => run.enums.state.indexOf(name as never);
  const inspect = stateCode("INSPECT");
  const variant = getScenario()?.variants[run.meta.variant];
  const zone = (kind: string): Zone | undefined => variant?.zones.find((z) => z.kind === kind);
  const fade = zone("fade");
  const trees = zone("obstruction");
  const trigger = zone("trigger")?.from_km ?? variant?.params.blackout_at;
  const times: (number | null)[] = [
    // 1. radio truly goes down on the outbound leg past the start of the fade
    fade
      ? firstSample(run, (k) => k > 0 && s.dir[k] === 1 && s.d[k] >= fade.from_km && radio.up[k] === 0 && radio.up[k - 1] === 1)
        ?? firstSample(run, (k) => s.dir[k] === 1 && s.d[k] >= fade.to_km)
      : firstSample(run, (k) => k > 0 && s.dir[k] === 1 && radio.up[k] === 0 && radio.up[k - 1] === 1),
    // 2. trees: first outbound sample at the obstruction zone
    trees ? firstSample(run, (k) => s.dir[k] === 1 && s.d[k] >= trees.from_km) : null,
    // 3. crater (any crater driver state)
    firstSample(run, (k) => s.crater[k] === 1),
    // 4. jammer blackout (from the run's events), else first outbound pass of the trigger
    run.events.blackout
      ? run.events.blackout[0]
      : trigger !== undefined ? firstSample(run, (k) => s.dir[k] === 1 && s.d[k] >= trigger) : null,
    // 5. inspection stop
    firstSample(run, (k) => s.state[k] === inspect),
  ];
  const cap = variant?.params.crater_cap;
  const out: Chapter[] = [];
  times.forEach((t, index) => {
    if (t === null) return;
    const short = fmtKm(s.d[sampleIndexAt(run, t)]);
    out.push({ index, label: `${short} ${CHAPTER_NAMES[index](cap)}`, short, t, seekT: Math.max(0, t - 5), endT: t + 10 });
  });
  return out;
}

const cache = new Map<string, PairEvents>();

/**
 * Events for a left/right pair (either may be null while loading). Cached per pair.
 * Chapters are measured on the right run (Proposed) when present.
 */
export function computePairEvents(left: RunData | null, right: RunData | null): PairEvents {
  const key = `${left?.meta.id ?? "-"}|${right?.meta.id ?? "-"}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const ref = right ?? left;
  const chapters = ref ? computeChapters(ref) : [];
  const nL = left?.meta.n_samples ?? 0;
  const nR = right?.meta.n_samples ?? 0;
  const n = Math.max(nL, nR);
  // Compare who saw only while both missions run (with one run loaded, over its own length).
  const nC = left && right ? Math.min(nL, nR) : n;
  const tAt = (k: number) => (k < nR ? right!.samples.t[k] : k < nL ? left!.samples.t[k] : 0.15 + 0.1 * k);
  const usable = (run: RunData | null, len: number, k: number) => (run && k < len ? run.samples.useful[k] === 1 : false);

  const whoSaw: WhoSawSpan[] = [];
  const tally: Record<WhoSaw, number> = { both: 0, left_only: 0, right_only: 0, neither: 0 };
  const interruptions: Interruption[] = [];
  const open: Record<Side, number | null> = { left: null, right: null };
  let prev: WhoSaw | null = null;
  let spanStart = 0;
  for (let k = 0; k < n; k++) {
    const l = usable(left, nL, k);
    const r = usable(right, nR, k);
    const cls: WhoSaw = l && r ? "both" : l ? "left_only" : r ? "right_only" : "neither";
    const t = tAt(k);
    if (k < nC) {
      tally[cls] += 0.1;
      if (cls !== prev) {
        if (prev !== null) whoSaw.push({ from: spanStart, to: t, cls: prev });
        prev = cls;
        spanStart = t;
      }
    }
    // interruptions: a 1 -> 0 edge of useful within each run
    for (const [side, run, len, u] of [["left", left, nL, l], ["right", right, nR, r]] as const) {
      if (!run || k >= len || k === 0) continue;
      const was = run.samples.useful[k - 1] === 1;
      if (was && !u) open[side] = t;
      if (!was && u && open[side] !== null) {
        interruptions.push({ t: open[side]!, end: t, side });
        open[side] = null;
      }
    }
  }
  const end = n > 0 ? tAt(n - 1) + 0.1 : 0;
  const endC = nC > 0 ? tAt(nC - 1) + 0.1 : 0;
  if (prev !== null) whoSaw.push({ from: spanStart, to: endC, cls: prev });
  for (const side of ["left", "right"] as const) if (open[side] !== null) interruptions.push({ t: open[side]!, end, side });
  interruptions.sort((a, b) => a.t - b.t);

  const divergences: Divergence[] = whoSaw
    .filter((s) => (s.cls === "left_only" || s.cls === "right_only") && s.to - s.from >= MIN_DIVERGENCE_S - 1e-6)
    .map((s) => ({ t: s.from, end: s.to, side: s.cls === "left_only" ? "left" : "right" }));

  for (const k of Object.keys(tally) as WhoSaw[]) tally[k] = Math.round(tally[k] * 10) / 10;

  const duration = Math.max(left?.meta.mission_time_s ?? 0, right?.meta.mission_time_s ?? 0);
  const ev: PairEvents = { chapters, divergences, interruptions, whoSaw, tally, duration };
  cache.set(key, ev);
  return ev;
}

/** Sorted, de-duplicated cursor targets for J / K under a jump filter. */
export function jumpTargets(ev: PairEvents, filter: JumpFilter): number[] {
  const ts: number[] = [];
  if (filter === "divergences" || filter === "all") ev.divergences.forEach((d) => ts.push(d.t));
  if (filter === "interruptions" || filter === "all") ev.interruptions.forEach((d) => ts.push(d.t));
  if (filter === "chapters" || filter === "all") ev.chapters.forEach((c) => ts.push(c.seekT));
  ts.sort((a, b) => a - b);
  return ts.filter((t, i) => i === 0 || t - ts[i - 1] > 0.05);
}

/** Next target strictly after t (or null). */
export function nextTarget(targets: number[], t: number): number | null {
  for (const x of targets) if (x > t + 0.05) return x;
  return null;
}

/** Previous target strictly before t (or null). */
export function prevTarget(targets: number[], t: number): number | null {
  for (let i = targets.length - 1; i >= 0; i--) if (targets[i] < t - 0.05) return targets[i];
  return null;
}

/** Driver-state name at sample k (convenience for tooltips). */
export function stateNameAt(run: RunData, k: number): string | null {
  return dec(run, "state", run.samples.state[k]);
}
