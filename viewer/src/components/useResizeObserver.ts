import { useLayoutEffect, useRef, useState, type RefObject } from "react";

export interface Size { width: number; height: number }

/**
 * Content-box size of an element, updated on resize (rounded to whole px).
 *   const ref = useRef<HTMLDivElement>(null);
 *   const { width, height } = useResizeObserver(ref);
 */
export function useResizeObserver<T extends Element>(ref: RefObject<T>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (w: number, h: number) =>
      setSize((s) => (s.width === Math.round(w) && s.height === Math.round(h) ? s : { width: Math.round(w), height: Math.round(h) }));
    const r = el.getBoundingClientRect();
    measure(r.width, r.height);
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e) measure(e.contentRect.width, e.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/** Convenience: a ref plus its size. */
export function useMeasure<T extends Element>(): [RefObject<T>, Size] {
  const ref = useRef<T>(null);
  const size = useResizeObserver(ref);
  return [ref, size];
}

/**
 * Size a <canvas> for the device pixel ratio and return its 2D context scaled so you
 * draw in CSS pixels. Call at the start of every redraw.
 */
export function prepareCanvas(canvas: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(width * dpr));
  const h = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return ctx;
}
