/**
 * Canvas drawing of the dense timeline tracks. Called only when the runs, the size, the
 * zoom window or the theme change (never per playback frame). All colours come from
 * tokens (useTokens), so a theme switch redraws with the new palette.
 *
 * Encodings (DESIGN.md 2.3, 2.4, 7):
 *  - link truth: solid fill = good, fill at --link-degraded-alpha = up but outside the
 *    video limits, neutral hatch = down. Bar height = true capacity as a share of the
 *    link's nominal capacity (so the 1 Mbps crater shows as a low bar).
 *  - ribbon: controller-colour band where samples.useful = 1; a tear where it is 0, with
 *    a 10% bad wash and 2px --color-status-bad edges (narrow tears are a solid bad edge).
 *  - who-saw lane: left-only above the centre line in the left colour, right-only below
 *    it in the right colour, neither = bad hatch at full height.
 *  - camera rows: the link each camera is sent on (cams.tgt, first = primary); two
 *    colours stacked = sent on two links; faint = TRICKLE; empty = paused.
 *  - uploads: faint = background chunks being sent, solid = a requested item being sent.
 */
import type { RunData, LinkName } from "../../../data/types";
import type { PairEvents } from "../../../data/events";
import type { Tokens } from "../../../components";
import { withAlpha } from "../../../components";
import {
  BULK_BACKGROUND, BULK_NONE, CAM_PAUSED, CAM_TRICKLE, CAP_STEPS, LINK_DEGRADED, LINK_DOWN,
  derive, derivePair, firstSpanAfter, type Span,
} from "./derive";
import type { Layout, Row } from "./layout";

export interface DrawInput {
  ctx: CanvasRenderingContext2D;
  width: number;
  dpr: number;
  layout: Layout;
  domain: [number, number];
  left: RunData;
  right: RunData;
  events: PairEvents;
  tokens: Tokens;
  /** Fill colour tokens of the left and right controllers. */
  leftColor: string;
  rightColor: string;
  /** Draw the 1px darker edge on the left ribbon (Baseline in light theme). */
  leftEdge: string | null;
}

function hatch(ctx: CanvasRenderingContext2D, color: string, lineW: number, dpr: number): CanvasPattern | null {
  const T = Math.max(1, Math.round(5 * dpr));
  const c = document.createElement("canvas");
  c.width = T;
  c.height = T;
  const g = c.getContext("2d");
  if (!g) return null;
  g.strokeStyle = color;
  g.lineWidth = lineW * dpr;
  g.lineCap = "square";
  g.beginPath();
  for (const o of [-T, 0, T]) { g.moveTo(o, T); g.lineTo(o + T, 0); }
  g.stroke();
  const p = ctx.createPattern(c, "repeat");
  p?.setTransform(new DOMMatrix([1 / dpr, 0, 0, 1 / dpr, 0, 0]));
  return p;
}

export function drawTracks(inp: DrawInput): void {
  const { ctx, width: W, dpr, layout, domain, left, right, events, tokens } = inp;
  const [d0, d1] = domain;
  const k = W / Math.max(1e-6, d1 - d0);
  const X = (t: number) => (t - d0) * k;
  const snap = (x: number) => Math.round(x * dpr) / dpr;
  const px = 1 / dpr;
  const get = tokens.get;
  const dAlpha = tokens.num("--link-degraded-alpha") || 0.3;

  const sheet = get("--color-surface-2");
  const sunken = get("--color-surface-sunken");
  const bad = get("--color-status-bad");
  const badWash = get("--color-status-bad-wash");
  const grid = get("--color-grid");
  const gridStrong = get("--color-grid-strong");
  const borderStrong = get("--color-border-strong");
  const linkFill: Record<LinkName, string> = {
    radio: get("--color-link-radio"), starlink: get("--color-link-starlink"), lte: get("--color-link-lte"),
  };
  const lteEdge = get("--color-link-lte-edge");
  const hatchNeutral = hatch(ctx, get("--color-status-unknown"), 1, dpr);
  const hatchBad = hatch(ctx, bad, 1.5, dpr);

  const L = derive(left);
  const R = derive(right);
  const P = derivePair(left, right, events);
  const H = layout.height;

  /** Visit spans intersecting the window, clipped to it, with snapped x0/x1. */
  const each = (spans: Span[], fn: (s: Span, x0: number, x1: number) => void) => {
    for (let i = firstSpanAfter(spans, d0); i < spans.length; i++) {
      const s = spans[i];
      if (s.t0 >= d1) break;
      const x0 = snap(X(Math.max(s.t0, d0)));
      const x1 = snap(X(Math.min(s.t1, d1)));
      fn(s, x0, x1);
    }
  };
  const channel = (row: Row, end: number) => {
    ctx.fillStyle = sunken;
    ctx.fillRect(0, row.y, Math.max(0, snap(X(Math.min(end, d1)))), row.h);
  };

  // Sheet and segment boundaries (behind everything, like the report's axvlines).
  ctx.fillStyle = sheet;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = grid;
  for (let i = 1; i < P.seg.length; i++) {
    if (P.seg[i].v === P.seg[i - 1].v) continue;
    const t = P.seg[i].t0;
    if (t <= d0 || t >= d1) continue;
    ctx.fillRect(snap(X(t)), 0, px, H);
  }

  const runOf = (side: "left" | "right") => (side === "left" ? left : right);
  const derOf = (side: "left" | "right") => (side === "left" ? L : R);
  const colOf = (side: "left" | "right") => (side === "left" ? inp.leftColor : inp.rightColor);

  for (const row of layout.rows) {
    const y = row.y;
    const h = row.h;
    switch (row.kind) {
      case "segment": {
        // DESIGN-GAP: --color-zone-wash is almost the sheet colour in dark (#1F292E on #212B30),
        // so scoring segments use the sunken track colour, which reads in both themes.
        ctx.fillStyle = sunken;
        each(P.seg, (s, x0, x1) => {
          if (s.v < 0 || x1 - x0 < px) return;
          ctx.fillRect(x0, y, Math.max(px, x1 - x0 - px), h);
        });
        break;
      }
      case "link": {
        const link = row.link!;
        channel(row, P.fullEnd);
        each(P.links[link], (s, x0, x1) => {
          const cls = Math.floor(s.v / 100);
          const w = Math.max(px, x1 - x0);
          if (cls === LINK_DOWN) {
            if (hatchNeutral) { ctx.fillStyle = hatchNeutral; ctx.fillRect(x0, y, w, h); }
            return;
          }
          const step = s.v % 100;
          const bh = Math.max(3, Math.round((h * step) / CAP_STEPS));
          const degraded = cls === LINK_DEGRADED;
          ctx.fillStyle = degraded ? withAlpha(linkFill[link], dAlpha) : linkFill[link];
          ctx.fillRect(x0, y + h - bh, w, bh);
          if (link === "lte" && !degraded) {
            ctx.fillStyle = lteEdge;
            ctx.fillRect(x0, y + h - bh, w, px);
          }
        });
        break;
      }
      case "ribbon": {
        const side = row.side!;
        const D = derOf(side);
        const col = colOf(side);
        const edge = side === "left" ? inp.leftEdge : null;
        // usable stretches
        each(D.useful, (s, x0, x1) => {
          if (s.v !== 1) return;
          const w = x1 - x0;
          if (w <= 0) return;
          ctx.fillStyle = col;
          ctx.fillRect(x0, y, w, h);
          if (edge) {
            ctx.fillStyle = edge;
            ctx.fillRect(x0, y, w, px);
            ctx.fillRect(x0, y + h - px, w, px);
          }
        });
        // tears: every loss of view stays visible (at least 1px), same rule for both sides
        each(D.useful, (s, x0, x1) => {
          if (s.v !== 0) return;
          let a = x0;
          let b = x1;
          if (b - a < 1) { const c = (a + b) / 2; a = snap(c - 0.5); b = a + 1; }
          const w = b - a;
          ctx.fillStyle = sheet;
          ctx.fillRect(a, y, w, h);
          if (w >= 5) {
            ctx.fillStyle = badWash;
            ctx.fillRect(a, y, w, h);
            ctx.fillStyle = bad;
            ctx.fillRect(a, y, 2, h);
            ctx.fillRect(b - 2, y, 2, h);
          } else {
            ctx.fillStyle = bad;
            ctx.fillRect(a, y, w, h);
          }
        });
        // this run's end (the other run may last longer)
        if (D.end < d1 && D.end > d0) {
          ctx.fillStyle = borderStrong;
          ctx.fillRect(snap(X(D.end)), y - 2, px * 2, h + 4);
        }
        break;
      }
      case "cam": {
        const side = row.side!;
        const run = runOf(side);
        const D = derOf(side);
        channel(row, D.end);
        each(D.cams[row.cam!], (s, x0, x1) => {
          if (s.v < 0) return;
          const cls = s.v % 10;
          if (cls === CAM_PAUSED) return;
          const set = run.enums.linkset[Math.floor(s.v / 10)] ?? [];
          const names = set.map((i) => run.meta.links[i]);
          if (names.length === 0) return;
          const a = cls === CAM_TRICKLE ? dAlpha : 1;
          const w = Math.max(px, x1 - x0);
          // One band per link, primary on top; duplication shows as stacked colours.
          let yy = y;
          names.forEach((name, i) => {
            const bh = i === names.length - 1 ? y + h - yy : Math.max(1, Math.round(h / names.length));
            ctx.fillStyle = withAlpha(linkFill[name], a);
            ctx.fillRect(x0, yy, w, bh);
            yy += bh;
          });
        });
        break;
      }
      case "whosaw": {
        const mid = y + Math.floor(h / 2);
        // Compared only while both missions ran (see derivePair).
        const end = Math.min(d1, P.commonEnd);
        ctx.fillStyle = gridStrong;
        ctx.fillRect(0, mid, Math.max(0, snap(X(end))), px);
        for (const s of P.whoSaw) {
          if (s.to <= d0 || s.from >= d1 || s.cls === "both") continue;
          let a = snap(X(Math.max(s.from, d0)));
          let b = snap(X(Math.min(s.to, d1)));
          if (b - a < 1) { const c = (a + b) / 2; a = snap(c - 0.5); b = a + 1; }
          if (s.cls === "left_only") {
            ctx.fillStyle = inp.leftColor;
            ctx.fillRect(a, y, b - a, mid - y);
          } else if (s.cls === "right_only") {
            ctx.fillStyle = inp.rightColor;
            ctx.fillRect(a, mid + px, b - a, y + h - mid - px);
          } else if (hatchBad) {
            ctx.fillStyle = hatchBad;
            ctx.fillRect(a, y, b - a, h);
          }
        }
        break;
      }
      case "man": {
        const mid = y + Math.floor(h / 2);
        each(P.man, (s, x0, x1) => {
          const name = right.enums.man[s.v];
          const w = Math.max(px, x1 - x0);
          if (name === "DRIVE") {
            ctx.fillStyle = borderStrong;
            ctx.fillRect(x0, mid - px, w, 2 * px);
          } else {
            ctx.fillStyle = sunken;
            ctx.fillRect(x0, y, w, h);
            ctx.fillStyle = borderStrong;
            ctx.fillRect(x0, y, w, px);
            ctx.fillRect(x0, y + h - px, w, px);
            ctx.fillRect(x0, y, px, h);
            ctx.fillRect(x0 + w - px, y, px, h);
          }
        });
        break;
      }
      case "upload": {
        const side = row.side!;
        const D = derOf(side);
        const col = colOf(side);
        channel(row, D.end);
        each(D.bulk, (s, x0, x1) => {
          if (s.v === BULK_NONE) return;
          ctx.fillStyle = s.v === BULK_BACKGROUND ? withAlpha(col, dAlpha) : col;
          ctx.fillRect(x0, y, Math.max(px, x1 - x0), h);
        });
        break;
      }
      default:
        break;
    }
  }
}
