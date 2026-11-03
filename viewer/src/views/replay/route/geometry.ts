/**
 * Route schematic geometry (DESIGN.md 6.1 "Route strip"): a km axis with an out lane and
 * a back lane joined by a U-turn at the inspection site. Zone extents and point positions
 * come from the scenario's zones for the current variant; nothing here hard-codes km.
 */
import type { Zone } from "../../../data/types";

export interface RouteLayout {
  width: number;
  height: number;
  /** km at the left and right ends of the axis. */
  km0: number;
  km1: number;
  /** Plot x range, px. */
  x0: number;
  x1: number;
  /** Lane centre lines, px. One-lane mode draws only `yOut` (== yBack). */
  yOut: number;
  yBack: number;
  /** Bottom of the label row, px. */
  labelBottom: number;
  twoLanes: boolean;
  showLabels: boolean;
  /** km where the return leg (and the mission) ends. */
  endKm: number | null;
  /** km of the turn-around (inspection site). */
  turnKm: number;
}

export function kmToX(L: RouteLayout, km: number): number {
  return L.x0 + ((km - L.km0) / (L.km1 - L.km0)) * (L.x1 - L.x0);
}
export function xToKm(L: RouteLayout, x: number): number {
  return L.km0 + ((x - L.x0) / (L.x1 - L.x0)) * (L.km1 - L.km0);
}

export function makeLayout(width: number, height: number, zones: Zone[], twoLanes: boolean, showLabels: boolean): RouteLayout {
  const site = zones.find((z) => z.kind === "site");
  const end = zones.find((z) => z.kind === "end");
  const turnKm = site ? site.from_km : Math.max(...zones.map((z) => z.to_km), 0);
  // The axis ends at the turn-around; the U-turn and the site ring sit in the right pad.
  const laneGap = twoLanes ? Math.max(10, Math.min(12, Math.round((height - 14) / 2))) : 0;
  const labelBottom = showLabels ? Math.min(15, Math.round(height * 0.42)) : 2;
  const yBack = height - 6;
  const yOut = twoLanes ? yBack - laneGap : yBack;
  const pad = twoLanes ? laneGap / 2 + 6 : 8;
  return {
    width, height, km0: 0, km1: turnKm, x0: 5, x1: Math.max(10, width - pad - 4),
    yOut, yBack, labelBottom, twoLanes, showLabels, endKm: end ? end.from_km : null, turnKm,
  };
}

/** A label the placer may draw. */
export interface LabelCand {
  key: string;
  text: string;
  /** Anchor x, px. */
  x: number;
  anchor: "start" | "end" | "middle";
  /** Lower = placed first. */
  prio: number;
  /** Quiet label (km ticks): drawn in text-3. */
  quiet?: boolean;
  /** For zone spans: the label may slide right up to this x (its right edge) to avoid a collision. */
  maxRight?: number;
}
export interface PlacedLabel extends LabelCand { left: number; right: number }

/** "1.5 km" (axis ticks use one decimal, like an axis; positions elsewhere use fmtKm). */
export function fmtKm1(km: number): string {
  return `${km.toFixed(1)} km`;
}

/** km of every 0.5 km tick strictly inside the axis. */
export function kmTicks(L: RouteLayout): number[] {
  const out: number[] = [];
  for (let km = 0.5; km < L.km1 - 0.05; km += 0.5) out.push(Math.round(km * 10) / 10);
  return out;
}

/** Plain label for a zone (sentence case, operator words). */
export function zoneLabel(z: Zone): string {
  switch (z.kind) {
    case "tower": return z.name.replace(/\s*tower$/i, "");
    case "fade": return "Ridge";
    case "obstruction": return "Trees";
    case "crater": return "Crater";
    case "jamming": return "Contested";
    case "site": return "Inspection";
    case "coverage": return "Cell-edge 4G";
    case "trigger": return "Blackout";
    case "end": return "End";
    default: return z.name;
  }
}

const PRIO: Partial<Record<Zone["kind"], number>> = {
  crater: 0, jamming: 1, fade: 2, obstruction: 3, site: 4, tower: 5, coverage: 7, trigger: 8,
};

/**
 * Greedy label placement by priority: a label is drawn only where it does not collide with
 * a label already placed (kept 6px apart) and stays inside the strip. Others live in the
 * hover readout only.
 */
export function placeLabels(L: RouteLayout, zones: Zone[], measure: (s: string) => number): PlacedLabel[] {
  const cands: LabelCand[] = [];
  for (const z of zones) {
    const p = PRIO[z.kind];
    if (p === undefined) continue;
    const text = zoneLabel(z);
    if (z.kind === "tower") {
      cands.push({ key: z.name, text, x: kmToX(L, z.from_km) + 6, anchor: "start", prio: p });
    } else if (z.kind === "site") {
      cands.push({ key: z.name, text, x: L.width - 1, anchor: "end", prio: p });
    } else if (z.kind === "trigger" || z.kind === "coverage") {
      continue; // drawn as marks; named in the hover readout
    } else {
      cands.push({ key: z.name, text, x: kmToX(L, z.from_km) + 3, anchor: "start", prio: p, maxRight: kmToX(L, z.to_km) - 2 });
    }
  }
  // km ticks every 0.5 km fill the gaps the zone labels leave (lowest priority).
  for (let km = 0.5; km < L.km1 - 0.05; km += 0.5) {
    cands.push({ key: `km${km}`, text: fmtKm1(km), x: kmToX(L, km), anchor: "middle", prio: 20, quiet: true });
  }
  cands.sort((a, b) => a.prio - b.prio);
  const placed: PlacedLabel[] = [];
  // Tower glyphs sit in the label row: quiet km labels must not run into them.
  const glyphs = zones.filter((z) => z.kind === "tower").map((z) => kmToX(L, z.from_km));
  for (const c of cands) {
    const w = measure(c.text);
    let left = c.anchor === "start" ? c.x : c.anchor === "middle" ? c.x - w / 2 : c.x - w;
    const hits = (l: number) => placed.find((p) => l < p.right + 6 && l + w > p.left - 6);
    // A span label slides right past a placed label while it stays inside its zone.
    for (let h = hits(left); h && c.maxRight !== undefined && h.right + 6 + w <= c.maxRight; h = hits(left)) left = h.right + 6;
    const right = left + w;
    if (left < 0 || right > L.width) continue;
    if (hits(left)) continue;
    if (c.quiet && glyphs.some((g) => left < g + 8 && right > g - 8)) continue;
    placed.push({ ...c, x: c.anchor === "start" ? left : c.x, left, right });
  }
  return placed;
}
