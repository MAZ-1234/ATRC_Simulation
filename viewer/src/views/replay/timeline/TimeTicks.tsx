/**
 * Time axis of the mission timeline (DESIGN.md 8: labels every 2 min at full width, 12/text-3).
 * Same marks as the shared TimeAxis, but the first and last labels are anchored inward so
 * "0:00" and the mission end are never clipped by the plot edge. The cursor chip is an HTML
 * element moved by the timeline itself, so this SVG never re-renders during playback.
 */
import { memo } from "react";
import type { ScaleLinear } from "d3-scale";
import { TICK } from "../../../components";
import { fmtClockShort } from "../../../format";

export interface TimeTicksProps {
  scale: ScaleLinear<number, number>;
  /** Label spacing, s. */
  every: number;
  width: number;
}

/** Tick label half width allowance before a label is anchored inward, px. */
const EDGE_PX = 18;

export const TimeTicks = memo(function TimeTicks({ scale, every, width }: TimeTicksProps) {
  const [d0, d1] = scale.domain();
  const ticks: number[] = [];
  for (let t = Math.ceil(d0 / every - 1e-9) * every; t <= d1 + 1e-6; t += every) ticks.push(t);
  return (
    <g style={{ fontFamily: "var(--font-ui)" }}>
      {ticks.map((t) => {
        const x = Math.round(scale(t)) + 0.5;
        const anchor = x < EDGE_PX ? "start" : x > width - EDGE_PX ? "end" : "middle";
        return (
          <g key={t} transform={`translate(${x},0)`}>
            <line y1={0} y2={4} style={{ stroke: "var(--color-border-strong)", strokeWidth: "var(--stroke-hair)" }} />
            <text y={16} textAnchor={anchor} style={TICK}>{fmtClockShort(t)}</text>
          </g>
        );
      })}
    </g>
  );
});
