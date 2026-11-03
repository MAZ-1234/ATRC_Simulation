/**
 * React hooks over the store. Feature code should use these (or `useStore(selector)`)
 * and never keep its own copy of the cursor, theme or selection.
 */
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore, pairOf, RIGHT_CONFIG, type Speed, type Theme } from "./store";
import { loadRun, peekRun, RunLoadError } from "../data/loader";
import { computePairEvents, type PairEvents } from "../data/events";
import type { RunData } from "../data/types";

export { useStore };

/** Cursor time only (re-renders every 0.1 s step while playing). */
export function useCursorT(): number {
  return useStore((s) => s.t);
}

export interface Playback {
  t: number;
  playing: boolean;
  speed: Speed;
  stopAt: number | null;
  /** Mission length of the current pair, s (0 when not exported). */
  duration: number;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  seek: (t: number) => void;
  step: (dt: number) => void;
  setSpeed: (s: Speed) => void;
  faster: () => void;
  slower: () => void;
  playRange: (from: number, to: number, speed?: Speed) => void;
}

/** Cursor, play state and playback actions. */
export function usePlayback(): Playback {
  const p = useStore(useShallow((s) => ({
    t: s.t, playing: s.playing, speed: s.speed, stopAt: s.stopAt,
    play: s.play, pause: s.pause, togglePlay: s.togglePlay, seek: s.seek, step: s.step,
    setSpeed: s.setSpeed, faster: s.faster, slower: s.slower, playRange: s.playRange,
  })));
  const duration = useStore((s) => pairOf(s).duration);
  return { ...p, duration };
}

export interface ThemeApi {
  theme: Theme;
  /** False while following the OS setting. */
  explicit: boolean;
  presenter: boolean;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  togglePresenter: () => void;
}

/** Resolved theme and presenter mode. Canvas code should redraw when `theme` or `presenter` changes. */
export function useTheme(): ThemeApi {
  return useStore(useShallow((s) => ({
    theme: s.theme, explicit: s.themeExplicit, presenter: s.presenter,
    setTheme: s.setTheme, toggleTheme: s.toggleTheme, togglePresenter: s.togglePresenter,
  })));
}

export type PairStatus = "loading" | "ready" | "error" | "missing";

export interface RunPair {
  /** loading: files are being injected; ready: both loaded; error: a file failed;
   *  missing: the selected config/variant/seed was not exported (see `missing`). */
  status: PairStatus;
  variant: string;
  seed: number;
  leftConfig: string;
  rightConfig: string;
  leftId: string | null;
  rightId: string | null;
  left: RunData | null;
  right: RunData | null;
  /** First load error (has `.hint` with the fix). */
  error: RunLoadError | Error | null;
  /** Config names that are not exported for this variant + seed. */
  missing: string[];
  /** Max mission time of the pair, s. */
  duration: number;
}

/**
 * The left (compare) and right (Proposed) runs for the current variant + seed, loaded on
 * demand. Loads are cached and shared, so any number of components may call this.
 */
export function useRunPair(): RunPair {
  const sel = useStore(useShallow((s) => ({ variant: s.variant, seed: s.seed, compare: s.compare })));
  const { leftId, rightId, duration } = useMemo(() => pairOf(sel), [sel.variant, sel.seed, sel.compare]); // eslint-disable-line

  const [state, setState] = useState<{ key: string; left: RunData | null; right: RunData | null; error: Error | null; pending: boolean }>(() => ({
    key: `${leftId}|${rightId}`, left: peekRun(leftId) ?? null, right: peekRun(rightId) ?? null, error: null, pending: false,
  }));
  const key = `${leftId}|${rightId}`;

  useEffect(() => {
    let alive = true;
    const l0 = peekRun(leftId) ?? null;
    const r0 = peekRun(rightId) ?? null;
    const needs = (leftId && !l0) || (rightId && !r0);
    setState({ key, left: l0, right: r0, error: null, pending: !!needs });
    if (!needs) return;
    Promise.allSettled([leftId ? loadRun(leftId) : Promise.resolve(null), rightId ? loadRun(rightId) : Promise.resolve(null)])
      .then(([l, r]) => {
        if (!alive) return;
        const err = l.status === "rejected" ? l.reason : r.status === "rejected" ? r.reason : null;
        setState({
          key,
          left: l.status === "fulfilled" ? l.value : null,
          right: r.status === "fulfilled" ? r.value : null,
          error: err instanceof Error ? err : err ? new Error(String(err)) : null,
          pending: false,
        });
      });
    return () => { alive = false; };
  }, [key]); // eslint-disable-line

  const fresh = state.key === key;
  const left = fresh ? state.left : peekRun(leftId) ?? null;
  const right = fresh ? state.right : peekRun(rightId) ?? null;
  const missing: string[] = [];
  if (!leftId) missing.push(sel.compare);
  if (!rightId) missing.push(RIGHT_CONFIG);
  const status: PairStatus =
    missing.length > 0 ? "missing"
      : fresh && state.error ? "error"
        : left && right ? "ready" : "loading";
  return {
    status, variant: sel.variant, seed: sel.seed, leftConfig: sel.compare, rightConfig: RIGHT_CONFIG,
    leftId, rightId, left, right, error: fresh ? state.error : null, missing, duration,
  };
}

/** Chapters, divergences, interruptions and who-saw spans for the loaded pair (null until loaded). */
export function usePairEvents(): PairEvents | null {
  const pair = useRunPair();
  return useMemo(
    () => (pair.left || pair.right ? computePairEvents(pair.left, pair.right) : null),
    [pair.left, pair.right],
  );
}

/** Responsive class from DESIGN.md 5.1: wide >= 1360, compact 1024-1359, narrow < 1024. */
export type Breakpoint = "wide" | "compact" | "narrow";
/** Wide needs this much viewport height for the Replay frame (48 + 64 + 380 + 280 + 56). */
const WIDE_MIN_H = 828;
/** Mirrors the CSS breakpoints in styles/tokens.css (wide but short counts as compact). */
function bp(): Breakpoint {
  const w = window.innerWidth;
  return w >= 1360 && window.innerHeight >= WIDE_MIN_H ? "wide" : w >= 1024 ? "compact" : "narrow";
}
export function useBreakpoint(): Breakpoint {
  const [b, setB] = useState<Breakpoint>(bp);
  useEffect(() => {
    const on = () => setB(bp());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return b;
}

/** prefers-reduced-motion, live. */
export function useReducedMotion(): boolean {
  const q = "(prefers-reduced-motion: reduce)";
  const [r, setR] = useState(() => { try { return window.matchMedia(q).matches; } catch { return false; } });
  useEffect(() => {
    let mq: MediaQueryList | null = null;
    try { mq = window.matchMedia(q); } catch { return; }
    const on = () => setR(mq!.matches);
    mq.addEventListener("change", on);
    return () => mq?.removeEventListener("change", on);
  }, []);
  return r;
}
