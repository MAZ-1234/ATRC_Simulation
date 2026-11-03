/**
 * Claim sentences are templates filled from data (DESIGN.md 6.2). A claim is a list of
 * parts: plain strings and controller names. Controller names render in the controller's
 * text colour, weight 500 (DESIGN.md 3); the same parts give the plain text used for
 * aria-labels.
 */
import type { ReactNode } from "react";
import { ctrlClass } from "../../components";

export type Part = string | { c: string; as?: string };
export type Parts = Part[];

/** A controller name in prose: c("Proposed"), or c("Proposed - uploads", "video-first"). */
export const c = (config: string, as?: string): Part => ({ c: config, as });

export function textOf(parts: Parts): string {
  return parts.map((p) => (typeof p === "string" ? p : p.as ?? p.c)).join("");
}

/** Non-breaking space (renders as a normal space; DESIGN.md 3 units rule). */
const NBSP = String.fromCharCode(160);
/** Keep a number and its unit on one line: "71 ms", "1.0 Mbps", "20 of 20 seeds". */
const UNIT_RE = /(\d) (ms|s|fps|MB|Mbps|kbps|points|seeds|times|min|interruptions)\b/g;
export function keepUnits(s: string): string {
  return s.replace(UNIT_RE, `$1${NBSP}$2`).replace(/min (\d)/g, `min${NBSP}$1`);
}

export function renderParts(parts: Parts): ReactNode {
  return parts.map((p, i) =>
    typeof p === "string" ? <span key={i}>{keepUnits(p)}</span> : <span key={i} className={ctrlClass(p.c)}>{p.as ?? p.c}</span>,
  );
}

/**
 * A label inside a sentence: lower-case the first letter unless the label starts with an
 * acronym or a number ("Heavy jamming" -> "heavy jamming", "4G overlap" stays).
 */
export function lc(label: string): string {
  if (label.length < 2) return label.toLowerCase();
  const a = label[0], b = label[1];
  if (/[0-9]/.test(a) || (/[A-Z]/.test(a) && /[A-Z0-9]/.test(b))) return label;
  return a.toLowerCase() + label.slice(1);
}
