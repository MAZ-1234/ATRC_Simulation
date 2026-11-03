/**
 * Route strip + Tour chapter chips + claim caption. DESIGN.md 6.1 ("Route strip"), 6.1.1
 * (Tour), 6.1.2 / 6.1.3 (collapse rules). The "Tour" button (key G) after the chips plays
 * every chapter back to back (store.tour); its caption card is ./TourCard.
 *
 * Layout (height is the cell's --rp-route-h; it never grows, so nothing below jumps):
 *   wide     64px  [Route | km schematic, out + back lanes        ]
 *                  [Chapters | chips "1.55 km Radio lost" ... | claim caption]
 *   compact  40px  [Route | one-lane schematic (caption overlays its label row) | km chips]
 *   narrow   64px  [Route | one-lane schematic] / [Chapters | km chips | short caption]
 *
 * Data: zones from scenario.js for the current variant; both vehicles from the loaded
 * pair; chapters from computePairEvents; claims from ./claims.ts. The static schematic is
 * memoised per size and variant; only the vehicle marks, the gutter readout and the active
 * chip's progress subscribe to the cursor.
 */
import { useEffect, useMemo, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { Tooltip, TooltipBox, useMeasure, ctrlVar, ctrlClass } from "../../../components";
import { TOUR_HOLD_MS, TOUR_HOLD_REDUCED_MS, TOUR_SPEED, useBreakpoint, useReducedMotion, usePairEvents, useRunPair, useStore } from "../../../state";
import {
  getScenario, sampleIndexAt, dec, fmtKm, fmtClock, fmtDur, fmtSec, fmtCount, manoeuvreLabel,
} from "../../../data/loader";
import type { Chapter } from "../../../data/events";
import type { RunData, Zone } from "../../../data/types";
import { chipText, computeClaims, type ChapterClaim, type ChipText } from "./claims";
import { ClaimSentence, type Names } from "./claimSentence";
import { TourCard } from "./TourCard";
import { kmTicks, kmToX, makeLayout, placeLabels, xToKm, type PlacedLabel, type RouteLayout } from "./geometry";
import s from "./RouteStrip.module.css";

// ------------------------------------------------------------------ helpers

/** Index (into `chapters`) of the chapter whose play window contains t, else -1. */
function activeChapter(chapters: Chapter[], t: number): number {
  let a = -1;
  for (let i = 0; i < chapters.length; i++) {
    if (t >= chapters[i].seekT - 1e-6 && t <= chapters[i].endT + 1e-6) a = i;
  }
  return a;
}

/** Re-render once web fonts are in, so measured label widths match what is drawn. */
function useFontsReady(): boolean {
  const [ready, setReady] = useState(() => (document.fonts ? document.fonts.status === "loaded" : true));
  useEffect(() => {
    if (ready || !document.fonts) return;
    let alive = true;
    document.fonts.ready.then(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, [ready]);
  return ready;
}

let measureCtx: CanvasRenderingContext2D | null = null;
function textMeasurer(px: number): (t: string) => number {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  const ctx = measureCtx;
  const font = getComputedStyle(document.documentElement).getPropertyValue("--font-ui").trim() || "Barlow, sans-serif";
  return (t: string) => {
    if (!ctx) return t.length * px * 0.55;
    ctx.font = `400 ${px}px ${font}`;
    return ctx.measureText(t).width;
  };
}

/** First time a run reached `km` travelling in direction `dir` (+1 out, -1 back), or null. */
function passTime(run: RunData, km: number, dir: 1 | -1): number | null {
  const sm = run.samples;
  for (let k = 0; k < run.meta.n_samples; k++) {
    if (sm.dir[k] !== dir) continue;
    if (dir === 1 ? sm.d[k] >= km : sm.d[k] <= km) return sm.t[k];
  }
  return null;
}

/** Direction of travel along the km axis at sample k: +1, -1, or 0 when standing still. */
function motionAt(run: RunData, k: number): -1 | 0 | 1 {
  const d = run.samples.d;
  const dd = d[k] - d[Math.max(0, k - 3)];
  return Math.abs(dd) < 2e-5 ? 0 : dd > 0 ? 1 : -1;
}

const lower = (m: string) => m.charAt(0).toLowerCase() + m.slice(1);

// ------------------------------------------------------------------ component

export function RouteStrip() {
  const pair = useRunPair();
  const events = usePairEvents();
  const bp = useBreakpoint();
  const left = pair.left as RunData;
  const right = pair.right as RunData;
  const scenario = getScenario();
  const zones = useMemo(() => scenario?.variants[pair.variant]?.zones ?? [], [scenario, pair.variant]);
  const chapters = useMemo(() => events?.chapters ?? [], [events]);

  const chips = useMemo(() => chapters.map((c) => chipText(c, right, scenario)), [chapters, right, scenario]);
  const claims = useMemo(() => computeClaims(chapters, left, right, scenario), [chapters, left, right, scenario]);
  const active = useStore((st) => activeChapter(chapters, st.t));
  const touring = useStore((st) => st.tour !== null);
  // While the tour runs, its card carries the claim, so the strip does not repeat it.
  const activeClaim = active >= 0 && !touring ? claims.find((c) => c.index === chapters[active].index) ?? null : null;

  const names = { left: pair.leftConfig, right: pair.rightConfig, leftDecider: left.meta.decider, rightDecider: right.meta.decider };
  const wide = bp === "wide";
  const compact = bp === "compact";

  const hint = chapters.length > 0
    ? `Each chapter plays from ${fmtDur(chapters[0].t - chapters[0].seekT)} before to ${fmtDur(chapters[0].endT - chapters[0].t)} after, at ${TOUR_SPEED}×.`
    : "No chapters found in this trace.";

  const caption = (
    <Caption claim={activeClaim} names={names} form={bp === "narrow" ? "short" : "full"} hint={hint} overlay={compact} />
  );

  return (
    <div className={`${s.root} ${s[bp]}`}>
      <div className={s.gutter}>
        <span className={s.trackLabel}>Route</span>
        <VehicleReadout run={right} kmOnly={bp === "narrow"} />
      </div>
      <RouteMap
        zones={zones}
        left={left}
        right={right}
        names={names}
        twoLanes={wide}
        showLabels={!(compact && activeClaim)}
        overlay={compact && activeClaim ? caption : null}
      />
      {!compact && (
        <span className={s.chipLabel}>
          <span className={s.trackLabel}>Chapters</span>
          {/* wide: the Tour button sits in the gutter, so the claim caption keeps its full width */}
          {wide && <TourButton count={chapters.length} form="text" />}
        </span>
      )}
      <div className={s.chipRow}>
        <ChapterChips chapters={chapters} chips={chips} active={active} short={!wide} />
        {!wide && <TourButton count={chapters.length} form={compact ? "text" : "icon"} />}
        {!compact && !touring && caption}
      </div>
      <TourCard placement="frame" />
    </div>
  );
}

// ------------------------------------------------------------------ gutter readout

function VehicleReadout({ run, kmOnly }: { run: RunData; kmOnly: boolean }) {
  const k = useStore((st) => sampleIndexAt(run, st.t));
  const d = run.samples.d[k];
  const man = dec(run, "man", run.samples.man[k]);
  const text = kmOnly ? fmtKm(d) : `${fmtKm(d)}, ${lower(manoeuvreLabel(man))}`;
  return <span className={s.readout} title={`${fmtKm(d)}, ${lower(manoeuvreLabel(man))} (true manoeuvre)`}>{text}</span>;
}

// ------------------------------------------------------------------ chips

function ChapterChips({ chapters, chips, active, short }: { chapters: Chapter[]; chips: ChipText[]; active: number; short: boolean }) {
  const playRange = useStore((st) => st.playRange);
  const tourGo = useStore((st) => st.tourGo);
  const touring = useStore((st) => st.tour !== null);
  return (
    <div className={s.chips} role="group" aria-label="Chapters">
      {chapters.map((c, i) => {
        const txt = chips[i];
        const on = i === active;
        const name = txt.mid.slice(txt.km.length + 1);
        return (
          <Tooltip key={c.index} placement="bottom" content={
            <>
              <div className={s.tipTitle}>{txt.full}</div>
              <div>Plays {fmtClock(c.seekT)} to {fmtClock(c.endT)} at {TOUR_SPEED}×, then pauses.</div>
            </>
          }>
            <button type="button" className={s.chip} aria-pressed={on} aria-label={`Start chapter ${txt.full}`}
              onClick={() => (touring ? tourGo(i) : playRange(c.seekT, c.endT, TOUR_SPEED))}>
              <span className={s.chipKm}>{txt.km}</span>
              {!short && <span className={s.chipName}>{name}</span>}
              {on && <ChipProgress chapter={c} />}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

/** Start or stop the guided tour (key G): every chapter back to back. */
function TourButton({ count, form }: { count: number; form: "text" | "icon" }) {
  const on = useStore((st) => st.tour !== null);
  const toggleTour = useStore((st) => st.toggleTour);
  const hold = useReducedMotion() ? TOUR_HOLD_REDUCED_MS : TOUR_HOLD_MS;
  const label = form === "icon" ? null : on ? "Stop" : "Tour";
  return (
    <Tooltip placement="bottom" content={
      <>
        <div className={s.tipTitle}>{on ? "Stop the tour" : "Play all chapters as a tour"} (G)</div>
        <div>Plays the {fmtCount(count)} chapters back to back at {TOUR_SPEED}×, holding each claim for {fmtSec(hold / 1000, 0)}. Space pauses; a seek or step ends it.</div>
      </>
    }>
      <button type="button" className={`${s.chip} ${s.tourBtn} ${form === "icon" ? s.tourIconOnly : ""}`} aria-pressed={on} disabled={count === 0}
        aria-keyshortcuts="G" aria-label={on ? "Stop the tour" : `Play all ${fmtCount(count)} chapters as a tour`} onClick={toggleTour}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className={s.tourIcon}>
          {on ? <rect x="1.5" y="1.5" width="7" height="7" /> : <path d="M2 1 L9 5 L2 9 Z" />}
        </svg>
        {label}
      </button>
    </Tooltip>
  );
}

/** 2px text-1 bar along the bottom of the active chip: how far through its play window. */
function ChipProgress({ chapter }: { chapter: Chapter }) {
  const f = useStore((st) => Math.min(1, Math.max(0, (st.t - chapter.seekT) / (chapter.endT - chapter.seekT))));
  return <span className={s.chipProgress} style={{ transform: `scaleX(${f})` }} aria-hidden />;
}

// ------------------------------------------------------------------ claim caption

function Caption({ claim, names, form, hint, overlay }: { claim: ChapterClaim | null; names: Names; form: "full" | "short"; hint: string; overlay: boolean }) {
  if (!claim) {
    return <p className={`${s.caption} ${s.hint}`}>{hint}</p>;
  }
  const body = <ClaimSentence claim={claim} names={names} form={form} />;
  return (
    <Tooltip placement="bottom" content={
      <>
        <div>{claim.scopeNote}</div>
        <div className={s.tipNote}>
          Usable share = samples where the simulator scored the needed view as usable.
          {" "}{names.right}: {fmtDur(claim.right.seconds)} in scope; {names.left}: {fmtDur(claim.left.seconds)}.
        </div>
      </>
    }>
      <p className={`${s.caption} ${overlay ? s.captionOverlay : ""}`} tabIndex={0} aria-live="polite">{body}</p>
    </Tooltip>
  );
}

// ------------------------------------------------------------------ schematic

interface MapProps {
  zones: Zone[];
  left: RunData;
  right: RunData;
  names: Names;
  twoLanes: boolean;
  showLabels: boolean;
  overlay: ReactNode;
}

interface Hover { cx: number; cy: number; km: number; dir: 1 | -1 }

function RouteMap({ zones, left, right, names, twoLanes, showLabels, overlay }: MapProps) {
  const [ref, size] = useMeasure<HTMLDivElement>();
  const presenter = useStore((st) => st.presenter);
  const fonts = useFontsReady();
  const seek = useStore((st) => st.seek);
  const [hover, setHover] = useState<Hover | null>(null);

  const layout = useMemo(
    () => (size.width > 40 && size.height > 10 ? makeLayout(size.width, size.height, zones, twoLanes, showLabels) : null),
    [size.width, size.height, zones, twoLanes, showLabels],
  );
  const labels = useMemo(() => {
    if (!layout || !showLabels) return [];
    const px = parseFloat(getComputedStyle(document.documentElement).fontSize) * 0.8;
    return placeLabels(layout, zones, textMeasurer(px));
  }, [layout, zones, showLabels, presenter, fonts]); // eslint-disable-line react-hooks/exhaustive-deps

  const staticLayer = useMemo(() => (layout ? <StaticLayer L={layout} zones={zones} labels={labels} /> : null), [layout, zones, labels]);

  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!layout) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const km = Math.min(layout.km1, Math.max(layout.km0, xToKm(layout, x)));
    const dir: 1 | -1 = layout.twoLanes && y > (layout.yOut + layout.yBack) / 2 && (layout.endKm === null || km >= layout.endKm) ? -1 : 1;
    setHover({ cx: e.clientX, cy: e.clientY, km, dir });
  };
  const onClick = () => {
    if (!hover) return;
    const tt = passTime(right, hover.km, hover.dir);
    if (tt !== null) seek(tt);
  };

  return (
    <div ref={ref} className={s.map} onPointerMove={onMove} onPointerLeave={() => setHover(null)} onClick={onClick}>
      {layout && (
        <svg width={layout.width} height={layout.height} className={s.svg} role="img"
          aria-label={`Route schematic from ${fmtKm(layout.km0)} to ${fmtKm(layout.turnKm)} and back to ${fmtKm(layout.endKm)}, with both vehicles.`}>
          {staticLayer}
          <Vehicles L={layout} left={left} right={right} names={names} />
        </svg>
      )}
      {overlay}
      {hover && layout && (
        <TooltipBox x={hover.cx} y={hover.cy} open>
          <HoverReadout L={layout} hover={hover} zones={zones} left={left} right={right} names={names} />
        </TooltipBox>
      )}
    </div>
  );
}

function HoverReadout({ L, hover, zones, left, right, names }: { L: RouteLayout; hover: Hover; zones: Zone[]; left: RunData; right: RunData; names: Names }) {
  const tol = (3 * (L.km1 - L.km0)) / Math.max(1, L.x1 - L.x0); // 3px in km
  const here = zones.filter((z) => {
    if (z.kind === "end" && hover.dir === 1 && L.twoLanes) return false;
    return z.from_km === z.to_km ? Math.abs(hover.km - z.from_km) <= tol : hover.km >= z.from_km && hover.km <= z.to_km;
  });
  const tR = passTime(right, hover.km, hover.dir);
  const tL = passTime(left, hover.km, hover.dir);
  return (
    <div className={s.hover}>
      <div className={s.tipTitle}>{fmtKm(hover.km)}, {hover.dir === 1 ? "outbound" : "return leg"}</div>
      {here.map((z) => (
        <div key={z.name} className={s.hoverZone}><span className={s.hoverZoneName}>{z.name}.</span> {z.description}</div>
      ))}
      <table className={s.hoverTable}>
        <tbody>
          <tr><th scope="row" className={ctrlClass(names.right)}>{names.right}</th><td>{tR === null ? "Not reached" : `here at ${fmtClock(tR)}`}</td></tr>
          <tr><th scope="row" className={ctrlClass(names.left)}>{names.left}</th><td>{tL === null ? "Not reached" : `here at ${fmtClock(tL)}`}</td></tr>
        </tbody>
      </table>
      {tR !== null && <div className={s.tipNote}>Click to move the cursor to {fmtClock(tR)}.</div>}
    </div>
  );
}

// ------------------------------------------------------------------ static layer (memoised)

function StaticLayer({ L, zones, labels }: { L: RouteLayout; zones: Zone[]; labels: PlacedLabel[] }) {
  const x = (km: number) => kmToX(L, km);
  const H = L.height;
  const ramp = zones.find((z) => z.kind === "jamming_ramp");
  const r = (L.yBack - L.yOut) / 2;
  const xt = x(L.turnKm);
  const towerTop = Math.max(1, L.labelBottom - 11);
  const laneBottom = L.twoLanes ? L.yBack : L.yOut;

  // Zone spans: --color-zone-wash with 1px grid-strong edges so they read on a projector.
  const washes: ReactNode[] = [];
  const edges: number[] = [];
  for (const z of zones) {
    const a = x(z.from_km);
    const b = Math.max(x(z.to_km), a + 3);
    if (z.kind === "crater" || z.kind === "obstruction") {
      washes.push(<rect key={z.name} x={a} y={0} width={b - a} height={H} className={s.wash} />);
      edges.push(a, b);
    } else if (z.kind === "fade") {
      // Severity ramp: the radio fades across the whole zone.
      washes.push(<polygon key={z.name} points={`${a},${H} ${b},0 ${b},${H}`} className={s.wash} />);
      edges.push(b);
    } else if (z.kind === "jamming") {
      const re = ramp ? Math.min(b, Math.max(a, x(ramp.to_km))) : a;
      const rs = ramp ? Math.max(a, x(ramp.from_km)) : a;
      washes.push(<polygon key={z.name} points={`${a},${H} ${rs},${H} ${re},0 ${b},0 ${b},${H}`} className={s.wash} />);
      edges.push(b);
    }
  }

  const marks: ReactNode[] = [];
  for (const z of zones) {
    const a = x(z.from_km);
    if (z.kind === "tower") {
      marks.push(<polygon key={z.name} className={s.tower} points={`${a - 4},${towerTop + 7} ${a + 4},${towerTop + 7} ${a},${towerTop}`} />);
    } else if (z.kind === "coverage") {
      marks.push(<line key={z.name} className={s.coverage} x1={a} x2={x(Math.min(z.to_km, L.km1))} y1={H - 1} y2={H - 1} />);
    } else if (z.kind === "trigger") {
      // Blackout trigger: a dashed post across the lanes.
      marks.push(<line key={z.name} className={s.trigger} x1={a} x2={a} y1={L.yOut - 6} y2={laneBottom + 5} />);
    } else if (z.kind === "event") {
      // Upload requested here (same diamond as the timeline's upload marks).
      const y = L.yOut;
      marks.push(<polygon key={z.name} className={s.event} points={`${a},${y - 4} ${a + 4},${y} ${a},${y + 4} ${a - 4},${y}`} />);
    }
  }

  const end = L.endKm !== null ? x(L.endKm) : null;
  return (
    <g>
      {washes}
      {edges.map((ex, i) => <line key={i} className={s.zoneEdge} x1={ex} x2={ex} y1={0} y2={H} />)}
      {/* km ticks under the out lane */}
      {kmTicks(L).map((km) => <line key={km} className={s.tick} x1={x(km)} x2={x(km)} y1={L.yOut + 2} y2={L.yOut + 5} />)}
      {/* lanes */}
      <line className={s.rail} x1={x(L.km0)} x2={xt} y1={L.yOut} y2={L.yOut} />
      {L.twoLanes && (
        <>
          <path className={s.rail} d={`M ${xt} ${L.yOut} A ${r} ${r} 0 0 1 ${xt} ${L.yBack}`} />
          {end !== null && <line className={s.rail} x1={xt} x2={end} y1={L.yBack} y2={L.yBack} />}
        </>
      )}
      {marks}
      {/* inspection site: ring at the turn-around */}
      <circle className={s.site} cx={L.twoLanes ? xt + r : xt + 4} cy={(L.yOut + L.yBack) / 2} r={3.5} />
      {/* mission end on the return lane */}
      {end !== null && (
        L.twoLanes ? (
          <>
            <line className={s.endBar} x1={end} x2={end} y1={L.yBack - 5} y2={L.yBack + 5} />
            <text className={s.label} x={end - 6} y={L.yBack + 4} textAnchor="end">End</text>
          </>
        ) : (
          <line className={s.endTick} x1={end} x2={end} y1={L.yOut + 3} y2={L.yOut + 6} />
        )
      )}
      {labels.map((lb) => (
        <text key={lb.key} className={lb.quiet ? s.labelQuiet : s.label} x={lb.x} y={L.labelBottom - 3} textAnchor={lb.anchor}>{lb.text}</text>
      ))}
    </g>
  );
}

// ------------------------------------------------------------------ vehicles (per cursor step)

/**
 * Both vehicles, as one 10px square split in two: the top half is the left console's run,
 * the bottom half the right console's, each at its own position (they drift apart by a few
 * metres at most). The chevron points the way the right vehicle is moving; no chevron
 * while it stands still.
 * DESIGN-GAP: DESIGN.md draws one vehicle in text-1. There are two runs, so each half takes
 * its controller colour (identity, not status); the chevron stays text-1.
 */
function Vehicles({ L, left, right, names }: { L: RouteLayout; left: RunData; right: RunData; names: Names }) {
  const t = useStore((st) => st.t);
  const kL = sampleIndexAt(left, t);
  const kR = sampleIndexAt(right, t);
  const pos = (run: RunData, k: number) => {
    const d = run.samples.d[k];
    const dir = run.samples.dir[k];
    return { x: kmToX(L, Math.min(L.km1, Math.max(L.km0, d))), y: L.twoLanes && dir === -1 ? L.yBack : L.yOut, dir };
  };
  const pL = pos(left, kL);
  const pR = pos(right, kR);
  const m = motionAt(right, kR);
  const xt = kmToX(L, L.turnKm);
  const r = (L.yBack - L.yOut) / 2;

  // Travelled part of the route (right run).
  const travelled = pR.dir === 1
    ? `M ${kmToX(L, L.km0)} ${L.yOut} L ${pR.x} ${L.yOut}`
    : L.twoLanes
      ? `M ${kmToX(L, L.km0)} ${L.yOut} L ${xt} ${L.yOut} A ${r} ${r} 0 0 1 ${xt} ${L.yBack} L ${pR.x} ${L.yBack}`
      : `M ${kmToX(L, L.km0)} ${L.yOut} L ${xt} ${L.yOut}`;

  const cy = pR.y;
  const chev = m === 0 ? null : m > 0
    ? `${pR.x + 7},${cy - 4} ${pR.x + 11},${cy} ${pR.x + 7},${cy + 4}`
    : `${pR.x - 7},${cy - 4} ${pR.x - 11},${cy} ${pR.x - 7},${cy + 4}`;

  return (
    <g>
      <path className={s.travelled} d={travelled} />
      <rect className={s.knock} x={Math.min(pL.x, pR.x) - 6} y={Math.min(pL.y, pR.y) - 6} width={Math.abs(pL.x - pR.x) + 12} height={Math.abs(pL.y - pR.y) + 12} rx={1} />
      <rect x={pL.x - 5} y={pL.y - 5} width={10} height={5} style={{ fill: ctrlVar(names.left), stroke: ctrlVar(names.left, "edge") }} className={s.half} />
      <rect x={pR.x - 5} y={pR.y} width={10} height={5} style={{ fill: ctrlVar(names.right), stroke: ctrlVar(names.right, "edge") }} className={s.half} />
      {chev && <polygon className={s.chevron} points={chev} />}
    </g>
  );
}
