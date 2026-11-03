/**
 * The claim sentence for one chapter, shared by the route strip's claim caption and the
 * Tour card. The numbers are the claim's computed usable shares (./claims.ts), printed with
 * fmtPct; the controller names are coloured spans.
 */
import type { ReactNode } from "react";
import { ctrlClass } from "../../../components";
import { configLabel, fmtPct } from "../../../data/loader";
import type { RunData } from "../../../data/types";
import type { ChapterClaim } from "./claims";

export interface Names { left: string; right: string; leftDecider: RunData["meta"]["decider"]; rightDecider: RunData["meta"]["decider"] }

/** A piece of the sentence: text, or a controller name. */
type Part = string | { side: "left" | "right" };

/** The sentence as parts. "short": "Crater: Proposed 96.0%, Baseline 9.0% usable." */
function claimParts(claim: ChapterClaim, names: Names, form: "full" | "short"): Part[] {
  const L: Part = { side: "left" };
  const R: Part = { side: "right" };
  const pL = fmtPct(claim.left.pct);
  const pR = fmtPct(claim.right.pct);
  const simple = /^\w+$/.test(names.left) && /^\w+$/.test(names.right);
  if (form === "short") return [`${claim.short}: `, R, ` ${pR}, `, L, ` ${pL} usable.`];
  if (claim.left.pct === null || claim.right.pct === null) return [`${claim.lead}: no samples in this trace.`];
  if (pL === pR && claim.left.pct === 0) return [`${claim.lead}, neither view was usable.`];
  if (pL === pR) return [`${claim.lead}, both views were usable ${pR} of the time.`];
  if (simple) return [`${claim.lead}, `, R, `’s view was usable ${pR} of the time; `, L, `’s ${pL}.`];
  return [`${claim.lead}, the view was usable ${pR} of the time with `, R, `; ${pL} with `, L, "."];
}

const label = (names: Names, side: "left" | "right") =>
  side === "left" ? configLabel(names.left, names.leftDecider) : configLabel(names.right, names.rightDecider);

/** The claim sentence with controller names in their colours. */
export function ClaimSentence({ claim, names, form }: { claim: ChapterClaim; names: Names; form: "full" | "short" }) {
  const out: ReactNode[] = claimParts(claim, names, form).map((p, i) =>
    typeof p === "string" ? p : <span key={i} className={ctrlClass(p.side === "left" ? names.left : names.right)}>{label(names, p.side)}</span>,
  );
  return <>{out}</>;
}

/** The same sentence as plain text (announcements, titles). */
export function claimText(claim: ChapterClaim, names: Names, form: "full" | "short"): string {
  return claimParts(claim, names, form).map((p) => (typeof p === "string" ? p : label(names, p.side))).join("");
}
