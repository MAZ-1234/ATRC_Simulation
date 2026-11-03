/**
 * Line with a 95% interval band (DESIGN.md 6.2, "Crater capacity: a line with an interval
 * band"). x is a log scale over the tested values; y starts at 0 (DESIGN.md 8, "Zero").
 * Lines are direct-labelled at their right end (<= 3 series, no separate legend).
 */
import { useMemo, useRef, useState, type ReactNode } from "react";
import { scaleLinear, scaleLog } from "d3-scale";
import { area as d3area, line as d3line } from "d3-shape";
import { ChartFrame, Readout, TooltipBox, TICK, useResizeObserver, type ReadoutRow } from "../../components";
import { useStore } from "../../state";
import { fmtCI, fmtMeanPm, type MetricCI } from "../../data/loader";
import { roleOf } from "./DotFacets";
import { rootPx, textWidth } from "./measure";

export interface Series { config: string; points: { x: number; m: MetricCI }[] }

export interface LineBandProps {
  title: string;
  ariaLabel: string;
  caption?: ReactNode;
  series: Series[];
  xValues: number[];
  xFmt: (v: number) => string;
  xHeader: string;
  yTitle: string;
  yDomain: [number, number];
  yDp: number;
  yFmt: (v: number | null) => string;
  refLine?: { x: number; label: string };
  n?: number | null;
}

const H = 300;

export function LineBand(p: LineBandProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const { width } = useResizeObserver(wrapRef);
  const presenter = useStore((s) => s.presenter);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const R = rootPx();
  const fs13 = R * 0.8667;
  const labelW = Math.max(...p.series.map((s) => textWidth(s.config, fs13, 500))) + 16;
  const narrow = width < 600;
  const margin = { top: 44, right: narrow ? 16 : Math.ceil(labelW), bottom: 34, left: 40 };
  const k = presenter ? 1.2 : 1;

  const table = useMemo(() => ({
    columns: ["Configuration", p.xHeader, `${p.yTitle}`, "n"],
    numeric: [2, 3],
    rows: p.series.flatMap((s) => s.points.map((pt) => [s.config, p.xFmt(pt.x), fmtMeanPm(pt.m.mean, pt.m.ci, p.yDp), pt.m.n ?? "–"] as ReactNode[])),
  }), [p.series]); // eslint-disable-line

  return (
    <div ref={wrapRef}>
      <ChartFrame title={p.title} ariaLabel={p.ariaLabel} caption={p.caption} n={p.n} height={H} margin={margin} data={table}
        legend={narrow ? <NarrowLegend series={p.series} /> : undefined}>
        {({ innerWidth, innerHeight }) => {
          const xs = scaleLog().domain([Math.min(...p.xValues), Math.max(...p.xValues)]).range([0, innerWidth]);
          const ys = scaleLinear().domain(p.yDomain).range([innerHeight, 0]);
          const yTicks = ys.ticks(5);
          // direct labels at the right end, pushed apart vertically
          const ends = p.series.map((s) => {
            const last = s.points[s.points.length - 1];
            return { config: s.config, y: last?.m.mean !== null && last ? ys(last.m.mean!) : 0 };
          }).sort((a, b) => a.y - b.y);
          for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 16) ends[i].y = ends[i - 1].y + 16;
          return (
            <g style={{ fontFamily: "var(--font-ui)" }} onPointerLeave={() => setHover(null)}>
              <text x={-margin.left} y={-26} style={{ fontSize: "var(--fs-13)", fill: "var(--color-text-2)" }}>{p.yTitle}</text>
              {/* DESIGN-GAP: DESIGN.md 8 says vertical gridlines only (written for dot plots). A line chart
                  needs horizontal ones to read y, so this chart draws horizontal 1px --color-grid lines. */}
              {yTicks.map((v) => (
                <g key={v} transform={`translate(0,${ys(v)})`}>
                  <line x1={0} x2={innerWidth} style={{ stroke: "var(--color-grid)", strokeWidth: "var(--stroke-hair)" }} />
                  <text x={-8} y={4} textAnchor="end" style={TICK}>{v}</text>
                </g>
              ))}
              {p.xValues.map((v) => (
                <text key={v} x={xs(v)} y={innerHeight + 18} textAnchor="middle" style={TICK}>{p.xFmt(v)}</text>
              ))}
              {p.refLine && (
                <g pointerEvents="none">
                  <line x1={xs(p.refLine.x)} x2={xs(p.refLine.x)} y1={-14} y2={innerHeight} style={{ stroke: "var(--color-text-2)" }} strokeWidth={1} strokeDasharray="4 3" />
                  <text x={xs(p.refLine.x) + 4} y={-4} style={{ fontSize: "var(--fs-12)", fill: "var(--color-text-2)" }}>{p.refLine.label}</text>
                </g>
              )}
              {p.series.map((s) => {
                const role = roleOf(s.config);
                const col = role === "proposed" ? "var(--color-ctrl-proposed)" : role === "baseline" ? "var(--color-ctrl-baseline)" : "var(--color-ctrl-other)";
                const edge = role === "baseline" ? "var(--color-ctrl-baseline-edge)" : col;
                const pts = s.points.filter((pt) => pt.m.mean !== null);
                const band = d3area<{ x: number; m: MetricCI }>()
                  .x((d) => xs(d.x)).y0((d) => ys(d.m.lo ?? d.m.mean!)).y1((d) => ys(d.m.hi ?? d.m.mean!))(pts) ?? "";
                const ln = d3line<{ x: number; m: MetricCI }>().x((d) => xs(d.x)).y((d) => ys(d.m.mean!))(pts) ?? "";
                return (
                  <g key={s.config} pointerEvents="none">
                    <path d={band} style={{ fill: col, fillOpacity: 0.16 }} />
                    <path d={ln} fill="none" style={{ stroke: edge, strokeWidth: "var(--stroke-bold)" }}
                      strokeDasharray={role === "other" ? "6 3" : undefined} />
                    {pts.map((pt) => (
                      role === "other"
                        ? <circle key={pt.x} cx={xs(pt.x)} cy={ys(pt.m.mean!)} r={3.25 * k} style={{ fill: "var(--color-surface-2)", stroke: col, strokeWidth: "var(--stroke-data)" }} />
                        : <circle key={pt.x} cx={xs(pt.x)} cy={ys(pt.m.mean!)} r={3 * k} style={{ fill: col, stroke: role === "baseline" ? edge : "var(--color-surface-2)", strokeWidth: 1 }} />
                    ))}
                  </g>
                );
              })}
              {!narrow && ends.map((e) => (
                <text key={e.config} x={innerWidth + 10} y={e.y + 4} style={{
                  fontSize: "var(--fs-13)", fontWeight: 500,
                  fill: roleOf(e.config) === "proposed" ? "var(--color-ctrl-proposed-text)" : roleOf(e.config) === "baseline" ? "var(--color-ctrl-baseline-text)" : "var(--color-ctrl-other)",
                }}>{e.config}</text>
              ))}
              {hover && <line x1={xs(p.xValues[hover.i])} x2={xs(p.xValues[hover.i])} y1={0} y2={innerHeight} style={{ stroke: "var(--color-border-strong)", strokeWidth: 1 }} pointerEvents="none" />}
              {p.xValues.map((v, i) => {
                const x0 = i === 0 ? 0 : (xs(p.xValues[i - 1]) + xs(v)) / 2;
                const x1 = i === p.xValues.length - 1 ? innerWidth : (xs(v) + xs(p.xValues[i + 1])) / 2;
                return <rect key={v} x={x0} y={0} width={Math.max(0, x1 - x0)} height={innerHeight} fill="transparent"
                  onPointerMove={(e) => setHover({ i, x: e.clientX, y: e.clientY })} />;
              })}
            </g>
          );
        }}
      </ChartFrame>
      {hover && (
        <TooltipBox x={hover.x} y={hover.y} open>
          <Readout title={p.xFmt(p.xValues[hover.i])} rows={p.series.map((s): ReadoutRow => {
            const pt = s.points.find((q) => q.x === p.xValues[hover.i]);
            return [s.config, pt ? `${p.yFmt(pt.m.mean)} (95% CI ${fmtCI(pt.m.lo, pt.m.hi, p.yDp)}), n = ${pt.m.n ?? "–"}` : "–"];
          })} />
        </TooltipBox>
      )}
    </div>
  );
}

function NarrowLegend({ series }: { series: Series[] }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", fontSize: "var(--fs-13)" }}>
      {series.map((s) => <span key={s.config} className={roleOf(s.config) === "proposed" ? "ctrl-proposed" : roleOf(s.config) === "baseline" ? "ctrl-baseline" : "ctrl-other"}>{s.config}</span>)}
    </div>
  );
}
