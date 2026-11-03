/**
 * Link health row (DESIGN.md 7): link name in its text colour plus swatch; a 30 s truth
 * band (DESIGN.md 2.3 state encoding, height = true capacity); the measured capacity line
 * on top (2px text-1 at 80%); the current measured value right-aligned; a text-3 line with
 * the measured RTT and loss. Starlink adds "Handover in 3.2 s" from 5 s before each
 * scheduled handover (schedule read from scenario.js).
 *
 * Truth comes from the right (Proposed) run's `truth`, measured values from its
 * `decisions.measured` (its own link monitor). The tooltip adds the left run's monitor.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { Tooltip, prepareCanvas, useMeasure, useTokens, withAlpha, linkVar, type Tokens } from "../../../components";
import {
  decisionIndexAt, sampleIndexAt, fmtClock, fmtFrac, fmtMbps, fmtMs, fmtSec, fmtDbm, linkLabel,
} from "../../../data/loader";
import { useStore } from "../../../state";
import type { LinkName, RunData, Scenario } from "../../../data/types";
import { DEGRADED, DOWN, GOOD, UNKNOWN, type RunTruth } from "./linkTruth";
import s from "./TruthSpine.module.css";

/** Length of the truth band window, s (DESIGN.md 7: "30-s truth band"). */
export const BAND_S = 30;
/** Handover countdown shows from this many seconds before (DESIGN.md 7). */
const HANDOVER_LEAD_S = 5;

/** Seconds until the next scheduled Starlink handover after t (null without a schedule). */
export function nextHandoverIn(t: number, scenario: Scenario | null): number | null {
  const ho = scenario?.starlink_handover;
  if (!ho || !ho.offsets_s.length || ho.period_s <= 0) return null;
  const base = Math.floor(t / ho.period_s) * ho.period_s;
  let best = Infinity;
  for (const c of [base, base + ho.period_s]) {
    for (const o of ho.offsets_s) {
      const at = c + o;
      if (at > t + 1e-6 && at - t < best) best = at - t;
    }
  }
  return Number.isFinite(best) ? best : null;
}

interface Props {
  link: LinkName;
  t: number;
  right: RunData;
  left: RunData;
  rightName: string;
  leftName: string;
  truth: RunTruth;
  scenario: Scenario | null;
}

export function LinkRow({ link, t, right, left, rightName, leftName, truth, scenario }: Props) {
  const k = sampleIndexAt(right, t);
  const di = decisionIndexAt(right, t);
  const st = truth.state[link][k];
  const tr = right.truth[link];
  const m = right.decisions.measured[link];
  const alive = m.alive[di] === 1;

  const ho = link === "starlink" ? nextHandoverIn(t, scenario) : null;
  const showHo = ho !== null && ho <= HANDOVER_LEAD_S && st !== UNKNOWN;

  let value: ReactNode;
  let valueText: string;
  let sub: string;
  if (st === UNKNOWN) {
    value = <span className={s.valueQuiet}>None</span>;
    valueText = "None";
    sub = "Not in variant";
  } else if (st === DOWN) {
    value = <span className={s.valueDown}><span className={s.hatchSwatch} aria-hidden />Down</span>;
    valueText = "Down";
    // The monitor can lag the truth: say so instead of hiding it.
    sub = alive ? "Not noticed yet" : "No echo";
  } else {
    value = alive
      ? <span className={st === DEGRADED ? s.valueDegraded : s.valueGood}>{fmtMbps(m.cap[di])}</span>
      : <span className={s.valueQuiet}>No echo</span>;
    valueText = alive ? `measured ${fmtMbps(m.cap[di])}` : "No echo";
    sub = alive ? `${fmtMs(m.rtt[di])}, ${fmtFrac(m.loss[di])} loss` : "Not measured";
  }

  // ---- tooltip readout (max 8 rows, DESIGN.md 7)
  const lim = right.meta.limits.video;
  const reasons: string[] = [];
  if (st === DEGRADED) {
    if (tr.loss[k] > lim.max_loss) reasons.push(`loss ${fmtFrac(tr.loss[k])} over ${fmtFrac(lim.max_loss)}`);
    if (tr.rtt[k] > lim.max_rtt_ms) reasons.push(`RTT ${fmtMs(tr.rtt[k])} over ${fmtMs(lim.max_rtt_ms)}`);
  }
  const stateWord = st === UNKNOWN ? "Not in this variant" : st === DOWN ? "Down" : st === GOOD ? "Good" : `Degraded: ${reasons.join(", ")}`;
  const dl = decisionIndexAt(left, t);
  const trio = (cap: number, rtt: number, loss: number) => `${fmtMbps(cap)}, ${fmtMs(rtt)}, ${fmtFrac(loss)}`;
  const mon = (run: RunData, d: number) => {
    const mm = run.decisions.measured[link];
    return mm.alive[d] === 1 ? trio(mm.cap[d], mm.rtt[d], mm.loss[d]) : "No echo";
  };
  const sig = tr.sig ? tr.sig[k] : null;
  // Readout (max 8 rows, DESIGN.md 7). Values: capacity, RTT, loss.
  const rows: [string, string][] = [["Truth", stateWord]];
  if (st !== UNKNOWN) {
    rows.push(["True value", st === DOWN ? "Down" : trio(tr.cap[k], tr.rtt[k], tr.loss[k])]);
    if (sig !== null && sig !== undefined) rows.push(["True signal", fmtDbm(sig)]);
    rows.push([`${rightName} measured`, mon(right, di)]);
    rows.push([`${leftName} measured`, mon(left, dl)]);
    rows.push(["Good when", `${fmtMs(lim.max_rtt_ms)}, ${fmtFrac(lim.max_loss)} loss at most`]);
  }

  const label = linkLabel(link);
  const aria = `${label}: ${stateWord}. ${valueText}, ${sub}.${showHo ? ` Handover in ${fmtSec(ho)}.` : ""}`;

  return (
    <Tooltip rows={rows} title={`${label} at ${fmtClock(t)}`} placement="bottom" className={s.rowAnchor}>
      <div className={`${s.linkRow} ${st === UNKNOWN ? s.unknownRow : ""}`} tabIndex={0} aria-label={aria}>
        <span className={s.linkName} style={{ color: linkVar(link, "text") }}>
          <span className={s.linkSwatch} style={{ background: linkVar(link), borderColor: linkVar(link, "edge") }} aria-hidden />
          {label}
        </span>
        <Band link={link} t={t} run={right} truth={truth} />
        <span className={s.linkValue}>{value}</span>
        {showHo
          ? <span className={`${s.linkSub} ${s.handover}`}>Handover in {fmtSec(ho)}</span>
          : <span className={s.linkSub}>{sub}</span>}
      </div>
    </Tooltip>
  );
}

// ------------------------------------------------------------------ band (canvas)

/**
 * Fast playback (16x and 60x): skip a redraw that comes less than FAST_MS after the last one,
 * so the band repaints every other display frame. The 30 s window then moves 2 s (60x)
 * per repaint instead of 1 s, which is not visible; paused or slower playback draws at once,
 * and a fallback timer draws the newest window if no further render arrives.
 */
const FAST_MS = 20;
const FAST_FALLBACK_MS = 100;
const FAST_SPEED = 16;

function Band({ link, t, run, truth }: { link: LinkName; t: number; run: RunData; truth: RunTruth }) {
  const [ref, size] = useMeasure<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement>(null);
  const tokens = useTokens();
  const fast = useStore((st) => st.playing && st.speed >= FAST_SPEED);
  const lastDraw = useRef(0);
  const unknown = truth.state[link][0] === UNKNOWN;

  useEffect(() => {
    const c = canvas.current;
    if (!c || size.width < 4 || size.height < 4) return;
    const draw = () => {
      lastDraw.current = performance.now();
      const ctx = prepareCanvas(c, size.width, size.height);
      if (ctx) drawBand(ctx, size.width, size.height, link, t, run, truth, tokens);
    };
    if (fast && performance.now() - lastDraw.current < FAST_MS) {
      const id = window.setTimeout(draw, FAST_FALLBACK_MS);
      return () => window.clearTimeout(id);
    }
    draw();
  }, [size.width, size.height, link, t, run, truth, tokens, fast]);

  return (
    <div ref={ref} className={`${s.band} ${unknown ? s.bandUnknown : ""}`} aria-hidden>
      <canvas ref={canvas} className={s.bandCanvas} />
    </div>
  );
}

function drawBand(ctx: CanvasRenderingContext2D, W: number, H: number, link: LinkName, t: number, run: RunData, truth: RunTruth, tk: Tokens) {
  const st = truth.state[link];
  if (st[0] === UNKNOWN) return;
  const ts = run.samples.t;
  const dt = run.meta.dt;
  const t0 = t - BAND_S;
  const X = (tt: number) => ((tt - t0) / BAND_S) * W;
  const kEnd = sampleIndexAt(run, t);
  // Part of the window before the first sample (mission start): no data, drawn as the
  // dotted unknown outline (DESIGN.md 2.3) so an early band reads as "nothing yet", not blank.
  const xFirst = Math.min(W, Math.max(0, X(ts[0])));
  if (xFirst > 1) {
    ctx.save();
    ctx.strokeStyle = tk.get("--color-status-unknown");
    ctx.lineWidth = 1;
    ctx.setLineDash([1, 2]);
    ctx.strokeRect(0.5, 0.5, xFirst - 1, H - 1);
    ctx.restore();
  }
  if (ts[0] > t) return;
  const kStart = Math.max(0, sampleIndexAt(run, t0));
  const cap = run.truth[link].cap;
  const Y = (kbps: number) => H - Math.max(0, Math.min(1, kbps / truth.capMax)) * (H - 1);

  const fill = tk.get(`--color-link-${link}`);
  const edge = link === "lte" ? tk.get("--color-link-lte-edge") : "";
  const alpha = tk.num("--link-degraded-alpha") || 0.3;
  const hatch = tk.get("--color-status-unknown");
  const lineCol = tk.get("--color-text-1");

  // Truth area: one rect per sample (<= 300 per row).
  const degFill = withAlpha(fill, alpha);
  const downRuns: [number, number][] = [];
  let downFrom: number | null = null;
  // Set fillStyle only when the state changes: parsing a colour string per sample was the
  // band's main cost during fast playback (it redraws on every cursor step).
  let curFill = "";
  ctx.beginPath();
  for (let k = kStart; k <= kEnd; k++) {
    const a = Math.max(0, X(ts[k]));
    const b = k === kEnd ? W : Math.min(W, X(ts[k] + dt));
    if (b <= a) continue;
    const sk = st[k];
    if (sk === DOWN) {
      if (downFrom === null) downFrom = a;
      continue;
    }
    if (downFrom !== null) { downRuns.push([downFrom, a]); downFrom = null; }
    const y = Y(cap[k]);
    const want = sk === DEGRADED ? degFill : fill;
    if (want !== curFill) { ctx.fillStyle = want; curFill = want; }
    ctx.fillRect(a, y, b - a + 0.5, H - y);
  }
  if (downFrom !== null) downRuns.push([downFrom, W]);

  // 4G fill always carries its 1px edge (DESIGN.md 2.3): draw the top outline.
  if (edge) {
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1;
    ctx.beginPath();
    let open = false;
    for (let k = kStart; k <= kEnd; k++) {
      const a = Math.max(0, X(ts[k]));
      const b = k === kEnd ? W : Math.min(W, X(ts[k] + dt));
      if (st[k] === DOWN || b <= a) { open = false; continue; }
      const y = Y(cap[k]) + 0.5;
      if (!open) { ctx.moveTo(a, y); open = true; } else ctx.lineTo(a, y);
      ctx.lineTo(b, y);
    }
    ctx.stroke();
  }

  // Down: neutral hatch at full height (135deg, 5px tile).
  if (downRuns.length) {
    ctx.strokeStyle = hatch;
    ctx.lineWidth = 1;
    for (const [a, b] of downRuns) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(a, 0, b - a, H);
      ctx.clip();
      ctx.beginPath();
      for (let x = Math.floor((a - H) / 5) * 5; x < b; x += 5) {
        ctx.moveTo(x, H);
        ctx.lineTo(x + H, 0);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  // Measured capacity (decisions, 10 Hz) as a step line.
  const dts = run.decisions.cols.t;
  const mcap = run.decisions.measured[link].cap;
  const malive = run.decisions.measured[link].alive;
  let di = Math.max(0, decisionIndexAt(run, Math.max(t0, dts[0])));
  const dEnd = decisionIndexAt(run, t);
  const lw = tk.num("--stroke-bold") || 2;
  ctx.lineJoin = "miter";
  ctx.beginPath();
  let first = true;
  for (; di <= dEnd; di++) {
    const a = Math.max(0, X(dts[di]));
    const b = di === dEnd ? W : Math.min(W, X(dts[di + 1] ?? dts[di] + dt));
    // No line while the monitor has no echo: it measured nothing.
    if (malive[di] !== 1) { first = true; continue; }
    const y = Math.min(H - 1, Y(mcap[di]));
    if (first) { ctx.moveTo(a, y); first = false; } else ctx.lineTo(a, y);
    ctx.lineTo(b, y);
  }
  // A 1px plot-sheet halo keeps the line legible over any link fill in both themes.
  ctx.strokeStyle = tk.get("--color-surface-2");
  ctx.lineWidth = lw + 2;
  ctx.stroke();
  ctx.strokeStyle = withAlpha(lineCol, 0.8);
  ctx.lineWidth = lw;
  ctx.stroke();
}
