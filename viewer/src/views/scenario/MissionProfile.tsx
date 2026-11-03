/**
 * Mission script: position over time (DESIGN.md 6.3 wireframe "km ▲ out to 3.0, back to
 * 1.4, events as labelled ◆"). Drawn from the loaded Proposed run of the selected seed:
 * the script is the same for every controller, but the vehicle only moves while commands
 * arrive, so the exact times are a property of a run.
 */
import { useMemo, useRef, useState, type PointerEvent } from "react";
import { scaleLinear } from "d3-scale";
import { TooltipBox, Readout, useMeasure, TICK } from "../../components";
import { showInReplay } from "../../state";
import { bisectRight, dec, fmtClock, fmtClockShort, fmtKm, manoeuvreLabel } from "../../data/loader";
import type { RunData, Scenario, VariantInfo } from "../../data/types";
import { SPAN_KINDS, stateLabel, uploadLabel, zoneKey } from "./model";
import s from "./Scenario.module.css";

interface Props {
  sc: Scenario;
  variant: VariantInfo;
  run: RunData;
  gutter: number;
  hoverZone: string | null;
}

const RIGHT = 20;
/** States labelled on the curve, with the side of the point the label sits on. */
const LABELLED: Record<string, "left" | "right"> = { CRATER_APPROACH: "left", INSPECT: "left", RETURN: "right" };
const TOP = 24;

export function MissionProfile({ sc, variant, run, gutter, hoverZone }: Props) {
  const [ref, { width }] = useMeasure<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ i: number; cx: number; cy: number } | null>(null);
  const S = run.samples;
  const T = run.meta.mission_time_s;
  const W = Math.max(320, width);
  const plotH = 168;
  const upTop = plotH + 14;
  const kmMax = sc.km[sc.km.length - 1];
  const x = useMemo(() => scaleLinear().domain([0, T]).range([gutter, W - RIGHT]), [T, gutter, W]);
  const y = useMemo(() => scaleLinear().domain([0, kmMax]).range([plotH - 6, TOP]), [kmMax]);

  const path = useMemo(() => {
    let d = "";
    for (let i = 0; i < S.t.length; i += 5) d += `${d ? "L" : "M"}${x(S.t[i]).toFixed(1)},${y(S.d[i]).toFixed(1)}`;
    const n = S.t.length - 1;
    return d + `L${x(S.t[n]).toFixed(1)},${y(S.d[n]).toFixed(1)}`;
  }, [S, x, y]);

  const entries = useMemo(() => run.state_changes
    .map(([t, d, c]) => ({ t, d, state: dec(run, "state", c) ?? "" }))
    .filter((e) => e.state in LABELLED), [run]);
  const requested = run.uploads.filter((u) => u.requested);
  const background = run.uploads.filter((u) => !u.requested);
  // Requested items created at the same moment share one marker ("Inspection still, Inspection clip").
  const reqGroups = useMemo(() => {
    const g: { t: number; d: number; names: string[] }[] = [];
    for (const u of requested) {
      const last = g[g.length - 1];
      if (last && Math.abs(last.t - u.created_t) < 0.5) {
        // "Inspection still" + "Inspection clip" -> "Inspection still and clip"
        const first = last.names[0].split(" ")[0];
        const name = uploadLabel(u.id);
        last.names.push(name.startsWith(first + " ") ? name.slice(first.length + 1) : name);
      }
      else g.push({ t: u.created_t, d: u.created_d, names: [uploadLabel(u.id)] });
    }
    return g;
  }, [requested]);
  // Requested-upload labels: right of the marker if it fits, else left, else on a second line.
  const labelPlan = useMemo(() => {
    const lines: [number, number][][] = [[], []];
    const marks = reqGroups.map((g) => x(g.t));
    const out: { g: (typeof reqGroups)[number]; line: number; anchor: "start" | "end" }[] = [];
    reqGroups.forEach((g, i) => {
      const w = g.names.join(" and ").length * 6.2;
      const gx = marks[i];
      const free = (line: number, a: number, b: number) => a >= gutter && b <= W - RIGHT + 4
        && lines[line].every(([p, q]) => b + 6 < p || a > q + 6)
        && (line > 0 || marks.every((m, j) => j === i || m + 6 < a || m - 6 > b));
      const tries: [number, "start" | "end", number, number][] = [
        [0, "start", gx + 8, gx + 8 + w], [0, "end", gx - 8 - w, gx - 8], [1, "start", gx + 8, gx + 8 + w], [1, "end", gx - 8 - w, gx - 8]];
      const pick = tries.find(([l, , a, b]) => free(l, a, b)) ?? tries[2];
      lines[pick[0]].push([pick[2], pick[3]]);
      out.push({ g, line: pick[0], anchor: pick[1] });
    });
    return out;
  }, [reqGroups, x, gutter, W]);
  const twoLines = labelPlan.some((p) => p.line > 0);
  const bgTop = upTop + 22 + (twoLines ? 14 : 0);
  const H = bgTop + 18 + 26;

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const px = e.clientX - r.left;
    if (px < gutter || px > W - RIGHT) { setHover(null); return; }
    const t = x.invert(px);
    const i = Math.max(0, Math.min(S.t.length - 1, bisectRight(S.t, t)));
    setHover({ i, cx: e.clientX, cy: e.clientY });
  };
  const hi = hover?.i ?? 0;
  const zonesKm = variant.zones.filter((z) => SPAN_KINDS.has(zoneKey(z.kind)) && z.kind !== "jamming_ramp");

  return (
    <div ref={ref} className={s.strip}>
      {width > 0 && (
        <svg ref={svgRef} width={W} height={H} className={s.svg} role="img"
          aria-label={`Position over time in the Proposed run: out to ${fmtKm(Math.max(...S.d))} and back to ${fmtKm(S.d[S.d.length - 1])}, mission ${fmtClock(T)}.`}
          onPointerMove={onMove} onPointerLeave={() => setHover(null)}
          onClick={() => { if (hover) showInReplay({ t: S.t[hover.i] }); }} style={{ cursor: hover ? "pointer" : "default" }}>
          <rect x={gutter} y={0} width={W - RIGHT - gutter} height={plotH} style={{ fill: "var(--color-surface-2)" }} />
          {zonesKm.map((z) => {
            const on = hoverZone === zoneKey(z.kind);
            return (
              <g key={z.name}>
                <rect x={gutter} y={y(z.to_km)} width={W - RIGHT - gutter} height={Math.max(1.5, y(z.from_km) - y(z.to_km))}
                  style={{ fill: on ? "var(--color-grid-strong)" : "var(--color-zone-wash)" }} />
                {y(z.from_km) - y(z.to_km) >= 13 && (
                  <text x={gutter + 6} y={(y(z.from_km) + y(z.to_km)) / 2 + 4}
                    style={{ fontSize: "var(--fs-12)", fill: on ? "var(--color-text-1)" : "var(--color-text-3)" }}>{z.name}</text>
                )}
              </g>
            );
          })}
          {[0, 1, 2, 3].filter((k) => k <= kmMax).map((k) => (
            <g key={k}>
              <line x1={gutter} x2={W - RIGHT} y1={y(k)} y2={y(k)} style={{ stroke: "var(--color-grid)", strokeWidth: 1 }} />
              <text x={gutter - 8} y={y(k) + 4} textAnchor="end" style={TICK}>{k.toFixed(1)}</text>
            </g>
          ))}
          <text x={gutter} y={14} style={{ fontSize: "var(--fs-13)", fill: "var(--color-text-2)" }}>Position (km), seed {run.meta.seed}</text>
          <path d={path} fill="none" style={{ stroke: "var(--color-text-1)", strokeWidth: "var(--stroke-data)" }} strokeLinejoin="round" />
          {entries.map((e) => {
            const ex = x(e.t);
            const ey = y(e.d);
            const right = LABELLED[e.state] === "right";
            return (
              <g key={e.state + e.t}>
                <circle cx={ex} cy={ey} r={3.5} style={{ fill: "var(--color-surface-2)", stroke: "var(--color-text-1)", strokeWidth: 1.5 }} />
                <text x={ex + (right ? 7 : -7)} y={ey - 8} textAnchor={right ? "start" : "end"}
                  style={{ fontSize: "var(--fs-12)", fill: "var(--color-text-2)" }}>
                  <title>{e.state}</title>{stateLabel(e.state)} {fmtClock(e.t)}
                </text>
              </g>
            );
          })}
          {/* uploads row */}
          <text x={gutter - 8} y={upTop + 12} textAnchor="end" style={{ fontFamily: "var(--font-display)", fontSize: "var(--fs-13)", fontWeight: 500, fill: "var(--color-text-2)" }}>Requested</text>
          <text x={gutter - 8} y={bgTop + 11} textAnchor="end" style={{ fontFamily: "var(--font-display)", fontSize: "var(--fs-13)", fontWeight: 500, fill: "var(--color-text-2)" }}>Background</text>
          {background.map((u) => (
            <line key={u.id} x1={x(u.created_t)} x2={x(u.created_t)} y1={bgTop + 2} y2={bgTop + 14} style={{ stroke: "var(--color-text-2)", strokeWidth: 1.5 }} />
          ))}
          {labelPlan.map(({ g, line, anchor }) => {
            const gx = x(g.t);
            const ly = upTop + 12 + line * 14;
            return (
              <g key={g.t}>
                <line x1={gx} x2={gx} y1={y(g.d)} y2={upTop + 4} style={{ stroke: "var(--color-text-3)", strokeWidth: 1 }} strokeDasharray="2 2" />
                <path d={`M${gx},${upTop + 3}L${gx + 5},${upTop + 8}L${gx},${upTop + 13}L${gx - 5},${upTop + 8}Z`} style={{ fill: "var(--color-text-1)" }} />
                <text x={gx + (anchor === "start" ? 8 : -8)} y={ly} textAnchor={anchor} style={{ fontSize: "var(--fs-12)", fill: "var(--color-text-1)" }}>{g.names.join(" and ")}</text>
              </g>
            );
          })}
          {Array.from({ length: Math.floor(T / 120) + 1 }, (_, i) => i * 120).map((t) => (
            <text key={t} x={x(t)} y={H - 6} textAnchor="middle" style={TICK}>{fmtClockShort(t)}</text>
          ))}
          {hover && (
            <g pointerEvents="none">
              <line x1={x(S.t[hi])} x2={x(S.t[hi])} y1={0} y2={bgTop + 16} style={{ stroke: "var(--color-cursor)", strokeWidth: 1 }} />
              <circle cx={x(S.t[hi])} cy={y(S.d[hi])} r={4} style={{ fill: "var(--color-text-1)" }} />
            </g>
          )}
        </svg>
      )}
      <TooltipBox x={hover?.cx ?? 0} y={hover?.cy ?? 0} open={!!hover}>
        {hover && (
          <>
            <Readout title={fmtClock(S.t[hi])} rows={[
              ["Position", `${fmtKm(S.d[hi])}, ${S.dir[hi] > 0 ? "outbound" : "return"}`],
              ["Driver state", stateLabel(dec(run, "state", S.state[hi]) ?? "")],
              ["True manoeuvre", manoeuvreLabel(dec(run, "man", S.man[hi]))],
              ["Speed", `${S.v[hi].toFixed(1)} m/s`],
            ]} />
            <div className={s.tipHint}>Click to show this moment in Replay</div>
          </>
        )}
      </TooltipBox>
    </div>
  );
}
