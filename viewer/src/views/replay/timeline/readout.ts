/**
 * Text for the timeline's crosshair readout and the slider's aria-valuetext. Every value
 * is read from the run at the cursor; thresholds come from `meta.requirements` and
 * `meta.limits`. The verdict itself is the simulator's `samples.useful` (never re-scored);
 * the reason names which requirement the protected view missed, using the same three
 * checks as edge_mlc/sim/engine.py `sample()`: frame age, frames in the last 1 s, width.
 */
import type { CamName, LinkName, Manoeuvre, RunData } from "../../../data/types";
import {
  dec, decisionIndexAt, ladderOf, linksOf, sampleIndexAt,
} from "../../../data/loader";
import {
  camLabel, linkLabel, manoeuvreLabel, segmentLabel,
} from "../../../data/labels";
import { fmtClock, fmtFps, fmtFrac, fmtKm, fmtMbps, fmtMs, fmtSec } from "../../../format";
import { LINK_DEGRADED, LINK_DOWN, linkClassAt } from "./derive";

/** True when t is past the last sample of the run. */
export function endedAt(run: RunData, t: number): boolean {
  const n = run.meta.n_samples;
  return n === 0 || t > run.samples.t[n - 1] + (run.meta.dt || 0.1) - 1e-6;
}

export interface Verdict {
  kind: "usable" | "not" | "ended";
  /** "Usable", "Not usable", "Mission ended at 22:09.9". */
  head: string;
  /** "front view at 20 fps, 0.1 s old" or "rear view 1.4 s old (reversing needs 0.5 s or newer)". */
  reason: string;
}

/** The controller's verdict on the operator's view at time t, with its reason. */
export function verdictAt(run: RunData, t: number): Verdict {
  if (endedAt(run, t)) {
    return { kind: "ended", head: `Mission ended at ${fmtClock(run.meta.mission_time_s)}`, reason: "" };
  }
  const k = sampleIndexAt(run, t);
  const s = run.samples;
  const man = dec(run, "man", s.man[k]) as Manoeuvre | null;
  const rq = man ? run.meta.requirements[man] : undefined;
  const cam = (dec(run, "cam", s.prot[k]) ?? rq?.cam ?? "front") as CamName;
  const c = run.cams[cam];
  const age = c.age[k];
  const fps = s.fps[k];
  const w = ladderOf(run, c.vlevel[k])?.w ?? 0;
  const view = `${cam} view`;
  const manWord = manoeuvreLabel(man).toLowerCase();
  const ageText = age >= 99 ? "no frame yet" : `${fmtSec(age)} old`;

  if (s.useful[k] === 1) {
    return { kind: "usable", head: "Usable", reason: `${view} at ${fmtFps(fps)}, ${ageText}` };
  }
  const fails: string[] = [];
  if (rq) {
    if (age > rq.max_age_s) {
      fails.push(age >= 99
        ? `no ${cam} frame received yet (${manWord} needs one ${fmtSec(rq.max_age_s)} old or newer)`
        : `${view} ${ageText} (${manWord} needs ${fmtSec(rq.max_age_s)} or newer)`);
    }
    if (fps < rq.min_fps) fails.push(`${view} at ${fmtFps(fps)} (${manWord} needs ${fmtFps(rq.min_fps)})`);
    if (w < rq.min_w) fails.push(`${view} ${w} px wide (${manWord} needs ${rq.min_w} px)`);
  }
  // Rounding of the exported age can hide a borderline miss; say so rather than invent one.
  const reason = fails.length > 0 ? fails[0] : `${view} at ${fmtFps(fps)}, ${ageText}, below the requirement`;
  return { kind: "not", head: "Not usable", reason };
}

/** Short truth text for one link at time t ("Down", "8.0 Mbps, 42 ms", "Lossy: 14.0% loss"). */
export function linkTruthText(run: RunData, link: LinkName, t: number): { cls: number; text: string } {
  const k = sampleIndexAt(run, t);
  const T = run.truth[link];
  const cls = linkClassAt(run, link, k);
  if (cls === LINK_DOWN) return { cls, text: "Down" };
  const lim = run.meta.limits.video;
  if (cls === LINK_DEGRADED) {
    const bad: string[] = [];
    if (T.loss[k] > lim.max_loss) bad.push(`loss ${fmtFrac(T.loss[k])}`);
    if (T.rtt[k] > lim.max_rtt_ms) bad.push(fmtMs(T.rtt[k]));
    return { cls, text: `${fmtMbps(T.cap[k])}, ${bad.join(", ")}` };
  }
  return { cls, text: `${fmtMbps(T.cap[k])}, ${fmtMs(T.rtt[k])}` };
}

/** What the controller's monitor measured for one link at time t. */
export function measuredText(run: RunData, link: LinkName, t: number): string {
  const M = run.decisions.measured[link];
  if (!M) return "–";
  const j = decisionIndexAt(run, t);
  if (!M.alive[j]) return M.rtt[j] >= 9999 ? "No echo" : "Not alive";
  const parts: string[] = [];
  if (M.cap[j] > 0) parts.push(fmtMbps(M.cap[j]));
  parts.push(fmtMs(M.rtt[j]));
  return parts.join(", ");
}

/** Camera plan of one controller at t: "front on Starlink at L5, rear on 4G at TRICKLE". */
export function camPlanText(run: RunData, t: number): string {
  if (endedAt(run, t)) return `mission ended at ${fmtClock(run.meta.mission_time_s)}`;
  const k = sampleIndexAt(run, t);
  return run.meta.cams.map((cam) => {
    const c = run.cams[cam];
    const links = linksOf(run, c.tgt[k]);
    const lvl = ladderOf(run, c.tlevel[k]);
    if (links.length === 0 || c.tlevel[k] <= 0) return `${cam} paused`;
    return `${cam} on ${links.map(linkLabel).join(" and ")} at ${lvl?.name ?? "?"}`;
  }).join(", ");
}

/** Position, segment and true manoeuvre at t (from the reference run). */
export function whereAt(run: RunData, t: number): { km: string; segment: string; man: string; need: string } {
  const k = sampleIndexAt(run, t);
  const s = run.samples;
  const man = dec(run, "man", s.man[k]) as Manoeuvre | null;
  const rq = man ? run.meta.requirements[man] : undefined;
  return {
    km: fmtKm(s.d[k]),
    segment: segmentLabel(dec(run, "seg", s.seg[k])),
    man: manoeuvreLabel(man),
    need: rq ? `${camLabel(rq.cam, true)}` : "",
  };
}
