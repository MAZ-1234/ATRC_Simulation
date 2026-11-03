/**
 * Every deployable configuration against Proposed on every scanned metric (DESIGN.md
 * 6.2.1: "Add any further row where an ablation beats Proposed ... computed, not
 * hard-coded"). Rows are metrics, columns are configurations. A cell is marked only
 * where the other configuration's mean is better than Proposed's:
 *   filled square  = better mean and the two 95% intervals do not overlap;
 *   hollow square  = better mean, intervals overlap;
 *   short rule     = Proposed's mean is as good or better.
 * Marks are drawn in --color-ctrl-other (configuration ink), never in status colours:
 * red is reserved for "the operator cannot see" (DESIGN.md 2.4).
 */
import { useMemo, useRef, useState } from "react";
import { ChartFrame, Readout, TooltipBox, useResizeObserver } from "../../components";
import { useStore } from "../../state";
import { configLabel, ctrlRole, fmtCI } from "../../data/loader";
import { SCAN, def, fpair, rivalsIn, scanLosses, type Loss, type Outcome } from "./data";
import { rootPx, wrap } from "./measure";
import s from "./Results.module.css";

const OUTCOME_TEXT: Record<Outcome, string> = {
  clear: "Better mean, intervals apart",
  overlap: "Better mean, intervals overlap",
  none: "Proposed as good or better",
  missing: "No value",
};

export function MatrixLegend() {
  return (
    <div className={s.mLegend} role="list" aria-label="Legend">
      <span role="listitem"><svg width="12" height="12" aria-hidden><rect x="1" y="1" width="10" height="10" className={s.mClear} /></svg>Better mean than Proposed, 95% intervals do not overlap</span>
      <span role="listitem"><svg width="12" height="12" aria-hidden><rect x="1.75" y="1.75" width="8.5" height="8.5" className={s.mOverlap} /></svg>Better mean, intervals overlap</span>
      <span role="listitem"><svg width="12" height="12" aria-hidden><line x1="2" x2="10" y1="6" y2="6" className={s.mNone} /></svg>Proposed as good or better</span>
    </div>
  );
}

export function LossMatrix({ variant, title, ariaLabel, caption }: { variant: string; title: string; ariaLabel: string; caption: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const { width } = useResizeObserver(wrapRef);
  const presenter = useStore((st) => st.presenter);
  const [hover, setHover] = useState<{ r: number; c: number; x: number; y: number } | null>(null);
  const configs = useMemo(() => rivalsIn(variant), [variant]);
  const scan = useMemo(() => scanLosses(variant), [variant]);
  const cell = (cfg: string, metric: string): Loss | undefined => scan.cells.find((x) => x.config === cfg && x.metric === metric);

  const R = rootPx();
  const fs12 = R * 0.8, fs13 = R * 0.8667;
  const narrow = width < 600;
  const labelW = narrow ? 120 : 200;
  const colW = Math.max(40, Math.max(0, width - labelW) / Math.max(1, configs.length));
  const lh12 = Math.round(fs12 * 1.25);
  const lh13 = Math.round(fs13 * 1.2);
  const heads = useMemo(() => configs.map((cfg) => wrap(cfg, colW - 12, fs12, 500, narrow ? 4 : 3)), [configs, colW, fs12, narrow, presenter]); // eslint-disable-line
  const labels = useMemo(() => SCAN.map((m) => wrap(m.short, labelW - 12, fs13, 400, 2)), [labelW, fs13]);
  const headH = Math.max(1, ...heads.map((h) => h.lines.length)) * lh12 + 12;
  const rowH = Math.max(30, Math.max(...labels.map((l) => l.lines.length)) * lh13 + 10);
  const height = headH + SCAN.length * rowH + 2;
  const k = presenter ? 1.2 : 1;

  const table = useMemo(() => ({
    columns: ["Configuration", "Metric", "Configuration value", "Proposed value", "95% intervals"],
    numeric: [2, 3],
    rows: scan.losses.map((l) => {
      const d = def(l.metric);
      const [a, p] = fpair(l.metric, l.other.mean, l.proposed.mean);
      return [configLabel(l.config), d.title, `${a} (${fmtCI(l.other.lo, l.other.hi, d.dp)})`,
        `${p} (${fmtCI(l.proposed.lo, l.proposed.hi, d.dp)})`, l.outcome === "clear" ? "Do not overlap" : "Overlap"];
    }),
  }), [scan]);

  const hl = hover ? cell(configs[hover.c], SCAN[hover.r].key) : undefined;
  const nP = cell(configs[0] ?? "", "useful_view_pct")?.proposed.n ?? null;
  const n = Math.min(...configs.map((cfg) => cell(cfg, "useful_view_pct")?.other.n ?? Infinity), nP ?? Infinity);
  const hd = hl ? def(hl.metric) : null;
  const hp = hl ? fpair(hl.metric, hl.other.mean, hl.proposed.mean) : null;

  return (
    <div ref={wrapRef}>
      <ChartFrame title={title} ariaLabel={ariaLabel} legend={<MatrixLegend />} caption={caption} height={height}
        margin={{ top: 0, right: 0, bottom: 0, left: 0 }} data={table} n={Number.isFinite(n) ? n : null}>
        {() => (
          <g style={{ fontFamily: "var(--font-ui)" }} onPointerLeave={() => setHover(null)}>
            {heads.map((h, ci) => {
              const x = labelW + ci * colW + colW / 2;
              const top = headH - 9 - (h.lines.length - 1) * lh12;
              const role = ctrlRole(configs[ci]);
              return (
                <text key={ci} x={x} y={top} textAnchor="middle"
                  style={{ fontSize: "var(--fs-12)", fontWeight: 500, fill: role === "baseline" ? "var(--color-ctrl-baseline-text)" : "var(--color-text-1)" }}>
                  {h.truncated && <title>{configs[ci]}</title>}
                  {h.lines.map((ln, i) => <tspan key={i} x={x} dy={i === 0 ? 0 : lh12}>{ln}</tspan>)}
                </text>
              );
            })}
            {SCAN.map((m, ri) => {
              const y = headH + ri * rowH;
              const cy = y + rowH / 2;
              const lab = labels[ri];
              return (
                <g key={m.key}>
                  <line x1={0} x2={width} y1={y} y2={y} style={{ stroke: "var(--color-grid)", strokeWidth: "var(--stroke-hair)" }} />
                  <text x={0} y={cy + 4.5 - ((lab.lines.length - 1) * lh13) / 2} style={{ fontSize: "var(--fs-13)", fill: "var(--color-text-1)" }}>
                    {lab.truncated && <title>{m.short}</title>}
                    {lab.lines.map((ln, i) => <tspan key={i} x={0} dy={i === 0 ? 0 : lh13}>{ln}</tspan>)}
                  </text>
                  {configs.map((cfg, ci) => {
                    const l = cell(cfg, m.key);
                    const cx = labelW + ci * colW + colW / 2;
                    const on = hover?.r === ri && hover.c === ci;
                    const sz = 10 * k;
                    return (
                      <g key={cfg}>
                        {on && <rect x={labelW + ci * colW} y={y} width={colW} height={rowH} style={{ fill: "var(--color-hover-overlay)" }} />}
                        {l?.outcome === "clear" && <rect x={cx - sz / 2} y={cy - sz / 2} width={sz} height={sz} className={s.mClear} />}
                        {l?.outcome === "overlap" && <rect x={cx - sz / 2 + 0.75} y={cy - sz / 2 + 0.75} width={sz - 1.5} height={sz - 1.5} className={s.mOverlap} />}
                        {l?.outcome === "none" && <line x1={cx - 4} x2={cx + 4} y1={cy} y2={cy} className={s.mNone} />}
                        {(!l || l.outcome === "missing") && <text x={cx} y={cy + 4} textAnchor="middle" style={{ fontSize: "var(--fs-12)", fill: "var(--color-text-3)" }}>–</text>}
                        <rect x={labelW + ci * colW} y={y} width={colW} height={rowH} fill="transparent"
                          onPointerMove={(e) => setHover({ r: ri, c: ci, x: e.clientX, y: e.clientY })} />
                      </g>
                    );
                  })}
                </g>
              );
            })}
            <line x1={0} x2={width} y1={headH + SCAN.length * rowH} y2={headH + SCAN.length * rowH} style={{ stroke: "var(--color-grid)", strokeWidth: "var(--stroke-hair)" }} />
          </g>
        )}
      </ChartFrame>
      {hover && hl && hd && hp && (
        <TooltipBox x={hover.x} y={hover.y} open>
          <Readout title={<>{configLabel(hl.config)}<br /><span style={{ fontWeight: 400, color: "var(--color-text-2)" }}>{hd.title}</span></>} rows={[
            [hl.config, hp[0]],
            ["95% CI", fmtCI(hl.other.lo, hl.other.hi, hd.dp)],
            ["Proposed", hp[1]],
            ["95% CI", fmtCI(hl.proposed.lo, hl.proposed.hi, hd.dp)],
            ["Seeds", `${hl.other.n ?? "–"}, ${hl.proposed.n ?? "–"}`],
            ["Reading", OUTCOME_TEXT[hl.outcome]],
          ]} />
        </TooltipBox>
      )}
    </div>
  );
}
