/**
 * Camera tile (DESIGN.md 7 "Camera tile", 9.3 "Camera tile drawing").
 *
 * What the operator actually had on screen at the cursor, for one camera of one controller:
 * - the image is the frame captured at (t - age): it changes only when a frame arrives, so
 *   the tile refreshes at the delivered rate and holds still when frames stop;
 * - it is drawn at the delivered width x height, scaled by tile width / top ladder width,
 *   then upscaled with smoothing off, so a 320×240 frame is visibly coarser than 640×480;
 *   colours are quantised at low JPEG quality (q < 55, DESIGN.md 9.3);
 * - states: live, frozen (image holds, age counts up, 2px bad edge on the needed tile),
 *   paused ("No video sent"), waiting (no frame yet), ended, no data.
 * The tile is a button that opens an enlarged view at 2× (DESIGN.md 11).
 */
import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RunData } from "../../../data/types";
import { camLabel, fmtFps, levelTooltip, linkLabel } from "../../../data/loader";
import { Popover, Readout, useResizeObserver } from "../../../components";
import { useReducedMotion, useStore } from "../../../state";
import { drawScene, quantise, type World } from "./scene";
import { fmtAge, resText, viaText, type TileModel } from "./model";
import s from "./Console.module.css";

/** JPEG quality below which colours are quantised (DESIGN.md 9.3). */
const MJPEG_Q = 55;
/** Reduced motion: tiles update at most twice a second (DESIGN.md 9.2). */
const REDUCED_MS = 500;
/**
 * Fast playback (16x and 60x): skip a repaint that comes less than FAST_MS after the last
 * one, i.e. paint every other display frame (about 30 Hz at 60 Hz). At these speeds each
 * display frame already jumps several captured frames, so the cap is not visible; it
 * halves the canvas work on slow machines. Paused or slower playback paints at once, and
 * a fallback timer paints the newest frame if no further render arrives.
 */
const FAST_MS = 20;
const FAST_FALLBACK_MS = 100;
const FAST_SPEED = 16;

export interface CameraTileProps {
  run: RunData;
  world: World;
  model: TileModel;
  config: string;
  /** "zoom" draws the 2× enlarged view (no button, no popover). */
  variant?: "tile" | "zoom";
}

/** Status of the age bar under the needed tile: quiet, warn (close to the limit), bad (over). */
function ageClass(m: TileModel): "ok" | "warn" | "bad" | "quiet" {
  if (!m.needed || m.maxAge === null) return "quiet";
  if (m.age > m.maxAge) return "bad";
  // DESIGN-GAP: DESIGN.md 7 says warn from 0.3 to 0.5 s for a 0.5 s limit; applied as
  // 60% of the requirement's own max_age_s so STOPPED (1 s) scales the same way.
  if (m.age > 0.6 * m.maxAge) return "warn";
  return "ok";
}

/**
 * The tile canvas. Its backing store IS the delivered frame (rw x rh); CSS sizes it to the
 * tile and `image-rendering: pixelated` does the nearest-neighbour upscale. That is the same
 * picture as drawing small and blitting it up with smoothing off, without a second
 * full-size canvas and a per-frame copy (the costliest step during 16x / 60x playback,
 * and in theatre, where tiles are large).
 */
function TileCanvas({ run, world, model, width }: { run: RunData; world: World; model: TileModel; width: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const lastKey = useRef("");
  const lastDraw = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const reduced = useReducedMotion();
  const playing = useStore((st) => st.playing);
  const fast = useStore((st) => st.playing && st.speed >= FAST_SPEED);
  const height = Math.round((width * 3) / 4);
  const maxW = useMemo(() => Math.max(1, ...run.meta.ladder.map((l) => l.w)), [run]);

  const drawable = model.state === "live" || model.state === "frozen" || model.state === "ended";
  const lv = model.level;
  const key = drawable && lv ? `${model.captureK}|${model.levelIndex}|${width}|${model.cam}` : `blank|${width}`;

  useLayoutEffect(() => {
    const el = canvas.current;
    if (!el || width <= 0) return;
    const paint = () => {
      lastKey.current = key;
      lastDraw.current = performance.now();
      const cssW = `${width}px`;
      const cssH = `${height}px`;
      if (el.style.width !== cssW) el.style.width = cssW;
      if (el.style.height !== cssH) el.style.height = cssH;
      const blank = !drawable || !lv || lv.w <= 0;
      const rw = blank ? 1 : Math.max(8, Math.round((lv.w * width) / maxW));
      const rh = blank ? 1 : Math.max(6, Math.round((lv.h * width) / maxW));
      if (el.width !== rw) el.width = rw;
      if (el.height !== rh) el.height = rh;
      const ctx = el.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      if (blank) { ctx.clearRect(0, 0, rw, rh); return; } // CSS background shows the video surface
      const kc = model.captureK;
      const sm = run.samples;
      drawScene(ctx, rw, rh, world, {
        d: sm.d[kc], dir: sm.dir[kc] === -1 ? -1 : 1, crater: sm.crater[kc] === 1,
        reversing: run.enums.man[sm.man[kc]] === "REVERSE", cam: model.cam,
      });
      if (lv.q < MJPEG_Q) quantise(ctx, rw, rh);
    };
    if (key === lastKey.current && el.width > 0) return;
    if (timer.current !== undefined) { window.clearTimeout(timer.current); timer.current = undefined; }
    const since = performance.now() - lastDraw.current;
    const gap = reduced && playing ? REDUCED_MS : fast ? FAST_MS : 0;
    if (since < gap) {
      timer.current = window.setTimeout(paint, gap === FAST_MS ? FAST_FALLBACK_MS : gap - since);
      return;
    }
    paint();
  });
  useLayoutEffect(() => () => { if (timer.current !== undefined) window.clearTimeout(timer.current); }, []);

  return <canvas ref={canvas} className={s.canvas} aria-hidden />;
}

function Overlay({ model, zoom }: { model: TileModel; zoom: boolean }) {
  const lv = model.level;
  const center =
    model.state === "paused" ? "No video sent"
      : model.state === "waiting" ? "No frame received yet"
        : model.state === "nodata" ? "No frame data in this trace"
          : model.state === "ended" ? "Mission ended"
            : null;
  return (
    <>
      <span className={s.strip + " " + s.top}>
        <span className={s.camName}>{camLabel(model.cam)}</span>
        {model.needed && <span className={s.neededBadge}>Needed now</span>}
      </span>
      {center && <span className={s.center}>{center}</span>}
      {model.state === "frozen" && (
        <span className={`${s.frozenChip} ${model.needed ? s.frozenBad : ""}`}>
          Frozen, {fmtAge(model.age)} old
        </span>
      )}
      <span className={s.strip + " " + s.bottom}>
        {model.state === "paused" ? (
          <>
            <span>{model.target?.name ?? "PAUSED"}, nothing sent</span>
            <span>{model.age < 99 ? `last frame ${fmtAge(model.age)} old` : "no frame yet"}</span>
          </>
        ) : model.state === "nodata" ? (
          <span>No data</span>
        ) : (
          <>
            <span>{lv && lv.w > 0 ? `${resText(lv)}, ${fmtFps(model.fps)}` : `${fmtFps(model.fps)}`}{zoom && lv ? ` (${lv.name})` : ""}</span>
            <span>via {viaText(model.links)}, {fmtAge(model.age, model.maxAge)} old</span>
          </>
        )}
      </span>
    </>
  );
}

export function tileLabel(m: TileModel, config: string): string {
  const parts = [`${config}, ${camLabel(m.cam, true)}`];
  if (m.needed) parts.push("needed now");
  if (m.state === "paused") parts.push("no video sent");
  else if (m.state === "waiting") parts.push("no frame received yet");
  else if (m.state === "nodata") parts.push("no frame data");
  else {
    if (m.state === "frozen") parts.push("frozen");
    parts.push(`${resText(m.level)} at ${fmtFps(m.fps)}`, `via ${viaText(m.links)}`, `${fmtAge(m.age)} old`);
  }
  return parts.join(", ");
}

export function TileBody({ run, world, model, width, zoom, config }: {
  run: RunData; world: World; model: TileModel; width: number; zoom: boolean; config: string;
}) {
  return (
    <>
      <TileCanvas run={run} world={world} model={model} width={width} />
      <Overlay model={model} zoom={zoom} />
      <span className="sr-only">{tileLabel(model, config)}</span>
    </>
  );
}

export function stateClass(m: TileModel): string {
  return [
    s.tile,
    m.needed ? s.needed : "",
    m.state === "frozen" ? (m.needed ? s.frozenEdge : s.frozenQuiet) : "",
    m.state === "nodata" ? s.noData : "",
    m.state === "ended" ? s.ended : "",
  ].filter(Boolean).join(" ");
}

export function AgeBar({ model }: { model: TileModel }) {
  const cls = ageClass(model);
  const frac = model.state === "paused" || model.state === "nodata" ? 0 : Math.min(1, Math.max(0, model.age) / 1);
  return (
    <span className={s.ageTrack} aria-hidden>
      <span className={`${s.ageFill} ${s["age_" + cls]}`} style={{ width: `${(frac * 100).toFixed(1)}%` }} />
    </span>
  );
}

/** Enlarged 2× view with the full readout (opened from a tile). */
function TileZoom({ run, world, model, config }: { run: RunData; world: World; model: TileModel; config: string }) {
  const W = 464;
  return (
    <div className={s.zoom}>
      <div className={stateClass(model)} style={{ width: W }}>
        <TileBody run={run} world={world} model={model} width={W} zoom config={config} />
      </div>
      <AgeBar model={model} />
      <Readout rows={[
        ["Newest frame", model.level && model.level.w > 0 ? levelTooltip(model.level) : "none received"],
        ["Frames in the last 1 s", fmtFps(model.fps)],
        ["Newest frame age", model.age >= 99 ? "never received" : fmtAge(model.age, model.maxAge)],
        ["Sending now", model.target ? levelTooltip(model.target) : "unknown"],
        ["Sent on", model.links.length ? model.links.map(linkLabel).join(", ") : "no link"],
        ["Scored now", model.needed ? "yes, the true manoeuvre needs this camera" : "no, only the needed camera is scored"],
      ]} />
    </div>
  );
}

/** Live tile as a focusable button; click or Enter opens the enlarged view. */
export const CameraTile = memo(function CameraTile({ run, world, model, config }: CameraTileProps) {
  const btn = useRef<HTMLButtonElement>(null);
  const { width } = useResizeObserver(btn);
  const [open, setOpen] = useState(false);
  return (
    <figure className={s.tileFig}>
      <button ref={btn} type="button" className={stateClass(model)} aria-haspopup="dialog" aria-expanded={open}
        aria-label={`${tileLabel(model, config)}. Open enlarged view.`}
        onClick={() => setOpen(true)}>
        {width > 0 && <TileBody run={run} world={world} model={model} width={width} zoom={false} config={config} />}
      </button>
      <AgeBar model={model} />
      <Popover open={open} onClose={() => setOpen(false)} placement="center" width={500}
        title={`${config}, ${camLabel(model.cam, true)}`}>
        <TileZoom run={run} world={world} model={model} config={config} />
      </Popover>
    </figure>
  );
});
