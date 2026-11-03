/** Public state API for feature code. Import from "../../state". */
export {
  useStore, pairOf, currentDuration, normaliseSelection,
  VIEWS, VIEW_LABEL, SPEEDS, STEP_S, RIGHT_CONFIG, DEFAULT_COMPARE, DEFAULT_VARIANT,
  TOUR_SPEED, TOUR_HOLD_MS, TOUR_HOLD_REDUCED_MS,
  type AppState, type View, type Theme, type TheatreCams, type Speed, type FocusEvent, type TourState, type TourPhase,
} from "./store";
export {
  useCursorT, usePlayback, useTheme, useRunPair, usePairEvents, useBreakpoint, useReducedMotion,
  type Playback, type ThemeApi, type RunPair, type PairStatus, type Breakpoint,
} from "./hooks";
export { showInReplay, buildHash, parseHash, setHashParam, getHashParam } from "./url";
export { announce, isPopoverOpen, registerPopover, closeTopPopover } from "./overlay";
