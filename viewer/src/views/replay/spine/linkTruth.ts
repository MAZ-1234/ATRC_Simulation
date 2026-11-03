/**
 * Ground-truth link state per sample (DESIGN.md 2.3 encoding), memoised per run.
 *
 *   down      truth.up === 0
 *   degraded  up, but outside the video limits: loss > meta.limits.video.max_loss or
 *             RTT > meta.limits.video.max_rtt_ms
 *   good      otherwise
 *   unknown   the link does not exist in this variant (no 4G in "no_lte")
 *
 * This is the same rule the mission timeline's link tracks use (timeline/derive.ts
 * `linkClassAt`), so the spine band and the timeline track never disagree. The video
 * limits are the per-traffic limits both deciders share (config `limits`). Capacity is
 * shown as the band's height, not folded into the state.
 * DESIGN-GAP: sim/plots.py hard-codes loss < 0.05 and RTT < 250 ms for the same picture;
 * the viewer reads the config's video limits instead (thresholds come from the data).
 */
import type { LadderLevel, LinkName, Manoeuvre, Requirement, RunData, Scenario } from "../../../data/types";

export const DOWN = 0;
export const DEGRADED = 1;
export const GOOD = 2;
export const UNKNOWN = 3;
export type LinkState = typeof DOWN | typeof DEGRADED | typeof GOOD | typeof UNKNOWN;

export interface RunTruth {
  state: Record<LinkName, Uint8Array>;
  /** Capacity at the top of every band, kbit/s (largest nominal link capacity or observed truth). */
  capMax: number;
  /** Per sample: kbit/s of the cheapest ladder level that meets the TRUE manoeuvre's requirement (tooltip context). */
  needKbps: Float32Array;
}

/** Ladder levels (index) that meet a requirement (frame width and frame rate). */
export function levelsMeeting(ladder: LadderLevel[], req: Requirement | undefined): number[] {
  if (!req) return [];
  const out: number[] = [];
  ladder.forEach((l, i) => { if (l.w >= req.min_w && l.fps >= req.min_fps && l.kbps > 0) out.push(i); });
  return out;
}

/** kbit/s of the cheapest ladder level that meets the requirement (0 when none). */
export function needKbpsFor(ladder: LadderLevel[], req: Requirement | undefined): number {
  const lv = levelsMeeting(ladder, req);
  return lv.length ? Math.min(...lv.map((i) => ladder[i].kbps)) : 0;
}

const cache = new WeakMap<RunData, RunTruth>();

export function linkExists(link: LinkName, run: RunData, scenario: Scenario | null): boolean {
  if (link !== "lte") return true;
  const p = scenario?.variants[run.meta.variant]?.params;
  return p ? p.lte !== false : true;
}

export function runTruth(run: RunData, scenario: Scenario | null): RunTruth {
  const hit = cache.get(run);
  if (hit) return hit;
  const n = run.meta.n_samples;
  const { limits, requirements, ladder } = run.meta;
  const needByMan = run.enums.man.map((m: Manoeuvre) => needKbpsFor(ladder, requirements[m]));
  const needKbps = new Float32Array(n);
  for (let k = 0; k < n; k++) needKbps[k] = needByMan[run.samples.man[k]] ?? 0;

  let capMax = 0;
  for (const lc of scenario?.link_config ?? []) capMax = Math.max(capMax, lc.nominal_kbps);
  const state = {} as Record<LinkName, Uint8Array>;
  for (const link of run.meta.links) {
    const tr = run.truth[link];
    const st = new Uint8Array(n);
    const exists = linkExists(link, run, scenario);
    for (let k = 0; k < n; k++) {
      if (tr.cap[k] > capMax) capMax = tr.cap[k];
      if (!exists) { st[k] = UNKNOWN; continue; }
      if (tr.up[k] !== 1) { st[k] = DOWN; continue; }
      const bad = tr.loss[k] > limits.video.max_loss || tr.rtt[k] > limits.video.max_rtt_ms;
      st[k] = bad ? DEGRADED : GOOD;
    }
    state[link] = st;
  }
  const out: RunTruth = { state, capMax: capMax || 8000, needKbps };
  cache.set(run, out);
  return out;
}
