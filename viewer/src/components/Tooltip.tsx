import {
  cloneElement, forwardRef, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState,
  type ReactElement, type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import s from "./Tooltip.module.css";

/** Readout rows: [label, value]; numbers are right-aligned. At most 8 rows (DESIGN.md 7). */
export type ReadoutRow = [ReactNode, ReactNode];

export function Readout({ title, rows }: { title?: ReactNode; rows: ReadoutRow[] }) {
  return (
    <div className={s.readout}>
      {title && <div className={s.rTitle}>{title}</div>}
      <table className={s.rTable}>
        <tbody>
          {rows.slice(0, 8).map(([k, v], i) => (
            <tr key={i}><th scope="row">{k}</th><td>{v}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface TooltipProps {
  /** Free content (13px). Use `rows` for a label/value readout instead. */
  content?: ReactNode;
  /** Readout variant rows. */
  rows?: ReadoutRow[];
  /** Readout title row. */
  title?: ReactNode;
  /** Preferred side; flips when there is no room. */
  placement?: "top" | "bottom";
  /** Hover delay, ms (default 300). Focus opens immediately. */
  delay?: number;
  disabled?: boolean;
  /** The trigger. Must be focusable for keyboard users (button, link, tabIndex=0). */
  children: ReactElement;
  className?: string;
}

/**
 * Tooltip (DESIGN.md 7): surface-2, radius-4, shadow-pop, max 320px, 13px. Opens after
 * 300 ms on hover and immediately on focus; Esc closes it. Adds aria-describedby to the child.
 */
export function Tooltip({ content, rows, title, placement = "top", delay = 300, disabled, children, className }: TooltipProps) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const clear = () => { if (timer.current !== undefined) window.clearTimeout(timer.current); timer.current = undefined; };
  useEffect(() => clear, []);

  const show = (now: boolean) => {
    if (disabled) return;
    clear();
    if (now) setOpen(true);
    else timer.current = window.setTimeout(() => setOpen(true), delay);
  };
  const hide = () => { clear(); setOpen(false); };

  // Esc closes an open tooltip wherever focus is (WCAG 1.4.13: a hover tooltip must be
  // dismissible without moving the pointer). Before, only a focused trigger saw the key.
  // The event is not stopped, so one Esc still also closes a popover the tooltip sits in.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      clear();
      setOpen(false);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open]);

  const child = isValidElement(children)
    ? cloneElement(children as ReactElement<{ "aria-describedby"?: string }>, { "aria-describedby": open ? id : undefined })
    : children;

  return (
    <span ref={anchor} className={[s.anchor, className].filter(Boolean).join(" ")}
      onMouseEnter={() => show(false)} onMouseLeave={hide}
      onFocus={() => show(true)} onBlur={hide}>
      {child}
      {open && (
        <TooltipPortal id={id} anchor={anchor.current} placement={placement}>
          {rows ? <Readout title={title} rows={rows} /> : <>{title && <div className={s.rTitle}>{title}</div>}{content}</>}
        </TooltipPortal>
      )}
    </span>
  );
}

function TooltipPortal({ id, anchor, placement, children }: { id: string; anchor: HTMLElement | null; placement: "top" | "bottom"; children: ReactNode }) {
  const tip = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!anchor || !tip.current) return;
    const a = anchor.getBoundingClientRect();
    const t = tip.current.getBoundingClientRect();
    const gap = 8;
    let top = placement === "top" ? a.top - t.height - gap : a.bottom + gap;
    if (placement === "top" && top < 4) top = a.bottom + gap;
    if (placement === "bottom" && top + t.height > window.innerHeight - 4) top = a.top - t.height - gap;
    let left = a.left + a.width / 2 - t.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - t.width - 8));
    setPos({ left, top });
  }, [anchor, placement, children]);
  return createPortal(
    <div ref={tip} id={id} role="tooltip" className={s.tip}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}>
      {children}
    </div>,
    document.body,
  );
}

export interface TooltipBoxProps {
  /** Pointer position in client (viewport) px. */
  x: number;
  y: number;
  open: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * A tooltip box at a pointer position, for canvas/SVG crosshair readouts (timeline hover).
 * Placed 12px right/below the pointer and flipped to stay on screen.
 */
export const TooltipBox = forwardRef<HTMLDivElement, TooltipBoxProps>(function TooltipBox({ x, y, open, children, className }, _ref) {
  const tip = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: -9999, top: -9999 });
  useLayoutEffect(() => {
    if (!open || !tip.current) return;
    const t = tip.current.getBoundingClientRect();
    let left = x + 12;
    let top = y + 12;
    if (left + t.width > window.innerWidth - 8) left = x - t.width - 12;
    if (top + t.height > window.innerHeight - 8) top = y - t.height - 12;
    setPos({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [x, y, open, children]);
  if (!open) return null;
  return createPortal(
    <div ref={tip} role="tooltip" className={[s.tip, s.pointer, className].filter(Boolean).join(" ")} style={pos}>
      {children}
    </div>,
    document.body,
  );
});
