import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { registerPopover } from "../state/overlay";
import s from "./Popover.module.css";

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  /** Element the popover hangs from. Omit with placement="center" for a dialog (shortcut sheet). */
  anchorRef?: RefObject<HTMLElement>;
  placement?: "bottom-start" | "bottom-end" | "top-start" | "center";
  /** Title row (display 18/600). Also the dialog's accessible name. */
  title?: ReactNode;
  /** Width in px (default 320; max is the viewport minus margins). */
  width?: number;
  children: ReactNode;
  className?: string;
}

const FOCUSABLE =
  "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])";

/** Tabbable elements inside `root`, in DOM order (skips hidden ones). */
function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.getClientRects().length > 0);
}

/**
 * Popover / dialog (DESIGN.md 7): surface-2, radius-4, shadow-pop. Opens with a 120 ms
 * fade, closes on Esc, outside click or onClose. While open, global shortcuts are
 * suspended except Esc. Focus moves inside on open, Tab cycles inside it, and focus
 * returns to the trigger on close.
 */
export function Popover({ open, onClose, anchorRef, placement = "bottom-start", title, width = 320, children, className }: PopoverProps) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    const unregister = registerPopover(() => closeRef.current());
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (box.current?.contains(t) || anchorRef?.current?.contains(t)) return;
      closeRef.current();
    };
    const el = box.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); closeRef.current(); return; }
      // Keep Tab inside the dialog (global shortcuts are suspended while it is open, so
      // focus must not wander behind it). Esc closes it and returns focus to the trigger.
      if (e.key === "Tab" && el) {
        const items = focusables(el);
        if (items.length === 0) { e.preventDefault(); el.focus(); return; }
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === el)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("mousedown", onDown);
    el?.addEventListener("keydown", onKey);
    (el ? focusables(el)[0] ?? el : null)?.focus();
    return () => {
      unregister();
      document.removeEventListener("mousedown", onDown);
      el?.removeEventListener("keydown", onKey);
      if (prevFocus && document.contains(prevFocus)) prevFocus.focus();
    };
  }, [open, anchorRef]);

  useLayoutEffect(() => {
    if (!open || !box.current) return;
    const b = box.current.getBoundingClientRect();
    if (placement === "center" || !anchorRef?.current) {
      setPos({ left: Math.max(8, (window.innerWidth - b.width) / 2), top: Math.max(8, (window.innerHeight - b.height) / 3) });
      return;
    }
    const a = anchorRef.current.getBoundingClientRect();
    let left = placement === "bottom-end" ? a.right - b.width : a.left;
    let top = placement === "top-start" ? a.top - b.height - 6 : a.bottom + 6;
    left = Math.max(8, Math.min(left, window.innerWidth - b.width - 8));
    if (top + b.height > window.innerHeight - 8) top = Math.max(8, a.top - b.height - 6);
    setPos({ left, top });
  }, [open, placement, anchorRef]);

  if (!open) return null;
  return createPortal(
    <div ref={box} role="dialog" aria-modal={placement === "center" ? true : undefined}
      aria-labelledby={title ? titleId : undefined} tabIndex={-1}
      className={[s.pop, className].filter(Boolean).join(" ")}
      style={{ width: `min(${width}px, calc(100vw - 16px))`, ...(pos ?? { left: -9999, top: -9999 }) }}>
      {title && <h2 id={titleId} className={s.title}>{title}</h2>}
      {children}
    </div>,
    document.body,
  );
}
