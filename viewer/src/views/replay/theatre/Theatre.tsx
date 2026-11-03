/**
 * Theatre (key F): the two operators' camera feeds fill the screen, Baseline-side left and
 * Proposed right, on the same cursor as the rest of Replay. The browser is asked for full
 * screen when theatre opens; if it refuses (an iframe, a file:// policy) theatre still
 * covers the window. Esc, F or the Exit button close it.
 *
 * Nothing here is new data: tiles, verdicts and "usable so far" all read the same columns
 * as the consoles. "Usable so far" is the share of samples.useful over t >= 3 s up to the
 * cursor, the same mean the engine reports as useful_view_pct (sim/engine.py metrics()),
 * so at the end of the mission it equals the run's headline number.
 *
 * Layout: top bar (clock, km, true manoeuvre, camera layout, exit), two stages, bottom bar
 * (play, scrubber over both usability ribbons, speed). Cameras: "needed" shows only the
 * camera the true manoeuvre needs (the scored one), "both" shows front and rear.
 */
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { RunData } from "../../../data/types";
import { configLabel, getScenario, manoeuvreLabel, sampleIndexAt, dec } from "../../../data/loader";
import { SegmentedControl, ctrlVar, useResizeObserver, prepareCanvas, useTokens, withAlpha, Button } from "../../../components";
import { SPEEDS, closeTopPopover, isPopoverOpen, useRunPair, useStore, type Speed, type TheatreCams } from "../../../state";
import { fmtClock, fmtKm, fmtPct } from "../../../format";
import { buildWorld, type World } from "../consoles/scene";
import { lastSampleT, requirementAt, tileAt, TILE_CAMS } from "../consoles/model";
import { AgeBar, TileBody, stateClass, tileLabel } from "../consoles/CameraTile";
import { Verdict } from "../consoles/Verdict";
import { VerdictAnnouncer } from "../consoles/Console";
import { TourCard } from "../route/TourCard";
import cs from "../consoles/Console.module.css";
import s from "./Theatre.module.css";

/** Engine metrics score from this time on (sim/engine.py metrics(): rows with t >= 3 s). */
const SCORE_FROM_S = 3;

/** Sample index at the cursor, or -1 once the cursor is past this run's last sample. */
function useSampleIndex(run: RunData): number {
  const end = lastSampleT(run) + run.meta.dt / 2;
  return useStore((st) => (st.t > end ? -1 : sampleIndexAt(run, st.t)));
}

/** Prefix counts of usable and scored samples (t >= 3 s), for "usable so far". */
function usePrefix(run: RunData): { useful: Uint32Array; scored: Uint32Array } {
  return useMemo(() => {
    const n = run.meta.n_samples;
    const useful = new Uint32Array(n + 1);
    const scored = new Uint32Array(n + 1);
    for (let i = 0; i < n; i++) {
      const on = run.samples.t[i] >= SCORE_FROM_S - 1e-6 ? 1 : 0;
      scored[i + 1] = scored[i] + on;
      useful[i + 1] = useful[i] + (on && run.samples.useful[i] === 1 ? 1 : 0);
    }
    return { useful, scored };
  }, [run]);
}

/** Largest 4:3 tile width for n tiles in a w x h box (row or column, whichever is bigger). */
function fitTiles(w: number, h: number, n: number, gap: number, below: number): { tw: number; dir: "row" | "column" } {
  const cell = (cw: number, ch: number) => Math.max(0, Math.min(cw, ((ch - below) * 4) / 3));
  if (n <= 1) return { tw: Math.floor(cell(w, h)), dir: "row" };
  const row = cell((w - gap) / 2, h);
  const col = cell(w, (h - gap) / 2);
  return row >= col ? { tw: Math.floor(row), dir: "row" } : { tw: Math.floor(col), dir: "column" };
}

const Stage = memo(function Stage({ run, config, cams }: { run: RunData; config: string; cams: TheatreCams }) {
  const variant = run.meta.variant;
  const world: World = useMemo(() => buildWorld(variant, getScenario()?.variants?.[variant]?.zones), [variant]);
  const k0 = useSampleIndex(run);
  const ended = k0 < 0;
  const k = ended ? run.meta.n_samples - 1 : k0;
  const pre = usePrefix(run);
  const box = useRef<HTMLDivElement>(null);
  const { width, height } = useResizeObserver(box);

  const models = useMemo(() => TILE_CAMS.map((cam) => tileAt(run, k, cam, ended)), [run, k, ended]);
  const neededCam = requirementAt(run, k)?.req.cam;
  const shown = cams === "both" ? models : models.filter((m) => m.cam === (neededCam ?? "front"));
  const { tw, dir } = fitTiles(width, height, shown.length, 16, 10);

  const scored = pre.scored[k + 1];
  const pct = scored > 0 ? (100 * pre.useful[k + 1]) / scored : null;

  return (
    <section className={s.stage} aria-label={`${config} camera feeds`}>
      <header className={s.stageHead}>
        <h2 className={s.stageTitle} style={{ color: ctrlVar(config, "text") }}>{configLabel(config, run.meta.decider)}</h2>
        <span className={s.sofar} title="Share of scored samples (from 0:03) with a usable view, up to the cursor. At the end it equals the run's usable-view metric.">
          Usable so far <b>{pct === null ? "scored from 0:03" : fmtPct(pct)}</b>
        </span>
      </header>
      <div ref={box} className={s.tileBox} style={{ flexDirection: dir }}>
        {tw > 0 && shown.map((m) => (
          <figure key={m.cam} className={s.fig} style={{ width: tw }}>
            <div className={`${stateClass(m)} ${cs.big}`} role="img" aria-label={tileLabel(m, config)}>
              <TileBody run={run} world={world} model={m} width={tw} zoom config={config} />
            </div>
            <AgeBar model={m} />
          </figure>
        ))}
      </div>
      <div className={s.verdict}>
        <Verdict run={run} k={k} config={config} endedAt={ended ? run.meta.mission_time_s : null} />
      </div>
    </section>
  );
});

/** Two usability ribbons (left above right) with a cursor; click or drag to seek. */
function Scrubber({ left, right, duration }: { left: RunData; right: RunData; duration: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const { width } = useResizeObserver(wrap);
  const tokens = useTokens();
  const t = useStore((st) => st.t);
  const H = 22;

  useLayoutEffect(() => {
    const el = canvas.current;
    if (!el || width <= 0 || duration <= 0) return;
    const ctx = prepareCanvas(el, width, H);
    if (!ctx) return;
    const bad = tokens.get("--color-status-bad");
    const row = (run: RunData, color: string, y: number, h: number) => {
      const n = run.meta.n_samples;
      const cols = new Float32Array(width);
      const cnt = new Uint16Array(width);
      for (let i = 0; i < n; i++) {
        const x = Math.min(width - 1, Math.floor((run.samples.t[i] / duration) * width));
        cnt[x]++;
        if (run.samples.useful[i] === 1) cols[x]++;
      }
      ctx.fillStyle = color;
      for (let x = 0; x < width; x++) if (cnt[x]) ctx.fillRect(x, y, 1, h);
      for (let x = 0; x < width; x++) {
        if (!cnt[x]) continue;
        const f = cols[x] / cnt[x];
        if (f < 1) { ctx.fillStyle = withAlpha(bad, 1 - f); ctx.fillRect(x, y, 1, h); }
      }
    };
    row(left, tokens.get(left.meta.config === "Baseline" ? "--color-ctrl-baseline" : "--color-ctrl-other"), 0, 10);
    row(right, tokens.get("--color-ctrl-proposed"), 12, 10);
  }, [left, right, width, duration, tokens]);

  const x = duration > 0 ? (t / duration) * 100 : 0;
  return (
    <div ref={wrap} className={s.scrub}>
      <canvas ref={canvas} className={s.ribbons} aria-hidden />
      <span className={s.cursor} style={{ left: `${x}%` }} aria-hidden />
      <input type="range" className={s.range} min={0} max={duration} step={0.1} value={t} data-owns-arrows
        aria-label="Mission time" aria-valuetext={`${fmtClock(t)} of ${fmtClock(duration)}`}
        onChange={(e) => useStore.getState().seek(Number(e.currentTarget.value))} />
    </div>
  );
}

function PlayToggle() {
  const playing = useStore((st) => st.playing || st.tour?.phase === "hold"); // tour hold counts as playing
  return (
    <button type="button" className={s.play} aria-label={playing ? "Pause" : "Play"} title={`${playing ? "Pause" : "Play"} (Space)`}
      onClick={() => useStore.getState().togglePlay()}>
      <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden>
        {playing
          ? <><rect x="3.5" y="2.5" width="3" height="11" fill="currentColor" /><rect x="9.5" y="2.5" width="3" height="11" fill="currentColor" /></>
          : <path d="M4 2.5 L13.5 8 L4 13.5 Z" fill="currentColor" />}
      </svg>
    </button>
  );
}

function ClockLine({ right, duration }: { right: RunData; duration: number }) {
  const t = useStore((st) => st.t);
  const k = sampleIndexAt(right, t);
  const man = dec(right, "man", right.samples.man[k]);
  return (
    <span className={s.clockLine}>
      <span className={s.clock}>{fmtClock(t)}</span>
      <span className={s.dim}>/ {fmtClock(duration)}</span>
      <span className={s.km}>{fmtKm(right.samples.d[k])}</span>
      {man && <span className={s.man} title="True manoeuvre from the driver script; the score always uses it">{manoeuvreLabel(man)}</span>}
    </span>
  );
}

export function Theatre() {
  const pair = useRunPair();
  const cams = useStore((st) => st.theatreCams);
  const speed = useStore((st) => st.speed);
  const root = useRef<HTMLDivElement>(null);
  const entered = useRef(false);

  // Leaving browser full screen (Esc handled by the browser) closes theatre too.
  useEffect(() => {
    const on = () => {
      if (document.fullscreenElement) entered.current = true;
      else if (entered.current) {
        entered.current = false;
        // The browser leaves full screen on Esc by itself. With a dialog open over theatre
        // (e.g. "How we got these numbers") that Esc was meant for the dialog: close it
        // and keep theatre, which still fills the window.
        if (isPopoverOpen()) { closeTopPopover(); return; }
        useStore.getState().setTheatre(false);
      }
    };
    document.addEventListener("fullscreenchange", on);
    if (document.fullscreenElement) entered.current = true;
    // Modal: take focus on open and hand it back to whatever opened theatre on close.
    // The opener has usually unmounted with the frame by now, leaving focus on <body>.
    const a = document.activeElement;
    const opener = a instanceof HTMLElement && a !== document.body ? a : null;
    root.current?.focus();
    return () => {
      document.removeEventListener("fullscreenchange", on);
      // The frame (and usually the opener) remounts after theatre closes: focus the opener if
      // it survived, else the playback bar's full-screen button once it is back.
      requestAnimationFrame(() => {
        const back = opener?.isConnected ? opener : document.querySelector<HTMLElement>("[data-theatre-opener]");
        back?.focus();
      });
    };
  }, []);

  /** Keep Tab inside theatre (aria-modal). */
  const trapTab = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !root.current) return;
    const items = [...root.current.querySelectorAll<HTMLElement>(
      "button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex='-1'])",
    )].filter((el) => el.tabIndex >= 0 && el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const at = document.activeElement;
    if (e.shiftKey && (at === first || at === root.current)) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && at === last) { first.focus(); e.preventDefault(); }
  };

  if (pair.status !== "ready" || !pair.left || !pair.right) return null;
  const { left, right } = pair;

  return (
    <div ref={root} className={s.root} role="dialog" aria-modal="true" aria-label="Theatre: camera feeds full screen" tabIndex={-1} onKeyDown={trapTab}>
      <VerdictAnnouncer left={left} right={right} leftConfig={pair.leftConfig} rightConfig={pair.rightConfig} />
      <div className={s.top}>
        <ClockLine right={right} duration={pair.duration} />
        <TourCard placement="theatre" />
        <span className={s.topControls}>
          <SegmentedControl<TheatreCams> ariaLabel="Cameras shown" label="Cameras" value={cams}
            onChange={(v) => useStore.getState().setTheatreCams(v)}
            options={[
              { value: "needed", label: "Needed now", title: "Only the camera the true manoeuvre needs: the one that is scored (C)" },
              { value: "both", label: "Front and rear", title: "Both cameras on each side (C)" },
            ]} />
          <Button onClick={() => useStore.getState().setTheatre(false)} title="Exit theatre (Esc or F)">Exit</Button>
        </span>
      </div>

      <div className={s.stages}>
        <Stage run={left} config={pair.leftConfig} cams={cams} />
        <span className={s.divider} aria-hidden />
        <Stage run={right} config={pair.rightConfig} cams={cams} />
      </div>

      <div className={s.bottom}>
        <PlayToggle />
        <Scrubber left={left} right={right} duration={pair.duration} />
        <SegmentedControl<Speed> ariaLabel="Playback speed" label="Speed" value={speed}
          options={SPEEDS.map((v) => ({ value: v, label: `${v}×` }))} onChange={(v) => useStore.getState().setSpeed(v)} />
      </div>
      <p className={s.note}>
        Ribbons: top {pair.leftConfig}, bottom {pair.rightConfig}; red where the view was not usable. Camera views are drawn
        from the simulated position, not recorded video. Keys: Space play, ←/→ step, [ ] speed, C cameras, G tour, Esc exit.
      </p>
    </div>
  );
}
