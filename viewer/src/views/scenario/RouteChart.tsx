/**
 * Link ground truth along the route (DESIGN.md 6.3, 8). km on x, the same zones and zone
 * names as the Replay route strip, an outbound and a return lane with the scoring
 * segments, then one track per link (Radio, Starlink, 4G): the chosen metric as a line
 * and the link state band underneath (solid = meets the config's video limits, faint =
 * up but below them, hatch = down; DESIGN.md 2.3). Hover reads every value at that km;
 * click opens Replay at the first outbound pass of that km in the loaded Proposed run.
 */
import { useMemo, useRef, useState, type PointerEvent } from "react";
import { scaleLinear } from "d3-scale";
import { TooltipBox, Readout, useMeasure, TICK, linkVar, type ReadoutRow } from "../../components";
import { showInReplay } from "../../state";
import {
  LINK_ORDER, fmtClock, fmtKm, linkLabel, segmentLabel,
} from "../../data/loader";
import type { LinkName, RunData, Scenario, VariantInfo, Zone } from "../../data/types";
import { PATTERN_IDS } from "../../app/PatternDefs";
import {
  METRICS, SPAN_KINDS, fmtMetric, goodRule, kmIndex, metricDomain, metricRefs, metricValue, passTime,
  num, stateAt, stateSpans, zoneKey, type LinkState, type Metric,
} from "./model";
import s from "./Scenario.module.css";

export interface RouteChartProps {
  sc: Scenario;
  variantName: string;
  variant: VariantInfo;
  metric: Metric;
  /** Loaded Proposed run for km -> t (null while loading). */
  run: RunData | null;
  seed: number;
  gutter: number;
  trackH: number;
  hoverZone: string | null;
  onHoverZone: (key: string | null) => void;
}

const RIGHT = 20;
const LABEL_ROW = 17;
const LANE_H = 22;
const BAND_H = 10;
const TRACK_GAP = 14;
const AXIS_H = 30;
const STATE_WORD: Record<LinkState, string> = { good: "Meets limits", degraded: "Up, outside limits", down: "Down" };

interface Placed { zone: Zone; x: number; x0: number; x1: number; row: number; anchor: "start" | "middle" | "end"; text: string }

/**
 * Greedy rows for zone labels so no two labels overlap and no point's leader line (which
 * runs from its label down to the lanes) crosses another label (approximate 12px Barlow advance).
 */
interface LabelIn { zone: Zone; from_km: number; to_km: number; name: string; text?: string }
function placeLabels(zones: LabelIn[], x: (d: number) => number, x0: number, x1: number): Placed[] {
  const charW = 6.3;
  const items = zones.map((z) => {
    const span = z.to_km > z.from_km;
    const cx = span ? (x(z.from_km) + x(z.to_km)) / 2 : x(z.from_km);
    const text = z.text ?? z.name;
    const w = text.length * charW;
    let anchor: Placed["anchor"] = span ? "middle" : "start";
    let a = span ? cx - w / 2 : cx + 7;
    if (a + w > x1) { anchor = "end"; a = (span ? cx + w / 2 : cx - 7) - w; if (a + w > x1) a = x1 - w; }
    if (a < x0) { a = x0; anchor = "start"; }
    return {
      zone: z.zone, x: anchor === "start" ? a : anchor === "end" ? a + w : cx,
      x0: Math.min(a, span ? a : cx - 6), x1: Math.max(a + w, span ? a + w : cx + 6), anchor, text,
      px: span ? null : cx,
    };
  }).sort((p, q) => p.x0 - q.x0);
  // A point's leader runs down from its label, so a point must sit BELOW (higher row) every
  // label its x falls inside. Place items in topological order of that constraint (ties by x),
  // each at the first row under its constraints with no overlap in that row.
  const n = items.length;
  const above: number[][] = items.map(() => []);
  for (let i = 0; i < n; i++) {
    const px = items[i].px;
    if (px === null) continue;
    for (let j = 0; j < n; j++) if (j !== i && px >= items[j].x0 - 3 && px <= items[j].x1 + 3) above[i].push(j);
  }
  const order: number[] = [];
  const placedSet = new Set<number>();
  while (order.length < n) {
    let next = -1;
    for (let i = 0; i < n && next < 0; i++) if (!placedSet.has(i) && above[i].every((j) => placedSet.has(j))) next = i;
    if (next < 0) next = [...Array(n).keys()].find((i) => !placedSet.has(i))!; // cycle: give up on one constraint
    order.push(next);
    placedSet.add(next);
  }
  const row = new Array<number>(n).fill(-1);
  for (const i of order) {
    const it = items[i];
    let r = Math.max(0, ...above[i].filter((j) => row[j] >= 0).map((j) => row[j] + 1));
    while (items.some((d, j) => row[j] === r && d.x1 + 10 > it.x0 && it.x1 + 10 > d.x0)) r++;
    row[i] = r;
  }
  return items.map((it, i) => ({ zone: it.zone, x: it.x, x0: it.x0, x1: it.x1, row: row[i], anchor: it.anchor, text: it.text }));
}

export function RouteChart({ sc, variantName, variant, metric, run, seed, gutter, trackH, hoverZone, onHoverZone }: RouteChartProps) {
  const [wrapRef, { width }] = useMeasure<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ km: number; cx: number; cy: number } | null>(null);
  const rule = useMemo(() => goodRule(sc), [sc]);
  const kmMax = sc.km[sc.km.length - 1];
  const W = Math.max(320, width);
  const x = useMemo(() => scaleLinear().domain([0, kmMax]).range([gutter, W - RIGHT]), [gutter, W, kmMax]);

  // Zones: labelled ones on top; route-long ones (no radio, cell-edge 4G, mission end) are shown by the tracks/lane.
  const labelled = useMemo(() => variant.zones.filter((z) => !["no_radio", "coverage", "end", "jamming_ramp"].includes(z.kind)), [variant]);
  // The blackout trigger label carries its length (read from the variant parameters).
  const placed = useMemo(() => placeLabels(labelled.map((z) => ({
    ...z, zone: z, text: z.kind === "trigger" ? `${z.name}, ${num(variant.params.blackout_s)} s blackout` : z.name,
  })), (d) => x(d), gutter, W - RIGHT), [labelled, x, gutter, W, variant]);
  const nRows = Math.max(1, ...placed.map((p) => p.row + 1));
  const headH = nRows * LABEL_ROW + 6;
  const lanesTop = headH;
  const sheetTop = lanesTop;
  const tracksTop = lanesTop + 2 * LANE_H + 10;
  const trackBlock = trackH + BAND_H + TRACK_GAP;
  const sheetBottom = tracksTop + LINK_ORDER.length * trackBlock - TRACK_GAP + 6;
  const H = sheetBottom + AXIS_H;

  const domain = useMemo(() => metricDomain(sc, metric), [sc, metric]);
  const y = useMemo(() => scaleLinear().domain(domain).nice(4).range([trackH - 4, 6]), [domain, trackH]);
  const yTicks = y.domain();
  const spans = useMemo(() => {
    const out: Partial<Record<LinkName, ReturnType<typeof stateSpans>>> = {};
    for (const ln of LINK_ORDER) if (variant.profile[ln]) out[ln] = stateSpans(sc.km, variant.profile[ln], rule);
    return out;
  }, [sc, variant, rule]);

  // Line paths: break where the link is down (signal keeps a dotted line while down).
  const paths = useMemo(() => {
    const out: Partial<Record<LinkName, { up: string; down: string }>> = {};
    for (const ln of LINK_ORDER) {
      const p = variant.profile[ln];
      if (!p) continue;
      let up = "";
      let down = "";
      let penUp = false;
      let penDown = false;
      for (let i = 0; i < sc.km.length; i++) {
        const v = metricValue(p, metric, i);
        const px = x(sc.km[i]).toFixed(1);
        const py = v === null ? "" : y(Math.max(y.domain()[0], Math.min(y.domain()[1], v))).toFixed(1);
        const isUp = !!p.up[i] && v !== null;
        const isDown = !p.up[i] && v !== null && metric === "sig";
        up += isUp ? `${penUp ? "L" : "M"}${px},${py}` : "";
        penUp = isUp;
        // Down segments connect to the neighbouring up point so the dotted line is continuous.
        if (isDown) {
          if (!penDown && i > 0 && p.up[i - 1]) {
            const pv = metricValue(p, metric, i - 1);
            if (pv !== null) down += `M${x(sc.km[i - 1]).toFixed(1)},${y(pv).toFixed(1)}`;
            penDown = true;
          }
          down += `${penDown ? "L" : "M"}${px},${py}`;
          penDown = true;
        } else {
          if (penDown && isUp) down += `L${px},${py}`;
          penDown = false;
        }
      }
      out[ln] = { up, down };
    }
    return out;
  }, [sc, variant, metric, x, y]);

  // Starlink inside the crater: depends on the vehicle being in a crater state, so drawn as a dashed overlay.
  const crater = variant.crater_starlink;
  const craterZone = variant.zones.find((z) => z.kind === "crater");
  const craterPath = useMemo(() => {
    if (!craterZone || metric === "sig") return "";
    let d = "";
    crater.km.forEach((k, i) => {
      if (k > craterZone.to_km - 1e-9) return;
      const v = metric === "cap" ? crater.cap[i] / 1000 : metric === "rtt" ? crater.rtt[i] : crater.loss[i] * 100;
      d += `${d ? "L" : "M"}${x(k).toFixed(1)},${y(v).toFixed(1)}`;
    });
    return d;
  }, [crater, craterZone, metric, x, y]);
  const craterVal = craterZone && metric !== "sig"
    ? (metric === "cap" ? crater.cap[0] / 1000 : metric === "rtt" ? crater.rtt[0] : crater.loss[0] * 100) : null;

  const kmTicks = x.ticks(7);
  const meta = METRICS.find((m) => m.value === metric)!;
  const plotX0 = gutter;
  const plotX1 = W - RIGHT;

  const zoneUnder = (km: number): string | null => {
    const hits = variant.zones.filter((z) => SPAN_KINDS.has(zoneKey(z.kind)) && km >= z.from_km && km <= z.to_km)
      .sort((a, b) => (a.to_km - a.from_km) - (b.to_km - b.from_km));
    return hits[0] ? zoneKey(hits[0].kind) : null;
  };

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    if (px < plotX0 || px > plotX1 || py > sheetBottom) { if (hover) setHover(null); return; }
    const km = Math.round(Math.max(0, Math.min(kmMax, x.invert(px))) * 100) / 100;
    setHover({ km, cx: e.clientX, cy: e.clientY });
    if (py < sheetTop) {
      const lab = placed.find((p) => px >= p.x0 - 4 && px <= p.x1 + 4 && Math.abs(py - (p.row * LABEL_ROW + 12)) < 10);
      onHoverZone(lab ? zoneKey(lab.zone.kind) : zoneUnder(km));
    } else onHoverZone(zoneUnder(km));
  };
  const onLeave = () => { setHover(null); onHoverZone(null); };
  const outT = hover ? passTime(run, hover.km, "out") : null;
  const backT = hover ? passTime(run, hover.km, "back") : null;
  const onClick = () => { if (hover && outT !== null) showInReplay({ t: Math.max(0, outT - 2) }); };

  // Readout rows (max 8): one per link, then the passes.
  const rows: ReadoutRow[] = [];
  if (hover) {
    const i = kmIndex(sc, hover.km);
    for (const ln of LINK_ORDER) {
      const p = variant.profile[ln];
      if (!p) continue;
      const st = stateAt(p, i, rule);
      const parts = st === "down"
        ? [p.sig[i] !== null ? fmtMetric("sig", p.sig[i]) : ""]
        : [fmtMbps(p.cap[i]), `RTT ${fmtMetric("rtt", p.rtt[i])}`, `loss ${fmtMetric("loss", p.loss[i] * 100)}`, p.sig[i] !== null ? fmtMetric("sig", p.sig[i]) : ""];
      rows.push([
        <span key={ln} style={{ color: linkVar(ln, "text"), fontWeight: 500 }}>{linkLabel(ln)}</span>,
        <span key={`${ln}-v`} className={s.readVal}>
          <span className={st === "good" ? undefined : s.readState}>{STATE_WORD[st]}</span>
          {parts.filter(Boolean).length > 0 && <span>{parts.filter(Boolean).join(", ")}</span>}
        </span>,
      ]);
    }
    if (craterZone && hover.km >= craterZone.from_km - 1e-9 && hover.km < craterZone.to_km - 1e-9) {
      const ci = Math.max(0, crater.km.findIndex((k) => k >= hover.km - 1e-9));
      rows.push([
        <span key="cr" style={{ color: linkVar("starlink", "text"), fontWeight: 500 }}>Starlink, crater</span>,
        <span key="cr-v" className={s.readVal}>
          <span className={crater.up[ci] ? undefined : s.readState}>{crater.up[ci] ? "In a crater state" : "Down"}</span>
          <span>{fmtMbps(crater.cap[ci])}, RTT {fmtMetric("rtt", crater.rtt[ci])}, loss {fmtMetric("loss", crater.loss[ci] * 100)}</span>
        </span>,
      ]);
    }
    if (run) {
      rows.push(["Outbound pass", outT !== null ? fmtClock(outT) : "Not reached"]);
      rows.push(["Return pass", backT !== null ? fmtClock(backT) : "Not on the return leg"]);
    }
  }
  const hoverZoneName = hover ? variant.zones.find((z) => z.kind !== "no_radio" && z.kind !== "coverage" && z.kind !== "end"
    && hover.km >= z.from_km && hover.km <= z.to_km && z.to_km > z.from_km)?.name : undefined;

  const segs = sc.segments;
  const aria = `${meta.title} of Radio, Starlink and 4G along the route, 0 to ${fmtKm(kmMax)}, for the ${variantName} variant. Bands mark where each link meets the video limits, is up but outside them, or is down.`;

  return (
    <div ref={wrapRef} className={s.routeChart} data-chart="route">
      {width > 0 && (
        <svg ref={svgRef} width={W} height={H} role="img" aria-label={aria} className={s.svg}
          onPointerMove={onMove} onPointerLeave={onLeave} onClick={onClick}
          style={{ cursor: hover && outT !== null ? "pointer" : "default" }}>
          {/* plot sheet */}
          <rect x={plotX0} y={sheetTop} width={plotX1 - plotX0} height={sheetBottom - sheetTop} style={{ fill: "var(--color-surface-2)" }} />
          {/* zone washes (spans), full height so each zone reads as a column */}
          {variant.zones.filter((z) => z.to_km > z.from_km && (SPAN_KINDS.has(zoneKey(z.kind)) || hoverZone === zoneKey(z.kind)) && z.kind !== "jamming_ramp").map((z) => {
            const on = hoverZone === zoneKey(z.kind);
            const x0 = x(z.from_km);
            const w = Math.max(2, x(z.to_km) - x0);
            return (
              <g key={z.name}>
                <rect x={x0} y={0} width={w} height={sheetBottom}
                  style={{ fill: on ? "var(--color-grid-strong)" : "var(--color-zone-wash)", opacity: on ? 0.55 : 1 }} />
                {on && <>
                  <line x1={x0} x2={x0} y1={0} y2={sheetBottom} style={{ stroke: "var(--color-text-2)", strokeWidth: 1 }} />
                  <line x1={x0 + w} x2={x0 + w} y1={0} y2={sheetBottom} style={{ stroke: "var(--color-text-2)", strokeWidth: 1 }} />
                </>}
              </g>
            );
          })}
          {/* km gridlines */}
          {kmTicks.map((k) => (
            <line key={k} x1={x(k)} x2={x(k)} y1={sheetTop} y2={sheetBottom} style={{ stroke: "var(--color-grid)", strokeWidth: "var(--stroke-hair)" }} />
          ))}

          {/* zone labels */}
          {placed.map((p) => {
            const z = p.zone;
            const ly = p.row * LABEL_ROW + 12;
            const point = z.to_km <= z.from_km;
            const on = hoverZone === zoneKey(z.kind);
            const px = x(z.from_km);
            return (
              <g key={`l-${z.name}`}>
                {point && (
                  <line x1={px} x2={px} y1={ly + 4} y2={sheetTop} style={{ stroke: on ? "var(--color-text-1)" : "var(--color-text-3)", strokeWidth: 1 }} />
                )}
                {point && <PointGlyph kind={z.kind} x={px} y={ly - 4} on={on} />}
                <text x={p.x} y={ly} textAnchor={p.anchor}
                  style={{ fontSize: "var(--fs-12)", fill: on ? "var(--color-text-1)" : "var(--color-text-2)", fontWeight: on ? 600 : 400 }}>
                  {p.text}
                </text>
              </g>
            );
          })}
          {/* Jamming ramp as a wedge at the top of the contested zone */}
          {variant.zones.filter((z) => z.kind === "jamming_ramp").map((z) => {
            const a = x(z.from_km);
            const b = x(z.to_km);
            const top = sheetTop + 2;
            return (
              <g key="ramp" pointerEvents="none">
                <path d={`M${a},${top + 6}L${b},${top}L${b},${top + 6}Z`} style={{ fill: "var(--color-text-3)", opacity: 0.45 }} />
              </g>
            );
          })}

          {/* lanes */}
          <Lane label="Outbound" y={lanesTop + LANE_H / 2 + 2} from={0} to={Math.max(...segs.filter((g) => g.dir !== "back").map((g) => g.to_km))}
            x={(d) => x(d)} gutter={gutter} dir={1}
            segs={segs.filter((g) => g.dir === "out" || (g.dir === "state" && g.to_km > g.from_km))}
            points={variant.zones.filter((z) => z.kind === "event" || z.kind === "site")} />
          <Lane label="Return" y={lanesTop + LANE_H * 1.5 + 4} from={Math.max(...segs.map((g) => g.to_km))}
            to={variant.zones.find((z) => z.kind === "end")?.from_km ?? Math.min(...segs.filter((g) => g.dir === "back").map((g) => g.from_km))}
            x={(d) => x(d)} gutter={gutter} dir={-1}
            segs={segs.filter((g) => g.dir === "back")} points={variant.zones.filter((z) => z.kind === "end")} />

          {/* link tracks */}
          {LINK_ORDER.map((ln, li) => {
            const top = tracksTop + li * trackBlock;
            const p = variant.profile[ln];
            const noSig = metric === "sig" && (!p || p.sig.every((v) => v === null));
            const refs = metricRefs(sc, metric, ln, rule);
            const lineColor = linkVar(ln, "edge");
            return (
              <g key={ln} transform={`translate(0,${top})`}>
                {/* gutter label */}
                <text x={gutter - 12} y={14} textAnchor="end"
                  style={{ fontFamily: "var(--font-display)", fontSize: "var(--fs-15)", fontWeight: 600, fill: linkVar(ln, "text") }}>{linkLabel(ln)}</text>
                <text x={gutter - 12} y={30} textAnchor="end" style={TICK}>{noSig ? "" : `${meta.label} (${meta.unit})`}</text>
                {/* y ticks (min, max) */}
                {!noSig && [yTicks[1], yTicks[0]].map((v, k) => (
                  <text key={k} x={plotX0 + 4} y={y(v) + (k === 0 ? 10 : -3)} style={{ ...TICK, fontSize: "var(--fs-12)" }}>{fmtTick(metric, v)}</text>
                ))}
                <line x1={plotX0} x2={plotX1} y1={y(yTicks[0])} y2={y(yTicks[0])} style={{ stroke: "var(--color-grid-strong)", strokeWidth: 1 }} />
                {/* reference lines */}
                {!noSig && refs.map((r) => {
                  if (r.value < y.domain()[0] || r.value > y.domain()[1]) return null;
                  const ry = y(r.value);
                  return (
                    <g key={r.label} pointerEvents="none">
                      <line x1={plotX0} x2={plotX1} y1={ry} y2={ry} style={{ stroke: "var(--color-text-2)" }} strokeWidth={1} strokeDasharray="4 3" />
                      <text x={plotX1 - 4} y={ry - 4} textAnchor="end" style={{ fontSize: "var(--fs-12)", fill: "var(--color-text-2)" }}>
                        {r.label}{r.assumed ? " (A)" : ""}
                      </text>
                    </g>
                  );
                })}
                {noSig ? (
                  <text x={plotX0 + 8} y={trackH / 2 + 4} style={{ fontSize: "var(--fs-13)", fill: "var(--color-text-3)" }}>
                    {p && !p.up.some(Boolean) ? `No ${linkLabel(ln)} on this variant.` : `${linkLabel(ln)} reports no signal strength.`}
                  </text>
                ) : (
                  <>
                    {paths[ln]?.down && <path d={paths[ln]!.down} fill="none" style={{ stroke: lineColor, strokeWidth: "var(--stroke-data)", opacity: 0.7 }} strokeDasharray="2 3" />}
                    <path d={paths[ln]?.up ?? ""} fill="none" style={{ stroke: lineColor, strokeWidth: "var(--stroke-bold)" }} strokeLinejoin="round" />
                  </>
                )}
                {ln === "starlink" && craterPath && (
                  <g pointerEvents="none">
                    <path d={craterPath} fill="none" style={{ stroke: lineColor, strokeWidth: "var(--stroke-bold)" }} strokeDasharray="5 3" />
                    {craterVal !== null && craterZone && (
                      <text x={x(craterZone.from_km) - 4} y={Math.min(trackH - 6, y(craterVal) + (metric === "cap" ? -5 : 13))} textAnchor="end"
                        style={{ fontSize: "var(--fs-12)", fill: "var(--color-text-2)" }}>
                        In the crater {fmtMetric(metric, craterVal)}
                      </text>
                    )}
                  </g>
                )}
                {ln === "starlink" && (() => {
                  const z = variant.zones.find((q) => q.kind === "trigger");
                  if (!z) return null;
                  const tx = x(z.from_km);
                  return (
                    <g pointerEvents="none">
                      <line x1={tx} x2={tx} y1={0} y2={trackH + BAND_H} style={{ stroke: "var(--color-text-1)" }} strokeWidth={1} strokeDasharray="3 3" />
                    </g>
                  );
                })()}
                {/* state band */}
                <g transform={`translate(0,${trackH})`}>
                  {(spans[ln] ?? []).map((sp, k) => {
                    const bx = x(sp.from);
                    const bw = Math.max(1, x(sp.to) - bx);
                    if (sp.state === "down") {
                      return <rect key={k} x={bx} y={0} width={bw} height={BAND_H} fill={`url(#${PATTERN_IDS.neutral})`} />;
                    }
                    return (
                      <rect key={k} x={bx} y={0} width={bw} height={BAND_H}
                        style={{
                          fill: linkVar(ln),
                          opacity: sp.state === "degraded" ? "var(--link-degraded-alpha)" : 1,
                          stroke: ln === "lte" ? "var(--color-link-lte-edge)" : "none",
                          strokeWidth: ln === "lte" ? 1 : 0,
                        }} />
                    );
                  })}
                </g>
              </g>
            );
          })}

          {/* km axis */}
          <g transform={`translate(0,${sheetBottom})`}>
            {kmTicks.map((k) => (
              <g key={k} transform={`translate(${x(k)},0)`}>
                <line y1={0} y2={4} style={{ stroke: "var(--color-border-strong)", strokeWidth: 1 }} />
                <text y={17} textAnchor="middle" style={TICK}>{k.toFixed(1)}</text>
              </g>
            ))}
            <text x={gutter - 12} y={17} textAnchor="end" style={{ fontSize: "var(--fs-13)", fill: "var(--color-text-2)" }}>Position (km)</text>
          </g>

          {/* crosshair */}
          {hover && (
            <g pointerEvents="none">
              <line x1={x(hover.km)} x2={x(hover.km)} y1={sheetTop} y2={sheetBottom} style={{ stroke: "var(--color-cursor)", strokeWidth: 1 }} />
              {LINK_ORDER.map((ln, li) => {
                const p = variant.profile[ln];
                if (!p) return null;
                const i = kmIndex(sc, hover.km);
                const v = metricValue(p, metric, i);
                if (v === null || (!p.up[i] && metric !== "sig")) return null;
                const cy = tracksTop + li * trackBlock + y(Math.max(y.domain()[0], Math.min(y.domain()[1], v)));
                return <circle key={ln} cx={x(hover.km)} cy={cy} r={3.5} style={{ fill: "var(--color-surface-2)", stroke: linkVar(ln, "edge"), strokeWidth: 2 }} />;
              })}
            </g>
          )}
        </svg>
      )}
      <TooltipBox x={hover?.cx ?? 0} y={hover?.cy ?? 0} open={!!hover}>
        <Readout title={`${fmtKm(hover?.km)}${hoverZoneName ? `, ${hoverZoneName}` : ""}`} rows={rows} />
        {run && outT !== null && <div className={s.tipHint}>Click to show the outbound pass in Replay (seed {seed})</div>}
      </TooltipBox>
    </div>
  );
}

function fmtMbps(kbps: number): string {
  return `${(kbps / 1000).toFixed(1)} Mbps`;
}

function fmtTick(m: Metric, v: number): string {
  if (m === "cap") return `${Math.round(v)} Mbps`;
  if (m === "rtt") return `${Math.round(v)} ms`;
  if (m === "loss") return `${Math.round(v)}%`;
  return fmtMetric("sig", v);
}

function PointGlyph({ kind, x, y, on }: { kind: Zone["kind"]; x: number; y: number; on: boolean }) {
  const c = on ? "var(--color-text-1)" : "var(--color-text-2)";
  if (kind === "tower") return <path d={`M${x},${y - 5}L${x + 4.5},${y + 3}L${x - 4.5},${y + 3}Z`} style={{ fill: c }} />;
  if (kind === "trigger") return <path d={`M${x - 4},${y - 4}L${x + 4},${y + 4}M${x + 4},${y - 4}L${x - 4},${y + 4}`} style={{ stroke: c, strokeWidth: 1.75 }} />;
  return <path d={`M${x},${y - 4.5}L${x + 4.5},${y}L${x},${y + 4.5}L${x - 4.5},${y}Z`} style={{ fill: c }} />;
}

interface LaneProps {
  label: string;
  y: number;
  from: number;
  to: number;
  dir: 1 | -1;
  x: (d: number) => number;
  gutter: number;
  segs: Scenario["segments"];
  points: Zone[];
}

/** One leg of the route: a 2px line with segment ticks and names, a chevron at its end. */
function Lane({ label, y, from, to, dir, x, gutter, segs, points }: LaneProps) {
  const a = x(Math.min(from, to));
  const b = x(Math.max(from, to));
  const end = x(to);
  return (
    <g>
      <text x={gutter - 12} y={y + 4} textAnchor="end" style={{ fontFamily: "var(--font-display)", fontSize: "var(--fs-13)", fontWeight: 500, fill: "var(--color-text-2)" }}>{label}</text>
      <line x1={a} x2={b} y1={y} y2={y} style={{ stroke: "var(--color-text-3)", strokeWidth: 2 }} />
      <path d={dir > 0 ? `M${end - 6},${y - 5}L${end},${y}L${end - 6},${y + 5}` : `M${end + 6},${y - 5}L${end},${y}L${end + 6},${y + 5}`}
        fill="none" style={{ stroke: "var(--color-text-2)", strokeWidth: 2 }} />
      {segs.map((g) => {
        const s0 = x(g.from_km);
        const s1 = x(g.to_km);
        const label = segmentLabel(g.name);
        const fits = s1 - s0 > label.length * 6.1 + 8;
        return (
          <g key={g.name}>
            <line x1={s0} x2={s0} y1={y - 4} y2={y + 4} style={{ stroke: "var(--color-text-3)", strokeWidth: 1 }} />
            <line x1={s1} x2={s1} y1={y - 4} y2={y + 4} style={{ stroke: "var(--color-text-3)", strokeWidth: 1 }} />
            {fits && (
              <text x={(s0 + s1) / 2} y={y - 5} textAnchor="middle" style={{ fontSize: "var(--fs-12)", fill: "var(--color-text-3)" }}>
                <title>Scoring segment: {g.name}{g.note ? ` (${g.note})` : ""}</title>{label}
              </text>
            )}
          </g>
        );
      })}
      {points.map((z) => (
        <g key={z.name}>
          {z.kind === "end"
            ? <rect x={x(z.from_km) - 1.5} y={y - 6} width={3} height={12} style={{ fill: "var(--color-text-1)" }} />
            : <path d={`M${x(z.from_km)},${y - 4.5}L${x(z.from_km) + 4.5},${y}L${x(z.from_km)},${y + 4.5}L${x(z.from_km) - 4.5},${y}Z`} style={{ fill: "var(--color-text-1)" }} />}
          {z.kind === "end" && (
            <text x={x(z.from_km) - 8} y={y + 4} textAnchor="end" style={{ fontSize: "var(--fs-12)", fill: "var(--color-text-2)" }}>{z.name}</text>
          )}
        </g>
      ))}
    </g>
  );
}
