/**
 * Why one controller could see when the other could not: a per-sample attribution of the
 * gap between two runs inside a chapter scope. Used by the "In short" summary in ClaimWhy.
 *
 * For every sample where the WINNER's view was usable and the LOSER's was not, the loser's
 * failure is put in the first class that the exported columns support:
 *   level      the level the loser was SENDING on the needed camera (cams.<cam>.tlevel) cannot
 *              meet the requirement's min_w or min_fps, while the winner's can
 *              -> knowing the manoeuvre (mission awareness)
 *   link       the loser's needed camera was on a truly worse link than the winner's (down,
 *              lossier, or too thin for the needed camera alone: truth.<link>), or failed on /
 *              left a link the winner was not on within the last 1 s (the fps
 *              requirement counts frames over the last 1 s), while the winner's link was fine
 *              -> link choice; "predicted" when the winner made a DUPLICATE / SWITCH move on
 *              the needed camera shortly before
 *   bandwidth  the loser was still streaming the camera nobody needed while the winner had
 *              paused it or cut it to 1 fps -> bandwidth given to the needed camera
 *   timing     none of the above (where a random dropout fell)
 * Nothing here re-scores: usable is samples.useful.
 */
import type { LinkName, Manoeuvre, RunData } from "../../../data/types";
import { dec, decisionIndexAt, ladderOf } from "../../../data/loader";

export type Cause = "level" | "link" | "bandwidth" | "timing";

/** A level at or below this is "cut": PAUSED (0) or TRICKLE (1). */
const CUT_LEVEL = 1;
/** The fps requirement counts frames over the last 1 s, so a link event this recent explains it. */
const RECENT_SAMPLES = 10;
/** A predictive move up to this long before the first link-caused loss counts as "ahead of it", s. */
const LOOKBACK_S = 15;

export interface Attribution {
  /** Samples where the winner was usable and the loser was not. */
  n: number;
  counts: Record<Cause, number>;
  /** level: the manoeuvre, and the picture widths each side was sending (most common). */
  levelMan: Manoeuvre | null;
  loserW: number | null;
  winnerW: number | null;
  /** link: the loser's failing link and the winner's link at those moments (most common). */
  deadLink: LinkName | null;
  winnerLink: LinkName | null;
  /** link: the winner made a predictive move on the needed camera shortly before. */
  predicted: boolean;
  /** link: the winner runs two-stream FEC and, at most of those moments, was sending the
   *  needed camera across several links (samples.dup), so one link dropping did not cost it. */
  redundant: boolean;
}

interface RunSide { run: RunData; idx: number[] }

/** True when the run's config sends the protected camera with a redundancy scheme (FEC). */
export function usesFec(run: RunData): boolean {
  const r = run.meta.options?.redundancy;
  return typeof r === "string" && r !== "none";
}

function needOf(run: RunData, k: number) {
  const man = dec(run, "man", run.samples.man[k]) as Manoeuvre | null;
  const req = man ? run.meta.requirements[man] : undefined;
  return man && req ? { man, req } : null;
}

/**
 * The needed camera's link is truly down, over the video loss / RTT limit, or too thin to
 * carry the needed camera ALONE at the level being sent (truth.cap below its kbps). A link
 * that can carry the needed camera but not both cameras is a bandwidth question, not this.
 */
function linkBadAt(run: RunData, k: number): boolean {
  const li = run.samples.link[k];
  if (li < 0) return true;
  const tr = run.truth?.[run.meta.links[li]];
  if (!tr) return false;
  const lim = run.meta.limits.video;
  if (tr.up[k] === 0 || tr.loss[k] > lim.max_loss || tr.rtt[k] > lim.max_rtt_ms) return true;
  const need = needOf(run, k);
  const tl = need ? run.cams?.[need.req.cam]?.tlevel[k] : undefined;
  const kbps = tl !== undefined ? ladderOf(run, tl)?.kbps ?? 0 : 0;
  return kbps > 0 && tr.cap[k] < kbps;
}

/** Margin by which the loser's true packet loss must exceed the winner's to count as worse. */
const LOSS_MARGIN = 0.005;

/**
 * The loser's link is truly worse than the winner's at the same moment: down, lossier by more
 * than LOSS_MARGIN, or too thin for the needed camera alone. Frames are lost well below the
 * controllers' own switching limits, so this compares the two links directly.
 */
function linkWorse(Lr: RunData, k: number, lName: LinkName, W: RunData, j: number, wName: LinkName): boolean {
  const lt = Lr.truth?.[lName];
  const wt = W.truth?.[wName];
  if (!lt || !wt) return false;
  if (lt.up[k] === 0 && wt.up[j] === 1) return true;
  if (lt.loss[k] > wt.loss[j] + LOSS_MARGIN) return true;
  const need = needOf(Lr, k);
  const tl = need ? Lr.cams?.[need.req.cam]?.tlevel[k] : undefined;
  const kbps = tl !== undefined ? ladderOf(Lr, tl)?.kbps ?? 0 : 0;
  return kbps > 0 && lt.cap[k] < kbps && wt.cap[j] >= kbps;
}

/** Link down or over the limits, or a link change, in the last 1 s. */
function linkTroubleRecent(run: RunData, k: number): boolean {
  for (let j = Math.max(0, k - RECENT_SAMPLES); j <= k; j++) {
    if (linkBadAt(run, j)) return true;
    if (j > 0 && run.samples.link[j] !== run.samples.link[j - 1]) return true;
  }
  return false;
}

/**
 * The link the loser was failing on: its current link if that is bad now, else the link it
 * left in the last 1 s, else a link that was bad in the last 1 s (a dropout just ended).
 */
function failingLink(run: RunData, k: number): LinkName | null {
  const li = run.samples.link[k];
  if (li >= 0 && linkBadAt(run, k)) return run.meta.links[li];
  const j0 = Math.max(0, k - RECENT_SAMPLES);
  for (let q = k; q >= j0; q--) {
    const lq = run.samples.link[q];
    if (lq >= 0 && lq !== li) return run.meta.links[lq];
  }
  for (let q = k; q >= j0; q--) {
    const lq = run.samples.link[q];
    if (lq >= 0 && linkBadAt(run, q)) return run.meta.links[lq];
  }
  return null;
}

function sentMeets(run: RunData, k: number): boolean | null {
  const need = needOf(run, k);
  const tl = need ? run.cams?.[need.req.cam]?.tlevel[k] : undefined;
  if (!need || tl === undefined) return null;
  const lv = ladderOf(run, tl);
  return !!lv && lv.w >= need.req.min_w && lv.fps >= need.req.min_fps;
}

function otherCut(run: RunData, k: number): boolean | null {
  const need = needOf(run, k);
  if (!need) return null;
  const other = need.req.cam === "front" ? "rear" : "front";
  const tl = run.cams?.[other]?.tlevel[k];
  return tl === undefined ? null : tl <= CUT_LEVEL;
}

function predictedBefore(run: RunData, t: number): boolean {
  const cols = run.decisions?.cols;
  if (!cols) return false;
  const i1 = decisionIndexAt(run, t);
  const i0 = decisionIndexAt(run, t - LOOKBACK_S);
  for (let i = i0; i <= i1; i++) {
    for (const a of [cols.front_action[i], cols.rear_action[i]]) {
      const name = a >= 0 ? run.enums.action[a] : "";
      if (name === "DUPLICATE" || name === "SWITCH") return true;
    }
  }
  return false;
}

function mode<T>(m: Map<T, number>): T | null {
  let best: T | null = null;
  let n = -1;
  for (const [k, c] of m) if (c > n) { best = k; n = c; }
  return best;
}

export function attribute(winner: RunSide, loser: RunSide): Attribution {
  const counts: Record<Cause, number> = { level: 0, link: 0, bandwidth: 0, timing: 0 };
  const W = winner.run;
  const Lr = loser.run;
  const byT = new Map<number, number>();
  for (const j of winner.idx) byT.set(Math.round(W.samples.t[j] * 10), j);
  const mans = new Map<Manoeuvre, number>();
  const lw = new Map<number, number>();
  const ww = new Map<number, number>();
  const dead = new Map<LinkName, number>();
  const alive = new Map<LinkName, number>();
  let firstLinkT: number | null = null;
  let linkDup = 0;
  let n = 0;
  for (const k of loser.idx) {
    if (Lr.samples.useful[k] === 1) continue;
    const j = byT.get(Math.round(Lr.samples.t[k] * 10));
    if (j === undefined || W.samples.useful[j] !== 1) continue;
    n++;
    const need = needOf(Lr, k);
    const sl = sentMeets(Lr, k);
    const sw = sentMeets(W, j);
    if (need && sl === false && sw === true) {
      counts.level++;
      mans.set(need.man, (mans.get(need.man) ?? 0) + 1);
      const wl = ladderOf(Lr, Lr.cams?.[need.req.cam]?.tlevel[k] ?? -1)?.w;
      const nw = needOf(W, j);
      const wwid = nw ? ladderOf(W, W.cams?.[nw.req.cam]?.tlevel[j] ?? -1)?.w : undefined;
      if (wl !== undefined) lw.set(wl, (lw.get(wl) ?? 0) + 1);
      if (wwid !== undefined) ww.set(wwid, (ww.get(wwid) ?? 0) + 1);
      continue;
    }
    // Link choice: the loser's needed camera was on a WORSE link than the winner's at that
    // moment, or was failing on / had just left a link the winner was not on. Two runs hit by
    // the same dropout on the same link differ only in when they recovered (that is timing).
    const wli = W.samples.link[j];
    const wName = wli >= 0 ? W.meta.links[wli] : null;
    const lli = Lr.samples.link[k];
    const lName = lli >= 0 ? Lr.meta.links[lli] : null;
    const worse = lName !== null && wName !== null && lName !== wName && linkWorse(Lr, k, lName, W, j, wName);
    const recent = !worse && linkTroubleRecent(Lr, k) && !linkBadAt(W, j) ? failingLink(Lr, k) : null;
    const bad = worse ? lName : recent && recent !== wName ? recent : null;
    if (bad) {
      counts.link++;
      firstLinkT = firstLinkT ?? Lr.samples.t[k];
      dead.set(bad, (dead.get(bad) ?? 0) + 1);
      if (wName) alive.set(wName, (alive.get(wName) ?? 0) + 1);
      if (W.samples.dup[j] === 1) linkDup++;
      continue;
    }
    if (otherCut(Lr, k) === false && otherCut(W, j) === true) { counts.bandwidth++; continue; }
    counts.timing++;
  }
  return {
    n, counts,
    levelMan: mode(mans), loserW: mode(lw), winnerW: mode(ww),
    deadLink: mode(dead), winnerLink: mode(alive),
    predicted: firstLinkT !== null && predictedBefore(W, firstLinkT),
    redundant: usesFec(W) && counts.link > 0 && linkDup >= 0.5 * counts.link,
  };
}

/** Causes in order of how much of the gap they explain (largest first, empty ones dropped). */
export function ranked(a: Attribution): [Cause, number][] {
  return (Object.entries(a.counts) as [Cause, number][]).filter(([, c]) => c > 0).sort((x, y) => y[1] - x[1]);
}
