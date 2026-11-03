/**
 * Mission timeline (DESIGN.md 6.1 "Timeline" and "Hover tooltip", 6.1.2, 6.1.3, 7 Timeline
 * track / Who-saw lane, 8 time axis, 9.2 motion).
 *
 * Tracks, top to bottom: segment, the three links (truth), the left ribbon plus its camera
 * link rows, the who-saw lane, the right ribbon plus its camera link rows, the true
 * manoeuvre, uploads, and the time axis. One cursor runs through all of them.
 *
 * Performance: the dense tracks are one <canvas> drawn only when the runs, size, zoom or
 * theme change. The cursor, its axis chip and the slider's value are moved by a store
 * subscription that writes to the DOM directly, so playback never re-renders this tree.
 *
 * Interaction: hover = crosshair readout; click = seek (a who-saw block seeks to its start
 * and focuses that moment for the decision logs; an upload marker seeks to its time);
 * drag on the tracks = scrub; drag on the time axis = zoom to that range, "Show whole
 * mission" resets. The plot is a focusable slider: arrows step 0.1 s (Shift 1 s),
 * PageUp/PageDown 10 s, Home/End.
 */
import {
  memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type PointerEvent as RPointerEvent, type KeyboardEvent as RKeyboardEvent, type ReactNode,
} from "react";
import { scaleLinear } from "d3-scale";
import {
  Button, Glyph, Tooltip, TooltipBox, prepareCanvas, useMeasure, useTokens,
} from "../../../components";
import {
  useBreakpoint, usePairEvents, useReducedMotion, useRunPair, useStore,
} from "../../../state";
import { ctrlRole, linkLabel } from "../../../data/labels";
import { sampleIndexAt } from "../../../data/loader";
import type { PairEvents, WhoSaw } from "../../../data/events";
import type { LinkName, RunData } from "../../../data/types";
import { fmtClock, fmtDur, fmtFrac, fmtMB, fmtMbps, fmtMs, fmtPct } from "../../../format";
import { derive, derivePair, nominalKbps, uploadName, type PairDerived } from "./derive";
import { drawTracks } from "./draw";
import { TimeTicks } from "./TimeTicks";
import { AXIS_H, HEADER_H, buildLayout, type Layout, type Row } from "./layout";
import {
  camPlanText, endedAt, linkTruthText, measuredText, verdictAt, whereAt,
} from "./readout";
import { LINK_DEGRADED, LINK_DOWN } from "./derive";
import s from "./MissionTimeline.module.css";

const LINKS: LinkName[] = ["radio", "starlink", "lte"];
/** Smallest zoom window, s. */
const MIN_ZOOM_S = 10;
/** Pointer travel that turns a press into a drag, px. */
const DRAG_PX = 4;

/** The ribbon draw-in runs once per page load (DESIGN.md 9.2). */
let drawInDone = false;

type Domain = [number, number];

interface Hover { x: number; y: number; cx: number; cy: number; t: number; row: Row | null }

function ctrlFillToken(config: string): string {
  const r = ctrlRole(config);
  return r === "proposed" ? "--color-ctrl-proposed" : r === "baseline" ? "--color-ctrl-baseline" : "--color-ctrl-other";
}
function ctrlTextVar(config: string): string {
  const r = ctrlRole(config);
  return r === "proposed" ? "var(--color-ctrl-proposed-text)" : r === "baseline" ? "var(--color-ctrl-baseline-text)" : "var(--color-ctrl-other)";
}

/** Axis label spacing: 2 min at full width (DESIGN.md 8), finer when zoomed. */
function tickEvery(span: number, width: number): number {
  const minPx = 64;
  for (const step of [5, 10, 15, 30, 60, 120, 300, 600]) if ((step / span) * width >= minPx) return step;
  return 600;
}

// ------------------------------------------------------------------ text measuring for labels

let measureCtx: CanvasRenderingContext2D | null = null;
function textWidth(text: string, px: number): number {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * px * 0.5;
  measureCtx.font = `400 ${px}px Barlow, system-ui, sans-serif`;
  return measureCtx.measureText(text).width;
}
function fs12px(): number {
  const root = parseFloat(getComputedStyle(document.documentElement).fontSize) || 15;
  return root * 0.8;
}

// ------------------------------------------------------------------ static SVG labels

interface LabelsProps {
  layout: Layout;
  width: number;
  domain: Domain;
  left: RunData;
  right: RunData;
  leftConfig: string;
  rightConfig: string;
  P: PairDerived;
  fontKey: string;
}

/** Segment names, manoeuvre names and upload markers, drawn over the canvas. */
const TrackLabels = memo(function TrackLabels({ layout, width, domain, left, right, leftConfig, rightConfig, P }: LabelsProps) {
  const [d0, d1] = domain;
  const X = (t: number) => ((t - d0) / (d1 - d0)) * width;
  const fpx = fs12px();
  const out: ReactNode[] = [];
  const rowOf = (id: string) => layout.rows.find((r) => r.id === id);

  const seg = rowOf("segment");
  if (seg) {
    P.seg.forEach((sp, i) => {
      if (sp.v < 0 || sp.t1 <= d0 || sp.t0 >= d1) return;
      const a = X(Math.max(sp.t0, d0));
      const b = X(Math.min(sp.t1, d1));
      const name = segLabelShort(right.enums.seg[sp.v]);
      if (b - a < textWidth(name, fpx) + 8) return;
      out.push(<text key={`seg${i}`} x={(a + b) / 2} y={seg.y + seg.h / 2} textAnchor="middle" dominantBaseline="central" className={s.segText}>{name}</text>);
    });
  }

  const man = rowOf("man");
  if (man) {
    P.man.forEach((sp, i) => {
      if (sp.t1 <= d0 || sp.t0 >= d1) return;
      const a = X(Math.max(sp.t0, d0));
      const b = X(Math.min(sp.t1, d1));
      const code = right.enums.man[sp.v];
      const name = manShort(code, b - a, fpx);
      if (!name) return;
      const tw = textWidth(name, fpx);
      if (code === "DRIVE") {
        const x = a + 6;
        out.push(
          <g key={`man${i}`}>
            <rect x={x - 3} y={man.y} width={tw + 6} height={man.h} className={s.manBack} />
            <text x={x} y={man.y + man.h / 2} dominantBaseline="central" className={s.manText}>{name}</text>
          </g>,
        );
      } else {
        out.push(<text key={`man${i}`} x={(a + b) / 2} y={man.y + man.h / 2} textAnchor="middle" dominantBaseline="central" className={s.manText}>{name}</text>);
      }
    });
  }

  // Requested uploads: request marker + name on the names row; completion per controller.
  const names = rowOf("upnames");
  const rows = { left: rowOf("upload-left"), right: rowOf("upload-right") };
  if (names) {
    const groups = requestGroups(left, right);
    let lastEnd = -Infinity;
    groups.forEach((g, gi) => {
      if (g.t < d0 || g.t > d1) return;
      const x = X(g.t);
      const cy = names.y + names.h / 2;
      out.push(<path key={`rq${gi}`} d={diamond(x, cy, 3.5)} className={s.reqMark} />);
      const label = g.label;
      const tw = textWidth(label, fpx);
      if (x + 7 > lastEnd + 6 && x + 7 + tw < width) {
        out.push(<text key={`rqt${gi}`} x={x + 7} y={cy} dominantBaseline="central" className={s.upText}>{label}</text>);
        lastEnd = x + 7 + tw;
      }
    });
    (["left", "right"] as const).forEach((side) => {
      const row = rows[side];
      const run = side === "left" ? left : right;
      const config = side === "left" ? leftConfig : rightConfig;
      if (!row) return;
      const D = derive(run);
      D.requested.forEach(({ up }, i) => {
        const cy = row.y + row.h / 2;
        if (up.done_t !== null) {
          if (up.done_t < d0 || up.done_t > d1) return;
          out.push(<path key={`dn${side}${i}`} d={diamond(X(up.done_t), cy, 4.5)} className={s.doneMark} style={{ fill: ctrlTextVar(config) }} />);
        } else if (D.end >= d0 && D.end <= d1) {
          const x = X(D.end);
          out.push(<path key={`miss${side}${i}`} d={`M${x - 3} ${cy - 3} L${x + 3} ${cy + 3} M${x + 3} ${cy - 3} L${x - 3} ${cy + 3}`} className={s.missMark} />);
        }
      });
    });
  }

  return (
    <svg className={s.labels} width={width} height={layout.height} aria-hidden>
      {out}
    </svg>
  );
});

function diamond(x: number, y: number, r: number): string {
  return `M${x} ${y - r} L${x + r} ${y} L${x} ${y + r} L${x - r} ${y} Z`;
}

const SEG_SHORT: Record<string, string> = {
  "leave base": "Leaving base", "radio edge": "Radio edge", transit: "Transit", crater: "Crater",
  "contested out": "Contested", inspection: "Inspection", "contested back": "Contested",
  "transit back": "Transit back", "radio back": "Radio back",
};
function segLabelShort(code: string | undefined): string {
  return code ? SEG_SHORT[code] ?? code : "";
}

const MAN_NAMES: Record<string, [string, string]> = {
  DRIVE: ["Driving", "Drv"], REVERSE: ["Reversing", "Rev"], PRECISION: ["Precision", "Prec"], STOPPED: ["Stopped", "Stop"],
};
function manShort(code: string, w: number, fpx: number): string | null {
  const n = MAN_NAMES[code];
  if (!n) return null;
  if (w >= textWidth(n[0], fpx) + 10) return n[0];
  if (w >= textWidth(n[1], fpx) + 4) return n[1];
  return null;
}

interface RequestGroup { t: number; label: string; ids: string[] }
/** Requested uploads grouped by request time (the still and clip are requested together). */
function requestGroups(left: RunData, right: RunData): RequestGroup[] {
  const byId = new Map<string, { t: number; name: string }>();
  for (const run of [left, right]) {
    for (const { up } of derive(run).requested) {
      const cur = byId.get(up.id);
      if (!cur || up.created_t < cur.t) byId.set(up.id, { t: up.created_t, name: uploadName(up) });
    }
  }
  const items = [...byId.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => a.t - b.t);
  const groups: RequestGroup[] = [];
  for (const it of items) {
    const g = groups[groups.length - 1];
    if (g && it.t - g.t < 1) { g.ids.push(it.id); g.label += `, ${it.name.toLowerCase()}`; }
    else groups.push({ t: it.t, label: it.name, ids: [it.id] });
  }
  return groups;
}

// ------------------------------------------------------------------ readout

interface ReadoutProps {
  t: number;
  row: Row | null;
  left: RunData;
  right: RunData;
  leftConfig: string;
  rightConfig: string;
  events: PairEvents;
  /** px per second, to find upload markers near the pointer. */
  pxPerS: number;
}

const WHO_TEXT = (cls: WhoSaw, l: string, r: string) =>
  cls === "both" ? "Both views usable" : cls === "neither" ? "Neither view usable" : cls === "left_only" ? `Only ${l}'s view usable` : `Only ${r}'s view usable`;

// DESIGN-GAP: section 7 caps a readout at 8 rows, but 6.1 asks the timeline crosshair for time,
// km, segment, manoeuvre, three links (truth and measured) and two verdicts with reasons. The
// readout keeps all of them, in a compact table, rather than drop a required field.
function Readout({ t, row, left, right, leftConfig, rightConfig, events, pxPerS }: ReadoutProps) {
  const ref = endedAt(right, t) ? left : right;
  const where = whereAt(ref, t);
  // Each controller runs its own monitor; show the one whose mission is still running.
  const measuredRun = ref;
  const measuredCfg = ref === right ? rightConfig : leftConfig;
  const vs = [
    { config: leftConfig, v: verdictAt(left, t) },
    { config: rightConfig, v: verdictAt(right, t) },
  ];
  let context: ReactNode = null;
  if (row?.kind === "cam") {
    const run = row.side === "left" ? left : right;
    const config = row.side === "left" ? leftConfig : rightConfig;
    context = <><span style={{ color: ctrlTextVar(config) }} className={s.ctrlName}>{config}</span> sends {camPlanText(run, t)}.</>;
  } else if (row?.kind === "whosaw") {
    const P = derivePair(left, right, events);
    const w = P.whoSaw.find((x) => t >= x.from && t < x.to);
    if (!w && P.longer && t >= P.commonEnd) {
      const done = P.longer === "left" ? rightConfig : leftConfig;
      context = <>{done} finished its mission at {fmtClock(P.commonEnd)}, so the lane compares the two views only up to then.</>;
    } else if (w) context = <>{WHO_TEXT(w.cls, leftConfig, rightConfig)} for {fmtDur(w.to - w.from)}, {fmtClock(w.from)} to {fmtClock(w.to)}.{w.cls !== "both" ? " Click to go to its start." : ""}</>;
  } else if (row?.kind === "upnames" || row?.kind === "upload") {
    const g = nearestRequest(left, right, t, 8 / pxPerS);
    if (g) context = <UploadContext ids={g.ids} left={left} right={right} leftConfig={leftConfig} rightConfig={rightConfig} />;
    else if (row.kind === "upload") {
      const run = row.side === "left" ? left : right;
      const config = row.side === "left" ? leftConfig : rightConfig;
      context = <><span style={{ color: ctrlTextVar(config) }} className={s.ctrlName}>{config}</span> {sendingText(run, t)}</>;
    }
  } else if (row?.kind === "man") {
    const st = ref.enums.state[ref.samples.state[sampleIndexAt(ref, t)]];
    context = <>Driver state {st}. The operator's need follows the true manoeuvre.</>;
  }

  return (
    <div className={s.ro}>
      <div className={s.roTitle}><span>{fmtClock(t)}</span><span>{where.km}</span></div>
      <table className={s.roTable}>
        <tbody>
          <tr><th scope="row">Segment</th><td colSpan={2}>{where.segment}</td></tr>
          <tr><th scope="row">Manoeuvre</th><td colSpan={2}>{where.man}{where.need ? `, needs the ${where.need}` : ""}</td></tr>
          <tr className={s.roHead}><th /><td>Truth</td><td>Measured by {measuredCfg}</td></tr>
          {LINKS.map((link) => {
            const tr = linkTruthText(ref, link, t);
            return (
              <tr key={link}>
                <th scope="row" style={{ color: `var(--color-link-${link}-text)` }} className={s.linkName}>{linkLabel(link)}</th>
                <td className={tr.cls === LINK_DEGRADED ? s.degraded : tr.cls === LINK_DOWN ? s.down : undefined}>{tr.text}</td>
                <td className={s.measured}>{endedAt(measuredRun, t) ? "–" : measuredText(measuredRun, link, t)}</td>
              </tr>
            );
          })}
          {vs.map(({ config, v }) => (
            <tr key={config} className={s.verdictRow}>
              <th scope="row" style={{ color: ctrlTextVar(config) }} className={s.ctrlName}>{config}</th>
              <td colSpan={2}>
                <span className={v.kind === "not" ? s.notUsable : v.kind === "ended" ? s.ended : s.usable}>
                  {v.kind === "not" && <Glyph kind="bad" size={11} />} {v.head}
                </span>
                {v.reason && <span className={s.reason}>{v.reason}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {context && <p className={s.roCtx}>{context}</p>}
    </div>
  );
}

function sendingText(run: RunData, t: number): string {
  if (endedAt(run, t)) return `ended its mission at ${fmtClock(run.meta.mission_time_s)}.`;
  const k = sampleIndexAt(run, t);
  const item = run.samples.bulk_item[k];
  const req = run.samples.bulk_req_kbps[k];
  const bg = run.samples.bulk_bg_kbps[k];
  if (req <= 0 && bg <= 0) return "is not sending upload data.";
  const name = item >= 0 && run.uploads[item] ? uploadName(run.uploads[item]) : "uploads";
  const kind = req > 0 ? "requested" : "background";
  return `is sending ${name} (${kind}) at ${fmtMbps(req + bg)}.`;
}

function nearestRequest(left: RunData, right: RunData, t: number, tol: number): RequestGroup | null {
  let best: RequestGroup | null = null;
  let bestD = tol;
  for (const g of requestGroups(left, right)) {
    const d = Math.abs(g.t - t);
    if (d <= bestD) { best = g; bestD = d; }
  }
  // Completion markers count too.
  for (const run of [left, right]) {
    for (const { up } of derive(run).requested) {
      if (up.done_t === null) continue;
      const d = Math.abs(up.done_t - t);
      if (d <= bestD) { best = { t: up.done_t, label: uploadName(up), ids: [up.id] }; bestD = d; }
    }
  }
  return best;
}

function UploadContext({ ids, left, right, leftConfig, rightConfig }: { ids: string[]; left: RunData; right: RunData; leftConfig: string; rightConfig: string }) {
  return (
    <>
      {ids.map((id) => {
        const ul = left.uploads.find((u) => u.id === id);
        const ur = right.uploads.find((u) => u.id === id);
        const any = ur ?? ul;
        if (!any) return null;
        const part = (config: string, u: typeof ul) => (
          <span key={config}>
            {" "}<span style={{ color: ctrlTextVar(config) }} className={s.ctrlName}>{config}</span>{" "}
            {u && u.done_t !== null
              ? <>delivered at {fmtClock(u.done_t)} ({fmtDur(u.delivery_s)}).</>
              : <span className={s.notUsable}>did not deliver it by mission end.</span>}
          </span>
        );
        return (
          <span key={id} className={s.upCtx}>
            {uploadName(any)}, {fmtMB(any.size_mb)}, requested at {fmtClock(any.created_t)}.
            {part(leftConfig, ul)}{part(rightConfig, ur)}
          </span>
        );
      })}
    </>
  );
}

/** aria-valuetext for the slider: "08:41.2, 2.41 km, Baseline view not usable, Proposed view usable". */
function sliderText(left: RunData, right: RunData, leftConfig: string, rightConfig: string, t: number): string {
  const ref = endedAt(right, t) ? left : right;
  const w = whereAt(ref, t);
  const v = (config: string, run: RunData) => {
    const x = verdictAt(run, t);
    return x.kind === "ended" ? `${config} mission ended` : `${config} view ${x.kind === "usable" ? "usable" : `not usable, ${x.reason}`}`;
  };
  return `${fmtClock(t)}, ${w.km}, ${w.segment}, ${w.man}. ${v(leftConfig, left)}. ${v(rightConfig, right)}.`;
}

// ------------------------------------------------------------------ main

export function MissionTimeline() {
  const pair = useRunPair();
  const events = usePairEvents();
  const left = pair.left!;
  const right = pair.right!;
  const bp = useBreakpoint();
  const tokens = useTokens();
  const reduced = useReducedMotion();
  const presenter = useStore((st) => st.presenter);

  const [rootRef, rootSize] = useMeasure<HTMLDivElement>();
  const [plotRef, plotSize] = useMeasure<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);

  const [showStreamsPref, setShowStreams] = useState<boolean | null>(null);
  const showStreams = bp === "wide" ? true : showStreamsPref ?? false;
  const [zoom, setZoom] = useState<Domain | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [sel, setSel] = useState<Domain | null>(null);
  const [fontKey, setFontKey] = useState("");

  // Redraw labels once web fonts are ready (text measuring depends on them).
  useEffect(() => {
    let alive = true;
    document.fonts?.ready.then(() => { if (alive) setFontKey("ready"); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  // The initializer must stay pure (StrictMode calls it twice); the once-per-load flag is set
  // in an effect instead.
  const [drawIn] = useState(() => !drawInDone && !useStore.getState().interacted && !reduced);
  useEffect(() => { drawInDone = true; }, []);

  const L = derive(left);
  const R = derive(right);
  const fullEnd = Math.max(L.end, R.end, events?.duration ?? 0);
  const domain: Domain = useMemo(() => zoom ?? [0, fullEnd], [zoom, fullEnd]);
  const width = plotSize.width;

  const available = bp === "narrow" ? null : Math.max(0, rootSize.height - HEADER_H - AXIS_H);
  const layout = useMemo(() => buildLayout(bp, showStreams, available), [bp, showStreams, available]);

  const leftConfig = pair.leftConfig;
  const rightConfig = pair.rightConfig;

  // Reset zoom when the pair changes.
  useEffect(() => { setZoom(null); }, [left, right]);

  // ---- canvas (dense tracks)
  useLayoutEffect(() => {
    const c = canvasRef.current;
    if (!c || width <= 0 || !events) return;
    const ctx = prepareCanvas(c, width, layout.height);
    if (!ctx) return;
    const baselineLeft = ctrlRole(leftConfig) === "baseline";
    drawTracks({
      ctx, width, dpr: window.devicePixelRatio || 1, layout, domain, left, right, events, tokens,
      leftColor: tokens.get(ctrlFillToken(leftConfig)),
      rightColor: tokens.get(ctrlFillToken(rightConfig)),
      leftEdge: baselineLeft ? tokens.get("--color-ctrl-baseline-edge") : null,
    });
  }, [width, layout, domain[0], domain[1], left, right, events, tokens, leftConfig, rightConfig]); // eslint-disable-line

  // ---- cursor, chip and slider value follow the store without re-rendering
  const domRef = useRef({ domain, width });
  domRef.current = { domain, width };
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const fullEndRef = useRef(fullEnd);
  fullEndRef.current = fullEnd;
  const chipW = useRef(new Map<number, number>());
  useEffect(() => { chipW.current.clear(); }, [tokens]); // presenter mode changes the chip font
  useEffect(() => {
    const apply = (t: number, playing: boolean) => {
      const { domain: [a, b], width: w } = domRef.current;
      const x = ((t - a) / (b - a)) * w;
      const inside = t >= a - 1e-6 && t <= b + 1e-6 && w > 0;
      const cur = cursorRef.current;
      const chip = chipRef.current;
      if (cur) {
        cur.style.display = inside ? "block" : "none";
        cur.style.transform = `translateX(${Math.round(x - 1)}px)`;
      }
      if (chip) {
        chip.style.display = inside ? "flex" : "none";
        const txt = fmtClock(t);
        if (chip.textContent !== txt) chip.textContent = txt;
        // Tabular digits: the chip's width depends only on the text length, so measure it
        // once per length instead of forcing a layout on every playback frame.
        let cw = chipW.current.get(txt.length);
        if (cw === undefined && inside) { cw = chip.offsetWidth || 56; chipW.current.set(txt.length, cw); }
        cw = cw ?? 56;
        const cx = Math.max(cw / 2, Math.min(w - cw / 2, x));
        chip.style.transform = `translateX(${Math.round(cx - cw / 2)}px)`;
      }
      const sl = sliderRef.current;
      if (sl) {
        sl.setAttribute("aria-valuenow", t.toFixed(1));
        if (!playing) sl.setAttribute("aria-valuetext", sliderText(left, right, leftConfig, rightConfig, t));
      }
    };
    const st = useStore.getState();
    apply(st.t, st.playing);
    return useStore.subscribe((now, prev) => {
      if (now.t === prev.t && now.playing === prev.playing) return;
      apply(now.t, now.playing);
      // While playing inside a zoom window, page forward when the cursor leaves it.
      const z = domRef.current.domain;
      if (zoomRef.current && now.playing && now.t > z[1]) {
        const span = z[1] - z[0];
        const a = Math.min(now.t, fullEndRef.current - span);
        setZoom([Math.max(0, a), Math.max(0, a) + span]);
      }
    });
  }, [left, right, leftConfig, rightConfig, width, domain[0], domain[1]]); // eslint-disable-line

  // ---- pointer helpers
  const tAtX = useCallback((x: number) => {
    const [a, b] = domain;
    return Math.max(0, Math.min(fullEnd, a + (x / Math.max(1, width)) * (b - a)));
  }, [domain[0], domain[1], width, fullEnd]); // eslint-disable-line
  const rowAtY = (y: number): Row | null => {
    for (const r of layout.rows) if (y >= r.y - 2 && y <= r.y + r.h + 2) return r;
    return null;
  };

  const press = useRef<{ x: number; y: number; drag: boolean; id: number } | null>(null);

  const local = (e: RPointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onTracksMove = (e: RPointerEvent<HTMLDivElement>) => {
    const p = local(e);
    const t = tAtX(p.x);
    if (press.current && press.current.id === e.pointerId) {
      if (!press.current.drag && Math.abs(p.x - press.current.x) > DRAG_PX) press.current.drag = true;
      if (press.current.drag) useStore.getState().seek(t);
    }
    setHover({ x: p.x, y: p.y, cx: e.clientX, cy: e.clientY, t, row: rowAtY(p.y) });
  };
  const onTracksDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const p = local(e);
    press.current = { x: p.x, y: p.y, drag: false, id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onTracksUp = (e: RPointerEvent<HTMLDivElement>) => {
    const pr = press.current;
    press.current = null;
    if (!pr || pr.id !== e.pointerId) return;
    if (pr.drag) return;
    const p = local(e);
    clickAt(tAtX(p.x), rowAtY(p.y));
  };

  const clickAt = (t: number, row: Row | null) => {
    const st = useStore.getState();
    if (row?.kind === "whosaw" && events) {
      const w = derivePair(left, right, events).whoSaw.find((x) => t >= x.from && t < x.to);
      if (w && w.cls !== "both") {
        st.seek(w.from);
        st.setFocus(w.cls === "neither"
          ? { t: w.from, kind: "neither", label: `Neither view usable for ${fmtDur(w.to - w.from)}` }
          : { t: w.from, kind: "divergence", side: w.cls === "left_only" ? "left" : "right", label: `${WHO_TEXT(w.cls, leftConfig, rightConfig)} for ${fmtDur(w.to - w.from)}` });
        return;
      }
    }
    if (row?.kind === "upnames" || row?.kind === "upload") {
      const g = nearestRequest(left, right, t, 8 / Math.max(1e-6, width / (domain[1] - domain[0])));
      if (g) { st.seek(g.t); st.setFocus({ t: g.t, kind: "upload", label: g.label }); return; }
    }
    st.seek(t);
  };

  // ---- axis drag to zoom
  const axisPress = useRef<{ t: number; x: number; id: number; drag: boolean } | null>(null);
  const onAxisDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const p = local(e);
    axisPress.current = { t: tAtX(p.x), x: p.x, id: e.pointerId, drag: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onAxisMove = (e: RPointerEvent<HTMLDivElement>) => {
    const ap = axisPress.current;
    if (!ap || ap.id !== e.pointerId) return;
    const p = local(e);
    if (!ap.drag && Math.abs(p.x - ap.x) > DRAG_PX) ap.drag = true;
    if (ap.drag) {
      const t = tAtX(p.x);
      setSel([Math.min(ap.t, t), Math.max(ap.t, t)]);
    }
  };
  const onAxisUp = (e: RPointerEvent<HTMLDivElement>) => {
    const ap = axisPress.current;
    axisPress.current = null;
    setSel(null);
    if (!ap || ap.id !== e.pointerId) return;
    const p = local(e);
    const t = tAtX(p.x);
    if (!ap.drag) { useStore.getState().seek(t); return; }
    let a = Math.min(ap.t, t);
    let b = Math.max(ap.t, t);
    if (b - a < MIN_ZOOM_S) {
      const c = (a + b) / 2;
      a = Math.max(0, c - MIN_ZOOM_S / 2);
      b = Math.min(fullEnd, a + MIN_ZOOM_S);
    }
    if (a <= 0.05 && b >= fullEnd - 0.05) setZoom(null);
    else setZoom([a, b]);
    useStore.getState().markInteracted();
  };

  // ---- slider keys (the global handler leaves arrows to role=slider)
  const onKey = (e: RKeyboardEvent<HTMLDivElement>) => {
    const st = useStore.getState();
    let handled = true;
    switch (e.key) {
      case "ArrowLeft": st.step(e.shiftKey ? -1 : -0.1); break;
      case "ArrowRight": st.step(e.shiftKey ? 1 : 0.1); break;
      case "PageUp": st.step(-10); break;
      case "PageDown": st.step(10); break;
      case "Home": st.pause(); st.seek(0); break;
      case "End": st.pause(); st.seek(fullEnd); break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
  };

  if (!events) return null;

  const span = domain[1] - domain[0];
  const scale = scaleLinear().domain(domain).range([0, Math.max(1, width)]); // cheap; TimeTicks re-renders only on hover
  const every = tickEvery(span, Math.max(1, width));
  const P = derivePair(left, right, events);
  const tally = P.tally;
  // Name the compared span only when the two missions end noticeably apart.
  const shorter = P.longer && P.fullEnd - P.commonEnd >= 1 ? (P.longer === "left" ? rightConfig : leftConfig) : null;
  const showSubLabels = bp !== "narrow";
  // The gutter is a fixed width; presenter mode enlarges type by 20%, so it drops the words
  // that do not fit and the per-row upload names (the rows keep their controller colours and
  // the Baseline-above-Proposed order of the ribbons; the Uploads tooltip names them).
  const roomy = bp === "wide" && !presenter;
  const showUploadRows = showSubLabels && !presenter;
  const rowsById = new Map(layout.rows.map((r) => [r.id, r]));
  const ribL = rowsById.get("ribbon-left");
  const ribR = rowsById.get("ribbon-right");
  const coverTop = ribL?.y ?? 0;
  const lastRight = rowsById.get("cam-right-rear") ?? ribR;
  const coverBottom = lastRight ? lastRight.y + lastRight.h : 0;
  const lim = right.meta.limits.video;

  const linkHelp = (link: LinkName) =>
    `Ground truth along the ${rightConfig} run. Solid: good (loss at most ${fmtFrac(lim.max_loss)} and RTT at most ${fmtMs(lim.max_rtt_ms)}, the config's video limits). Faint: up but outside them. Hatched: down. Bar height: true capacity against the nominal ${fmtMbps(nominalKbps(right, link))}.`;
  const ribbonHelp = (config: string, run: RunData) =>
    `${config}'s usable view over the mission (samples.useful from the simulator). A tear with red edges is time the operator could not see what the true manoeuvre needs. Engine metric: usable ${fmtPct(run.metrics.useful_view_pct ?? null)} of the mission, ${run.metrics.interruptions ?? "–"} interruptions.`;

  const label = (r: Row | undefined, content: ReactNode, help?: string, extra?: ReactNode) => {
    if (!r) return null;
    const inner = <span className={s.labelText}>{content}</span>;
    return (
      <div key={r.id} className={s.label} style={{ top: r.y + r.h / 2 }}>
        {help ? <Tooltip content={help} placement="top">{inner}</Tooltip> : inner}
        {extra}
      </div>
    );
  };

  const camHelp = "Link each camera is sent on, from the controller's plan. Top row: front camera; bottom row: rear camera. Two colours stacked: sent on two links at once. Faint: TRICKLE. Empty: paused.";

  return (
    <section ref={rootRef} className={[s.root, bp === "narrow" ? s.natural : ""].join(" ")} aria-label="Mission timeline">
      <h2 className="sr-only">Mission timeline</h2>

      {/* ---------------- header: who-saw tally and controls */}
      <div className={s.header} style={{ height: HEADER_H }}>
        <div className={s.headGutter} />
        <div className={s.headPlot}>
          <p className={s.tally} aria-label={`${shorter ? `Until ${fmtClock(P.commonEnd)}` : "Whole mission"}: ${rightConfig} only ${fmtDur(tally.right_only)}, ${leftConfig} only ${fmtDur(tally.left_only)}, neither ${fmtDur(tally.neither)} with a usable view.`}>
            <span className={s.tallyItem}>
              <span className={`${s.sw} ${s.swBelow}`} style={{ background: `var(${ctrlFillToken(rightConfig)})` }} aria-hidden />
              <span className={s.ctrlName} style={{ color: ctrlTextVar(rightConfig) }}>{rightConfig}</span> only <b>{fmtDur(tally.right_only)}</b>
            </span>
            <span className={s.tallyItem}>
              <span className={`${s.sw} ${s.swAbove}`} style={{ background: `var(${ctrlFillToken(leftConfig)})` }} aria-hidden />
              <span className={s.ctrlName} style={{ color: ctrlTextVar(leftConfig) }}>{leftConfig}</span> only <b>{fmtDur(tally.left_only)}</b>
            </span>
            <span className={s.tallyItem}>
              <span className={`${s.sw} ${s.swHatch}`} aria-hidden />
              Neither <b>{fmtDur(tally.neither)}</b>
            </span>
            {shorter && (
              <span className={s.tallyNote}>to {fmtClock(P.commonEnd)}, when {shorter} finished</span>
            )}
          </p>
          <div className={s.headRight}>
            <span className={s.legendTear} aria-hidden><span className={s.swTear} /></span>
            <span className={s.legendText}>View not usable</span>
            {zoom ? (
              <>
                <Button onClick={() => setZoom(null)} title={`Showing ${fmtClock(zoom[0])} to ${fmtClock(zoom[1])}`}>Show whole mission</Button>
              </>
            ) : (
              <span className={s.hint}>Drag along the time axis to zoom</span>
            )}
            {bp !== "wide" && (
              <Button pressed={showStreams} onClick={() => setShowStreams(!showStreams)}>Show camera links</Button>
            )}
          </div>
        </div>
      </div>

      {/* ---------------- body */}
      <div className={s.body}>
        <div className={s.gutter} style={{ height: layout.height + AXIS_H }}>
          {label(rowsById.get("segment"), "Segment", "Scoring segment of the mission (samples.seg).")}
          {LINKS.map((link) => label(rowsById.get(`link-${link}`), <span style={{ color: `var(--color-link-${link}-text)` }}>{linkLabel(link)}</span>, linkHelp(link)))}
          {(["left", "right"] as const).map((side) => {
            const config = side === "left" ? leftConfig : rightConfig;
            const run = side === "left" ? left : right;
            return label(rowsById.get(`ribbon-${side}`),
              <span className={s.ribbonName} style={{ color: ctrlTextVar(config) }}>{config}</span>,
              ribbonHelp(config, run),
              showSubLabels ? <span className={s.subValue}>{fmtPct(run.metrics.useful_view_pct ?? null)}{roomy ? " usable" : ""}</span> : null);
          })}
          {showStreams && (["left", "right"] as const).map((side) => {
            const front = rowsById.get(`cam-${side}-front`);
            const rear = rowsById.get(`cam-${side}-rear`);
            if (!front || !rear) return null;
            const r: Row = { ...front, id: `cams-${side}`, y: front.y, h: rear.y + rear.h - front.y };
            return label(r, <span className={s.subLabel}>{roomy ? "Camera links" : "Cameras"}</span>, camHelp,
              showSubLabels ? <span className={s.subHint}>front, rear</span> : null);
          })}
          {label(rowsById.get("whosaw"), "Who saw",
            `Above the line: only ${leftConfig}'s view usable. Below: only ${rightConfig}'s. Hatched: neither. Blank: both. Click a block to go to its start.`)}
          {label(rowsById.get("man"), bp === "narrow" ? "Manoeuvre" : "True manoeuvre", "What the driver script is doing; the operator's need follows it, not the controller's guess.")}
          {(() => {
            const g = layout.groups.uploads;
            const r: Row = { id: "uploads", kind: "upnames", y: g[0], h: g[1] - g[0] };
            return label(r, "Uploads",
              "Diamond outline: an operator request. Filled diamond: delivered, in the controller's colour. Bars: faint = background chunks being sent, solid = a requested item being sent. Top row: " + leftConfig + "; bottom row: " + rightConfig + ".");
          })()}
          {showUploadRows && (["left", "right"] as const).map((side) => {
            const r = rowsById.get(`upload-${side}`);
            const config = side === "left" ? leftConfig : rightConfig;
            if (!r) return null;
            return <span key={`ul${side}`} className={s.upSub} style={{ top: r.y + r.h / 2, color: ctrlTextVar(config) }}>{config}</span>;
          })}
        </div>

        <div ref={plotRef} className={s.plot} style={{ height: layout.height + AXIS_H }}>
          <div ref={sliderRef} className={s.tracks} style={{ height: layout.height }}
            role="slider" tabIndex={0} aria-label="Mission timeline cursor"
            aria-valuemin={0} aria-valuemax={Number(fullEnd.toFixed(1))}
            onKeyDown={onKey}
            onPointerMove={onTracksMove} onPointerDown={onTracksDown} onPointerUp={onTracksUp}
            onPointerCancel={() => { press.current = null; }}
            onPointerLeave={() => setHover(null)}>
            <canvas ref={canvasRef} className={s.canvas} />
            {width > 0 && (
              <TrackLabels layout={layout} width={width} domain={domain} left={left} right={right}
                leftConfig={leftConfig} rightConfig={rightConfig} P={P} fontKey={fontKey + tokens.version} />
            )}
            {drawIn && (
              <div className={s.cover} style={{ top: coverTop - 2, height: coverBottom - coverTop + 4 }} aria-hidden />
            )}
            {hover && <div className={s.hoverLine} style={{ transform: `translateX(${Math.round(hover.x)}px)` }} aria-hidden />}
          </div>
          <div ref={cursorRef} className={s.cursor} style={{ height: layout.height + 4 }} aria-hidden />
          {sel && width > 0 && (
            <div className={s.sel} style={{ left: scale(sel[0]), width: Math.max(1, scale(sel[1]) - scale(sel[0])), height: layout.height + AXIS_H }} aria-hidden />
          )}
          <div className={s.axis} style={{ top: layout.height, height: AXIS_H }}
            onPointerDown={onAxisDown} onPointerMove={onAxisMove} onPointerUp={onAxisUp}
            onPointerCancel={() => { axisPress.current = null; setSel(null); }}
            title="Drag to zoom to a time range">
            {width > 0 && (
              <svg width={width} height={AXIS_H} className={s.axisSvg} aria-hidden>
                <TimeTicks scale={scale} every={every} width={width} />
              </svg>
            )}
            <div ref={chipRef} className={s.chip} aria-hidden />
          </div>
        </div>
      </div>

      {hover && !sel && (
        <TooltipBox x={hover.cx} y={hover.cy} open>
          <Readout t={hover.t} row={hover.row} left={left} right={right} leftConfig={leftConfig} rightConfig={rightConfig}
            events={events} pxPerS={width / Math.max(1e-6, span)} />
        </TooltipBox>
      )}
    </section>
  );
}
