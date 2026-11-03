/**
 * Playback clock: one requestAnimationFrame loop for the whole app. While `playing`,
 * it advances the store cursor by (wall time x speed), in exact 0.1 s steps with no
 * easing (DESIGN.md 9.2). It pauses at `stopAt` (chapter tour) or at mission end.
 * Started once by the app shell; feature code only calls store actions.
 */
import { useStore, pairOf, STEP_S } from "./store";

export function startPlaybackLoop(): () => void {
  let raf = 0;
  let lastWall = 0;
  /** Simulated time carried between frames, unquantised. */
  let simT = 0;
  let running = false;

  const frame = (now: number) => {
    const s = useStore.getState();
    if (!s.playing) { running = false; return; }
    const dtWall = Math.min(0.25, (now - lastWall) / 1000); // tab was hidden: do not leap
    lastWall = now;
    // Re-sync if something else moved the cursor (seek while playing).
    if (Math.abs(simT - s.t) >= STEP_S * 1.5) simT = s.t;
    simT += dtWall * s.speed;

    const end = Math.floor(pairOf(s).duration * 10) / 10;
    const stop = s.stopAt !== null ? Math.min(s.stopAt, end) : end;
    if (simT >= stop) {
      useStore.setState({ t: Math.round(stop * 10) / 10, playing: false, stopAt: null });
      running = false;
      return;
    }
    const q = Math.floor(simT * 10 + 1e-6) / 10;
    if (q !== s.t) useStore.setState({ t: q });
    raf = requestAnimationFrame(frame);
  };

  const ensure = (playing: boolean) => {
    if (playing && !running) {
      running = true;
      lastWall = performance.now();
      simT = useStore.getState().t;
      raf = requestAnimationFrame(frame);
    } else if (!playing && running) {
      cancelAnimationFrame(raf);
      running = false;
    }
  };

  ensure(useStore.getState().playing);
  const unsub = useStore.subscribe((s, prev) => { if (s.playing !== prev.playing) ensure(s.playing); });
  return () => { unsub(); cancelAnimationFrame(raf); running = false; };
}
