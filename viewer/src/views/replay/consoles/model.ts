/**
 * Pure derivations for one console at one sample. Nothing here re-scores: "usable" is the
 * simulator's own `samples.useful`; the sentence only explains it from the same columns the
 * engine scored (engine.py Sim.sample: newest frame age <= max_age_s, frames that arrived in
 * the last 1 s >= min_fps, newest frame width >= min_w, for the TRUE manoeuvre's camera).
 * Every threshold is read from the run (`meta.requirements`, `meta.ladder`, `meta.modes`,
 * `meta.limits`) or the scenario (`constants.FRESH_S`).
 */
import type { CamName, LadderLevel, LinkName, Manoeuvre, Requirement, RunData } from "../../../data/types";
import {
  dec, decisionIndexAt, fmtClock, fmtFrac, fmtFps, fmtMs, fmtSec, getScenario, ladderOf, linkLabel, linksOf,
  manoeuvreLabel,
} from "../../../data/loader";

/** Age at or above this means "never received" (exporter AGE_CAP_S, documented in types.ts). */
export const AGE_NEVER = 99;

/** Display order of the two tiles in every console (DESIGN.md 6.1: front left, rear right). */
export const TILE_CAMS: CamName[] = ["front", "rear"];

/** Last sample time of a run (cursor beyond it = mission over for this controller). */
export function lastSampleT(run: RunData): number {
  return run.samples.t[run.meta.n_samples - 1] ?? 0;
}

// ------------------------------------------------------------------ requirement

export function requirementAt(run: RunData, k: number): { man: Manoeuvre; req: Requirement } | null {
  const man = dec(run, "man", run.samples.man[k]) as Manoeuvre | null;
  if (!man) return null;
  const req = run.meta.requirements[man];
  return req ? { man, req } : null;
}

// ------------------------------------------------------------------ tile

export type TileState = "live" | "frozen" | "paused" | "waiting" | "nodata" | "ended";

export interface TileModel {
  cam: CamName;
  state: TileState;
  /** Age of the newest frame at the operator, s (AGE_NEVER = never). */
  age: number;
  /** Frames that arrived in the last 1 s. */
  fps: number;
  /** Ladder rung of the newest received frame. */
  level: LadderLevel | undefined;
  levelIndex: number;
  /** Ladder rung the controller is sending now. */
  target: LadderLevel | undefined;
  targetIndex: number;
  /** Links the camera is sent on now, primary first. */
  links: LinkName[];
  /** Sample index of the moment the newest frame was captured (t - age), for drawing. */
  captureK: number;
  /** Age above which this tile counts as frozen, s. */
  frozenAfter: number;
  /** This camera is the one the true manoeuvre needs. */
  needed: boolean;
  /** Needed tile only: max_age_s of the requirement (age bar turns bad above it). */
  maxAge: number | null;
}

/** The scenario's "live" freshness limit (constants.FRESH_S), else the requirement's max age. */
function freshS(): number | null {
  const v = getScenario()?.constants?.FRESH_S;
  return typeof v === "number" ? v : null;
}

/**
 * Tile state at sample k.
 * - paused: the controller sends this camera at level 0 (PAUSED): "No video sent".
 * - waiting: no frame has ever arrived (age capped at AGE_NEVER).
 * - frozen: no new frame for longer than both the live limit (FRESH_S) and two frame
 *   intervals of the level being sent; a 1 fps TRICKLE that arrives on time is a slow
 *   stream, not a frozen one.
 *   DESIGN-GAP: DESIGN.md 7 does not define "no new frame" numerically; this rule uses only
 *   FRESH_S and the ladder fps from the data.
 */
export function tileAt(run: RunData, k: number, cam: CamName, ended: boolean): TileModel {
  const c = run.cams?.[cam];
  const rq = requirementAt(run, k);
  const needed = rq?.req.cam === cam;
  const base: TileModel = {
    cam, state: "nodata", age: AGE_NEVER, fps: 0, level: undefined, levelIndex: 0, target: undefined, targetIndex: 0,
    links: [], captureK: k, frozenAfter: Infinity, needed, maxAge: needed && rq ? rq.req.max_age_s : null,
  };
  if (!c || c.age.length === 0) return base;
  const age = c.age[k];
  const levelIndex = c.vlevel[k];
  const targetIndex = c.tlevel[k];
  const level = ladderOf(run, levelIndex);
  const target = ladderOf(run, targetIndex);
  const links = linksOf(run, c.tgt[k]);
  const sendFps = (target && target.fps > 0 ? target.fps : level?.fps) || 1;
  const fresh = freshS() ?? rq?.req.max_age_s ?? 0.5;
  const frozenAfter = Math.max(fresh, 2 / sendFps);
  // Capture moment of the newest frame: sample at (t - age).
  const tc = run.samples.t[k] - age;
  let captureK = k;
  if (age < AGE_NEVER) {
    // Last sample at or before tc (the grid is uniform, step meta.dt).
    captureK = Math.max(0, k - Math.ceil(age / run.meta.dt - 1e-6));
    if (captureK > 0 && run.samples.t[captureK] > tc + 1e-6) captureK -= 1;
  }
  let state: TileState;
  if (ended) state = "ended";
  else if (targetIndex === 0) state = "paused";
  else if (age >= AGE_NEVER || levelIndex === 0) state = "waiting";
  else if (age > frozenAfter) state = "frozen";
  else state = "live";
  return { ...base, state, age, fps: c.fps[k], level, levelIndex, target, targetIndex, links, captureK, frozenAfter };
}

/** "Starlink", "Starlink + 4G", or "no link". */
export function viaText(links: LinkName[]): string {
  return links.length === 0 ? "no link" : links.map(linkLabel).join(" + ");
}

/** "320×240" or "no frame". */
export function resText(l: LadderLevel | undefined): string {
  return l && l.w > 0 ? `${l.w}×${l.h}` : "no frame";
}

/** Age with enough decimals that the comparison with `limit` is visible ("0.53 s"). */
export function fmtAge(age: number, limit: number | null = null): string {
  if (age >= AGE_NEVER) return "never";
  if (limit !== null && age > limit && Number(age.toFixed(1)) <= limit) return fmtSec(age, 2);
  return fmtSec(age, 1);
}

// ------------------------------------------------------------------ verdict

export interface VerdictModel {
  usable: boolean;
  cam: CamName;
  man: Manoeuvre;
  req: Requirement;
  /** The words after "Usable:" / "Not usable:". */
  detail: string;
  /** Full sentence for screen readers and tooltips. */
  sentence: string;
}

const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** "front camera, newest frame 0.5 s old at most, 10 fps or more, 320 px wide or more". */
export function requirementText(req: Requirement): string {
  return `${req.cam} camera, newest frame ${fmtSec(req.max_age_s, 1)} old at most, ${fmtFps(req.min_fps)} or more, ${req.min_w} px wide or more`;
}

/**
 * Verdict at sample k, agreeing with samples.useful by construction: `usable` IS
 * samples.useful[k]; the words name which requirement the exported columns fail.
 */
export function verdictAt(run: RunData, k: number): VerdictModel | null {
  const rq = requirementAt(run, k);
  if (!rq) return null;
  const { man, req } = rq;
  const cam = req.cam;
  const usable = run.samples.useful[k] === 1;
  const c = run.cams?.[cam];
  const manL = lc(manoeuvreLabel(man));
  if (!c) {
    const detail = usable ? `${cam} view meets the ${manL} requirement` : `${cam} view misses the ${manL} requirement`;
    return { usable, cam, man, req, detail, sentence: `${usable ? "Usable" : "Not usable"}: ${detail}.` };
  }
  const age = c.age[k];
  const fps = c.fps[k];
  const w = ladderOf(run, c.vlevel[k])?.w ?? 0;

  if (usable) {
    const detail = `${cam} view at ${fmtFps(fps)}, ${fmtAge(age)} old, ${w} px wide`;
    return { usable, cam, man, req, detail, sentence: `Usable: ${detail}.` };
  }

  let detail: string;
  if (age >= AGE_NEVER) {
    detail = `no ${cam} frame received yet (${manL} needs one ${fmtSec(req.max_age_s, 1)} old or newer)`;
  } else {
    const got: string[] = [];
    const need: string[] = [];
    if (age > req.max_age_s + 1e-9) {
      got.push(`${fmtAge(age, req.max_age_s)} old`);
      need.push(`${fmtSec(req.max_age_s, 1)} or newer`);
    }
    if (fps < req.min_fps) {
      got.push(`at ${fmtFps(fps)}`);
      need.push(`${fmtFps(req.min_fps)} or more`);
    }
    if (w < req.min_w) {
      got.push(w > 0 ? `only ${w} px wide` : "with no picture");
      need.push(`${req.min_w} px or more`);
    }
    if (got.length === 0) {
      // Exported ages are rounded to 0.01 s; the engine compared the unrounded age, so the
      // only way every exported column passes while useful = 0 is an age just over the limit.
      got.push(`just over ${fmtSec(req.max_age_s, 1)} old`);
      need.push(`${fmtSec(req.max_age_s, 1)} or newer`);
    }
    detail = `${cam} view ${got.join(" and ")} (${manL} needs ${need.join(" and ")})`;
  }
  return { usable, cam, man, req, detail, sentence: `Not usable: ${detail}.` };
}

// ------------------------------------------------------------------ mode seen

export interface ModeSeen {
  /** The controller exposes a detected manoeuvre. */
  detects: boolean;
  /** Detected mode label ("Driving") or the plain reason it has none. */
  seen: string;
  /** True manoeuvre label. */
  truth: string;
  /** Detected mode equals the true manoeuvre. */
  match: boolean;
  /** Code names for the tooltip. */
  seenCode: string;
  truthCode: string;
}

/** Controller's mode in effect at sample k (samples.mode) against the true manoeuvre. */
export function modeSeenAt(run: RunData, k: number): ModeSeen {
  const mode = dec(run, "mode", run.samples.mode[k]) ?? "N/A";
  const man = dec(run, "man", run.samples.man[k]) ?? "";
  const truth = manoeuvreLabel(man);
  if (mode === "N/A") {
    return { detects: false, seen: "none", truth, match: false, seenCode: mode, truthCode: man };
  }
  if (mode === "FIXED") {
    return { detects: false, seen: "none, fixed priorities", truth, match: false, seenCode: mode, truthCode: man };
  }
  return { detects: true, seen: manoeuvreLabel(mode), truth, match: mode === man, seenCode: mode, truthCode: man };
}

// ------------------------------------------------------------------ decision log

export interface LogEntry {
  /** Index into run.reasons. */
  i: number;
  t: number;
  /** Raw reason text exactly as the decider logged it. */
  raw: string;
  /** Plain-language rewrite (falls back to the raw text when no rule matches). */
  text: string;
  /** True when `text` is a rewrite. */
  rewritten: boolean;
}

const camWord = (c: string) => (c === "rear" ? "rear camera" : "front camera");
const Cam = (c: string) => (c === "rear" ? "Rear camera" : "Front camera");
const L = (l: string) => linkLabel(l);

function levelName(run: RunData, di: number, cam: string): string | null {
  const col = cam === "rear" ? run.decisions.cols.rear_level : run.decisions.cols.front_level;
  const lv = ladderOf(run, col[di]);
  return lv ? lv.name : null;
}

/** "RTT 312 ms (limit 250 ms)" / "no heartbeat echo" / "loss 8.0% (limit 5%)" for a link at decision di. */
function videoLimitCause(run: RunData, di: number, link: string): string | null {
  const m = run.decisions.measured[link as LinkName];
  const lim = run.meta.limits?.video;
  if (!m || !lim) return null;
  if (m.alive[di] === 0) return "no heartbeat echo";
  if (m.rtt[di] > lim.max_rtt_ms) return `RTT ${fmtMs(m.rtt[di])}, limit ${fmtMs(lim.max_rtt_ms)}`;
  if (m.loss[di] > lim.max_loss) return `loss ${fmtFrac(m.loss[di])}, limit ${fmtFrac(lim.max_loss, 0)}`;
  return null;
}

/** Proposed's per-mode stream limits at decision di, from meta.modes ("RTT 250 ms, loss 5%"). */
function streamLimits(run: RunData, di: number, cam: string): { text: string; mode: string } | null {
  const mode = dec(run, "mode", run.decisions.cols.mode[di]);
  if (!mode) return null;
  const need = run.meta.modes?.[mode]?.[cam as CamName];
  if (!need || need.max_rtt_ms === undefined || need.max_loss === undefined) return null;
  return { text: `RTT ${fmtMs(need.max_rtt_ms)} and loss ${fmtFrac(need.max_loss, 0)} at most`, mode: lc(manoeuvreLabel(mode)) };
}

/**
 * Plain-language rewrite of one reason. Each rule mirrors the f-string that produced the
 * text in edge_mlc/deciders/baseline.py or proposed.py, and adds only values that are in
 * the trace at that decision (levels, measured link values, limits). Unknown text is kept.
 */
export function rewriteReason(run: RunData, t: number, raw: string): string | null {
  const di = decisionIndexAt(run, t);
  const order = run.meta.links;
  let m: RegExpExecArray | null;

  // ---- baseline.py
  if ((m = /^video link (\w+)->(\w+) \(threshold\)$/.exec(raw))) {
    const [, from, to] = m;
    if (order.indexOf(to as LinkName) < order.indexOf(from as LinkName)) {
      const pref = to === order[0] ? "the preferred link" : `preferred over ${L(from)}`;
      return `Both cameras moved back to ${L(to)}, ${pref}: it met the video limits again.`;
    }
    const cause = videoLimitCause(run, di, from);
    return `Both cameras moved from ${L(from)} to ${L(to)}: ${L(from)} broke the video limit${cause ? ` (${cause})` : ""}.`;
  }
  if ((m = /^(front|rear) quality down \(loss ([\d.]+)\)$/.exec(raw))) {
    const [, cam, loss] = m;
    const lv = levelName(run, di, cam);
    const link = linksOf(run, cam === "rear" ? run.decisions.cols.rear_links[di] : run.decisions.cols.front_links[di])[0];
    return `${Cam(cam)} stepped down${lv ? ` to ${lv}` : ""}: data loss ${fmtFrac(Number(loss), 0)}${link ? ` on ${L(link)}` : ""}.`;
  }
  if ((m = /^(front|rear) quality up$/.exec(raw))) {
    const lv = levelName(run, di, m[1]);
    // baseline.py steps up after cam_up_after_s with data loss at or below cam_down_loss;
    // neither value is in the trace, so the sentence names the rule without numbers.
    return `${Cam(m[1])} stepped up${lv ? ` to ${lv}` : ""}: data loss had stayed below the step-down limit.`;
  }

  // ---- proposed.py (and the oracles, which run the same decider)
  if ((m = /^(front|rear): (\w+) has ([\d.]+)s left -> duplicate on (\w+)$/.exec(raw))) {
    const [, cam, cur, s, b] = m;
    return `${Cam(cam)} also sent on ${L(b)}: ${L(cur)} predicted to fail in ${fmtSec(Number(s))}.`;
  }
  if ((m = /^(front|rear): predicted failure of (\w+) in ([\d.]+)s -> switch to (\w+)$/.exec(raw))) {
    const [, cam, cur, s, b] = m;
    return `${Cam(cam)} moved to ${L(b)}: ${L(cur)} predicted to fail in ${fmtSec(Number(s))}.`;
  }
  if ((m = /^(front|rear): scheduled handover on (\w+) -> duplicate on (\w+)$/.exec(raw))) {
    const [, cam, cur, b] = m;
    return `${L(cur)} handover due: ${camWord(cam)} also sent on ${L(b)}.`;
  }
  if ((m = /^(front|rear): no link meets limits -> minimum level on (\w+) \(degraded\)$/.exec(raw))) {
    const [, cam, link] = m;
    const lv = levelName(run, di, cam);
    const lim = streamLimits(run, di, cam);
    return `No link meets the ${camWord(cam)}'s limits${lim ? ` for ${lim.mode} (${lim.text})` : ""}. Kept it at its minimum${lv ? `, ${lv},` : ""} on ${L(link)}.`;
  }
  if ((m = /^(front|rear): no link alive -> minimum level kept on (\w+)$/.exec(raw))) {
    const [, cam, link] = m;
    const lv = levelName(run, di, cam);
    return `No link looks alive. Kept the ${camWord(cam)} at its minimum${lv ? `, ${lv},` : ""} on ${L(link)}.`;
  }
  if ((m = /^(front|rear): no link can carry minimum -> (trickle|paused)$/.exec(raw))) {
    const [, cam, what] = m;
    return what === "trickle"
      ? `No link meets the ${camWord(cam)}'s limits with room for its minimum level, so it drops to TRICKLE.`
      : `Paused the ${camWord(cam)}: no link meets its limits with room for its minimum level.`;
  }
  if ((m = /^(front|rear): (\w+)->(\w+)$/.exec(raw))) {
    const [, cam, a, b] = m;
    return b === order[0]
      ? `${Cam(cam)} moved back to ${L(b)}, the preferred link.`
      : `${Cam(cam)} moved from ${L(a)} to ${L(b)}.`;
  }
  return null;
}

const logCache = new WeakMap<RunData, LogEntry[]>();

/** Every reason of a run as a log entry, oldest first (cached per run). */
export function logEntries(run: RunData): LogEntry[] {
  const hit = logCache.get(run);
  if (hit) return hit;
  const out = run.reasons.map(([t, raw], i) => {
    const text = rewriteReason(run, t, raw);
    return { i, t, raw, text: text ?? raw, rewritten: text !== null };
  });
  logCache.set(run, out);
  return out;
}

/** "06:14.3" for log stamps. */
export const stamp = (t: number) => fmtClock(t);
