/**
 * Chapter scopes, chip labels and claim captions for the Tour (DESIGN.md 6.1.1).
 *
 * Every number here is read from the loaded traces at runtime:
 *  - chip km = the reference (right) vehicle's position at the chapter moment;
 *  - each claim reports the share of samples whose `samples.useful` is 1 (the simulator's
 *    own verdict: no re-scoring) inside the chapter's scope, for each controller.
 *
 * Scope rule (fixed, the same for every seed and for every outcome):
 *  0 radio lost   -> the "radio edge" scoring segment (same samples as metrics.useful_radio edge)
 *  1 trees        -> the outbound passage through the scenario's "obstruction" zone
 *  2 crater       -> the "crater" scoring segment (metrics.useful_crater)
 *  3 blackout     -> the run's own jammer blackout interval (events.blackout); if the run has
 *                    none, the "contested out" segment
 *  4 inspection   -> the "inspection" scoring segment
 */
import type { Chapter } from "../../../data/events";
import type { RunData, Scenario, SegmentName, Zone } from "../../../data/types";
import { fmtKm, fmtMbps, fmtDur, sampleIndexAt } from "../../../data/loader";

/** Medium chip names (wide), DESIGN.md 6.1 wireframe: "[1.6 km Radio lost] [2.10 km Trees] ...". */
const MID_NAME = ["Radio lost", "Trees", "Crater", "Jammer blackout", "Inspection"];

export interface ChipText {
  /** "1.55 km" (compact and narrow chips). */
  km: string;
  /** "1.55 km Radio lost" (wide chips). */
  mid: string;
  /** "1.55 km Radio lost behind the ridge" (tooltips, aria-label). */
  full: string;
}

/**
 * Chip labels with the km measured on the reference run.
 * DESIGN-GAP: DESIGN.md names the chapters "1.6 km", "3.0 km" etc. The traces put the radio
 * loss at about 1.55 km (inside the 1.3-1.6 km fade), so the km prefix is computed from the
 * vehicle position at the chapter moment and printed with fmtKm (two decimals).
 */
export function chipText(ch: Chapter, ref: RunData, scenario: Scenario | null): ChipText {
  const d = ref.samples.d[sampleIndexAt(ref, ch.t)];
  const km = fmtKm(d);
  let rest = ch.label.replace(/^[\d.]+\s*km\s+/, "");
  // The crater capacity in the label comes from the variant parameters, not from DESIGN copy.
  const cap = scenario?.variants[ref.meta.variant]?.params.crater_cap;
  if (cap !== undefined) rest = rest.replace(/\d+(\.\d+)?\s*Mbps/, fmtMbps(cap));
  return { km, mid: `${km} ${MID_NAME[ch.index] ?? rest}`, full: `${km} ${rest}` };
}

/** Usable share of one controller inside a scope. */
export interface Share {
  /** Percent of the scope's samples with a usable view (0-100); null when the scope is empty. */
  pct: number | null;
  /** Scope length in this run, s. */
  seconds: number;
}

export interface ChapterClaim {
  index: number;
  /** Sentence lead, e.g. "In the crater". */
  lead: string;
  /** Short scope name for compact captions, e.g. "Crater". */
  short: string;
  /** How the scope is defined, for the tooltip. */
  scopeNote: string;
  left: Share;
  right: Share;
}

export type Scope =
  | { kind: "segment"; seg: SegmentName }
  | { kind: "window"; from: number; to: number }
  | null;

/**
 * Sample indices inside a scope: the one selection every claim number is counted over
 * (the claim caption, the Tour card and the "How we got these numbers" page all use it).
 *   segment: every sample whose samples.seg is that scoring segment
 *   window:  every sample with from <= t < to
 */
export function scopeIndices(run: RunData, scope: Scope): number[] {
  const out: number[] = [];
  if (!scope) return out;
  const s = run.samples;
  if (scope.kind === "segment") {
    const code = run.enums.seg.indexOf(scope.seg);
    if (code < 0) return out;
    for (let k = 0; k < run.meta.n_samples; k++) if (s.seg[k] === code) out.push(k);
    return out;
  }
  for (let k = 0; k < run.meta.n_samples; k++) {
    const t = s.t[k];
    if (t < scope.from) continue;
    if (t >= scope.to) break;
    out.push(k);
  }
  return out;
}

function shareOf(run: RunData, idx: number[]): Share {
  let u = 0;
  for (const k of idx) u += run.samples.useful[k];
  return { pct: idx.length > 0 ? (100 * u) / idx.length : null, seconds: idx.length * run.meta.dt };
}

/** Outbound passage through a zone in one run: first sample at from_km to first sample past to_km. */
function passage(run: RunData, z: Zone): { from: number; to: number } | null {
  const s = run.samples;
  let a: number | null = null;
  for (let k = 0; k < run.meta.n_samples; k++) {
    if (s.dir[k] !== 1) continue;
    if (a === null && s.d[k] >= z.from_km) a = s.t[k];
    if (a !== null && s.d[k] > z.to_km) return { from: a, to: s.t[k] };
  }
  return null;
}

/** The scope of chapter `index` in one run (see the scope rule at the top of this file). */
export function scopeFor(index: number, run: RunData, zones: Zone[]): Scope {
  switch (index) {
    case 0: return { kind: "segment", seg: "radio edge" };
    case 1: {
      const z = zones.find((x) => x.kind === "obstruction");
      const p = z ? passage(run, z) : null;
      return p ? { kind: "window", ...p } : null;
    }
    case 2: return { kind: "segment", seg: "crater" };
    case 3: {
      const b = run.events.blackout;
      return b ? { kind: "window", from: b[0], to: b[0] + b[1] } : { kind: "segment", seg: "contested out" };
    }
    case 4: return { kind: "segment", seg: "inspection" };
    default: return null;
  }
}

function share(run: RunData, scope: Scope): Share {
  return shareOf(run, scopeIndices(run, scope));
}

const cache = new Map<string, ChapterClaim[]>();

/** Claims for every chapter of a pair. Cached per pair (the traces never change). */
export function computeClaims(chapters: Chapter[], left: RunData, right: RunData, scenario: Scenario | null): ChapterClaim[] {
  const key = `${left.meta.id}|${right.meta.id}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const zones = scenario?.variants[right.meta.variant]?.zones ?? [];
  const out: ChapterClaim[] = [];
  for (const ch of chapters) {
    const sR = scopeFor(ch.index, right, zones);
    const sL = scopeFor(ch.index, left, zones);
    if (!sR || !sL) continue;
    const r = share(right, sR);
    const l = share(left, sL);
    let lead = "";
    let short = "";
    let scopeNote = "";
    const dur = fmtDur(r.seconds);
    switch (ch.index) {
      case 0: lead = "Over the radio edge"; short = "Radio edge"; scopeNote = `Scope: the radio edge scoring segment (${dur} in the ${right.meta.config} run).`; break;
      case 1: {
        const z = zones.find((x) => x.kind === "obstruction");
        lead = "Passing the trees"; short = "Trees";
        scopeNote = `Scope: driving out through the trees, ${fmtKm(z?.from_km)} to ${fmtKm(z?.to_km)} (${dur} in the ${right.meta.config} run).`;
        break;
      }
      case 2: lead = "In the crater"; short = "Crater"; scopeNote = `Scope: the crater scoring segment (${dur} in the ${right.meta.config} run).`; break;
      case 3:
        if (sR.kind === "window") {
          lead = `During the ${fmtDur(sR.to - sR.from)} blackout`; short = "Blackout";
          scopeNote = "Scope: each run's own jammer blackout interval.";
        } else {
          lead = "In the contested zone, outbound"; short = "Contested";
          scopeNote = `Scope: the contested outbound scoring segment (${dur}).`;
        }
        break;
      case 4: lead = "At the inspection stop"; short = "Inspection"; scopeNote = `Scope: the inspection scoring segment (${dur} in the ${right.meta.config} run).`; break;
    }
    out.push({ index: ch.index, lead, short, scopeNote, left: l, right: r });
  }
  cache.set(key, out);
  return out;
}
