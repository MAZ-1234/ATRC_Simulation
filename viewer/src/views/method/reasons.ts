/**
 * Plain-language versions of the decider reason strings (run.reasons). The patterns are
 * the f-strings in edge_mlc/deciders/baseline.py and proposed.py; anything unknown is
 * shown verbatim. The raw string stays available for tooltips.
 */
import { camLabel, fmtFrac, linkLabel } from "../../data/loader";

export type ReasonKind =
  | "predict-switch" | "predict-duplicate" | "scheduled-duplicate" | "move"
  | "degraded" | "no-link-alive" | "trickle" | "paused"
  | "video-link" | "quality-down" | "quality-up" | "other";

export interface ParsedReason {
  kind: ReasonKind;
  /** Camera the reason is about (Proposed reasons and Baseline quality steps). */
  cam: "front" | "rear" | null;
  /** Link the stream leaves / the predicted link. */
  from: string | null;
  /** Link the stream goes to / the backup. */
  to: string | null;
  /** Seconds quoted in the reason (predicted time left). */
  seconds: number | null;
  /** Loss quoted in a Baseline quality step (fraction). */
  loss: number | null;
  text: string;
  raw: string;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function parseReason(raw: string): ParsedReason {
  const base: ParsedReason = { kind: "other", cam: null, from: null, to: null, seconds: null, loss: null, text: raw, raw };
  let m: RegExpMatchArray | null;

  // Proposed
  if ((m = raw.match(/^(front|rear): predicted failure of (\w+) in ([\d.]+)s -> switch to (\w+)$/))) {
    const [, cam, from, s, to] = m;
    return { ...base, kind: "predict-switch", cam: cam as "front", from, to, seconds: +s,
      text: `${linkLabel(from)} predicted to fail for the ${camLabel(cam, true)} in ${(+s).toFixed(1)} s. Switched it to ${linkLabel(to)}.` };
  }
  if ((m = raw.match(/^(front|rear): (\w+) has ([\d.]+)s left -> duplicate on (\w+)$/))) {
    const [, cam, from, s, to] = m;
    return { ...base, kind: "predict-duplicate", cam: cam as "front", from, to, seconds: +s,
      text: `${linkLabel(from)} has ${(+s).toFixed(1)} s left for the ${camLabel(cam, true)}. Duplicated it on ${linkLabel(to)}.` };
  }
  if ((m = raw.match(/^(front|rear): scheduled handover on (\w+) -> duplicate on (\w+)$/))) {
    const [, cam, from, to] = m;
    return { ...base, kind: "scheduled-duplicate", cam: cam as "front", from, to,
      text: `${linkLabel(from)} handover is due. Duplicated the ${camLabel(cam, true)} on ${linkLabel(to)}.` };
  }
  if ((m = raw.match(/^(front|rear): no link meets limits -> minimum level on (\w+) \(degraded\)$/))) {
    const [, cam, to] = m;
    return { ...base, kind: "degraded", cam: cam as "front", to,
      text: `No link meets the ${camLabel(cam, true)}'s limits. Kept its minimum level on ${linkLabel(to)} (degraded).` };
  }
  if ((m = raw.match(/^(front|rear): no link alive -> minimum level kept on (\w+)$/))) {
    const [, cam, to] = m;
    return { ...base, kind: "no-link-alive", cam: cam as "front", to,
      text: `No link answers heartbeats. Kept the ${camLabel(cam, true)} at its minimum on ${linkLabel(to)}.` };
  }
  if ((m = raw.match(/^(front|rear): no link can carry minimum -> (trickle|paused)$/))) {
    const [, cam, what] = m;
    return { ...base, kind: what === "trickle" ? "trickle" : "paused", cam: cam as "front",
      text: `No link has room for the ${camLabel(cam, true)}'s minimum. ${what === "trickle" ? "Sent it at TRICKLE." : "Paused it."}` };
  }
  if ((m = raw.match(/^(front|rear): (\w+)->(\w+)$/))) {
    const [, cam, from, to] = m;
    return { ...base, kind: "move", cam: cam as "front", from, to,
      text: `${cap(camLabel(cam, true))} moved from ${linkLabel(from)} to ${linkLabel(to)}.` };
  }

  // Baseline
  if ((m = raw.match(/^video link (\w+)->(\w+) \(threshold\)$/))) {
    const [, from, to] = m;
    return { ...base, kind: "video-link", from, to,
      text: `Both cameras moved from ${linkLabel(from)} to ${linkLabel(to)}: ${linkLabel(from)} was marked bad for video.` };
  }
  if ((m = raw.match(/^(front|rear) quality down \(loss ([\d.]+)\)$/))) {
    const [, cam, l] = m;
    return { ...base, kind: "quality-down", cam: cam as "front", loss: +l,
      text: `${cap(camLabel(cam, true))} one level down (data loss ${fmtFrac(+l, 0)}).` };
  }
  if ((m = raw.match(/^(front|rear) quality up$/))) {
    const [, cam] = m;
    return { ...base, kind: "quality-up", cam: cam as "front", text: `${cap(camLabel(cam, true))} one level up.` };
  }
  return base;
}
