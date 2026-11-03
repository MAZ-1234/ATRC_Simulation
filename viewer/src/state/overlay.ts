/**
 * Open-popover bookkeeping and the aria-live announcer.
 *
 * - While any popover/dialog is open, global shortcuts are suspended except Esc
 *   (DESIGN.md 11). `Popover` registers itself; Esc closes the most recent one.
 * - `announce(text)` speaks a sentence through the shell's aria-live="polite" region,
 *   e.g. "Baseline view not usable. Proposed view usable."
 */

type Closer = () => void;
const stack: Closer[] = [];

/** Register an open popover; returns the unregister function. */
export function registerPopover(close: Closer): () => void {
  stack.push(close);
  return () => {
    const i = stack.lastIndexOf(close);
    if (i >= 0) stack.splice(i, 1);
  };
}

export function isPopoverOpen(): boolean {
  return stack.length > 0;
}

/** Close the most recently opened popover. Returns true if one was closed. */
export function closeTopPopover(): boolean {
  const c = stack[stack.length - 1];
  if (!c) return false;
  c();
  return true;
}

type Listener = (text: string) => void;
const listeners = new Set<Listener>();

/** Announce a sentence to screen readers (polite). */
export function announce(text: string): void {
  listeners.forEach((l) => l(text));
}

/** Used by the shell's LiveRegion. */
export function onAnnounce(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
