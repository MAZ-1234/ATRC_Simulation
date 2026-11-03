/**
 * Ribbon-pair miniature (DESIGN.md 6.2 Variants: 120×16 beside each variant name).
 * Top band Baseline, bottom band Proposed; a band is drawn in the controller colour where
 * the view was usable for at least half of that pixel's time span, and left open (bad
 * wash) where it was not. Read from samples.useful, never re-scored.
 */
import type { RunData } from "../../data/types";

const cache = new Map<string, boolean[]>();

/** Per pixel: usable for at least half of the samples in that pixel's span. */
function pixels(run: RunData, w: number, duration: number): boolean[] {
  const key = `${run.meta.id}|${w}|${duration}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const n = new Array<number>(w).fill(0);
  const u = new Array<number>(w).fill(0);
  const { t, useful } = run.samples;
  for (let k = 0; k < t.length; k++) {
    const px = Math.min(w - 1, Math.floor((t[k] / duration) * w));
    n[px]++; u[px] += useful[k];
  }
  const out = n.map((c, i) => c > 0 && u[i] / c >= 0.5);
  cache.set(key, out);
  return out;
}

function spans(px: boolean[]): { from: number; to: number; ok: boolean }[] {
  const out: { from: number; to: number; ok: boolean }[] = [];
  px.forEach((ok, i) => {
    const last = out[out.length - 1];
    if (last && last.ok === ok) last.to = i + 1;
    else out.push({ from: i, to: i + 1, ok });
  });
  return out;
}

export function RibbonPair({ x, cy, left, right, w = 120 }: { x: number; cy: number; left: RunData; right: RunData; w?: number }) {
  const duration = Math.max(left.meta.mission_time_s, right.meta.mission_time_s);
  const bands = [
    { run: left, y: cy - 8, fill: "var(--color-ctrl-baseline)", edge: "var(--color-ctrl-baseline-edge)" },
    { run: right, y: cy + 1, fill: "var(--color-ctrl-proposed)", edge: "none" },
  ];
  return (
    <g transform={`translate(${x},0)`} pointerEvents="none" aria-hidden>
      {bands.map((b, i) => (
        <g key={i}>
          {spans(pixels(b.run, w, duration)).map((s, j) => (
            <rect key={j} x={s.from} y={b.y} width={s.to - s.from} height={7}
              style={s.ok ? { fill: b.fill } : { fill: "var(--color-status-bad-wash)" }} />
          ))}
        </g>
      ))}
    </g>
  );
}
