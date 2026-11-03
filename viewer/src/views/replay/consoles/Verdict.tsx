/**
 * Verdict sentence and "Mode seen" line (DESIGN.md 6.1 wireframe, 7, 10 example 2).
 *
 * The verdict is the simulator's own score at the cursor (samples.useful), explained from the
 * same columns the engine compared. A usable view is drawn in the controller's colour, never
 * green; "Not usable" is status-bad with a cross glyph and a 10% wash (DESIGN.md 2.4).
 */
import { memo } from "react";
import type { RunData } from "../../../data/types";
import { Glyph, Tooltip, ctrlVar } from "../../../components";
import { fmtClock, manoeuvreLabel } from "../../../data/loader";
import { modeSeenAt, requirementText, verdictAt } from "./model";
import s from "./Console.module.css";

/** Check mark drawn in the controller colour (usable is never green). */
function UsableMark({ color }: { color: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden style={{ flex: "none", color }}>
      <path d="M2 6.5 L5 9.2 L10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export const Verdict = memo(function Verdict({ run, k, config, endedAt }: {
  run: RunData; k: number; config: string; endedAt: number | null;
}) {
  if (endedAt !== null) {
    return (
      <div className={s.block}>
        <p className={`${s.verdict} ${s.verdictEnded}`}>
          Mission ended at {fmtClock(endedAt)}. No view is scored after this.
        </p>
      </div>
    );
  }
  const v = verdictAt(run, k);
  if (!v) return <div className={s.block}><p className={`${s.verdict} ${s.verdictEnded}`}>No score at this moment.</p></div>;
  const need = `${manoeuvreLabel(v.man)} needs the ${requirementText(v.req)}. Thresholds are config assumptions (A); the score is the simulator's own.`;
  return (
    <Tooltip content={need} placement="bottom" className={s.block}>
      <p tabIndex={0} className={`${s.verdict} ${v.usable ? s.verdictOk : s.verdictBad}`}
        style={v.usable ? { borderLeftColor: ctrlVar(config) } : undefined}>
        <span className={s.verdictHead} style={v.usable ? { color: ctrlVar(config, "text") } : undefined}>
          {v.usable ? <UsableMark color={ctrlVar(config, "text")} /> : <Glyph kind="bad" size={12} />}
          {v.usable ? "Usable:" : "Not usable:"}
        </span>{" "}
        <span className={s.verdictDetail}>{v.detail}</span>
      </p>
    </Tooltip>
  );
});

export const ModeLine = memo(function ModeLine({ run, k, config, short = false }: {
  run: RunData; k: number; config: string;
  /** Compact title row: "none (true: Driving)"; the tooltip still says why in full. */
  short?: boolean;
}) {
  const m = modeSeenAt(run, k);
  let value: React.ReactNode;
  let tip: string;
  if (!m.detects) {
    const why = m.seenCode === "FIXED"
      ? `${config} runs with mission awareness off: fixed camera priorities, front first.`
      : `${config} does not detect the manoeuvre: it always sends both cameras and steers them by fixed link thresholds.`;
    const why2 = m.seenCode === "FIXED" ? "mission awareness is off" : `${config} does not detect manoeuvres`;
    value = <>none{short ? "" : `, ${why2}`} <span className={s.modeTrue}>(true: {m.truth})</span></>;
    tip = `${why} True manoeuvre (driver script): ${m.truthCode}.`;
  } else if (m.match) {
    value = <>{m.seen}</>;
    tip = `Detected ${m.seenCode}; the driver script's true manoeuvre is also ${m.truthCode}.`;
  } else {
    value = <>{m.seen} <span className={s.modeWrong}>(true: {m.truth})</span></>;
    tip = `Detected ${m.seenCode}; the driver script's true manoeuvre is ${m.truthCode}. The score always uses the true one.`;
  }
  return (
    <Tooltip content={tip} placement="bottom" className={s.block}>
      <p tabIndex={0} className={s.mode}>
        <span className={s.modeLabel}>Mode seen:</span> {value}
      </p>
    </Tooltip>
  );
});
