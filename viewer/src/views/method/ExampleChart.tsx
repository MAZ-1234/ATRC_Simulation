/**
 * The worked-example chart: one real stretch of the demo run on a shared time axis.
 *   1. Proposed's logged time-until-unusable for the example link and camera, against
 *      the graded thresholds m, 2m, 3m (m rebuilt from the logged throttle).
 *   2. The link's signal as the controller measured it and as it truly was, with the
 *      link's signal_unusable limit from the config.
 *   3. Which link each controller sent the camera on (two bands = duplicated).
 *   4. Whether each controller's view was usable (the simulator's own verdict).
 * Numbered chips mark the events listed under the chart.
 */
import { useMemo } from "react";
import { scaleLinear } from "d3-scale";
import { ChartFrame, Legend, linkVar, useMeasure, type LegendItem } from "../../components";
import {
  bisectRight, decisionIndexAt, fmtClock, fmtClockShort, fmtDbm, fmtNum, linkLabel, linksOf, stepValueAt,
} from "../../data/loader";
import type { LinkName, RunData } from "../../data/types";
import type { Breakpoint } from "../../state";
import type { DeciderParams } from "./params";
import { marginAt, type WorkedExample } from "./example";
import s from "./Method.module.css";

interface Props {
  run: RunData;
  base: RunData | null;
  ex: WorkedExample;
  speed: Float64Array;
  params: DeciderParams;
  bp: Breakpoint;
  hovered: number | null;
}

const GUTTER: Record<Breakpoint, number> = { wide: 168, compact: 136, narrow: 96 };

// Track geometry (inner coordinates, px).
const TTU = { y: 0, h: 112 };
const SIG = { y: 134, h: 84 };
const LNK = { y: 252, row: 14, gap: 6 };
const USE = { y: 316, row: 14, gap: 6 };
const INNER_H = USE.y + 2 * USE.row + USE.gap;
const CHIP = 18;
const CHIP_GAP = 4;

interface Run<T> { from: number; to: number; v: T }

/** Group consecutive equal values into runs over a time column. */
function runsOf<T>(t: number[], i0: number, i1: number, val: (i: number) => T, dt: number, eq: (a: T, b: T) => boolean = (a, b) => a === b): Run<T>[] {
  const out: Run<T>[] = [];
  for (let i = i0; i <= i1; i++) {
    const v = val(i);
    const last = out[out.length - 1];
    if (last && eq(last.v, v)) last.to = t[i] + dt;
    else out.push({ from: t[i], to: t[i] + dt, v });
  }
  return out;
}

export function ExampleChart({ run, base, ex, speed, params, bp, hovered }: Props) {
  const [wrapRef, { width }] = useMeasure<HTMLDivElement>();
  const gutter = GUTTER[bp];
  const right = bp === "narrow" ? 60 : 64;
  const [t0, t1] = ex.window;
  const L = linkLabel(ex.link);

  const series = useMemo(() => {
    const C = run.decisions.cols;
    const i0 = decisionIndexAt(run, t0);
    const i1 = decisionIndexAt(run, t1);
    const ttuS = run.decisions.ttu[`${ex.link}:${ex.cam}`];
    const ttu: (number | null)[] = [];
    const m: number[] = [];
    for (let i = i0; i <= i1; i++) {
      ttu.push(stepValueAt(ttuS, i));
      m.push(marginAt(params, speed[i]));
    }
    const sigM = run.decisions.measured[ex.link].sig;
    const S = run.samples;
    const k0 = Math.max(0, bisectRight(S.t, t0));
    const k1 = Math.max(k0, bisectRight(S.t, t1));
    const sigT = run.truth[ex.link].sig;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = i0; i <= i1; i++) { const v = sigM?.[i]; if (v !== null && v !== undefined) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
    for (let k = k0; k <= k1; k++) { const v = sigT?.[k]; if (v !== null && v !== undefined) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
    if (ex.signalUnusable !== null) { lo = Math.min(lo, ex.signalUnusable); hi = Math.max(hi, ex.signalUnusable); }
    const hasSig = Number.isFinite(lo) && !!sigM;
    const camLinks = (r: RunData) => {
      const col = r.decisions.cols[`${ex.cam}_links`];
      const j0 = decisionIndexAt(r, t0);
      const j1 = decisionIndexAt(r, t1);
      return runsOf(r.decisions.cols.t, j0, j1, (i) => col[i], 0.1);
    };
    const usable = (r: RunData) => {
      const RS = r.samples;
      const j0 = Math.max(0, bisectRight(RS.t, t0));
      const j1 = Math.max(j0, bisectRight(RS.t, t1));
      return runsOf(RS.t, j0, j1, (k) => RS.useful[k], 0.1);
    };
    const mMax = Math.max(...m);
    return {
      i0, i1, ttu, m, mMax, C, sigM, sigT, k0, k1,
      sigDomain: hasSig ? [Math.floor(lo - 2), Math.ceil(hi + 2)] as [number, number] : null,
      pLinks: camLinks(run), bLinks: base ? camLinks(base) : null,
      pUse: usable(run), bUse: base ? usable(base) : null,
    };
  }, [run, base, ex, speed, params, t0, t1]);

  // Chip rows: stagger chips that would overlap.
  const innerW = Math.max(0, width - gutter - right);
  const x = useMemo(() => scaleLinear().domain([t0, t1]).range([0, innerW]), [t0, t1, innerW]);
  const chips = useMemo(() => {
    const lastX: number[] = [];
    return ex.events.map((e) => {
      const cx = x(e.t);
      let row = 0;
      while (lastX[row] !== undefined && cx - lastX[row] < CHIP + CHIP_GAP) row++;
      lastX[row] = cx;
      return { cx, row };
    });
  }, [ex.events, x]);
  const rows = Math.max(1, ...chips.map((c) => c.row + 1));
  const top = 10 + rows * (CHIP + CHIP_GAP);

  const yT = scaleLinear().domain([0, Math.ceil(3 * series.mMax * 1.25)]).range([TTU.h, 0]).clamp(true);
  const yS = series.sigDomain ? scaleLinear().domain(series.sigDomain).range([SIG.h, 0]) : null;

  const legend: LegendItem[] = [
    { key: "ttu", label: "Predicted time until unusable (Proposed)", mark: "line", color: "var(--color-ctrl-proposed)" },
    { key: "m", label: "Thresholds m, 2m, 3m", mark: "dashed", color: "var(--color-text-2)" },
    { key: "meas", label: "Signal as Proposed measured it", mark: "line", color: "var(--color-text-1)" },
    { key: "true", label: "True signal", mark: "line", color: linkVar(ex.link) },
    ...(["radio", "starlink", "lte"] as LinkName[]).map((l) => ({
      key: l, label: linkLabel(l), mark: "band" as const, color: linkVar(l), edge: l === "lte" ? linkVar(l, "edge") : undefined,
    })),
    { key: "lost", label: "View not usable", mark: "hatch-bad" },
  ];

  const tableRows = useMemo(() => {
    const out: (string | number)[][] = [];
    const C = run.decisions.cols;
    for (let i = series.i0; i <= series.i1; i++) {
      const j = i - series.i0;
      const v = series.ttu[j];
      const pl = linksOf(run, C[`${ex.cam}_links`][i]).map(linkLabel).join(" + ") || "None";
      const bi = base ? decisionIndexAt(base, C.t[i]) : -1;
      const bl = base ? linksOf(base, base.decisions.cols[`${ex.cam}_links`][bi]).map(linkLabel).join(" + ") || "None" : "–";
      const sig = series.sigM?.[i];
      out.push([fmtClock(C.t[i]), v === null ? "None" : fmtNum(v, 1), fmtNum(series.m[j], 2), sig === null || sig === undefined ? "–" : fmtDbm(sig), pl, bl]);
    }
    return out;
  }, [run, base, series, ex.cam]);

  const ticks = useMemo(() => {
    const span = t1 - t0;
    const step = span > 90 ? 20 : span > 45 ? 10 : 5;
    const out: number[] = [];
    for (let t = Math.ceil(t0 / step) * step; t <= t1 + 1e-6; t += step) out.push(t);
    return out;
  }, [t0, t1]);

  const camWord = ex.cam === "rear" ? "rear camera" : "front camera";
  const ttuLabel = bp === "narrow" ? ["Time until", `${L} fails (s)`] : ["Predicted time until", `${L} fails for the`, `${camWord} (s)`];
  const sigLabel = bp === "narrow" ? [`${L} signal`, "(dBm)"] : [`${L} signal (dBm)`];

  const step = (vals: (number | null)[], y: (v: number) => number) => {
    let d = "";
    let open = false;
    const C = series.C;
    for (let j = 0; j < vals.length; j++) {
      const v = vals[j];
      const xa = x(C.t[series.i0 + j]);
      const xb = x(C.t[series.i0 + j] + 0.1);
      if (v === null) { open = false; continue; }
      const yy = y(v);
      d += open ? `L${xa},${yy}L${xb},${yy}` : `M${xa},${yy}L${xb},${yy}`;
      open = true;
    }
    return d;
  };

  const linkBands = (runs: Run<number>[], r: RunData, y0: number, h: number, key: string) =>
    runs.map((g, n) => {
      const ls = linksOf(r, g.v);
      const xa = Math.max(0, x(g.from));
      const w = Math.max(0.5, Math.min(innerW, x(g.to)) - xa);
      if (ls.length === 0) return <rect key={`${key}${n}`} x={xa} y={y0} width={w} height={h} fill="url(#pat-hatch-neutral)" />;
      const hh = h / ls.length;
      return ls.map((l, q) => (
        <rect key={`${key}${n}-${q}`} x={xa} y={y0 + q * hh} width={w} height={hh}
          style={{ fill: linkVar(l), stroke: l === "lte" ? linkVar(l, "edge") : "none", strokeWidth: 1 }} />
      ));
    });

  const useBand = (runs: Run<number>[], y0: number, h: number, role: "baseline" | "proposed", key: string) =>
    runs.map((g, n) => {
      const xa = Math.max(0, x(g.from));
      const w = Math.max(0.5, Math.min(innerW, x(g.to)) - xa);
      if (g.v === 1) {
        return <rect key={`${key}${n}`} x={xa} y={y0} width={w} height={h}
          style={{ fill: `var(--color-ctrl-${role})`, stroke: role === "baseline" ? "var(--color-ctrl-baseline-edge)" : "none", strokeWidth: 1 }} />;
      }
      return (
        <g key={`${key}${n}`}>
          <rect x={xa} y={y0} width={w} height={h} style={{ fill: "var(--color-status-bad-wash)" }} />
          <rect x={xa} y={y0} width={w} height={h} fill="url(#pat-hatch-bad)" opacity={0.6} />
          <line x1={xa} x2={xa} y1={y0} y2={y0 + h} style={{ stroke: "var(--color-status-bad)", strokeWidth: 2 }} />
          <line x1={xa + w} x2={xa + w} y1={y0} y2={y0 + h} style={{ stroke: "var(--color-status-bad)", strokeWidth: 2 }} />
        </g>
      );
    });

  const gl = (lines: string[], y: number) => (
    <text x={-gutter} y={y} className={s.trackLabel}>
      {lines.map((ln, n) => <tspan key={n} x={-gutter} dy={n === 0 ? 0 : 15}>{ln}</tspan>)}
    </text>
  );
  const rowLabel = (txt: string, y: number, role: "baseline" | "proposed") => (
    <text x={-8} y={y + 11} textAnchor="end" className={s.rowLabel} style={{ fill: `var(--color-ctrl-${role}-text)` }}>{txt}</text>
  );

  const fmtS = (v: number) => `${fmtNum(v, 1)} s`;
  const lastM = series.m[series.m.length - 1];

  return (
    <div ref={wrapRef}>
      <ChartFrame
        title={`${L} fading on the way out, seed ${run.meta.seed}: what each controller saw and did`}
        ariaLabel={`Proposed predicted ${L} would fail for the ${camWord} and moved it ${ex.tFail !== null ? fmtNum(ex.tFail - ex.t, 1) + " s before" : ""} the link truly failed${ex.tBase !== null && ex.tFail !== null ? `; Baseline moved its video ${fmtNum(ex.tBase - ex.tFail, 1)} s after` : ""}.`}
        legend={<Legend items={legend} />}
        height={top + INNER_H + 30}
        margin={{ top, left: gutter, right, bottom: 30 }}
        caption={<>
          Time left is what Proposed logged at each decision ({run.meta.decide_dt} s). m is rebuilt from the logged throttle;
          values above {fmtS(yT.domain()[1])} are drawn at the top, and no line means no falling trend. Usable view is the simulator&apos;s own verdict.
        </>}
        data={{
          columns: ["Time", `Time until ${L} fails (s)`, "m (s)", `${L} signal measured`, "Proposed link", "Baseline link"],
          rows: tableRows,
          numeric: [1, 2, 3],
        }}
      >
        {() => (
          <g>
            {/* time grid */}
            {ticks.map((t) => (
              <line key={`g${t}`} x1={x(t)} x2={x(t)} y1={0} y2={INNER_H} style={{ stroke: "var(--color-grid)", strokeWidth: 1 }} />
            ))}

            {/* 1. time until unusable */}
            {gl(ttuLabel, TTU.y + 12)}
            <line x1={0} x2={innerW} y1={TTU.h} y2={TTU.h} style={{ stroke: "var(--color-grid-strong)", strokeWidth: 1 }} />
            {[1, 2, 3].map((k) => (
              <g key={`m${k}`}>
                <path d={step(series.m.map((v) => v * k), yT)} fill="none" style={{ stroke: "var(--color-text-2)" }} strokeWidth={1} strokeDasharray="4 3" />
                <text x={innerW + 6} y={yT(lastM * k) + 4} className={s.axisLabel}>{k === 1 ? "m" : `${k}m`}</text>
              </g>
            ))}
            <text x={6} y={yT(lastM * 0.5) + 4} className={s.zoneLabel}>Switch</text>
            <text x={6} y={yT(lastM * 1.5) + 4} className={s.zoneLabel}>Duplicate</text>
            <text x={6} y={yT(lastM * 2.5) + 4} className={s.zoneLabel}>Prepare</text>
            {yT.domain()[1] > lastM * 3.4 && <text x={6} y={yT((lastM * 3 + yT.domain()[1]) / 2) + 4} className={s.zoneLabel}>Normal</text>}
            <path d={step(series.ttu.map((v) => (v === null ? null : Math.min(v, yT.domain()[1]))), yT)} fill="none"
              style={{ stroke: "var(--color-ctrl-proposed)", strokeWidth: "var(--stroke-data)" }} />
            <text x={innerW + 6} y={TTU.h + 4} className={s.axisLabel}>0 s</text>

            {/* 2. signal */}
            {yS && (
              <g transform={`translate(0,${SIG.y})`}>
                {gl(sigLabel, 12)}
                {ex.signalUnusable !== null && (
                  <g>
                    <line x1={0} x2={innerW} y1={yS(ex.signalUnusable)} y2={yS(ex.signalUnusable)}
                      style={{ stroke: "var(--color-text-2)" }} strokeWidth={1} strokeDasharray="4 3" />
                    <text x={innerW + 6} y={yS(ex.signalUnusable) + 4} className={s.axisLabel}>{fmtDbm(ex.signalUnusable)}</text>
                    <text x={6} y={yS(ex.signalUnusable) + 15} className={s.zoneLabel}>Unusable below</text>
                  </g>
                )}
                <text x={innerW + 6} y={10} className={s.axisLabel}>{fmtDbm(series.sigDomain![1])}</text>
                <text x={innerW + 6} y={SIG.h} className={s.axisLabel}>{fmtDbm(series.sigDomain![0])}</text>
                {series.sigT && (
                  <path d={(() => {
                    let d = "";
                    let open = false;
                    const ST = run.samples.t;
                    for (let k = series.k0; k <= series.k1; k++) {
                      const v = series.sigT![k];
                      if (v === null) { open = false; continue; }
                      d += `${open ? "L" : "M"}${x(ST[k])},${yS(v)}`;
                      open = true;
                    }
                    return d;
                  })()} fill="none" style={{ stroke: linkVar(ex.link), strokeWidth: "var(--stroke-data)" }} />
                )}
                <path d={step(series.ttu.map((_, j) => series.sigM?.[series.i0 + j] ?? null), yS)} fill="none"
                  style={{ stroke: "var(--color-text-1)", strokeWidth: "var(--stroke-hair)", opacity: 0.8 }} />
              </g>
            )}

            {/* 3. camera link */}
            <text x={-gutter} y={LNK.y - 8} className={s.groupLabel}>{ex.cam === "rear" ? "Rear camera link" : "Front camera link"}</text>
            {rowLabel("Proposed", LNK.y, "proposed")}
            {linkBands(series.pLinks, run, LNK.y, LNK.row, "pl")}
            {series.bLinks && base && rowLabel("Baseline", LNK.y + LNK.row + LNK.gap, "baseline")}
            {series.bLinks && base && linkBands(series.bLinks, base, LNK.y + LNK.row + LNK.gap, LNK.row, "bl")}

            {/* 4. usable view */}
            <text x={-gutter} y={USE.y - 8} className={s.groupLabel}>Usable view</text>
            {rowLabel("Proposed", USE.y, "proposed")}
            {useBand(series.pUse, USE.y, USE.row, "proposed", "pu")}
            {series.bUse && rowLabel("Baseline", USE.y + USE.row + USE.gap, "baseline")}
            {series.bUse && useBand(series.bUse, USE.y + USE.row + USE.gap, USE.row, "baseline", "bu")}

            {/* time axis */}
            {ticks.map((t) => (
              <text key={`t${t}`} x={x(t)} y={INNER_H + 18} textAnchor="middle" className={s.axisLabel}>{fmtClockShort(t)}</text>
            ))}

            {/* event lines and chips */}
            {ex.events.map((e, n) => {
              const c = chips[n];
              const hot = hovered === n;
              const isTruth = e.actor === "truth";
              const stroke = isTruth ? "var(--color-text-1)" : hot ? "var(--color-text-1)" : "var(--color-text-3)";
              const cy = -(c.row + 1) * (CHIP + CHIP_GAP);
              const fill = e.actor === "proposed" ? "var(--color-ctrl-proposed)" : e.actor === "baseline" ? "var(--color-ctrl-baseline-edge)" : "var(--color-text-1)";
              return (
                <g key={`e${n}`}>
                  <line x1={c.cx} x2={c.cx} y1={cy + CHIP} y2={INNER_H}
                    style={{ stroke, strokeWidth: hot || isTruth ? 2 : 1 }} strokeDasharray={isTruth ? "5 3" : undefined} />
                  <rect x={c.cx - CHIP / 2} y={cy} width={CHIP} height={CHIP} rx={2}
                    style={{ fill: hot ? "var(--color-text-1)" : fill }} />
                  <text x={c.cx} y={cy + 13} textAnchor="middle" className={s.chipText}>{n + 1}</text>
                </g>
              );
            })}
          </g>
        )}
      </ChartFrame>
    </div>
  );
}
