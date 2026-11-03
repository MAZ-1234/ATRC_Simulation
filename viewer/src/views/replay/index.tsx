/**
 * Replay view layout (DESIGN.md 6.1, 6.1.2, 6.1.3). Contract with the shell: export
 * `ReplayView` (no props).
 *
 * This file owns only the frame: the grid, the per-breakpoint sizes (CSS custom properties
 * in Replay.module.css), the narrow console toggle and the loading / missing / error states.
 * Each slot reads the store and the run pair itself:
 *   route/RouteStrip        route strip, chapter chips, claim caption
 *   consoles/Console        one controller console (side "left" | "right")
 *   spine/TruthSpine        Links now, Needed now, Uploads queued
 *   timeline/MissionTimeline  multi-track mission timeline
 *   timeline/PlaybackBar    playback bar (rendered in every state, including no trace)
 *
 * Slots other than PlaybackBar are mounted only when the pair is ready, so they may assume
 * `useRunPair().status === "ready"` with `left` and `right` non-null.
 *
 * Performance: this component subscribes to the run selection and breakpoint only, never
 * to the cursor, so playback does not re-render the frame.
 */
import { useEffect, useState } from "react";
import { EmptyState, SegmentedControl } from "../../components";
import { useBreakpoint, useRunPair, type RunPair } from "../../state";
import { REGEN_COMMAND, REGEN_CWD } from "../../data/loader";
import { ctrlVar } from "../../components/colors";
import { RouteStrip } from "./route/RouteStrip";
import { TruthSpine } from "./spine/TruthSpine";
import { Console } from "./consoles/Console";
import { MissionTimeline } from "./timeline/MissionTimeline";
import { PlaybackBar } from "./timeline/PlaybackBar";
import { Theatre } from "./theatre/Theatre";
import { useStore } from "../../state";
import s from "./Replay.module.css";

/** Which consoles show on narrow screens (DESIGN.md 6.1.3). */
type ConsoleMode = "both" | "left" | "right";

/** Below this width "Side by side" is unavailable and the toggle defaults to Proposed. */
const SOLO_QUERY = "(max-width: 599px)";

const CAMERA_NOTE = "Camera views are drawn from the simulated position, not recorded video.";

function useMediaQuery(q: string): boolean {
  const [m, setM] = useState(() => { try { return window.matchMedia(q).matches; } catch { return false; } });
  useEffect(() => {
    let mq: MediaQueryList | null = null;
    try { mq = window.matchMedia(q); } catch { return; }
    const on = () => setM(mq!.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq?.removeEventListener("change", on);
  }, [q]);
  return m;
}

/** Console cell content while the pair loads: title plus a static text-3 line (DESIGN.md 7). */
function ConsoleLoading({ config, seed }: { config: string; seed: number }) {
  return (
    <div className={s.fill}>
      <h2 className={s.consoleHead} style={{ color: ctrlVar(config, "text") }}>{config}</h2>
      <p className={s.loading}>Loading seed {seed}</p>
    </div>
  );
}

/** Missing trace or failed load: what failed and how to fix it (DESIGN.md 7, 10 example 10). */
function PairProblem({ pair }: { pair: RunPair }) {
  if (pair.status === "missing") {
    const who = pair.missing.join(" and ");
    // DESIGN-GAP: copy example 10 leaves the export command as a gap; the shell's REGEN_COMMAND fills it.
    return (
      <EmptyState title={`No trace for ${who} on seed ${pair.seed} (${pair.variant}).`} command={REGEN_COMMAND} cwd={REGEN_CWD}>
        Export traces for this run, then reload. Or pick another seed or Compare configuration in the bar above.
      </EmptyState>
    );
  }
  const err = pair.error;
  const hint = err && "hint" in err ? (err as { hint: string }).hint : `Export the traces with ${REGEN_COMMAND} (from ${REGEN_CWD}), then reload.`;
  return (
    <EmptyState kind="bad" title={err?.message ?? `A run file for seed ${pair.seed} failed to load.`}>
      {hint}
    </EmptyState>
  );
}

export function ReplayView() {
  const pair = useRunPair();
  const bp = useBreakpoint();
  const narrow = bp === "narrow";
  const solo = useMediaQuery(SOLO_QUERY);
  const [mode, setMode] = useState<ConsoleMode>("both");
  const theatre = useStore((st) => st.theatre);

  const ready = pair.status === "ready";
  const blocked = pair.status === "missing" || pair.status === "error";
  // Theatre replaces the frame while open, so the consoles and timeline stop redrawing.
  if (theatre && ready) return <Theatre />;
  // Wide and compact always show both consoles; below 600px side by side is unavailable.
  const shown: ConsoleMode = !narrow ? "both" : solo && mode === "both" ? "right" : mode;
  const showLeft = shown !== "right";
  const showRight = shown !== "left";

  const rootClass = [
    s.root,
    blocked ? s.blocked : "",
    shown === "left" ? s.soloLeft : shown === "right" ? s.soloRight : "",
  ].filter(Boolean).join(" ");

  const leftCell = showLeft && (
    <div key="left" className={`${s.cell} ${s.left}`}>
      {ready ? <Console side="left" /> : <ConsoleLoading config={pair.leftConfig} seed={pair.seed} />}
    </div>
  );
  const rightCell = showRight && (
    <div key="right" className={`${s.cell} ${s.right}`}>
      {ready ? <Console side="right" /> : <ConsoleLoading config={pair.rightConfig} seed={pair.seed} />}
    </div>
  );
  const spineCell = (
    <div key="spine" className={`${s.cell} ${s.spine}`}>
      {ready ? <TruthSpine /> : <div className={s.fill} />}
      {!narrow && <p className={s.note} title={CAMERA_NOTE}>{CAMERA_NOTE}</p>}
    </div>
  );

  return (
    <div className={rootClass}>
      <h1 className="sr-only">Replay</h1>

      <div className={`${s.cell} ${s.route}`}>{ready ? <RouteStrip /> : <div className={s.fill} />}</div>

      {blocked ? (
        <div className={`${s.cell} ${s.state}`}><PairProblem pair={pair} /></div>
      ) : narrow ? (
        // Narrow DOM order follows the visual order (spine above the consoles) so Tab matches.
        <>
          {spineCell}
          <div key="toggle" className={`${s.cell} ${s.toggleRow}`}>
            <SegmentedControl<ConsoleMode>
              ariaLabel="Consoles shown"
              label="Show"
              value={shown}
              onChange={setMode}
              options={[
                { value: "both", label: "Side by side", disabled: solo, title: solo ? "Needs a screen at least 600 px wide" : undefined },
                { value: "left", label: pair.leftConfig },
                { value: "right", label: pair.rightConfig },
              ]}
            />
          </div>
          {leftCell}
          {rightCell}
          <p key="note" className={`${s.note} ${s.noteRow}`}>{CAMERA_NOTE}</p>
        </>
      ) : (
        // Wide / compact DOM order is the DESIGN.md 11 tab order: left console, spine, right console.
        <>
          {leftCell}
          {spineCell}
          {rightCell}
        </>
      )}

      {!blocked && (
        <div className={`${s.cell} ${s.timeline}`}>
          {ready ? <MissionTimeline /> : <div className={s.fill} />}
        </div>
      )}

      <div className={`${s.cell} ${s.playback}`}><PlaybackBar /></div>
    </div>
  );
}
