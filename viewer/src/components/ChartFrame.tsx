import { forwardRef, useId, useRef, useState, type ReactNode } from "react";
import { useResizeObserver } from "./useResizeObserver";
import { Badge } from "./Badge";
import { Button } from "./Button";
import s from "./ChartFrame.module.css";

export interface Margin { top: number; right: number; bottom: number; left: number }

export interface PlotSize {
  /** Full SVG size, px. */
  width: number;
  height: number;
  /** Plot area inside the margins, px. */
  innerWidth: number;
  innerHeight: number;
  margin: Margin;
}

/** The table a chart is drawn from ("Show data"); always in the DOM for screen readers. */
export interface ChartData {
  columns: string[];
  rows: ReactNode[][];
  /** Column indices that are numeric (right-aligned). */
  numeric?: number[];
}

export interface ChartFrameProps {
  /** Plain sentence of what is measured with its unit: "Usable view by configuration (%)". */
  title: ReactNode;
  /** Summary of the finding for role="img" aria-label. */
  ariaLabel: string;
  /** Legend row (usually <Legend/>), shown above the plot. */
  legend?: ReactNode;
  /** Right-aligned actions next to the title. */
  actions?: ReactNode;
  /** Plot height in px (full SVG height, including margins). Default 240. */
  height?: number;
  /** Plot margins (px). Default { top: 24, right: 16, bottom: 32, left: 168 } (left = timeline gutter). */
  margin?: Partial<Margin>;
  /** figcaption: n, CI method and source. */
  caption?: ReactNode;
  /** The data table behind the chart (enables the "Show data" toggle). */
  data?: ChartData;
  /** normal: draw children; loading/empty: show `message` in the plot area. */
  status?: "normal" | "loading" | "empty";
  message?: ReactNode;
  /** Seed count; below 5 a warn badge "n = 3: intervals are rough" sits beside the title. */
  n?: number | null;
  /**
   * Draw the plot. Called with measured sizes; render SVG elements in plot coordinates
   * (the frame translates by margin.left/top). Return null until width > 0 if needed.
   */
  children: (size: PlotSize) => ReactNode;
  /** Extra SVG rendered outside the margin transform (e.g. row labels in the left margin). */
  className?: string;
}

const DEFAULT_MARGIN: Margin = { top: 24, right: 16, bottom: 32, left: 168 };

/**
 * <figure> with title (display 18/600), legend, a responsive SVG on surface-2, a
 * figcaption, and a "Show data" toggle revealing the <table> (DESIGN.md 7 "Chart frame").
 */
export const ChartFrame = forwardRef<HTMLElement, ChartFrameProps>(function ChartFrame(
  { title, ariaLabel, legend, actions, height = 240, margin, caption, data, status = "normal", message, n, children, className }, ref,
) {
  const plotRef = useRef<HTMLDivElement>(null);
  const { width } = useResizeObserver(plotRef);
  const [showData, setShowData] = useState(false);
  const tableId = useId();
  const m: Margin = { ...DEFAULT_MARGIN, ...margin };
  const size: PlotSize = {
    width, height, margin: m,
    innerWidth: Math.max(0, width - m.left - m.right),
    innerHeight: Math.max(0, height - m.top - m.bottom),
  };
  const lowN = typeof n === "number" && n < 5;

  return (
    <figure ref={ref} className={[s.frame, className].filter(Boolean).join(" ")}>
      <div className={s.head}>
        <h3 className={s.title}>{title}</h3>
        {lowN && <Badge kind="status-warn">n = {n}: intervals are rough</Badge>}
        {actions && <div className={s.actions}>{actions}</div>}
      </div>
      {legend && <div className={s.legend}>{legend}</div>}
      <div ref={plotRef} className={s.plot} style={{ height }}>
        {status === "normal" && width > 0 && (
          <svg width={width} height={height} role="img" aria-label={ariaLabel} className={s.svg}>
            <g transform={`translate(${m.left},${m.top})`}>{children(size)}</g>
          </svg>
        )}
        {status !== "normal" && <p className={s.message}>{message ?? (status === "loading" ? "Loading" : "No data")}</p>}
      </div>
      {(caption || data) && (
        <figcaption className={s.caption}>
          {data && (
            <Button variant="quiet" aria-expanded={showData} aria-controls={tableId} onClick={() => setShowData((v) => !v)}>
              {showData ? "Hide data" : "Show data"}
            </Button>
          )}
          {caption && <span>{caption}</span>}
        </figcaption>
      )}
      {data && (
        <div id={tableId} className={showData ? s.tableWrap : "sr-only"}>
          <table className={s.table}>
            <thead>
              <tr>{data.columns.map((c, j) => <th key={j} className={data.numeric?.includes(j) ? "num" : undefined} scope="col">{c}</th>)}</tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={i}>{r.map((v, j) => <td key={j} className={data.numeric?.includes(j) ? "num" : undefined}>{v}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  );
});
