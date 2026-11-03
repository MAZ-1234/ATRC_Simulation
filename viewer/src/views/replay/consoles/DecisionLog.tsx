/**
 * Decision log (DESIGN.md 7 "Decision log entry", 6.1.2 compact, 10 copy).
 *
 * run.reasons up to the cursor, newest first. The exporter lists a reason only when it is
 * new at that decision, so an ongoing condition appears once when it starts. Each line is a
 * plain-language rewrite of the decider's own text (rules in model.ts mirror the f-strings
 * in edge_mlc/deciders/*.py); the raw text is always one hover or focus away.
 *
 * - current: the entry at or just before the cursor (the top one) gets surface-2.
 * - divergence: a 3px left rule in the controller colour marks the controller's last
 *   decision in the 5 s before a divergence began (the decision that led into it).
 *   DESIGN-GAP: DESIGN.md does not define "starts a divergence"; the 5 s window is a display
 *   rule only and is stated in the entry's tooltip.
 * - Clicking an entry moves the cursor to it.
 * - Compact and narrow: 3 newest plus "Show all decisions" (popover anchored to the console).
 */
import { memo, useMemo, useRef, useState, type RefObject } from "react";
import type { RunData } from "../../../data/types";
import { Button, Popover, Tooltip, ctrlVar } from "../../../components";
import { fmtClock, reasonIndexAt } from "../../../data/loader";
import { RIGHT_CONFIG, usePairEvents, useStore } from "../../../state";
import type { Side } from "../../../data/events";
import { logEntries, type LogEntry } from "./model";
import s from "./Console.module.css";

/** Window before a divergence in which a decision is marked as leading into it, s. */
const LEAD_S = 5;

interface Mark { t: number; end: number; who: Side }

/** Reason index -> divergence it leads into (newest decision in the LEAD_S before it began). */
function useDivergenceMarks(run: RunData): Map<number, Mark> {
  const ev = usePairEvents();
  return useMemo(() => {
    const out = new Map<number, Mark>();
    if (!ev) return out;
    for (const d of ev.divergences) {
      const i = reasonIndexAt(run, d.t);
      if (i >= 0 && run.reasons[i][0] >= d.t - LEAD_S - 1e-6) out.set(i, { t: d.t, end: d.end, who: d.side });
    }
    return out;
  }, [ev, run]);
}

const Entry = memo(function Entry({ e, current, mark, config, names, clamp }: {
  e: LogEntry; current: boolean; mark: Mark | undefined; config: string;
  names: Record<Side, string>; clamp: boolean;
}) {
  const tip = (
    <>
      <div>Logged as: “{e.raw}”</div>
      {mark && (
        <div className={s.tipNote}>
          Last decision before a divergence at {fmtClock(mark.t)}: only {names[mark.who]} could see, for {(mark.end - mark.t).toFixed(1)} s.
        </div>
      )}
    </>
  );
  return (
    <li className={s.entryItem}>
      <Tooltip content={tip} placement="top" className={s.entryAnchor}>
        <button type="button"
          className={[s.entry, current ? s.current : "", mark ? s.marked : "", clamp ? s.clamp : ""].filter(Boolean).join(" ")}
          style={mark ? { borderLeftColor: ctrlVar(config) } : undefined}
          onClick={() => { const st = useStore.getState(); st.pause(); st.seek(e.t); }}>
          <span className={s.stamp}>{fmtClock(e.t)}</span>
          <span className={s.entryText}>{e.text}</span>
        </button>
      </Tooltip>
    </li>
  );
});

function EntryList({ run, upto, limit, config, names, marks, clamp }: {
  run: RunData; upto: number; limit: number | null; config: string;
  names: Record<Side, string>; marks: Map<number, Mark>; clamp: boolean;
}) {
  const all = logEntries(run);
  const first = limit === null ? 0 : Math.max(0, upto - limit + 1);
  const rows: LogEntry[] = [];
  for (let i = upto; i >= first; i--) rows.push(all[i]);
  return (
    <ol className={s.entries} aria-label={`${config} decisions, newest first`}>
      {rows.map((e) => (
        <Entry key={e.i} e={e} current={e.i === upto} mark={marks.get(e.i)} config={config} names={names} clamp={clamp} />
      ))}
    </ol>
  );
}

function Empty({ run, config }: { run: RunData; config: string }) {
  const first = run.reasons[0];
  return (
    <p className={s.logEmpty}>
      {first
        ? <>No decisions logged yet. {config}'s first is at {fmtClock(first[0])}.</>
        : <>{config} logged no decisions in this run.</>}
    </p>
  );
}

export function DecisionLog({ run, config, side, compact, clamp, anchorRef }: {
  run: RunData; config: string; side: Side; compact: boolean;
  /** One line per entry (compact, where the row height is fixed); narrow wraps instead. */
  clamp: boolean; anchorRef: RefObject<HTMLElement>;
}) {
  const upto = useStore((st) => reasonIndexAt(run, st.t));
  const marks = useDivergenceMarks(run);
  const leftConfig = useStore((st) => st.compare);
  const names = useMemo<Record<Side, string>>(() => ({ left: leftConfig, right: RIGHT_CONFIG }), [leftConfig]);
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const t = useStore((st) => (open ? st.t : 0));
  void side;

  return (
    <div className={s.log}>
      <div className={s.logHead}>
        <h3 className={s.logTitle}>Decisions</h3>
        {upto >= 0 && <span className={s.logCount}>{upto + 1} so far</span>}
        {compact && upto >= 3 && (
          <Button ref={btn} variant="quiet" className={s.showAll} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>
            Show all decisions
          </Button>
        )}
      </div>
      {upto < 0 ? (
        <Empty run={run} config={config} />
      ) : (
        <div className={s.logScroll} tabIndex={compact ? undefined : 0} aria-label={compact ? undefined : `${config} decision log`}>
          <EntryList run={run} upto={upto} limit={compact ? 3 : null} config={config} names={names} marks={marks} clamp={clamp} />
        </div>
      )}
      {compact && (
        <Popover open={open} onClose={() => setOpen(false)} anchorRef={(anchorRef as RefObject<HTMLElement>) ?? btn}
          placement="bottom-start" width={460} title={`${config} decisions up to ${fmtClock(t)}`}>
          <div className={s.popList}>
            {upto >= 0
              ? <EntryList run={run} upto={upto} limit={null} config={config} names={names} marks={marks} clamp={false} />
              : <Empty run={run} config={config} />}
          </div>
        </Popover>
      )}
    </div>
  );
}
