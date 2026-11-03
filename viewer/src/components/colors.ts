/**
 * Colour lookups. SVG/HTML use CSS custom properties directly (`var(--...)`), so they
 * follow the theme for free. Canvas cannot read `var()`, so canvas code calls
 * `useTokens()` (re-reads on theme/presenter change) or `readToken()`.
 * Never write hex values outside tokens.css (DESIGN.md 12).
 */
import { useMemo } from "react";
import { useStore } from "../state/store";
import { ctrlRole, type CtrlRole } from "../data/labels";
import type { LinkName } from "../data/types";

export type ColorKind = "fill" | "text" | "edge";

/** CSS var for a controller: ctrlVar("Baseline") -> "var(--color-ctrl-baseline)". Others get --color-ctrl-other. */
export function ctrlVar(configOrRole: string | CtrlRole, kind: ColorKind = "fill"): string {
  const role: CtrlRole = configOrRole === "baseline" || configOrRole === "proposed" || configOrRole === "other"
    ? configOrRole : ctrlRole(configOrRole);
  if (role === "other") return "var(--color-ctrl-other)";
  if (role === "proposed") return kind === "fill" ? "var(--color-ctrl-proposed)" : "var(--color-ctrl-proposed-text)";
  return kind === "fill" ? "var(--color-ctrl-baseline)" : kind === "edge" ? "var(--color-ctrl-baseline-edge)" : "var(--color-ctrl-baseline-text)";
}

/** CSS class for a controller name in prose (base.css): "ctrl-baseline" | "ctrl-proposed" | "ctrl-other". */
export function ctrlClass(config: string): string {
  return `ctrl-${ctrlRole(config)}`;
}

/** CSS var for a link: linkVar("lte", "edge") -> "var(--color-link-lte-edge)". Radio/Starlink edge = fill. */
export function linkVar(link: LinkName, kind: ColorKind = "fill"): string {
  if (kind === "text") return `var(--color-link-${link}-text)`;
  if (kind === "edge") return link === "lte" ? "var(--color-link-lte-edge)" : `var(--color-link-${link})`;
  return `var(--color-link-${link})`;
}

/** Status colours (operator view and uploads only, never links). */
export type StatusKind = "bad" | "warn" | "good" | "unknown";
export function statusVar(kind: StatusKind, wash = false): string {
  if (wash && (kind === "bad" || kind === "warn")) return `var(--color-status-${kind}-wash)`;
  return `var(--color-status-${kind})`;
}

/** Resolved value of one custom property, e.g. readToken("--color-text-1") -> "#18211F". */
export function readToken(name: string, el: Element = document.documentElement): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

/** Token names that canvas code typically needs. */
export const CANVAS_TOKENS = [
  "--color-bg", "--color-surface-1", "--color-surface-2", "--color-surface-sunken", "--color-surface-video",
  "--color-text-1", "--color-text-2", "--color-text-3", "--color-text-on-video",
  "--color-border", "--color-border-strong", "--color-grid", "--color-grid-strong", "--color-cursor", "--color-zone-wash",
  "--color-ctrl-baseline", "--color-ctrl-baseline-edge", "--color-ctrl-proposed", "--color-ctrl-other",
  "--color-link-radio", "--color-link-starlink", "--color-link-lte", "--color-link-lte-edge",
  "--color-status-bad", "--color-status-warn", "--color-status-unknown", "--color-status-bad-wash", "--color-status-warn-wash",
  "--link-degraded-alpha", "--stroke-hair", "--stroke-data", "--stroke-bold",
] as const;
export type CanvasToken = (typeof CANVAS_TOKENS)[number];

export interface Tokens {
  /** Resolved colour (or number string) of a token. */
  get: (name: CanvasToken | string) => string;
  /** Numeric token ("1.5px" -> 1.5, "0.30" -> 0.3). */
  num: (name: CanvasToken | string) => number;
  /** Changes whenever the theme or presenter mode changes: use it as an effect dependency. */
  version: string;
}

/**
 * Resolved token values for canvas drawing. Returns a new object after a theme or
 * presenter change, so `useEffect(draw, [tokens, ...])` redraws.
 */
export function useTokens(): Tokens {
  const theme = useStore((s) => s.theme);
  const presenter = useStore((s) => s.presenter);
  return useMemo(() => {
    const cs = getComputedStyle(document.documentElement);
    const cache = new Map<string, string>();
    const get = (name: string) => {
      let v = cache.get(name);
      if (v === undefined) { v = cs.getPropertyValue(name).trim(); cache.set(name, v); }
      return v;
    };
    return { get, num: (n: string) => parseFloat(get(n)) || 0, version: `${theme}|${presenter}` };
  }, [theme, presenter]);
}

/** "#RRGGBB" + alpha -> "rgba(r, g, b, a)" for canvas fills (e.g. the degraded link tint). */
export function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
