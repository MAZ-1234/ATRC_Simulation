/**
 * Results view data layer. Every number on the Results view comes through here, read
 * from window.SIM_RESULTS (summary / capacity / buffer / runs tables). Nothing is
 * re-scored and nothing is typed in by hand (DESIGN.md 6.2, 8).
 *
 * `_ci` columns are the 95% CI half-width (1.96 * sd / sqrt(n), run_experiments.summarise).
 */
import {
  getResults, getScenario, summaryMetric, tableObjects, findRows, variantLabel,
  fmtPct, fmtCount, fmtNum, fmtDur, fmtMs, fmtFps, fmtMB, fmtSec,
  type MetricCI,
} from "../../data/loader";
import type { Cell } from "../../data/types";

export type { MetricCI };
export type Better = "higher" | "lower";

/** One metric as the Results view shows it. Units follow DESIGN.md 8. */
export interface MetricDef {
  key: string;
  /** Short column name for the comparison matrix: "Usable view". */
  short?: string;
  /** Chart facet title with unit: "Usable view (%)". */
  title: string;
  /** Short noun for prose and tables: "usable view". */
  noun: string;
  better: Better;
  /** Decimals in tables and value labels. */
  dp: number;
  /** Prose / tooltip formatter (with unit). */
  fmt: (v: number | null) => string;
  /** Value label next to a dot (no unit; the facet title carries it). */
  label: (v: number | null) => string;
}

const num = (dp: number) => (v: number | null) => fmtNum(v, dp);

const camOf = (man: "DRIVE" | "REVERSE" | "PRECISION" | "STOPPED") => getScenario()?.requirements?.[man]?.cam ?? null;
const sizeOf = (id: string): number | null => {
  const sc = getScenario();
  if (!sc) return null;
  if (sc.driver.scan_drive.id === id) return sc.driver.scan_drive.size_mb;
  for (const list of Object.values(sc.driver.events)) {
    const hit = list.find((u) => u.id === id);
    if (hit) return hit.size_mb;
  }
  return null;
};
const withSize = (name: string, id: string) => {
  const mb = sizeOf(id);
  return mb === null ? name : `${name}, ${fmtMB(mb)}`;
};

/** Metric catalogue. Titles that mention a camera or size read them from scenario.js. */
export function metricDefs(): Record<string, MetricDef> {
  const driveCam = camOf("DRIVE");
  const camWord = driveCam ? `${driveCam === "rear" ? "Rear" : "Front"} camera` : "Needed camera";
  const d: MetricDef[] = [
    { key: "useful_view_pct", title: "Usable view (%)", noun: "usable view", better: "higher", dp: 1, fmt: (v) => fmtPct(v), label: num(1) },
    { key: "interruptions", title: "View interruptions per mission (count)", noun: "view interruptions", better: "lower", dp: 1, fmt: (v) => fmtCount(v, 1), label: num(1) },
    { key: "longest_interruption_s", title: "Longest interruption (s)", noun: "longest interruption", better: "lower", dp: 1, fmt: (v) => fmtSec(v), label: num(1) },
    { key: "video_delay_p95_ms", title: "Video delay p95 (ms)", noun: "video delay p95", better: "lower", dp: 0, fmt: (v) => fmtMs(v), label: num(0) },
    { key: "video_delay_p95_bulk_ms", title: "Video delay p95 while uploading (ms)", noun: "video delay p95 while uploading", better: "lower", dp: 0, fmt: (v) => fmtMs(v), label: num(0) },
    { key: "req_mean_s", title: "Requested uploads, mean delivery (s)", noun: "mean delivery time of requested uploads", better: "lower", dp: 1, fmt: (v) => fmtDur(v), label: num(1) },
    { key: "mission_time_s", title: "Mission time (s)", noun: "mission time", better: "lower", dp: 0, fmt: (v) => fmtDur(v), label: (v) => fmtCount(v) },
    { key: "dup_overhead_pct", title: "Extra data from duplicated video (%)", noun: "extra data from duplicated video", better: "lower", dp: 1, fmt: (v) => fmtPct(v), label: num(1) },
    { key: "useful_transition_pct", title: "Usable view around link changes (%)", noun: "usable view around link changes", better: "higher", dp: 1, fmt: (v) => fmtPct(v), label: num(1) },
    { key: "interruptions_transition", title: "Interruptions around link changes (count)", noun: "interruptions around link changes", better: "lower", dp: 1, fmt: (v) => fmtCount(v, 1), label: num(1) },
    { key: "n_transition_events", title: "Link changes per mission (count)", noun: "link changes per mission", better: "lower", dp: 1, fmt: (v) => fmtCount(v, 1), label: num(1) },
    { key: "radio_leave_minus_fail_s", title: "Left the radio, relative to its failure (s)", noun: "time the view left the radio relative to its failure", better: "lower", dp: 1, fmt: (v) => fmtSec(v), label: num(1) },
    { key: "scan_drive_s", title: `${withSize("Driving scan", "scan_drive")}: delivered in (s)`, noun: "driving scan delivery", better: "lower", dp: 1, fmt: (v) => fmtDur(v), label: num(1) },
    { key: "lidar_crater_s", title: `${withSize("Crater scan", "lidar_crater")}: delivered in (s)`, noun: "crater scan delivery", better: "lower", dp: 1, fmt: (v) => fmtDur(v), label: num(1) },
    { key: "still_s", title: `${withSize("Still", "still")}: delivered in (s)`, noun: "still delivery", better: "lower", dp: 1, fmt: (v) => fmtDur(v), label: num(1) },
    { key: "clip_s", title: `${withSize("Clip", "clip")}: delivered in (s)`, noun: "clip delivery", better: "lower", dp: 1, fmt: (v) => fmtDur(v), label: num(1) },
    { key: "needed_fps_while_req_drive", title: `${camWord} while the driving scan uploads (fps)`, noun: `${camWord.toLowerCase()} frame rate while the driving scan uploads`, better: "higher", dp: 1, fmt: (v) => (v === null ? fmtFps(v) : `${fmtNum(v, 1)} fps`), label: num(1) },
    { key: "fps_delivered_mean_DRIVE", title: "Needed camera while driving (fps)", noun: "needed camera frame rate while driving", better: "higher", dp: 1, fmt: (v) => (v === null ? fmtFps(v) : `${fmtNum(v, 1)} fps`), label: num(1) },
    { key: "bg_backlog_mb_at_end", title: "Background data left at mission end (MB)", noun: "background data left at mission end", better: "lower", dp: 1, fmt: (v) => fmtMB(v), label: num(1) },
    { key: "bg_delivered_mb", title: "Background data delivered (MB)", noun: "background data delivered", better: "higher", dp: 0, fmt: (v) => fmtMB(v), label: num(0) },
    { key: "useful_crater", title: "Usable view in the crater (%)", noun: "usable view in the crater", better: "higher", dp: 1, fmt: (v) => fmtPct(v), label: num(1) },
  ];
  return Object.fromEntries(d.map((m) => [m.key, m]));
}

/** Metric definition by key (falls back to a generic one so nothing crashes). */
export function def(key: string): MetricDef {
  return metricDefs()[key] ?? { key, title: key, noun: key, better: "higher", dp: 1, fmt: (v) => fmtNum(v, 1), label: num(1) };
}

// ------------------------------------------------------------------ table access

/** Mean, CI and n from summary.csv. */
export function sm(config: string, variant: string, metric: string): MetricCI {
  return summaryMetric(config, variant, metric);
}

/** Configs present in summary.csv for a variant, in file order. */
export function configsIn(variant: string): string[] {
  const rows = tableObjects(getResults()?.summary).filter((r) => r.variant === variant);
  return Array.from(new Set(rows.map((r) => String(r.config))));
}

/** Variants present in summary.csv, in file order. */
export function variantsIn(): string[] {
  return Array.from(new Set(tableObjects(getResults()?.summary).map((r) => String(r.variant))));
}

export function has(config: string, variant: string): boolean {
  return findRows(getResults()?.summary, { config, variant }).length > 0;
}

/** Results variant to use: the selected one when summary.csv has it, else nominal. */
export function resultsVariant(selected: string): string {
  return has("Proposed", selected) ? selected : "nominal";
}

const isNum = (v: Cell | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** Row of a sweep table (capacity / buffer) as a MetricCI. */
export function sweepMetric(row: Record<string, Cell>, metric: string): MetricCI {
  const mean = isNum(row[metric]) ? (row[metric] as number) : null;
  const ci = isNum(row[`${metric}_ci`]) ? (row[`${metric}_ci`] as number) : null;
  return { mean, ci, lo: mean !== null && ci !== null ? mean - ci : null, hi: mean !== null && ci !== null ? mean + ci : null, n: isNum(row.n) ? row.n : null };
}

/** Per-seed paired comparison from results.runs: seeds where `a` beats `b`. */
export function pairedWins(a: string, b: string, variant: string, metric: string, better: Better): { wins: number; ties: number; n: number } {
  const rows = tableObjects(getResults()?.runs).filter((r) => r.variant === variant);
  const bySeed = new Map<number, { a?: number; b?: number }>();
  for (const r of rows) {
    if (r.config !== a && r.config !== b) continue;
    const v = r[metric];
    if (!isNum(v) || !isNum(r.seed)) continue;
    const e = bySeed.get(r.seed) ?? {};
    if (r.config === a) e.a = v; else e.b = v;
    bySeed.set(r.seed, e);
  }
  let wins = 0, ties = 0, n = 0;
  bySeed.forEach((e) => {
    if (e.a === undefined || e.b === undefined) return;
    n++;
    if (e.a === e.b) ties++;
    else if (better === "higher" ? e.a > e.b : e.a < e.b) wins++;
  });
  return { wins, ties, n };
}

// ------------------------------------------------------------------ comparisons

export interface Cmp {
  /** a - b (mean). */
  diff: number | null;
  /** a is better than b by mean. */
  aBetter: boolean;
  /** The two 95% intervals do not overlap. */
  clear: boolean;
}
export function compare(a: MetricCI, b: MetricCI, better: Better): Cmp {
  if (a.mean === null || b.mean === null) return { diff: null, aBetter: false, clear: false };
  const diff = a.mean - b.mean;
  const aBetter = better === "higher" ? diff > 0 : diff < 0;
  const clear = a.lo !== null && a.hi !== null && b.lo !== null && b.hi !== null && (a.lo > b.hi || b.lo > a.hi);
  return { diff, aBetter, clear };
}

/**
 * Format two values so the rounding never hides or reverses their order (DESIGN.md 13:
 * do not round in a way that changes a comparison). Adds decimals (up to 3) until the
 * rounded values differ in the same direction as the raw ones.
 */
export function pairDp(a: number | null, b: number | null, dp: number): number {
  if (a === null || b === null || a === b) return dp;
  let d = dp;
  while (d < 3) {
    const ra = Number(a.toFixed(d)), rb = Number(b.toFixed(d));
    if (Math.sign(ra - rb) === Math.sign(a - b)) break;
    d++;
  }
  return d;
}

/** Percent pair with safe decimals. */
export function pctPair(a: number | null, b: number | null): [string, string] {
  const d = pairDp(a, b, 1);
  return [fmtPct(a, d), fmtPct(b, d)];
}
/** Plain number pair with safe decimals. */
export function numPair(a: number | null, b: number | null, dp = 1): [string, string] {
  const d = pairDp(a, b, dp);
  return [fmtNum(a, d), fmtNum(b, d)];
}

// ------------------------------------------------------------------ source facts

export interface SourceInfo {
  dir: string;
  nNominal: number;
  byVariant: Record<string, number>;
  variants: string[];
  /** "n = 20 seeds on nominal, 10 on each other variant" style phrase. */
  phrase: string;
}
export function sourceInfo(): SourceInfo {
  const r = getResults();
  const byVariant = r?.n_seeds_by_variant ?? {};
  const variants = variantsIn();
  const nNominal = byVariant.nominal ?? r?.n_seeds ?? 0;
  const others = variants.filter((v) => v !== "nominal").map((v) => byVariant[v]).filter((x): x is number => typeof x === "number");
  const same = others.length > 0 && others.every((x) => x === others[0]);
  const phrase = others.length === 0
    ? `${nNominal} seeds on nominal`
    : same
      ? `${nNominal} seeds on nominal, ${others[0]} on each other variant`
      : `${nNominal} seeds on nominal, ${Math.min(...others)}–${Math.max(...others)} on the other variants`;
  return { dir: r?.source_dir ?? "", nNominal, byVariant, variants, phrase };
}

/** n of a config + variant from summary.csv. */
export function nOf(config: string, variant: string): number | null {
  return sm(config, variant, "useful_view_pct").n;
}

/** "Nominal, n = 20 seeds" scope line for a block. */
export function scopeOf(variant: string, config = "Proposed"): string {
  const n = nOf(config, variant);
  return `${variantLabel(variant)}, n = ${n ?? "–"} seeds`;
}

// ------------------------------------------------------------------ losses ("Where Proposed does not win")

/** Metrics scanned for losses, in matrix column order, with short column names. */
export const SCAN: { key: string; short: string }[] = [
  { key: "useful_view_pct", short: "Usable view" },
  { key: "interruptions", short: "Interruptions" },
  { key: "longest_interruption_s", short: "Longest interruption" },
  { key: "useful_transition_pct", short: "Usable around link changes" },
  { key: "useful_crater", short: "Usable in the crater" },
  { key: "video_delay_p95_ms", short: "Video delay p95" },
  { key: "video_delay_p95_bulk_ms", short: "Video delay p95 while uploading" },
  { key: "req_mean_s", short: "Requested upload time" },
  { key: "lidar_crater_s", short: "Crater scan delivery" },
  { key: "bg_backlog_mb_at_end", short: "Background left at end" },
];

/** True for the two oracle configurations (read ground truth; never compared as rivals). */
export const isOracleCfg = (cfg: string) => cfg.startsWith("Oracle");

/** Deployable configurations other than Proposed present for a variant, in file order. */
export function rivalsIn(variant: string): string[] {
  return configsIn(variant).filter((cfg) => cfg !== "Proposed" && !isOracleCfg(cfg));
}

export type Outcome = "clear" | "overlap" | "none" | "missing";
export interface Loss { config: string; metric: string; other: MetricCI; proposed: MetricCI; outcome: Outcome }

/**
 * Every (rival, metric) comparison on a variant. "clear": the rival's mean is better
 * and the two 95% intervals do not overlap; "overlap": better mean, intervals overlap;
 * "none": Proposed's mean is as good or better; "missing": no value.
 */
export function scanLosses(variant: string): { cells: Loss[]; losses: Loss[]; compared: number } {
  const cells: Loss[] = [];
  for (const cfg of rivalsIn(variant)) {
    for (const { key } of SCAN) {
      const other = sm(cfg, variant, key);
      const proposed = sm("Proposed", variant, key);
      let outcome: Outcome = "missing";
      if (other.mean !== null && proposed.mean !== null) {
        const c = compare(other, proposed, def(key).better);
        outcome = c.aBetter ? (c.clear ? "clear" : "overlap") : "none";
      }
      cells.push({ config: cfg, metric: key, other, proposed, outcome });
    }
  }
  const losses = cells.filter((x) => x.outcome === "clear" || x.outcome === "overlap");
  return { cells, losses, compared: cells.filter((x) => x.outcome !== "missing").length };
}

// ------------------------------------------------------------------ prose formatting

const UNIT: Record<string, string> = { "%": "%", ms: " ms", s: " s", fps: " fps", MB: " MB", count: "" };
/** Unit suffix from the metric title's "(unit)". */
function unitOf(key: string): string {
  const m = /\(([^)]+)\)\s*$/.exec(def(key).title);
  return m ? UNIT[m[1]] ?? ` ${m[1]}` : "";
}

/** One value of a metric in prose, with its unit. */
export function fv(key: string, v: number | null): string {
  return def(key).fmt(v);
}

/**
 * Two values of the same metric in prose, with enough decimals that rounding never hides
 * or reverses their order (DESIGN.md 13).
 */
export function fpair(key: string, a: number | null, b: number | null): [string, string] {
  const d = def(key);
  const dp = pairDp(a, b, d.dp);
  if (dp === d.dp) {
    const fa = d.fmt(a), fb = d.fmt(b);
    if (fa !== fb || a === b) return [fa, fb];
  }
  const u = unitOf(key);
  const plain = (v: number | null) => (v === null ? fmtNum(v, dp) : `${fmtNum(v, Math.max(dp, d.dp))}${u}`);
  return [plain(a), plain(b)];
}
