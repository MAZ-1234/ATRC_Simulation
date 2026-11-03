/**
 * Text measurement for SVG layout (row labels wrap to two lines at most; DESIGN.md 6.2.2).
 * Uses an offscreen canvas with the UI font at the current root size (presenter mode
 * changes the root size, so callers pass `rootPx`).
 */
let ctx: CanvasRenderingContext2D | null = null;

function context(): CanvasRenderingContext2D | null {
  if (ctx) return ctx;
  try { ctx = document.createElement("canvas").getContext("2d"); } catch { ctx = null; }
  return ctx;
}

/** Root font size in px (15, or 18 in presenter mode). */
export function rootPx(): number {
  try { return parseFloat(getComputedStyle(document.documentElement).fontSize) || 15; } catch { return 15; }
}

/** Width of `text` at `sizePx` and `weight` in Barlow. */
export function textWidth(text: string, sizePx: number, weight = 400, family = "Barlow"): number {
  const c = context();
  if (!c) return text.length * sizePx * 0.5;
  c.font = `${weight} ${sizePx}px "${family}", system-ui, sans-serif`;
  return c.measureText(text).width;
}

/** Greedy word wrap. Returns at most `maxLines` lines; the last line is ellipsised if it still overflows. */
export function wrap(text: string, width: number, sizePx: number, weight = 400, maxLines = 2): { lines: string[]; truncated: boolean } {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (textWidth(next, sizePx, weight) <= width || !cur) cur = next;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return { lines, truncated: false };
  const kept = lines.slice(0, maxLines);
  let last = `${kept[maxLines - 1]} ${lines.slice(maxLines).join(" ")}`;
  while (last.length > 1 && textWidth(`${last}…`, sizePx, weight) > width) last = last.slice(0, -1).trimEnd();
  kept[maxLines - 1] = `${last}…`;
  return { lines: kept, truncated: true };
}
