/**
 * Dot-and-interval small multiples (DESIGN.md 8): one figure, one row per configuration
 * (or variant / segment / buffer size), one facet per metric, each facet with its own x
 * scale. Dot = mean, 1.5px bar = 95% CI. Baseline and Proposed are filled dots in their
 * tokens; every other configuration is a hollow ring in --color-ctrl-other; oracles add a
 * dashed 1px interval. Vertical gridlines only, x ticks at the bottom, the facet title
 * (with unit) once at the top-left. Rows are 32px; labels wrap to two lines at most.
 */
import { useMemo, useRef, useState, type ReactNode } from "react";
import { scaleLinear, type ScaleLinear } from "d3-scale";
import { ChartFrame, LinearAxis, Readout, TooltipBox, TICK, useResizeObserver, type ReadoutRow } from "../../components";
import { useStore } from "../../state";
import { ctrlRole, configLabel, isOracle, fmtCI, fmtMeanPm, fmtNum, type MetricCI } from "../../data/loader";
import { def, type MetricDef } from "./data";
import { rootPx, textWidth, wrap } from "./measure";

export type MarkRole = "baseline" | "proposed" | "other" | "oracle";

export interface DotMark {
  /** Configuration (drives colour and mark shape). */
  config: string;
  m: MetricCI;
  /** Name in tooltips and tables when it differs from the config ("Video-first"). */
  name?: string;
}

export interface DotRow {
  key: string;
  label: string;
  /** Optional second line in 12/text-3 (e.g. what an ablation switches off). */
  sub?: string;
  /** Configuration whose text colour the label takes (Baseline / Proposed rows). */
  config?: string;
}

export interface DotFacet {
  key: string;
  title: string;
  dp: number;
  /** Prose formatter for tooltips (with unit). */
  fmt: (v: number | null) => string;
  /** Value label next to the dot. */
  label: (v: number | null) => string;
  domain?: [number, number];
  /** Span every facet column (the headline facet). */
  full?: boolean;
  /** Start a new facet row here, so facets of one metric never share a row with another's when columns wrap. */
  newRow?: boolean;
  /** Reference line (DESIGN.md 8). kind "limit" draws the usability limit in status-bad. */
  ref?: { value: number; label: string; kind?: "reference" | "limit" };
  tickFormat?: (v: number) => string;
}

/** Facet from a metric definition. */
export function facet(key: string, extra: Partial<DotFacet> = {}): DotFacet {
  const d: MetricDef = def(key);
  return { key, title: d.title, dp: d.dp, fmt: d.fmt, label: d.label, ...extra };
}

export function roleOf(config: string): MarkRole {
  if (isOracle(config)) return "oracle";
  const r = ctrlRole(config);
  return r === "other" ? "other" : r;
}

export interface DotFacetsProps {
  title: string;
  ariaLabel: string;
  legend?: ReactNode;
  caption?: ReactNode;
  actions?: ReactNode;
  rows: DotRow[];
  facets: DotFacet[];
  marks: (row: DotRow, facet: DotFacet) => DotMark[];
  /** Most facet columns to use when there is room (default 1). */
  cols?: number;
  /** Narrowest facet before fewer columns are used, px (default 180). */
  minFacet?: number;
  /** Row label column, px (default 168, the shared gutter). */
  labelWidth?: number;
  /** Extra column between labels and facets (e.g. ribbon miniatures). Hidden on narrow. */
  extra?: { width: number; render: (row: DotRow, x: number, cy: number) => ReactNode };
  /** Header of the first table column ("Configuration"). */
  rowHeader?: string;
  /** Header of the mark column in the table when rows hold several marks. */
  markHeader?: string;
  /** Lowest n across the chart (warn badge below 5). */
  n?: number | null;
}

/** Gap between facet columns: wide enough that one facet's last tick never reads as the next facet's first. */
const GAP_X = 56;
/** Narrowest gap, used to decide how many facet columns fit. */
const MIN_GAP_X = 40;
/** Right inset of each facet's scale, so the last tick label stays inside the facet. */
const INSET = 14;
const GAP_Y = 22;
const AXIS_H = 26;
const MIN_FACET_W = 180;

interface Hover { facet: string; row: string; x: number; y: number }

export function DotFacets(p: DotFacetsProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const { width } = useResizeObserver(wrapRef);
  const presenter = useStore((s) => s.presenter);
  const [hover, setHover] = useState<Hover | null>(null);

  const L = useMemo(() => layout(p, width), [p.rows, p.facets, p.cols, p.minFacet, p.labelWidth, p.extra, width, presenter]); // eslint-disable-line
  const k = presenter ? 1.2 : 1;

  const hoverRow = hover ? p.rows.find((r) => r.key === hover.row) : null;
  const hoverFacet = hover ? p.facets.find((f) => f.key === hover.facet) : null;
  const tipRows: ReadoutRow[] = [];
  if (hoverRow && hoverFacet) {
    const ms = p.marks(hoverRow, hoverFacet);
    for (const mk of ms) {
      const name = ms.length > 1 ? (mk.name ?? mk.config) : "Mean";
      tipRows.push([name, hoverFacet.fmt(mk.m.mean)]);
      tipRows.push([ms.length > 1 ? "95% CI" : "95% CI", fmtCI(mk.m.lo, mk.m.hi, hoverFacet.dp)]);
    }
    const ns = Array.from(new Set(ms.map((mk) => mk.m.n)));
    tipRows.push(["Seeds", ns.map((x) => x ?? "–").join(", ")]);
  }

  const table = useMemo(() => buildTable(p), [p.rows, p.facets, p.marks]); // eslint-disable-line

  return (
    <div ref={wrapRef}>
      <ChartFrame
        title={p.title}
        ariaLabel={p.ariaLabel}
        legend={p.legend}
        actions={p.actions}
        caption={p.caption}
        n={p.n}
        height={L.height}
        margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
        data={table}
      >
        {() => (
          <g style={{ fontFamily: "var(--font-ui)" }} onPointerLeave={() => setHover(null)}>
            {L.bands.map((band, bi) => (
              <g key={bi} transform={`translate(0,${band.y})`}>
                {/* row labels, once per facet row */}
                {p.rows.map((row, ri) => {
                  const cy = band.plotY + ri * L.rowH + L.rowH / 2;
                  const lab = L.labels[ri];
                  const total = lab.lines.length + (lab.sub ? 1 : 0);
                  const top = cy - ((total - 1) * L.lh) / 2;
                  const color = row.config && ctrlRole(row.config) !== "other"
                    ? (ctrlRole(row.config) === "proposed" ? "var(--color-ctrl-proposed-text)" : "var(--color-ctrl-baseline-text)")
                    : "var(--color-text-1)";
                  return (
                    <g key={row.key}>
                      <text x={L.pad} y={top + 4.5} style={{ fontSize: "var(--fs-13)", fontWeight: 500, fill: color }}>
                        {lab.truncated && <title>{row.label}</title>}
                        {lab.lines.map((ln, i) => <tspan key={i} x={L.pad} dy={i === 0 ? 0 : L.lh}>{ln}</tspan>)}
                        {lab.sub && <tspan x={L.pad} dy={L.lh} style={{ fontSize: "var(--fs-12)", fontWeight: 400, fill: "var(--color-text-3)" }}>{lab.sub}</tspan>}
                      </text>
                      {p.extra && L.extraW > 0 && p.extra.render(row, L.labelW, cy)}
                    </g>
                  );
                })}
                {band.facets.map((f) => (
                  <FacetPlot key={f.facet.key} f={f} band={band} rows={p.rows} rowH={L.rowH} marks={p.marks} k={k}
                    hover={hover} setHover={setHover} />
                ))}
              </g>
            ))}
          </g>
        )}
      </ChartFrame>
      {hover && hoverRow && hoverFacet && (
        <TooltipBox x={hover.x} y={hover.y} open>
          <Readout title={<>{hoverRow.label}<br /><span style={{ fontWeight: 400, color: "var(--color-text-2)" }}>{hoverFacet.title}</span></>} rows={tipRows} />
        </TooltipBox>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ one facet

interface PlacedFacet { facet: DotFacet; x: number; w: number; scale: ScaleLinear<number, number>; titleLines: string[] }
interface Band { y: number; titleH: number; refPad: number; plotY: number; plotH: number; height: number; facets: PlacedFacet[] }

function FacetPlot({ f, band, rows, rowH, marks, k, hover, setHover }: {
  f: PlacedFacet; band: Band; rows: DotRow[]; rowH: number; marks: DotFacetsProps["marks"]; k: number;
  hover: Hover | null; setHover: (h: Hover | null) => void;
}) {
  const x = f.scale;
  const fs12 = rootPx() * 0.8;
  const ticks = fitTicks(x, f.w, fs12, f.facet.tickFormat);
  // Rows with several marks (variants, segments) compare within the row; single-mark rows compare across rows.
  const groups = rows.map((r) => marks(r, f.facet).map((mk) => mk.m.mean));
  const labelOf = distinctLabels(f.facet, groups.some((g) => g.length > 1) ? groups : [groups.flat()]);
  return (
    <g transform={`translate(${f.x},0)`}>
      <text y={0} style={{ fontSize: "var(--fs-13)", fill: "var(--color-text-2)" }}>
        {f.titleLines.map((ln, i) => <tspan key={i} x={0} dy={i === 0 ? 13 : 16}>{ln}</tspan>)}
      </text>
      <g transform={`translate(0,${band.plotY})`}>
        <LinearAxis scale={x} innerHeight={band.plotH} ticks={ticks} format={f.facet.tickFormat} />
        {f.facet.ref && (() => {
          const rx = x(f.facet.ref.value);
          const c = f.facet.ref.kind === "limit" ? "var(--color-status-bad)" : "var(--color-text-2)";
          const lw = textWidth(f.facet.ref.label, fs12);
          const anchorEnd = rx + 4 + lw > f.w;
          return (
            <g pointerEvents="none">
              <line x1={rx} x2={rx} y1={-band.refPad + 2} y2={band.plotH} style={{ stroke: c }} strokeWidth={1} strokeDasharray="4 3" />
              <text x={anchorEnd ? rx - 4 : rx + 4} y={-band.refPad + 11} textAnchor={anchorEnd ? "end" : "start"}
                style={{ fontSize: "var(--fs-12)", fill: c }}>{f.facet.ref.label}</text>
            </g>
          );
        })()}
        {rows.map((row, ri) => {
          const ms = marks(row, f.facet);
          const cy = ri * rowH + rowH / 2;
          const offs = ms.length === 1 ? [0] : ms.length === 2 ? [-7, 7] : ms.map((_, i) => (i - (ms.length - 1) / 2) * 9);
          const on = hover?.facet === f.facet.key && hover.row === row.key;
          return (
            <g key={row.key}>
              {on && <rect x={-4} y={ri * rowH} width={f.w + 8} height={rowH} style={{ fill: "var(--color-hover-overlay)" }} />}
              {ms.map((mk, i) => <Mark key={mk.config + i} mk={mk} cy={cy + offs[i]} x={x} w={f.w} label={labelOf(mk.m.mean)} k={k} fs12={fs12} />)}
              <rect x={-4} y={ri * rowH} width={f.w + 8} height={rowH} fill="transparent"
                onPointerMove={(e) => setHover({ facet: f.facet.key, row: row.key, x: e.clientX, y: e.clientY })} />
            </g>
          );
        })}
      </g>
    </g>
  );
}

function Mark({ mk, cy, x, w, label, k, fs12 }: { mk: DotMark; cy: number; x: ScaleLinear<number, number>; w: number; label: string; k: number; fs12: number }) {
  const { mean, lo, hi } = mk.m;
  if (mean === null) {
    return <text x={0} y={cy + 4} style={{ ...TICK }}>No data</text>;
  }
  const role = roleOf(mk.config);
  const line = role === "proposed" ? "var(--color-ctrl-proposed)" : role === "baseline" ? "var(--color-ctrl-baseline-edge)" : "var(--color-ctrl-other)";
  const xm = x(mean);
  const x0 = lo !== null ? x(lo) : xm;
  const x1 = hi !== null ? x(hi) : xm;
  const oracle = role === "oracle";
  const lw = textWidth(label, fs12);
  // 6px slack: canvas text metrics can run narrower than the rendered tabular figures.
  const right = x1 + 7 * k + lw + 6 <= w || x0 - 7 * k - lw - 6 < 0;
  const lx = right ? x1 + 7 * k : x0 - 7 * k;
  return (
    <g pointerEvents="none">
      <line x1={x0} x2={x1} y1={cy} y2={cy} style={{ stroke: line, strokeWidth: oracle ? "var(--stroke-hair)" : "var(--stroke-data)" }} strokeDasharray={oracle ? "3 2" : undefined} />
      {role === "proposed" || role === "baseline" ? (
        <circle cx={xm} cy={cy} r={3 * k}
          style={{
            fill: role === "proposed" ? "var(--color-ctrl-proposed)" : "var(--color-ctrl-baseline)",
            stroke: role === "baseline" ? "var(--color-ctrl-baseline-edge)" : "var(--color-surface-2)",
            strokeWidth: 1,
          }} />
      ) : (
        <circle cx={xm} cy={cy} r={3.25 * k} style={{ fill: "var(--color-surface-2)", stroke: "var(--color-ctrl-other)", strokeWidth: "var(--stroke-data)" }} />
      )}
      <text x={lx} y={cy + 4} textAnchor={right ? "start" : "end"} style={HALO}>{label}</text>
    </g>
  );
}

/**
 * Value labels with enough decimals that two different means in one facet never print the
 * same (DESIGN.md 13: do not round in a way that hides a comparison). Up to 2 extra places.
 */
function distinctLabels(f: DotFacet, groups: (number | null)[][]): (v: number | null) => string {
  const sets = groups.map((g) => Array.from(new Set(g.filter((v): v is number => v !== null))));
  const clash = (fmt: (v: number) => string) => sets.some((vals) => {
    const seen = new Map<string, number>();
    return vals.some((v) => { const k = fmt(v); const o = seen.get(k); seen.set(k, v); return o !== undefined && o !== v; });
  });
  if (!clash((v) => f.label(v))) return f.label;
  for (let extra = 1; extra <= 2; extra++) {
    const dp = f.dp + extra;
    if (!clash((v) => fmtNum(v, dp)) || extra === 2) return (v) => fmtNum(v, dp);
  }
  return f.label;
}

/** Value label: 12/text-2 with a surface-2 halo so gridlines and reference lines never cross the digits. */
const HALO = {
  fontSize: "var(--fs-12)", fill: "var(--color-text-2)",
  stroke: "var(--color-surface-2)", strokeWidth: 3, strokeLinejoin: "round" as const, paintOrder: "stroke" as const,
};

// ------------------------------------------------------------------ layout

function layout(p: DotFacetsProps, width: number) {
  const R = rootPx();
  const fs13 = R * 0.8667;
  const fs12 = R * 0.8;
  const lh = Math.round(fs13 * 1.2);
  const narrow = width < 600;
  const pad = 0;
  const labelW = narrow ? Math.min(p.labelWidth ?? 168, 116) : (p.labelWidth ?? 168);
  const extraW = p.extra && !narrow ? p.extra.width : 0;
  const avail = Math.max(120, width - labelW - extraW);
  const maxCols = p.cols ?? 1;
  const minW = p.minFacet ?? MIN_FACET_W;
  const cols = Math.max(1, Math.min(maxCols, Math.floor((avail + MIN_GAP_X) / (minW + MIN_GAP_X))));
  // Widen the gap towards GAP_X only while every facet keeps its minimum width.
  const gapX = cols > 1 ? Math.max(MIN_GAP_X, Math.min(GAP_X, (avail - cols * minW) / (cols - 1))) : 0;
  const fw = (avail - (cols - 1) * gapX) / cols;

  const labels = p.rows.map((r) => {
    const w = wrap(r.label, labelW - 12, fs13, 500, 2);
    const sub = r.sub ? wrap(r.sub, labelW - 12, fs12, 400, 1).lines[0] : undefined;
    return { ...w, sub };
  });
  const maxLines = Math.max(1, ...labels.map((l) => l.lines.length + (l.sub ? 1 : 0)));
  const multi = p.rows.length > 0 && p.facets.length > 0 && p.marks(p.rows[0], p.facets[0]).length > 1;
  const rowH = Math.max(multi ? 38 : 32, maxLines * lh + 10);

  // group facets into facet rows
  const groups: DotFacet[][] = [];
  let cur: DotFacet[] = [];
  for (const f of p.facets) {
    if (f.full) { if (cur.length) groups.push(cur); groups.push([f]); cur = []; continue; }
    if (f.newRow && cur.length) { groups.push(cur); cur = []; }
    cur.push(f);
    if (cur.length === cols) { groups.push(cur); cur = []; }
  }
  if (cur.length) groups.push(cur);

  const bands: Band[] = [];
  let y = 0;
  for (const g of groups) {
    const full = g.length === 1 && g[0].full;
    const placed: PlacedFacet[] = g.map((f, i) => {
      const w = full ? avail : fw;
      const xPos = labelW + extraW + (full ? 0 : i * (fw + gapX));
      const titleLines = wrap(f.title, w - 4, fs13, 400, 3).lines;
      return { facet: f, x: xPos, w, titleLines, scale: scaleFor(p, f, w) };
    });
    const titleLines = Math.max(...placed.map((f) => f.titleLines.length));
    const titleH = 6 + titleLines * 16;
    const refPad = g.some((f) => f.ref) ? 18 : 6;
    const plotH = p.rows.length * rowH;
    const plotY = titleH + refPad;
    const height = plotY + plotH + AXIS_H;
    bands.push({ y, titleH, refPad, plotY, plotH, height, facets: placed });
    y += height + GAP_Y;
  }
  const height = Math.max(40, y - GAP_Y + 4);
  return { bands, rowH, lh, labels, extraW, labelW, height, pad };
}

/**
 * Tick count for a facet: the most ticks (6 at most, 56 px apart at least) whose labels
 * keep a clear gap between neighbours ("1,326 1,328 ..." on a narrow facet drops to fewer ticks).
 */
function fitTicks(x: ScaleLinear<number, number>, w: number, fs12: number, format?: (v: number) => string): number {
  const start = Math.max(3, Math.min(6, Math.floor(w / 56)));
  for (let n = start; n >= 2; n--) {
    const vals = x.ticks(n);
    const fmt = format ?? x.tickFormat(n);
    let ok = true;
    for (let i = 1; i < vals.length && ok; i++) {
      const half = (textWidth(fmt(vals[i - 1]), fs12) + textWidth(fmt(vals[i]), fs12)) / 2;
      if (x(vals[i]) - x(vals[i - 1]) < half + 14) ok = false;
    }
    if (ok) return n;
  }
  return 2;
}

function scaleFor(p: DotFacetsProps, f: DotFacet, w: number): ScaleLinear<number, number> {
  const ticks = Math.max(3, Math.min(6, Math.floor(w / 56)));
  if (f.domain) return scaleLinear().domain(f.domain).range([0, w - INSET]);
  const vals: number[] = [];
  for (const r of p.rows) {
    for (const mk of p.marks(r, f)) {
      for (const v of [mk.m.lo, mk.m.hi, mk.m.mean]) if (v !== null && Number.isFinite(v)) vals.push(v);
    }
  }
  if (f.ref) vals.push(f.ref.value);
  if (vals.length === 0) return scaleLinear().domain([0, 1]).range([0, w - INSET]);
  const min = Math.min(...vals), max = Math.max(...vals);
  let lo = min, hi = max;
  const span = hi - lo || Math.abs(hi) * 0.1 || 1;
  lo -= span * 0.1;
  hi += span * 0.1;
  // Never pad past a natural bound: counts, times and sizes stay >= 0, percentages <= 100.
  if (min >= 0) lo = Math.max(0, lo);
  const pct = /\(%\)\s*$/.test(f.title);
  if (pct && max <= 100) hi = Math.min(100, hi);
  const sc = scaleLinear().domain([lo, hi]).nice(ticks);
  const [a, b] = sc.domain();
  return sc.domain([min >= 0 ? Math.max(0, a) : a, pct && max <= 100 ? Math.min(100, b) : b]).range([0, w - INSET]);
}

// ------------------------------------------------------------------ table ("Show data")

function buildTable(p: DotFacetsProps) {
  const multi = p.rows.some((r) => p.facets.some((f) => p.marks(r, f).length > 1));
  const columns = [p.rowHeader ?? "Configuration", ...(multi ? [p.markHeader ?? "Configuration"] : []), ...p.facets.map((f) => f.title), "n"];
  const rows: ReactNode[][] = [];
  for (const r of p.rows) {
    const first = p.marks(r, p.facets[0]);
    first.forEach((mk, i) => {
      const cells: ReactNode[] = [r.label];
      if (multi) cells.push(mk.name ?? configLabel(mk.config));
      for (const f of p.facets) {
        const m = p.marks(r, f)[i]?.m;
        cells.push(m ? fmtMeanPm(m.mean, m.ci, f.dp) : "–");
      }
      cells.push(mk.m.n ?? "–");
      rows.push(cells);
    });
  }
  const offset = multi ? 2 : 1;
  return { columns, rows, numeric: [...p.facets.map((_, i) => i + offset), p.facets.length + offset] };
}
