import { useEffect, useState } from "react";
import { onAnnounce } from "../state/overlay";

/**
 * aria-live="polite" region (DESIGN.md 11). Speaks `announce()` messages. The verdict
 * change at the resting (paused) Replay cursor, e.g. "Baseline view not usable. Proposed
 * view usable.", is announced by the Replay console (consoles/Console.tsx
 * VerdictAnnouncer), which also knows when a run has ended. This region used to compute
 * its own copy 400 ms later, which contradicted the console once a run had ended
 * ("view not usable" after "mission ended").
 */
export function LiveRegion() {
  const [text, setText] = useState("");
  useEffect(() => onAnnounce(setText), []);
  return <div className="sr-only" aria-live="polite" aria-atomic="true">{text}</div>;
}
