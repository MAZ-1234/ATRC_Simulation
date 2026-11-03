/**
 * Data access for every view. Nothing is fetched: manifest/scenario/results are
 * classic <script> files loaded by index.html before the app, and each run file is
 * injected as a <script> on demand (works from file://). Types: ./types.ts.
 *
 *   getManifest() / getScenario() / getResults()   globals, or null when missing
 *   loadRun(id): Promise<RunData>                   cached; rejects with a fix-it message
 *   sampleIndexAt(run, t) / decisionIndexAt(run, t) binary search on the time columns
 *   dec(run, "mode", code) / linksOf(run, code) ... enum decoders
 *
 * Formatters live in ../format.ts and names in ./labels.ts; both are re-exported here.
 */
import type {
  LadderLevel, LinkName, Manifest, ManifestRun, RunData, RunEnums, Results, Scenario,
  StepSeries, Table, Cell,
} from "./types";

export * from "../format";
export * from "./labels";

// ------------------------------------------------------------------ regenerate hint

/** Exact command that (re)generates viewer/public/data. Run from edge_mlc/. */
export const REGEN_COMMAND = "../.venv/Scripts/python sim/export_viewer.py";
/** Where to run REGEN_COMMAND from. */
export const REGEN_CWD = "edge_mlc/";

// ------------------------------------------------------------------ globals

export function getManifest(): Manifest | null { return window.SIM_MANIFEST ?? null; }
export function getScenario(): Scenario | null { return window.SIM_SCENARIO ?? null; }
export function getResults(): Results | null { return window.SIM_RESULTS ?? null; }

export interface DataStatus {
  manifest: boolean;
  scenario: boolean;
  results: boolean;
  /** Names of the missing files, e.g. ["data/manifest.js"]. */
  missing: string[];
}
/** Which of the three start-up files loaded. The shell shows an error screen if any is missing. */
export function dataStatus(): DataStatus {
  const s = { manifest: !!window.SIM_MANIFEST, scenario: !!window.SIM_SCENARIO, results: !!window.SIM_RESULTS };
  const missing: string[] = [];
  if (!s.manifest) missing.push("data/manifest.js");
  if (!s.scenario) missing.push("data/scenario.js");
  if (!s.results) missing.push("data/results.js");
  return { ...s, missing };
}

// ------------------------------------------------------------------ manifest lookups

/** Manifest entry for a run id. */
export function manifestRun(id: string | null | undefined): ManifestRun | null {
  if (!id) return null;
  return getManifest()?.runs.find((r) => r.id === id) ?? null;
}

/** Run id for a config + variant + seed, or null when it was not exported. */
export function runIdFor(config: string, variant: string, seed: number): string | null {
  const r = getManifest()?.runs.find((x) => x.config === config && x.variant === variant && x.seed === seed);
  return r?.id ?? null;
}

/** Configs exported for a variant + seed, in manifest CONFIGS order. */
export function configsFor(variant: string, seed: number): string[] {
  const m = getManifest();
  if (!m) return [];
  const have = new Set(m.runs.filter((r) => r.variant === variant && r.seed === seed).map((r) => r.config));
  return m.configs.filter((c) => have.has(c));
}

/** Seeds exported for a variant (ascending). */
export function seedsFor(variant: string): number[] {
  const m = getManifest();
  if (!m) return [];
  return Array.from(new Set(m.runs.filter((r) => r.variant === variant).map((r) => r.seed))).sort((a, b) => a - b);
}

// ------------------------------------------------------------------ run loading

const runPromises = new Map<string, Promise<RunData>>();

/** The run if it is already loaded (synchronous), else undefined. */
export function peekRun(id: string | null | undefined): RunData | undefined {
  if (!id) return undefined;
  return window.SIM_RUNS?.[id];
}

/** Error thrown by loadRun; `hint` is a sentence telling the user how to fix it. */
export class RunLoadError extends Error {
  readonly hint: string;
  readonly runId: string;
  constructor(runId: string, message: string, hint: string) {
    super(message);
    this.name = "RunLoadError";
    this.runId = runId;
    this.hint = hint;
  }
}

/**
 * Load one run file by injecting `<script src="data/runs/<id>.js">`. Concurrent and
 * repeated calls share one promise. A failed load is not cached, so calling again retries.
 */
export function loadRun(id: string): Promise<RunData> {
  const ready = peekRun(id);
  if (ready) return Promise.resolve(ready);
  const pending = runPromises.get(id);
  if (pending) return pending;

  const entry = manifestRun(id);
  const src = entry?.file ?? `data/runs/${id}.js`;
  const p = new Promise<RunData>((resolve, reject) => {
    if (!entry) {
      reject(new RunLoadError(id, `Run ${id} is not in data/manifest.js.`,
        `Export it with ${REGEN_COMMAND} (from ${REGEN_CWD}), then reload.`));
      return;
    }
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.dataset.run = id;
    el.onload = () => {
      const run = peekRun(id);
      if (run) resolve(run);
      else reject(new RunLoadError(id, `${src} loaded but did not define run ${id}.`,
        `Re-export the data with ${REGEN_COMMAND} (from ${REGEN_CWD}), then reload.`));
    };
    el.onerror = () => {
      el.remove();
      reject(new RunLoadError(id, `Could not load ${src}.`,
        `The file is missing. Export it with ${REGEN_COMMAND} (from ${REGEN_CWD}), then reload.`));
    };
    document.head.appendChild(el);
  });
  runPromises.set(id, p);
  p.catch(() => runPromises.delete(id));
  return p;
}

// ------------------------------------------------------------------ time indexing

/** Index of the last element <= x in an ascending array; -1 if x is before the first. */
export function bisectRight(arr: ArrayLike<number>, x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/** Sample (0.1 s grid, from t = 0.15) in effect at time t, clamped to [0, n_samples - 1]. */
export function sampleIndexAt(run: RunData, t: number): number {
  const i = bisectRight(run.samples.t, t + 1e-6);
  return Math.min(Math.max(i, 0), run.meta.n_samples - 1);
}

/** Decision (10 Hz, from t = 0.1) in effect at time t, clamped to [0, n_decisions - 1]. */
export function decisionIndexAt(run: RunData, t: number): number {
  const i = bisectRight(run.decisions.cols.t, t + 1e-6);
  return Math.min(Math.max(i, 0), run.meta.n_decisions - 1);
}

/** Value of a step series (decisions.ttu) at a decision index; null = no predicted failure. */
export function stepValueAt(s: StepSeries | undefined, decisionIndex: number): number | null {
  if (!s || s.i.length === 0) return null;
  const k = bisectRight(s.i, decisionIndex);
  return k < 0 ? null : s.v[k];
}

/** Predicted seconds until `link` is unusable for `stream` at time t (Proposed only). */
export function ttuAt(run: RunData, link: LinkName, stream: "cmd" | "front" | "rear", t: number): number | null {
  return stepValueAt(run.decisions.ttu[`${link}:${stream}`], decisionIndexAt(run, t));
}

/** Index of the last reason at or before t (-1 if none). reasons are [t, text]. */
export function reasonIndexAt(run: RunData, t: number): number {
  let lo = 0;
  let hi = run.reasons.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (run.reasons[mid][0] <= t + 1e-6) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/** Mission length of a run, s. */
export function runDuration(run: RunData): number {
  return run.meta.mission_time_s;
}

// ------------------------------------------------------------------ enum decoders

/** Decode a per-run enum code; null for -1 / out of range. dec(run, "man", 0) -> "DRIVE". */
export function dec<K extends Exclude<keyof RunEnums, "linkset">>(
  run: RunData, name: K, code: number,
): RunEnums[K][number] | null {
  const table = run.enums[name] as RunEnums[K];
  return code >= 0 && code < table.length ? (table[code] as RunEnums[K][number]) : null;
}

/** Link name for a LinkIdx (-1 -> null). */
export function linkNameOf(run: RunData, idx: number): LinkName | null {
  return idx >= 0 && idx < run.meta.links.length ? run.meta.links[idx] : null;
}

/** Ordered link names of a linkset code (first = primary); [] for none. */
export function linksOf(run: RunData, linksetCode: number): LinkName[] {
  if (linksetCode < 0 || linksetCode >= run.enums.linkset.length) return [];
  return run.enums.linkset[linksetCode].map((i) => run.meta.links[i]);
}

/** Ladder rung for a level index (0..5). */
export function ladderOf(run: RunData, level: number): LadderLevel | undefined {
  return run.meta.ladder[level];
}

/** MB of upload `u` (index into run.uploads) delivered by time t (from upload_progress). */
export function uploadDeliveredAt(run: RunData, u: number, t: number): number {
  const up = run.uploads[u];
  if (!up) return 0;
  if (up.done_t !== null && t >= up.done_t) return up.size_mb;
  const p = run.upload_progress;
  let best = 0;
  // upload_progress is time-ordered; scan only up to t.
  const end = bisectRight(p.t, t + 1e-6);
  for (let k = end; k >= 0; k--) {
    if (p.u[k] === u) { best = p.mb[k]; break; }
  }
  return best;
}

// ------------------------------------------------------------------ results tables

/** Column index in a table (-1 if absent). */
export function colIndex(table: Table | null | undefined, column: string): number {
  return table ? table.columns.indexOf(column) : -1;
}

/** Rows of a table as objects keyed by column name. */
export function tableObjects(table: Table | null | undefined): Record<string, Cell>[] {
  if (!table) return [];
  return table.rows.map((row) => {
    const o: Record<string, Cell> = {};
    table.columns.forEach((c, j) => { o[c] = row[j]; });
    return o;
  });
}

/** Rows matching every key in `match` (e.g. {config: "Proposed", variant: "nominal"}). */
export function findRows(table: Table | null | undefined, match: Record<string, Cell>): Record<string, Cell>[] {
  return tableObjects(table).filter((r) => Object.entries(match).every(([k, v]) => r[k] === v));
}

/** Summary row (mean and `<m>_ci` columns) for a config + variant, or null. */
export function summaryRow(config: string, variant: string): Record<string, Cell> | null {
  return findRows(getResults()?.summary, { config, variant })[0] ?? null;
}

/** Mean, CI half-width and n of one metric from summary.csv. */
export interface MetricCI { mean: number | null; ci: number | null; lo: number | null; hi: number | null; n: number | null }
export function summaryMetric(config: string, variant: string, metric: string): MetricCI {
  const row = summaryRow(config, variant);
  const num = (v: Cell | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const mean = num(row?.[metric]);
  const ci = num(row?.[`${metric}_ci`]);
  return {
    mean, ci,
    lo: mean !== null && ci !== null ? mean - ci : null,
    hi: mean !== null && ci !== null ? mean + ci : null,
    n: num(row?.n),
  };
}

/** True when results came from the finished 20-seed run (results_run/). */
export function isFullResults(): boolean {
  return getResults()?.source_dir === "results_run";
}

// ------------------------------------------------------------------ demo seed

/**
 * Demo seed (DESIGN.md 1.1): the first exported seed whose crater result is closest to
 * the run mean, for Baseline and Proposed together. Never the best case. Uses the
 * per-run `useful_crater` from results.runs; falls back to the first exported seed.
 */
export function typicalSeed(variant: string): number | null {
  const seeds = seedsFor(variant);
  if (seeds.length === 0) return null;
  const demo = getManifest()?.demo;
  if (demo && demo.variant === variant && seeds.includes(demo.seed)) return demo.seed;
  const rows =tableObjects(getResults()?.runs).filter((r) => r.variant === variant);
  const score = new Map<number, number>();
  for (const config of ["Baseline", "Proposed"]) {
    const vals = rows.filter((r) => r.config === config && typeof r.useful_crater === "number");
    if (vals.length === 0) continue;
    const mean = vals.reduce((a, r) => a + (r.useful_crater as number), 0) / vals.length;
    for (const r of vals) {
      const s = r.seed as number;
      score.set(s, (score.get(s) ?? 0) + Math.abs((r.useful_crater as number) - mean));
    }
  }
  let best: number | null = null;
  let bestScore = Infinity;
  for (const s of seeds) {
    const v = score.get(s);
    if (v !== undefined && v < bestScore - 1e-9) { best = s; bestScore = v; }
  }
  return best ?? seeds[0];
}
