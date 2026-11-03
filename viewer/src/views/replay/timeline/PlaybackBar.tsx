/**
 * Playback bar (DESIGN.md 6.1 bottom row, 6.1.2, 6.1.3, 7 Playback bar, 11 keyboard).
 *
 * play/pause (40px), previous/next event (J/K, honouring the jump filter), mission clock
 * (display 24/600) and km, speed, jump filter and the shortcut sheet button. States:
 * playing, paused, at-end ("Mission ended at 22:10.4. Press Home to restart.") and no
 * trace (disabled controls plus a sentence). Every control calls the same store actions
 * as the global keys in src/app/useGlobalKeys.ts.
 *
 * Only the clock subscribes to the cursor, so playback re-renders a few text nodes per
 * frame and nothing else.
 *
 * Breakpoints: wide shows every speed; compact (6.1.2) shows 1x, 4x, 16x and a "More"
 * menu; narrow (6.1.3) shows play, events, clock and one "Speed" menu that also holds
 * the jump filter.
 */
import { useMemo, useRef, useState } from "react";
import { Button, Popover, SegmentedControl, type SegmentOption } from "../../../components";
import {
  SPEEDS, useBreakpoint, usePairEvents, useRunPair, useStore, type Speed,
} from "../../../state";
import {
  jumpTargets, nextTarget, prevTarget, MIN_DIVERGENCE_S, type JumpFilter, type PairEvents,
} from "../../../data/events";
import { sampleIndexAt } from "../../../data/loader";
import type { RunData } from "../../../data/types";
import { fmtClock, fmtCount, fmtKm, fmtSec } from "../../../format";
import { jumpEvent } from "../../../app/useGlobalKeys";
import { endedAt } from "./readout";
import s from "./PlaybackBar.module.css";

const speedLabel = (v: number) => `${v}×`;
const COMPACT_SPEEDS: Speed[] = [1, 4, 16];

const FILTER_NOUN: Record<JumpFilter, [string, string]> = {
  divergences: ["divergence", "Divergences"],
  interruptions: ["interruption", "Interruptions"],
  chapters: ["chapter", "Chapters"],
  all: ["event", "All"],
};

/** Option tooltips with counts from the trace (and the engine metric, labelled as such). */
function filterOptions(ev: PairEvents | null, left: RunData | null, right: RunData | null, leftConfig: string, rightConfig: string): SegmentOption<JumpFilter>[] {
  const nDiv = ev?.divergences.length ?? 0;
  const nIntL = ev?.interruptions.filter((i) => i.side === "left").length ?? 0;
  const nIntR = ev?.interruptions.filter((i) => i.side === "right").length ?? 0;
  const eng = (r: RunData | null) => fmtCount(r?.metrics.interruptions ?? null);
  // Two different counts, always labelled: trace-derived 1 -> 0 edges of samples.useful (what
  // J / K stops at) and the engine's `interruptions` metric (runs of a lost view from t = 3 s,
  // sim/engine.py metrics()). Name the difference only when the numbers actually differ.
  const same = left?.metrics.interruptions === nIntL && right?.metrics.interruptions === nIntR;
  const engineText = same
    ? `The engine's interruption metric gives the same counts.`
    : `The engine's interruption metric, which scores from 3 s on and also counts a view lost from the start, gives ${eng(left)} and ${eng(right)}.`;
  return [
    { value: "divergences", label: "Divergences",
      title: `${fmtCount(nDiv)} stretches of ${fmtSec(MIN_DIVERGENCE_S)} or more where only one controller's view was usable (from the trace).` },
    { value: "interruptions", label: "Interruptions",
      title: `Starts of a lost view in the trace: ${leftConfig} ${fmtCount(nIntL)}, ${rightConfig} ${fmtCount(nIntR)}. ${engineText}` },
    { value: "chapters", label: "Chapters", title: `${fmtCount(ev?.chapters.length ?? 0)} tour chapters, each started 5 s early.` },
    { value: "all", label: "All", title: "Divergences, interruptions and chapters." },
  ];
}

// ------------------------------------------------------------------ icons (currentColor)

function PlayIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><path d="M4 2.5 L13.5 8 L4 13.5 Z" fill="currentColor" /></svg>;
}
function PauseIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><rect x="3.5" y="2.5" width="3" height="11" fill="currentColor" /><rect x="9.5" y="2.5" width="3" height="11" fill="currentColor" /></svg>;
}
function PrevIcon() {
  return <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><rect x="2" y="2.5" width="1.75" height="9" fill="currentColor" /><path d="M12 2.5 L5 7 L12 11.5 Z" fill="currentColor" /></svg>;
}
function NextIcon() {
  return <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><rect x="10.25" y="2.5" width="1.75" height="9" fill="currentColor" /><path d="M2 2.5 L9 7 L2 11.5 Z" fill="currentColor" /></svg>;
}

function FullIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden style={{ verticalAlign: "-2px" }}>
      <path d="M1.5 5V1.5H5M9 1.5h3.5V5M12.5 9v3.5H9M5 12.5H1.5V9" stroke="currentColor" strokeWidth="1.6" fill="none" />
    </svg>
  );
}

// ------------------------------------------------------------------ parts

function PlayButton({ disabled }: { disabled: boolean }) {
  // A tour holding its caption between chapters counts as playing: the button pauses it.
  const playing = useStore((st) => st.playing || st.tour?.phase === "hold");
  const label = playing ? "Pause" : "Play";
  return (
    <button type="button" className={s.play} disabled={disabled} aria-label={label} title={`${label} (Space)`}
      onClick={() => useStore.getState().togglePlay()}>
      {playing ? <PauseIcon /> : <PlayIcon />}
    </button>
  );
}

function EventButtons({ targets, filter, disabled }: { targets: number[]; filter: JumpFilter; disabled: boolean }) {
  const prev = useStore((st) => prevTarget(targets, st.t));
  const next = useStore((st) => nextTarget(targets, st.t));
  const noun = FILTER_NOUN[filter][0];
  const prevLabel = prev !== null ? `Previous ${noun} at ${fmtClock(prev)} (J)` : `No earlier ${noun}`;
  const nextLabel = next !== null ? `Next ${noun} at ${fmtClock(next)} (K)` : `No later ${noun}`;
  return (
    <span className={s.events}>
      <Button variant="icon" disabled={disabled || prev === null} aria-label={prevLabel} title={prevLabel} onClick={() => jumpEvent(-1)}>
        <PrevIcon />
      </Button>
      <Button variant="icon" disabled={disabled || next === null} aria-label={nextLabel} title={nextLabel} onClick={() => jumpEvent(1)}>
        <NextIcon />
      </Button>
    </span>
  );
}

/** Mission clock and position: the only part of the bar that follows the cursor. */
function Clock({ duration, left, right, live }: { duration: number; left: RunData | null; right: RunData | null; live: boolean }) {
  const t = useStore((st) => st.t);
  const ref = right && !endedAt(right, t) ? right : left ?? right;
  const km = live && ref ? fmtKm(ref.samples.d[sampleIndexAt(ref, t)]) : null;
  const who = ref === right ? "Proposed" : ref?.meta.config;
  return (
    <span className={s.clockGroup}>
      <span className={s.clock} aria-label={`Mission time ${fmtClock(t)} of ${duration > 0 ? fmtClock(duration) : "unknown"}`}>
        <span className={s.now}>{fmtClock(t)}</span>
        <span className={s.total}> / {duration > 0 ? fmtClock(duration) : "–"}</span>
      </span>
      {km && <span className={s.km} title={`Position of the ${who} vehicle along the route`}>{km}</span>}
    </span>
  );
}

function AtEnd({ duration }: { duration: number }) {
  const end = Math.floor(duration * 10) / 10;
  const atEnd = useStore((st) => duration > 0 && !st.playing && st.t >= end - 1e-6);
  if (!atEnd) return null;
  return <span className={s.status} role="status">Mission ended at {fmtClock(duration)}. Press Home to restart.</span>;
}

function openShortcuts() {
  useStore.getState().setShortcutsOpen(true);
}

// ------------------------------------------------------------------ bar

export function PlaybackBar() {
  const pair = useRunPair();
  const events = usePairEvents();
  const bp = useBreakpoint();
  const speed = useStore((st) => st.speed);
  const filter = useStore((st) => st.jumpFilter);
  const { setSpeed, setJumpFilter } = useStore.getState();
  const [menu, setMenu] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);

  const ready = pair.status === "ready";
  const off = !ready;
  const duration = pair.duration;
  const targets = useMemo(() => (events ? jumpTargets(events, filter) : []), [events, filter]);
  const fOptions = useMemo(
    () => filterOptions(events, pair.left, pair.right, pair.leftConfig, pair.rightConfig),
    [events, pair.left, pair.right, pair.leftConfig, pair.rightConfig],
  );
  const allSpeeds: SegmentOption<Speed>[] = SPEEDS.map((v) => ({ value: v, label: speedLabel(v), disabled: off }));

  const noTrace = pair.status === "missing" ? `No trace for seed ${pair.seed}, so playback is off.`
    : pair.status === "error" ? `The trace for seed ${pair.seed} did not load, so playback is off.`
      : pair.status === "loading" ? `Loading seed ${pair.seed}` : null;

  const filterControl = (
    <SegmentedControl<JumpFilter> ariaLabel="Jump to" label="Jump to" value={filter}
      options={fOptions.map((o) => ({ ...o, disabled: off }))} onChange={setJumpFilter} className={s.filter} />
  );

  const hidden = !COMPACT_SPEEDS.includes(speed);
  let speedControl: JSX.Element;
  if (bp === "wide") {
    speedControl = <SegmentedControl<Speed> ariaLabel="Playback speed" label="Speed" value={speed} options={allSpeeds} onChange={setSpeed} />;
  } else if (bp === "compact") {
    speedControl = (
      <span className={s.speedCompact}>
        <SegmentedControl<Speed> ariaLabel="Playback speed" label="Speed" value={speed}
          options={COMPACT_SPEEDS.map((v) => ({ value: v, label: speedLabel(v), disabled: off }))} onChange={setSpeed} />
        <Button ref={moreRef} pressed={hidden} disabled={off} aria-haspopup="dialog" aria-expanded={menu}
          title="All speeds: 0.5× to 60×" onClick={() => setMenu((m) => !m)}>
          {hidden ? speedLabel(speed) : "More"}
        </Button>
      </span>
    );
  } else {
    speedControl = (
      <Button ref={moreRef} disabled={off} aria-haspopup="dialog" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
        Speed {speedLabel(speed)}
      </Button>
    );
  }

  return (
    <div className={[s.bar, s[bp]].join(" ")} role="group" aria-label="Playback">
      <span className={s.transport}>
        <PlayButton disabled={off || duration <= 0} />
        <EventButtons targets={targets} filter={filter} disabled={off} />
      </span>

      <span className={s.middle}>
        <Clock duration={duration} left={pair.left} right={pair.right} live={ready} />
        {noTrace ? <span className={off && pair.status !== "loading" ? s.noTrace : s.loading}>{noTrace}</span> : <AtEnd duration={duration} />}
      </span>

      <span className={s.controls}>
        {speedControl}
        {bp !== "narrow" && filterControl}
        <Button disabled={off} title="Camera feeds full screen (F)" aria-label="Camera feeds full screen" data-theatre-opener onClick={() => useStore.getState().setTheatre(true)}>
          <FullIcon /> {bp === "wide" ? "Full screen" : null}
        </Button>
        <Button variant="icon" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" className={s.help} onClick={openShortcuts}>?</Button>
      </span>

      <Popover open={menu} onClose={() => setMenu(false)} anchorRef={moreRef} placement="top-start"
        title={bp === "narrow" ? "Playback" : "Speed"} width={360}>
        <div className={s.menu}>
          <SegmentedControl<Speed> ariaLabel="Playback speed" label={bp === "narrow" ? "Speed" : undefined} value={speed} options={allSpeeds}
            onChange={(v) => { setSpeed(v); if (bp !== "narrow") setMenu(false); }} />
          {bp === "narrow" && filterControl}
          <p className={s.menuNote}>Keys: [ slower, ] faster, J and K for the previous or next event.</p>
        </div>
      </Popover>
    </div>
  );
}
