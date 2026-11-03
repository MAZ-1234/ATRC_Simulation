/**
 * Operator-facing names (DESIGN.md section 10). Code names appear only in tooltips
 * and in Method; everything on screen goes through these lookups.
 */
import type { DeciderKind, LadderLevel, LinkName, Manoeuvre, PlanMode, SegmentName } from "./types";

/** Display order of links everywhere: Radio, Starlink, 4G. */
export const LINK_ORDER: LinkName[] = ["radio", "starlink", "lte"];

const LINK_LABEL: Record<LinkName, string> = { radio: "Radio", starlink: "Starlink", lte: "4G" };
/** "radio" -> "Radio", "lte" -> "4G". Unknown names pass through. */
export function linkLabel(link: string | null | undefined): string {
  if (!link) return "No link";
  return (LINK_LABEL as Record<string, string>)[link] ?? link;
}

const VARIANT_LABEL: Record<string, string> = {
  nominal: "Nominal",
  harsh_handovers: "Harsh handovers",
  heavy_jamming: "Heavy jamming",
  no_lte: "No 4G",
  fast_fade: "Fast radio fade",
  overlap: "4G overlap",
  overlap_harsh: "4G overlap with harsh handovers",
};
/** Variant code -> plain words ("no_lte" -> "No 4G"). The code goes in the tooltip. */
export function variantLabel(v: string): string {
  return VARIANT_LABEL[v] ?? v.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

const MAN_LABEL: Record<string, string> = {
  DRIVE: "Driving",
  REVERSE: "Reversing",
  PRECISION: "Precision",
  STOPPED: "Stopped",
  FIXED: "Fixed (no mission awareness)",
  "N/A": "Not detected",
  HIDE: "Hidden",
};
/** Manoeuvre / plan mode code -> "Driving", "Reversing", ... */
export function manoeuvreLabel(m: Manoeuvre | PlanMode | string | null | undefined): string {
  if (!m) return "Unknown";
  return MAN_LABEL[m] ?? m;
}

/** Camera code -> "Front" / "Rear" (sentence start) or "front camera" (prose). */
export function camLabel(cam: string, prose = false): string {
  const c = cam === "rear" ? "rear" : "front";
  return prose ? `${c} camera` : c === "rear" ? "Rear" : "Front";
}

/** Segment code -> sentence case label ("contested out" -> "Contested, outbound"). */
const SEG_LABEL: Record<SegmentName, string> = {
  "leave base": "Leaving base",
  "radio edge": "Radio edge",
  transit: "Transit",
  crater: "Crater",
  "contested out": "Contested, outbound",
  inspection: "Inspection",
  "contested back": "Contested, return",
  "transit back": "Transit, return",
  "radio back": "Radio, return",
};
export function segmentLabel(s: string | null | undefined): string {
  if (!s) return "Between segments";
  return (SEG_LABEL as Record<string, string>)[s] ?? s;
}

/** Controller identity used for colour: only Baseline and Proposed get a hue. */
export type CtrlRole = "baseline" | "proposed" | "other";
export function ctrlRole(config: string): CtrlRole {
  if (config === "Baseline") return "baseline";
  if (config === "Proposed") return "proposed";
  return "other";
}

/** True for the two oracle configurations (drawn dashed, labelled as upper bounds). */
export function isOracle(config: string, decider?: DeciderKind): boolean {
  return decider === "oracle" || config.startsWith("Oracle");
}

/** Row label for a configuration; oracles get "(upper bound, not deployable)". */
export function configLabel(config: string, decider?: DeciderKind): string {
  return isOracle(config, decider) ? `${config} (upper bound, not deployable)` : config;
}

/** Tooltip text for a ladder level: "L3: 320×240, 20 fps, about 700 kbps". */
export function levelTooltip(l: LadderLevel | undefined): string {
  if (!l) return "Unknown level";
  if (l.w === 0 || l.fps === 0) return `${l.name}: no video sent`;
  return `${l.name}: ${l.w}×${l.h}, ${l.fps} fps, about ${l.kbps} kbps`;
}
