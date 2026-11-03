/**
 * The single global store (DESIGN.md 12): {view, run source, variant, seed, compare,
 * t, playing, speed, jumpFilter, theme, presenter} plus a focused event.
 * Mirrored to the URL hash by ./url.ts; playback is advanced by ./playback.ts.
 *
 * Read with selectors so components re-render only for what they use:
 *   const t = useStore((s) => s.t);
 *   const { seek, play } = useStore.getState();       // actions are stable
 */
import { create } from "zustand";
import { getManifest, manifestRun, runIdFor, configsFor, seedsFor, typicalSeed, peekRun } from "../data/loader";
import { computePairEvents, type Chapter, type JumpFilter, type Side } from "../data/events";
import { announce } from "./overlay";

export type View = "replay" | "results" | "scenario" | "method";
export const VIEWS: View[] = ["replay", "results", "scenario", "method"];
export const VIEW_LABEL: Record<View, string> = { replay: "Replay", results: "Results", scenario: "Scenario", method: "Method" };

export type Theme = "light" | "dark";
export type TheatreCams = "needed" | "both";

/** Playback speeds in order ([ and ] step through them). */
export const SPEEDS = [0.5, 1, 2, 4, 8, 16, 60] as const;
export type Speed = (typeof SPEEDS)[number];

/** The right console always shows this configuration. */
export const RIGHT_CONFIG = "Proposed";
/** Default configuration of the left console. */
export const DEFAULT_COMPARE = "Baseline";
export const DEFAULT_VARIANT = "nominal";

/** Cursor step: the sample period (0.1 s). Every t in the store is a multiple of it. */
export const STEP_S = 0.1;

/** An event the user selected (timeline click, who-saw block, Results "Show in replay"). */
export interface FocusEvent {
  t: number;
  /** Free-form kind, e.g. "divergence", "interruption", "chapter", "decision", "result". */
  kind: string;
  side?: Side;
  /** Optional short description for logs / tooltips. */
  label?: string;
  /** Chapter index when kind === "chapter". */
  chapter?: number;
}

/**
 * Guided tour (key G): every chapter back to back. Each chapter seeks to its seekT, plays at
 * TOUR_SPEED until its endT, holds for TOUR_HOLD_MS with its claim caption, then advances.
 *   playing  the chapter's window is playing
 *   hold     the window has ended; the caption is held before the next chapter
 *   paused   the user paused (Space, play button, leaving Replay); play resumes the tour
 *   done     the last chapter's hold has ended; the card offers Restart and Close
 * A manual seek, step, chapter-chip click or run change ends the tour.
 */
export type TourPhase = "playing" | "hold" | "paused" | "done";
export interface TourState {
  /** Index into the pair's chapters (computePairEvents(...).chapters). */
  step: number;
  /** Number of chapters in the tour. */
  count: number;
  phase: TourPhase;
}
/** Tour playback speed (DESIGN.md 6.1.1: chapters play at 4×). */
export const TOUR_SPEED: Speed = 4;
/** How long the caption is held after each chapter, ms (longer under reduced motion). */
export const TOUR_HOLD_MS = 2000;
export const TOUR_HOLD_REDUCED_MS = 5000;

export interface AppState {
  view: View;
  variant: string;
  seed: number;
  /** Config on the left console (default "Baseline"); right is always "Proposed". */
  compare: string;

  /** Cursor, s, a multiple of STEP_S, within [0, duration]. */
  t: number;
  playing: boolean;
  speed: Speed;
  /** When set, playback pauses on reaching this time (chapter tour). */
  stopAt: number | null;
  jumpFilter: JumpFilter;

  theme: Theme;
  /** True once the user chose a theme (then it is persisted); false = follows the OS. */
  themeExplicit: boolean;
  presenter: boolean;
  /** Theatre: the camera feeds fill the screen (key F). Not mirrored to the URL. */
  theatre: boolean;
  /** Theatre layout: only the camera the true manoeuvre needs, or both cameras per side. */
  theatreCams: TheatreCams;

  focus: FocusEvent | null;
  /** True after the first user interaction (the ribbon draw-in only runs before it). */
  interacted: boolean;
  /** Shortcut sheet (key ?) open. Not mirrored to the URL. */
  shortcutsOpen: boolean;
  /** Guided tour (key G), null when off. Not mirrored to the URL. */
  tour: TourState | null;

  // ---- actions (stable references)
  setView: (v: View) => void;
  setVariant: (v: string) => void;
  setSeed: (s: number) => void;
  setCompare: (config: string) => void;
  /** Move the cursor (quantised to 0.1 s, clamped). Does not change `playing`. */
  seek: (t: number) => void;
  /** Move the cursor by dt seconds (e.g. +-0.1, +-1). */
  step: (dt: number) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  setSpeed: (s: Speed) => void;
  faster: () => void;
  slower: () => void;
  /** Seek to `from` and play at `speed` until `to`, then pause (chapter tour). */
  playRange: (from: number, to: number, speed?: Speed) => void;
  setJumpFilter: (f: JumpFilter) => void;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  setPresenter: (on: boolean) => void;
  togglePresenter: () => void;
  /** Open or close theatre; also asks the browser for full screen (needs a user gesture). */
  setTheatre: (on: boolean) => void;
  toggleTheatre: () => void;
  setTheatreCams: (c: TheatreCams) => void;
  setFocus: (f: FocusEvent | null) => void;
  markInteracted: () => void;
  setShortcutsOpen: (open: boolean) => void;
  /** Start the tour at chapter `step` (default the first); also switches to Replay. */
  startTour: (step?: number) => void;
  /** Start the tour, or stop it when it is on (key G, route strip button). */
  toggleTour: () => void;
  /** Jump the running tour to chapter `step` (Previous / Next / chip click while touring); past the last chapter it finishes. */
  tourGo: (step: number) => void;
  /** End the tour; the cursor stays where it is, paused. */
  stopTour: () => void;
}

// ------------------------------------------------------------------ persistence (try/catch)

const LS_THEME = "edge-mlc-viewer.theme";
const LS_PRESENTER = "edge-mlc-viewer.presenter";
const LS_THEATRE_CAMS = "edge-mlc-viewer.theatre-cams";

function lsGet(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function lsSet(key: string, value: string): void {
  try { window.localStorage.setItem(key, value); } catch { /* storage blocked: keep in memory */ }
}

function systemTheme(): Theme {
  try { return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; } catch { return "light"; }
}

// ------------------------------------------------------------------ pair helpers

/** Run ids and duration for the current selection (ids are null when not exported). */
export function pairOf(s: Pick<AppState, "variant" | "seed" | "compare">): {
  leftId: string | null; rightId: string | null; duration: number;
} {
  const leftId = runIdFor(s.compare, s.variant, s.seed);
  const rightId = runIdFor(RIGHT_CONFIG, s.variant, s.seed);
  const duration = Math.max(manifestRun(leftId)?.mission_time_s ?? 0, manifestRun(rightId)?.mission_time_s ?? 0);
  return { leftId, rightId, duration };
}

/** Mission length of the current pair, s (0 when nothing is exported). */
export function currentDuration(): number {
  return pairOf(useStore.getState()).duration;
}

const quant = (t: number) => Math.round(t / STEP_S) * STEP_S;
const clampT = (t: number, s: Pick<AppState, "variant" | "seed" | "compare">) => {
  const d = pairOf(s).duration;
  const q = Math.round(quant(Math.max(0, t)) * 10) / 10;
  return d > 0 ? Math.min(q, Math.floor(d * 10) / 10) : q;
};

/** Make variant/seed/compare consistent with what the manifest actually has. */
export function normaliseSelection(sel: { variant?: string; seed?: number; compare?: string }): {
  variant: string; seed: number; compare: string;
} {
  const m = getManifest();
  const variants = m?.variants ?? [DEFAULT_VARIANT];
  const variant = sel.variant && variants.includes(sel.variant)
    ? sel.variant
    : variants.includes(DEFAULT_VARIANT) ? DEFAULT_VARIANT : variants[0] ?? DEFAULT_VARIANT;
  const seeds = seedsFor(variant);
  const seed = sel.seed !== undefined && seeds.includes(sel.seed) ? sel.seed : typicalSeed(variant) ?? seeds[0] ?? 0;
  const configs = configsFor(variant, seed).filter((c) => c !== RIGHT_CONFIG);
  const compare = sel.compare && configs.includes(sel.compare)
    ? sel.compare
    : configs.includes(DEFAULT_COMPARE) ? DEFAULT_COMPARE : configs[0] ?? DEFAULT_COMPARE;
  return { variant, seed, compare };
}

// ------------------------------------------------------------------ tour helpers

/** Chapters of the loaded pair (empty until both runs are loaded). Cached by computePairEvents. */
function tourChapters(s: Pick<AppState, "variant" | "seed" | "compare">): Chapter[] {
  const { leftId, rightId } = pairOf(s);
  const left = peekRun(leftId) ?? null;
  const right = peekRun(rightId) ?? null;
  return left && right ? computePairEvents(left, right).chapters : [];
}

function prefersReducedMotion(): boolean {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

/** Pending "advance after the hold" timer. */
let holdTimer: number | undefined;
function clearHold(): void {
  if (holdTimer !== undefined) { window.clearTimeout(holdTimer); holdTimer = undefined; }
}

/** State patch that ends a running tour (and its hold timer); {} when no tour is on. */
function endTour(s: AppState, why: "stopped" | "ended" = "ended"): Partial<AppState> {
  if (!s.tour) return {};
  clearHold();
  if (s.tour.phase !== "done") announce(why === "stopped" ? "Tour stopped." : "Tour ended.");
  return { tour: null };
}

// ------------------------------------------------------------------ store

const initialTheme = lsGet(LS_THEME);
const initialSel = normaliseSelection({});

export const useStore = create<AppState>()((set, get) => ({
  view: "replay",
  ...initialSel,
  t: 3,                 // engine metrics score from t >= 3 s; at t = 0 no frame has arrived yet
  playing: false,
  speed: 4,
  stopAt: null,
  jumpFilter: "divergences",
  theme: initialTheme === "dark" || initialTheme === "light" ? initialTheme : systemTheme(),
  themeExplicit: initialTheme === "dark" || initialTheme === "light",
  presenter: lsGet(LS_PRESENTER) === "on",
  theatre: false,
  theatreCams: lsGet(LS_THEATRE_CAMS) === "both" ? "both" : "needed",
  focus: null,
  interacted: false,
  shortcutsOpen: false,
  tour: null,

  setView: (view) => {
    const s = get();
    // Leaving Replay pauses a running tour (play resumes it once back).
    if (view !== "replay" && s.tour && (s.tour.phase === "playing" || s.tour.phase === "hold")) {
      clearHold();
      announce("Tour paused.");
      set({ view, playing: false, stopAt: null, tour: { ...s.tour, phase: "paused" } });
      return;
    }
    set({ view });
  },
  setVariant: (variant) => {
    const sel = normaliseSelection({ variant, seed: get().seed, compare: get().compare });
    set({ ...sel, playing: false, stopAt: null, t: clampT(get().t, sel), focus: null, ...endTour(get()) });
  },
  setSeed: (seed) => {
    const sel = normaliseSelection({ variant: get().variant, seed, compare: get().compare });
    set({ ...sel, playing: false, stopAt: null, t: clampT(get().t, sel), focus: null, ...endTour(get()) });
  },
  setCompare: (compare) => {
    const sel = normaliseSelection({ variant: get().variant, seed: get().seed, compare });
    set({ ...sel, t: clampT(get().t, sel), ...endTour(get()) });
  },
  // A manual seek or step ends the tour (the tour itself moves the cursor with setState).
  seek: (t) => {
    const s = get();
    // Seeking out of a tour chapter keeps playing if it was, but no longer stops at its end.
    set({ t: clampT(t, s), interacted: true, ...(s.tour ? { stopAt: null } : {}), ...endTour(s) });
  },
  step: (dt) => set({ t: clampT(get().t + dt, get()), playing: false, stopAt: null, interacted: true, ...endTour(get()) }),
  play: () => {
    const s = get();
    if (s.tour && (s.tour.phase === "paused" || s.tour.phase === "hold")) { resumeTour(); return; }
    const d = pairOf(s).duration;
    // Pressing play at the end restarts from 0.
    const t = d > 0 && s.t >= Math.floor(d * 10) / 10 ? 0 : s.t;
    set({ playing: d > 0, t, interacted: true, ...endTour(s) });
  },
  pause: () => {
    const s = get();
    if (s.tour && (s.tour.phase === "playing" || s.tour.phase === "hold")) {
      clearHold();
      announce("Tour paused. Press Space to resume.");
      set({ playing: false, stopAt: null, tour: { ...s.tour, phase: "paused" } });
      return;
    }
    set({ playing: false, stopAt: null });
  },
  togglePlay: () => {
    const s = get();
    // While touring, play/pause pauses and resumes the tour (the hold counts as playing).
    if (s.tour && s.tour.phase !== "done") { if (s.tour.phase === "paused") s.play(); else s.pause(); return; }
    if (s.playing) s.pause(); else s.play();
  },
  setSpeed: (speed) => set({ speed, interacted: true }),
  faster: () => {
    const i = SPEEDS.indexOf(get().speed);
    set({ speed: SPEEDS[Math.min(SPEEDS.length - 1, i + 1)], interacted: true });
  },
  slower: () => {
    const i = SPEEDS.indexOf(get().speed);
    set({ speed: SPEEDS[Math.max(0, i - 1)], interacted: true });
  },
  playRange: (from, to, speed = 4) => {
    set({ t: clampT(from, get()), stopAt: to, speed, interacted: true, ...endTour(get()) });
    get().play();
  },
  setJumpFilter: (jumpFilter) => set({ jumpFilter }),
  setTheme: (theme) => { lsSet(LS_THEME, theme); set({ theme, themeExplicit: true }); },
  toggleTheme: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),
  setPresenter: (presenter) => { lsSet(LS_PRESENTER, presenter ? "on" : "off"); set({ presenter }); },
  togglePresenter: () => get().setPresenter(!get().presenter),
  setTheatre: (theatre) => {
    if (theatre === get().theatre) return;
    set(theatre ? { theatre, view: "replay", interacted: true } : { theatre });
    try {
      if (theatre && !document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => {});
      if (!theatre && document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
    } catch { /* full screen unavailable: theatre still fills the window */ }
  },
  toggleTheatre: () => get().setTheatre(!get().theatre),
  setTheatreCams: (theatreCams) => { lsSet(LS_THEATRE_CAMS, theatreCams); set({ theatreCams }); },
  setFocus: (focus) => set({ focus }),
  markInteracted: () => { if (!get().interacted) set({ interacted: true }); },
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  startTour: (step = 0) => goTourStep(step),
  toggleTour: () => {
    const s = get();
    if (s.tour) set({ playing: false, stopAt: null, ...endTour(s, "stopped") });
    else goTourStep(0);
  },
  tourGo: (step) => {
    const s = get();
    if (!s.tour) return;
    if (step >= s.tour.count) { useStore.setState({ tour: { ...s.tour, step: s.tour.count - 1 } }); advanceTour(); }
    else goTourStep(step);
  },
  stopTour: () => {
    const s = get();
    if (s.tour) set({ playing: false, stopAt: null, ...endTour(s, "stopped") });
  },
}));

// ------------------------------------------------------------------ tour engine

/** Seek to chapter `step`'s seekT and play it at TOUR_SPEED until its endT. */
function goTourStep(step: number): void {
  const s = useStore.getState();
  const chapters = tourChapters(s);
  clearHold();
  if (chapters.length === 0 || pairOf(s).duration <= 0) {
    // Runs not loaded yet (e.g. G pressed on another view first): open Replay so they load.
    useStore.setState({ tour: null, view: "replay" });
    announce("The tour needs the replay traces. Press G again once they have loaded.");
    return;
  }
  const i = Math.max(0, Math.min(chapters.length - 1, Math.round(step)));
  const ch = chapters[i];
  useStore.setState({
    view: "replay",
    tour: { step: i, count: chapters.length, phase: "playing" },
    t: clampT(ch.seekT, s), stopAt: ch.endT, speed: TOUR_SPEED, playing: true, interacted: true,
  });
  announce(`Tour, chapter ${i + 1} of ${chapters.length}: ${ch.label}.`);
}

/** Continue a paused (or held) tour: finish the current chapter's window, else move on. */
function resumeTour(): void {
  const s = useStore.getState();
  if (!s.tour) return;
  const ch = tourChapters(s)[s.tour.step];
  if (ch && s.tour.phase === "paused" && s.t < ch.endT - STEP_S / 2 && s.t >= ch.seekT - STEP_S / 2) {
    useStore.setState({ tour: { ...s.tour, phase: "playing" }, stopAt: ch.endT, playing: true, view: "replay", interacted: true });
    announce(`Tour resumed: chapter ${s.tour.step + 1} of ${s.tour.count}.`);
    return;
  }
  advanceTour();
}

/** After the hold: the next chapter, or "done" after the last one. */
function advanceTour(): void {
  clearHold();
  const s = useStore.getState();
  if (!s.tour) return;
  if (s.tour.step + 1 < s.tour.count) { goTourStep(s.tour.step + 1); return; }
  useStore.setState({ tour: { ...s.tour, phase: "done" }, playing: false, stopAt: null });
  announce("Tour finished.");
}

// The playback loop ends a chapter by setting playing = false at stopAt: hold, then advance.
// A change of run (variant, seed, compare, including hash navigation) ends the tour.
useStore.subscribe((s, prev) => {
  if (!s.tour) return;
  if (s.variant !== prev.variant || s.seed !== prev.seed || s.compare !== prev.compare) {
    useStore.setState({ playing: false, stopAt: null, ...endTour(s) });
    return;
  }
  if (s.tour.phase === "playing" && prev.playing && !s.playing) {
    clearHold();
    useStore.setState({ tour: { ...s.tour, phase: "hold" } });
    holdTimer = window.setTimeout(advanceTour, prefersReducedMotion() ? TOUR_HOLD_REDUCED_MS : TOUR_HOLD_MS);
  }
});

// ------------------------------------------------------------------ DOM side effects

/** Apply theme/presenter attributes to <html> and follow the OS theme until the user chooses. */
export function bindDocumentAttributes(): () => void {
  const root = document.documentElement;
  const apply = (s: AppState) => {
    root.setAttribute("data-theme", s.theme);
    root.setAttribute("data-presenter", s.presenter ? "on" : "off");
  };
  apply(useStore.getState());
  const unsub = useStore.subscribe(apply);
  let mq: MediaQueryList | null = null;
  const onMq = () => { if (!useStore.getState().themeExplicit) useStore.setState({ theme: systemTheme() }); };
  try {
    mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", onMq);
  } catch { mq = null; }
  return () => { unsub(); mq?.removeEventListener("change", onMq); };
}
