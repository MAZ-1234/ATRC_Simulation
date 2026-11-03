/**
 * Starlink handover schedule (DESIGN.md 6.3: "one minute dial strip, 4 ticks"), the
 * outage chance and length per variant, the one congestion burst, and the outages this
 * seed actually drew (from the loaded run's events). Handover outages are pre-generated
 * from the seed in sim/scenario.py make_ctx, so both controllers meet the same ones.
 */
import { useMemo, useRef, useState, type PointerEvent } from "react";
import { scaleLinear } from "d3-scale";
import { Badge, TooltipBox, Readout, useMeasure, TICK, type ReadoutRow } from "../../components";
import { showInReplay } from "../../state";
import { fmtClock, fmtClockShort, fmtDur, fmtMs, fmtSec, variantLabel } from "../../data/loader";
import type { RunData, Scenario } from "../../data/types";
import { PATTERN_IDS } from "../../app/PatternDefs";
import { lowerFirst, num, pctOf, secRange } from "./model";
import s from "./Scenario.module.css";

interface Props {
  sc: Scenario;
  variant: string;
  run: RunData | null;
  seed: number;
  gutter: number;
}

const RIGHT = 20;
const ROW = 20;

export function Handovers({ sc, variant, run, seed, gutter }: Props) {
  const ho = sc.starlink_handover;
  const P = sc.variants[variant]?.params;
  if (!P) return null;
  const meanLen = (P.ho_out_s[0] + P.ho_out_s[1]) / 2;
  return (
    <div className={s.stack}>
      <p className={s.lead}>
        Starlink moves to a new satellite at {ho.offsets_s.map((o) => `:${String(o).padStart(2, "0")}`).join(", ")} of
        every minute. Each handover adds {fmtMs(ho.extra_rtt_ms)} RTT for {num(ho.extra_for_s)} s, and
        on {lowerFirst(variantLabel(variant))} it takes the link down {pctOf(P.ho_p_out)} of the time
        for {secRange(P.ho_out_s[0], P.ho_out_s[1])} <Badge kind="assumption" title="Assumption: sim/scenario.py DEFAULTS ho_p_out, ho_out_s" />.
        One gateway congestion burst adds {fmtMs(ho.congestion_burst.extra_rtt_ms)} RTT
        at {num(ho.congestion_burst.from_s)}–{num(ho.congestion_burst.to_s)} s in every seed <Badge kind="assumption" title="Assumption: sim/scenario.py make_ctx (gateway congestion burst)" />.
      </p>
      <MinuteStrip sc={sc} variant={variant} gutter={gutter} />
      <MissionStrip sc={sc} run={run} seed={seed} gutter={gutter} />
      <div className={s.tableWrap}>
        <table className={s.table}>
          <caption className="sr-only">Starlink handover outages per variant</caption>
          <thead>
            <tr>
              <th scope="col">Variant</th>
              <th scope="col" className="num">Outage chance <Badge kind="assumption" /></th>
              <th scope="col" className="num">Outage length <Badge kind="assumption" /></th>
              <th scope="col" className="num">Expected outages per 10 min</th>
              <th scope="col" className="num">Expected time down per 10 min</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(sc.variants).map(([name, v]) => {
              const per10 = (600 / ho.period_s) * ho.offsets_s.length * v.params.ho_p_out;
              const m = (v.params.ho_out_s[0] + v.params.ho_out_s[1]) / 2;
              const sel = name === variant;
              return (
                <tr key={name} className={sel ? s.rowSel : undefined} aria-current={sel || undefined}>
                  <th scope="row" title={name}>{variantLabel(name)}</th>
                  <td className="num">{pctOf(v.params.ho_p_out)}</td>
                  <td className="num">{secRange(v.params.ho_out_s[0], v.params.ho_out_s[1])}</td>
                  <td className="num">{per10.toFixed(1)}</td>
                  <td className="num">{fmtDur(per10 * m)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="caption">
        Expected values: {(600 / ho.period_s) * ho.offsets_s.length} handovers per 10 min times the outage chance, times the mean
        length ({fmtSec(meanLen)} on {lowerFirst(variantLabel(variant))}). Outages are drawn from the seed, so both controllers meet the same ones.
      </p>
    </div>
  );
}

function MinuteStrip({ sc, variant, gutter }: { sc: Scenario; variant: string; gutter: number }) {
  const [ref, { width }] = useMeasure<HTMLDivElement>();
  const ho = sc.starlink_handover;
  const P = sc.variants[variant].params;
  const W = Math.max(320, width);
  const x = scaleLinear().domain([0, ho.period_s]).range([gutter, W - RIGHT]);
  const top = 22;
  const H = top + ROW * 3 + 28;
  const ticks = Array.from({ length: Math.floor(ho.period_s / 5) + 1 }, (_, i) => i * 5);
  return (
    <div ref={ref} className={s.strip}>
      {width > 0 && (
        <svg width={W} height={H} role="img" className={s.svg}
          aria-label={`One minute of Starlink: handovers at seconds ${ho.offsets_s.join(", ")}; each adds ${ho.extra_rtt_ms} ms RTT for ${ho.extra_for_s} s and causes an outage ${pctOf(P.ho_p_out)} of the time.`}>
          <text x={gutter} y={12} style={{ fontSize: "var(--fs-13)", fill: "var(--color-text-2)" }}>One minute, repeated for the whole mission (s)</text>
          <rect x={x(0)} y={top} width={x(ho.period_s) - x(0)} height={ROW * 3} style={{ fill: "var(--color-surface-2)" }} />
          {ticks.map((t) => (
            <line key={t} x1={x(t)} x2={x(t)} y1={top} y2={top + ROW * 3} style={{ stroke: "var(--color-grid)", strokeWidth: 1 }} />
          ))}
          {["Handover", `RTT +${Math.round(ho.extra_rtt_ms)} ms`, `Outage, ${pctOf(P.ho_p_out)} chance`].map((l, i) => (
            <text key={l} x={gutter - 12} y={top + i * ROW + 14} textAnchor="end"
              style={{ fontFamily: "var(--font-display)", fontSize: "var(--fs-13)", fontWeight: 500, fill: "var(--color-text-2)" }}>{l}</text>
          ))}
          {ho.offsets_s.map((o) => {
            const x0 = x(o);
            return (
              <g key={o}>
                <line x1={x0} x2={x0} y1={top + 2} y2={top + ROW - 2} style={{ stroke: "var(--color-text-1)", strokeWidth: 2 }} />
                <text x={x0 + 5} y={top + 14} style={{ fontSize: "var(--fs-12)", fontWeight: 600, fill: "var(--color-text-1)" }}>:{String(o).padStart(2, "0")}</text>
                <rect x={x0} y={top + ROW + 4} width={Math.max(2, x(o + ho.extra_for_s) - x0)} height={ROW - 8}
                  style={{ fill: "var(--color-link-starlink)" }} />
                <rect x={x0} y={top + 2 * ROW + 4} width={Math.max(2, x(o + P.ho_out_s[1]) - x0)} height={ROW - 8}
                  fill={`url(#${PATTERN_IDS.neutral})`} style={{ stroke: "var(--color-status-unknown)", strokeWidth: 1 }} />
                <line x1={x(o + P.ho_out_s[0])} x2={x(o + P.ho_out_s[0])} y1={top + 2 * ROW + 2} y2={top + 3 * ROW - 2}
                  style={{ stroke: "var(--color-text-2)", strokeWidth: 1.5 }} />
              </g>
            );
          })}
          <text x={W - RIGHT} y={12} textAnchor="end" style={{ fontSize: "var(--fs-12)", fill: "var(--color-text-2)" }}>
            Hatch: outage, {secRange(P.ho_out_s[0], P.ho_out_s[1])} when it happens
          </text>
          {ticks.filter((t) => t % 15 === 0).map((t) => (
            <text key={t} x={x(t)} y={top + ROW * 3 + 16} textAnchor="middle" style={TICK}>{t}</text>
          ))}
        </svg>
      )}
    </div>
  );
}

interface Block { kind: "outage" | "burst" | "blackout"; t: number; len: number }

function MissionStrip({ sc, run, seed, gutter }: { sc: Scenario; run: RunData | null; seed: number; gutter: number }) {
  const [ref, { width }] = useMeasure<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ b: Block; cx: number; cy: number } | null>(null);
  const ho = sc.starlink_handover;
  const T = run?.meta.mission_time_s ?? null;
  const W = Math.max(320, width);
  const x = useMemo(() => scaleLinear().domain([0, T ?? 1]).range([gutter, W - RIGHT]), [T, gutter, W]);
  const blocks = useMemo<Block[]>(() => {
    if (!run) return [];
    const b: Block[] = run.events.starlink_outages.map(([t, len]) => ({ kind: "outage", t, len }));
    const cb = ho.congestion_burst;
    b.push({ kind: "burst", t: cb.from_s, len: cb.to_s - cb.from_s });
    if (run.events.blackout) b.push({ kind: "blackout", t: run.events.blackout[0], len: run.events.blackout[1] });
    return b;
  }, [run, ho]);
  const outages = run?.events.starlink_outages ?? [];
  const downS = outages.reduce((a, [, l]) => a + l, 0);
  const top = 22;
  const H = top + ROW * 3 + 28;
  const rowOf = (k: Block["kind"]) => (k === "outage" ? 1 : 2);

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const row = Math.floor((py - top) / ROW);
    const hit = blocks.filter((b) => rowOf(b.kind) === row)
      .map((b) => ({ b, d: px < x(b.t) ? x(b.t) - px : px > x(b.t + b.len) ? px - x(b.t + b.len) : 0 }))
      .sort((p, q) => p.d - q.d)[0];
    setHover(hit && hit.d < 5 ? { b: hit.b, cx: e.clientX, cy: e.clientY } : null);
  };
  const name = (k: Block["kind"]) => (k === "outage" ? "Handover outage" : k === "burst" ? "Gateway congestion burst" : "Jammer blackout");
  const rows: ReadoutRow[] = hover ? [
    ["Starts", fmtClock(hover.b.t)],
    ["Lasts", fmtSec(hover.b.len, 2)],
    ...(hover.b.kind === "burst" ? [["RTT", `+${fmtMs(ho.congestion_burst.extra_rtt_ms)}`] as ReadoutRow] : []),
    ...(hover.b.kind === "blackout" ? [["Trigger", "first pass of the blackout point (position)"] as ReadoutRow] : []),
  ] : [];

  return (
    <div ref={ref} className={s.strip}>
      {width > 0 && run && T !== null && (
        <svg ref={svgRef} width={W} height={H} className={s.svg} role="img"
          aria-label={`Starlink over the mission, seed ${seed}: ${outages.length} handover outages, ${downS.toFixed(1)} s down in total.`}
          onPointerMove={onMove} onPointerLeave={() => setHover(null)}
          onClick={() => { if (hover) showInReplay({ t: Math.max(0, hover.b.t - 3) }); }}
          style={{ cursor: hover ? "pointer" : "default" }}>
          <text x={gutter} y={12} style={{ fontSize: "var(--fs-13)", fill: "var(--color-text-2)" }}>
            The whole mission, seed {seed} (mission time)
          </text>
          <rect x={x(0)} y={top} width={x(T) - x(0)} height={ROW * 3} style={{ fill: "var(--color-surface-2)" }} />
          {["Handovers", `Outages, seed ${seed}`, "Other Starlink events"].map((l, i) => (
            <text key={l} x={gutter - 12} y={top + i * ROW + 14} textAnchor="end"
              style={{ fontFamily: "var(--font-display)", fontSize: "var(--fs-13)", fontWeight: 500, fill: "var(--color-text-2)" }}>{l}</text>
          ))}
          {(() => {
            const out: JSX.Element[] = [];
            for (let m = 0; m * ho.period_s <= T; m++) {
              for (const o of ho.offsets_s) {
                const t = m * ho.period_s + o;
                if (t > T) continue;
                out.push(<line key={t} x1={x(t)} x2={x(t)} y1={top + 5} y2={top + ROW - 5} style={{ stroke: "var(--color-text-3)", strokeWidth: 1 }} />);
              }
            }
            return out;
          })()}
          {blocks.map((b, i) => {
            const y0 = top + rowOf(b.kind) * ROW + 4;
            const bx = x(b.t);
            const bw = Math.max(2, x(b.t + b.len) - bx);
            const on = hover?.b === b;
            if (b.kind === "burst") {
              return (
                <g key={i}>
                  <rect x={bx} y={y0} width={Math.max(3, bw)} height={ROW - 8} style={{ fill: "var(--color-link-starlink)", opacity: "var(--link-degraded-alpha)", stroke: on ? "var(--color-text-1)" : "var(--color-link-starlink)", strokeWidth: 1 }} />
                  <text x={bx - 5} y={y0 + 10} textAnchor="end" style={{ fontSize: "var(--fs-12)", fill: "var(--color-text-2)" }}>
                    Congestion burst +{fmtMs(ho.congestion_burst.extra_rtt_ms)}
                  </text>
                </g>
              );
            }
            return (
              <g key={i}>
                <rect x={bx} y={y0} width={bw} height={ROW - 8} fill={`url(#${PATTERN_IDS.neutral})`}
                  style={{ stroke: on ? "var(--color-text-1)" : "var(--color-status-unknown)", strokeWidth: on ? 1.5 : 1 }} />
                {b.kind === "blackout" && (
                  <text x={bx + bw + 5} y={y0 + 10} style={{ fontSize: "var(--fs-12)", fill: "var(--color-text-2)" }}>Jammer blackout {num(b.len)} s</text>
                )}
              </g>
            );
          })}
          {Array.from({ length: Math.floor(T / 120) + 1 }, (_, i) => i * 120).map((t) => (
            <text key={t} x={x(t)} y={top + ROW * 3 + 16} textAnchor="middle" style={TICK}>{fmtClockShort(t)}</text>
          ))}
        </svg>
      )}
      {!run && <p className={s.pending}>Loading seed {seed} to show this seed's outages.</p>}
      {run && T !== null && (
        <p className="caption">
          Seed {seed}: {outages.length} handover outages before the mission ended at {fmtClock(T)}, {fmtSec(downS)} down in
          total. The blackout time comes from the Proposed run, because it fires when the vehicle first reaches the trigger point.
          Hover a block for its time; click it to show it in Replay.
        </p>
      )}
      <TooltipBox x={hover?.cx ?? 0} y={hover?.cy ?? 0} open={!!hover}>
        <Readout title={hover ? name(hover.b.kind) : ""} rows={rows} />
      </TooltipBox>
    </div>
  );
}
