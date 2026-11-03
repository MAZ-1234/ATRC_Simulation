/**
 * SVG axis helpers (DESIGN.md 8). Render inside a <g> in plot coordinates (e.g. the
 * ChartFrame children). x axis at the bottom, tick labels 12/text-3, vertical gridlines
 * only (1px --color-grid), axis title once at the top-left in 13/text-2 with its unit.
 */
import type { ScaleLinear } from "d3-scale";
import type { CSSProperties } from "react";
import { fmtClock, fmtClockShort } from "../format";

/** Tick label style: 12 / text-3. SVG presentation attributes cannot take var(), so use style. */
export const TICK: CSSProperties = { fontSize: "var(--fs-12)", fill: "var(--color-text-3)" };

export interface LinearAxisProps {
  scale: ScaleLinear<number, number>;
  /** Plot height: gridlines run from 0 to here; the axis sits at y = innerHeight. */
  innerHeight: number;
  /** Approximate tick count (5-7 round values, default 6). */
  ticks?: number;
  /** Exact tick values (overrides `ticks`). */
  tickValues?: number[];
  /** Tick label formatter (default: d3 tickFormat of the scale). */
  format?: (v: number) => string;
  /** Axis title with unit, drawn once at the top-left: "Usable view (%)". */
  title?: string;
  /** Draw vertical gridlines (default true). */
  grid?: boolean;
  /** Put labels on top instead of bottom. */
  top?: boolean;
}

export function LinearAxis({ scale, innerHeight, ticks = 6, tickValues, format, title, grid = true, top }: LinearAxisProps) {
  const values = tickValues ?? scale.ticks(ticks);
  const fmt = format ?? scale.tickFormat(ticks);
  const y = top ? 0 : innerHeight;
  return (
    <g className="axis" style={{ fontFamily: "var(--font-ui)" }}>
      {title && (
        <text x={0} y={-10} style={{ fontSize: "var(--fs-13)", fill: "var(--color-text-2)" }}>{title}</text>
      )}
      {values.map((v) => {
        const x = scale(v);
        return (
          <g key={v} transform={`translate(${x},0)`}>
            {grid && <line y1={0} y2={innerHeight} style={{ stroke: "var(--color-grid)", strokeWidth: "var(--stroke-hair)" }} />}
            <text y={top ? y - 6 : y + 16} textAnchor="middle" style={TICK}>{fmt(v)}</text>
          </g>
        );
      })}
    </g>
  );
}

export interface TimeAxisProps {
  /** Mission time (s) -> x px. */
  scale: ScaleLinear<number, number>;
  /** Height of the tracks above the axis (gridlines run 0..innerHeight). */
  innerHeight: number;
  /** Label spacing, s (default 120: "0:00, 2:00 ... 22:00"). */
  every?: number;
  /** Cursor time: drawn as a text-1 chip on the axis with the mission clock. */
  cursorT?: number | null;
  grid?: boolean;
}

/** Replay time axis: labels every 2 min plus the cursor chip (DESIGN.md 8). */
export function TimeAxis({ scale, innerHeight, every = 120, cursorT, grid = false }: TimeAxisProps) {
  const [d0, d1] = scale.domain();
  const ticks: number[] = [];
  for (let t = Math.ceil(d0 / every) * every; t <= d1 + 1e-6; t += every) ticks.push(t);
  const cx = cursorT !== null && cursorT !== undefined ? scale(cursorT) : null;
  const chipW = 52;
  return (
    <g className="time-axis" style={{ fontFamily: "var(--font-ui)" }}>
      {ticks.map((t) => (
        <g key={t} transform={`translate(${scale(t)},0)`}>
          {grid && <line y1={0} y2={innerHeight} style={{ stroke: "var(--color-grid)", strokeWidth: "var(--stroke-hair)" }} />}
          <line y1={innerHeight} y2={innerHeight + 4} style={{ stroke: "var(--color-border-strong)", strokeWidth: "var(--stroke-hair)" }} />
          <text y={innerHeight + 16} textAnchor="middle" style={TICK}>{fmtClockShort(t)}</text>
        </g>
      ))}
      {cx !== null && (
        <g transform={`translate(${cx},${innerHeight + 2})`}>
          <rect x={-chipW / 2} y={0} width={chipW} height={18} rx={2} style={{ fill: "var(--color-text-1)" }} />
          <text y={13} textAnchor="middle" style={{ fontSize: "var(--fs-12)", fontWeight: 500, fill: "var(--color-surface-1)" }}>{fmtClock(cursorT!)}</text>
        </g>
      )}
    </g>
  );
}

export interface CursorLineProps {
  x: number;
  height: number;
}
/** The shared cursor: 2px --color-cursor vertical line (DESIGN.md 4 stroke-bold). */
export function CursorLine({ x, height }: CursorLineProps) {
  return <line x1={x} x2={x} y1={0} y2={height} style={{ stroke: "var(--color-cursor)", strokeWidth: "var(--stroke-bold)" }} pointerEvents="none" />;
}

export interface ReferenceLineProps {
  /** x position in px. */
  x: number;
  innerHeight: number;
  label: string;
  /** "limit" draws the usability limit in --color-status-bad (label should be "Usability limit"). */
  kind?: "reference" | "limit";
}
/** Dashed reference line with its label at the top-left end (DESIGN.md 8). */
export function ReferenceLine({ x, innerHeight, label, kind = "reference" }: ReferenceLineProps) {
  const c = kind === "limit" ? "var(--color-status-bad)" : "var(--color-text-2)";
  return (
    <g pointerEvents="none">
      <line x1={x} x2={x} y1={0} y2={innerHeight} style={{ stroke: c }} strokeWidth={1} strokeDasharray="4 3" />
      <text x={x + 4} y={10} style={{ fontSize: "var(--fs-12)", fill: c }}>{label}</text>
    </g>
  );
}
