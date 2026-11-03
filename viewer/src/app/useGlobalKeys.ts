/**
 * Global keyboard shortcuts (DESIGN.md 11). Active unless focus is in a text input or
 * select, or a popover is open (then only Esc works). Playback keys act on Replay only.
 *
 *   Space        play / pause                 1 2 3 4   Replay, Results, Scenario, Method
 *   Left/Right   step 0.1 s (Shift: 1 s)      T         light / dark
 *   Home / End   mission start / end          P         presenter mode
 *   [ / ]        slower / faster              ?         shortcut sheet
 *   J / K        previous / next event (jump filter)    Esc  close popover or tooltip
 *   F            theatre (camera feeds full screen)     C    theatre: needed camera / both
 *   G            guided tour: every chapter back to back (again: stop)
 */
import { useEffect } from "react";
import { useStore, pairOf, VIEWS } from "../state/store";
import { isPopoverOpen, closeTopPopover } from "../state/overlay";
import { peekRun } from "../data/loader";
import { computePairEvents, jumpTargets, nextTarget, prevTarget } from "../data/events";

function isTextEntry(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type;
    return !["button", "checkbox", "radio", "range", "submit", "reset"].includes(type);
  }
  return el.isContentEditable;
}

/** Elements that use arrow / Home / End keys themselves. */
function ownsArrows(el: EventTarget | null): boolean {
  return el instanceof HTMLElement && !!el.closest("[role=radiogroup], [role=tablist], [role=slider], [role=listbox], [role=menu], [data-owns-arrows]");
}

/** Jump the cursor to the previous (-1) or next (+1) event under the current jump filter. */
export function jumpEvent(dir: -1 | 1): boolean {
  const s = useStore.getState();
  const { leftId, rightId } = pairOf(s);
  const left = peekRun(leftId) ?? null;
  const right = peekRun(rightId) ?? null;
  if (!left && !right) return false;
  const ev = computePairEvents(left, right);
  const targets = jumpTargets(ev, s.jumpFilter);
  const t = dir > 0 ? nextTarget(targets, s.t) : prevTarget(targets, s.t);
  if (t === null) return false;
  s.pause();
  s.seek(t);
  const chapter = ev.chapters.find((c) => Math.abs(c.seekT - t) < 0.05);
  const div = ev.divergences.find((d) => Math.abs(d.t - t) < 0.05);
  s.setFocus(
    chapter ? { t, kind: "chapter", chapter: chapter.index, label: chapter.label }
      : div ? { t, kind: "divergence", side: div.side }
        : { t, kind: "interruption" },
  );
  return true;
}

export function useGlobalKeys(openShortcuts: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Escape") {
        if (e.defaultPrevented) return; // a dialog already closed itself on this Esc
        if (closeTopPopover()) e.preventDefault();
        else if (useStore.getState().theatre) { useStore.getState().setTheatre(false); e.preventDefault(); }
        return;
      }
      if (isPopoverOpen() || isTextEntry(e.target) || e.defaultPrevented) return;
      const s = useStore.getState();

      // global
      if (e.key >= "1" && e.key <= "4") { s.setView(VIEWS[Number(e.key) - 1]); e.preventDefault(); return; }
      if (e.key === "t" || e.key === "T") { s.toggleTheme(); e.preventDefault(); return; }
      if (e.key === "p" || e.key === "P") { s.togglePresenter(); e.preventDefault(); return; }
      if (e.key === "?") { openShortcuts(); e.preventDefault(); return; }

      if (e.key === "f" || e.key === "F") { s.toggleTheatre(); e.preventDefault(); return; }
      if (e.key === "g" || e.key === "G") { s.toggleTour(); e.preventDefault(); return; }

      // playback (Replay only)
      if (s.view !== "replay") return;
      switch (e.key) {
        case "c": case "C":
          if (!s.theatre) return;
          s.setTheatreCams(s.theatreCams === "needed" ? "both" : "needed"); e.preventDefault(); return;
        case " ":
        case "Spacebar":
          s.togglePlay(); e.preventDefault(); return;
        case "ArrowLeft":
        case "ArrowRight":
          if (ownsArrows(e.target)) return;
          s.step((e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 1 : 0.1));
          e.preventDefault(); return;
        case "Home":
          if (ownsArrows(e.target)) return;
          s.pause(); s.seek(0); e.preventDefault(); return;
        case "End":
          if (ownsArrows(e.target)) return;
          s.pause(); s.seek(pairOf(s).duration); e.preventDefault(); return;
        case "[": s.slower(); e.preventDefault(); return;
        case "]": s.faster(); e.preventDefault(); return;
        case "j": case "J": jumpEvent(-1); e.preventDefault(); return;
        case "k": case "K": jumpEvent(1); e.preventDefault(); return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openShortcuts]);
}
