/**
 * "A real prediction, worked": one decision from the demo run with the logged
 * time-until-unusable, the rebuilt margin, the action, what the link really did, and
 * what Baseline did on the same seed. Everything is read from the two run files.
 */
import { useMemo, useState } from "react";
import { Button, Glyph, Panel } from "../../components";
import {
  fmtClock, fmtCount, fmtDbm, fmtFrac, fmtKm, fmtMs, fmtNum, fmtSec, linkLabel, manoeuvreLabel,
} from "../../data/loader";
import type { RunData, Scenario } from "../../data/types";
import { showInReplay, type Breakpoint } from "../../state";
import type { DeciderParams } from "./params";
import { actionAgreement, computeExample, type WorkedExample } from "./example";
import { ExampleChart } from "./ExampleChart";
import { Ctrl, V, num, sec } from "./text";
import s from "./Method.module.css";

interface Props {
  status: "loading" | "ready" | "error";
  error: string | null;
  run: RunData | null;
  base: RunData | null;
  sc: Scenario;
  p: DeciderParams;
  speed: Float64Array | null;
  bp: Breakpoint;
  variant: string;
  seed: number;
}

const ACTOR = { proposed: "Proposed", baseline: "Baseline", truth: "Truth" } as const;

export function ExamplePanel({ status, error, run, base, sc, p, speed, bp, variant, seed }: Props) {
  const [hovered, setHovered] = useState<number | null>(null);
  const ex: WorkedExample | null = useMemo(
    () => (run && speed ? computeExample(run, base, sc, p, speed) : null), [run, base, sc, p, speed]);
  const agree = useMemo(() => (run && speed ? actionAgreement(run, sc, p, speed) : null), [run, sc, p, speed]);

  const title = `A real prediction, worked on seed ${seed}`;
  if (status === "loading") return <Panel id="example" title={title} state="loading" message={`Loading seed ${seed}`} />;
  if (status === "error" || !run || !speed) return <Panel id="example" title={title} state="error" message={error ?? `Could not load the runs for seed ${seed}.`} />;
  if (!ex) {
    return <Panel id="example" title={title} state="empty"
      message={`Proposed made no predicted switch or duplication on seed ${seed}, so there is no moment to work through.`} />;
  }

  const L = linkLabel(ex.link);
  const B = ex.backup ? linkLabel(ex.backup) : null;
  const q = p.proposed;
  const camWord = ex.cam === "rear" ? "rear camera" : "front camera";
  const ttu = ex.ttu;
  const ruleAction = ttu === null ? null : ttu < ex.margin ? "SWITCH" : ttu < 2 * ex.margin ? "DUPLICATE" : ttu < 3 * ex.margin ? "PREPARE" : "NORMAL";
  const lead = ex.tFail !== null ? ex.tFail - ex.t : null;
  const baseLag = ex.tBase !== null && ex.tFail !== null ? ex.tBase - ex.tFail : null;
  const mP = run.metrics.radio_leave_minus_fail_s;
  const mB = base?.metrics.radio_leave_minus_fail_s ?? null;
  const holdPlusStable = q.hold_s + q.return_stable_s;
  const gap = ex.returnGap ? ex.returnGap.tBack - ex.returnGap.tSwitch : null;

  const facts: [string, React.ReactNode][] = [
    ["Decision", <>{fmtClock(ex.t)} at {fmtKm(ex.d)}, detected mode {manoeuvreLabel(ex.mode)}</>],
    [`Time until ${L} is unusable for the ${camWord}`, <><V>{ttu === null ? "none predicted" : fmtSec(ttu)}</V> <span className={s.muted}>(logged)</span></>],
    ["Margin m", <>{sec(q.margin_base_s)} + {sec(q.margin_per_speed_s)} × {fmtNum(ex.speed, 2)} + {sec(q.switch_cost_s)} = <V>{fmtSec(ex.margin, 2)}</V> <span className={s.muted}>(speed rebuilt from the logged throttle)</span></>],
    ["Rule", ttu === null ? "No prediction" : <>{fmtSec(ttu)} {ruleAction === "SWITCH" ? "<" : "≥"} m {ruleAction === "SWITCH" ? "" : ruleAction === "DUPLICATE" ? "and < 2m " : ""}gives <b>{ruleAction}</b>; logged action <b>{ex.action ?? "none"}</b>
      {" "}{ruleAction === ex.action ? <span className={s.check}><Glyph kind="good" size={12} /> Same</span> : <span className={s.check}><Glyph kind="bad" size={12} /> Differs</span>}</>],
    [`${L} as measured`, <>
      {ex.measured.sig !== null && <>signal {fmtDbm(ex.measured.sig)}{ex.signalUnusable !== null && <> (unusable below {fmtDbm(ex.signalUnusable)})</>}, </>}
      RTT p90 {fmtMs(ex.measured.rtt_p90)} (limit {fmtMs(ex.req.max_rtt_ms)}), loss {fmtFrac(ex.measured.loss)} (limit {fmtFrac(ex.req.max_loss, 0)})</>],
    ["Action", B ? <>{camWord.replace(/^./, (c) => c.toUpperCase())} moved to {B}, {L} avoided for {sec(q.hold_s)}</> : "No backup link was available"],
    ["What really happened", lead !== null
      ? <>{L} truly failed for video {fmtSec(lead)} later, at {fmtClock(ex.tFail)}.
        {baseLag !== null && <> <Ctrl name="Baseline" /> moved its video {baseLag >= 0 ? `${fmtSec(baseLag)} after` : `${fmtSec(-baseLag)} before`} the failure, at {fmtClock(ex.tBase)}{ex.baseStreak !== null && <>, after {ex.baseStreak} failed checks in a row</>}.</>}</>
      : <>The link did not truly fail on the outbound fade in this run.</>],
    ["Usable view lost in this window", <><Ctrl name="Baseline" /> <V>{ex.lostS.baseline === null ? "–" : fmtSec(ex.lostS.baseline)}</V>, <Ctrl name="Proposed" /> <V>{fmtSec(ex.lostS.proposed)}</V> <span className={s.muted}>({fmtClock(ex.window[0])} to {fmtClock(ex.window[1])})</span></>],
  ];

  return (
    <Panel id="example" title={title}
      actions={<Button onClick={() => showInReplay({ variant, seed, t: ex.t, cmp: "Baseline" })}>Show in replay</Button>}>
      <p className={s.lede}>
        {ex.byRule
          ? <>Chosen by rule, not by hand: the last time <Ctrl name="Proposed" /> predicted that {L}, the preferred link, would fail before it truly broke the video limit on the way out.</>
          : <>This run has no predicted switch before {L} truly failed, so this is <Ctrl name="Proposed" />&apos;s first predicted move.</>}
        {" "}Seed {seed} is the demo seed: typical, not the best case.
      </p>
      <ExampleChart run={run} base={base} ex={ex} speed={speed} params={p} bp={bp} hovered={hovered} />
      <div className={s.exampleGrid}>
        <div>
          <h3 className={s.subTitle}>The decision at {fmtClock(ex.t)}</h3>
          <dl className={s.facts}>
            {facts.map(([k, v]) => (
              <div key={k} className={s.fact}><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
        </div>
        <div>
          <h3 className={s.subTitle}>In order</h3>
          <ol className={s.eventList}>
            {ex.events.map((e, n) => (
              <li key={n} className={[s.event, hovered === n ? s.eventHot : ""].join(" ")} tabIndex={0}
                onMouseEnter={() => setHovered(n)} onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(n)} onBlur={() => setHovered(null)}
                title={e.reason?.raw}>
                <span className={[s.chip, s[`chip_${e.actor}`]].join(" ")} aria-hidden>{n + 1}</span>
                <span className={s.evTime}>{fmtClock(e.t)}</span>
                <span className={s.evText}>
                  {e.actor === "truth" ? null : <><span className={e.actor === "baseline" ? "ctrl-baseline" : "ctrl-proposed"}>{ACTOR[e.actor]}</span>. </>}
                  {e.text}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <div className={s.checks}>
        {ex.returnGap && gap !== null && (
          <p>
            <b>Hold and return, seen here.</b> After the predicted switch at {fmtClock(ex.returnGap.tSwitch)}, the camera went back to {L} at
            {" "}{fmtClock(ex.returnGap.tBack)}, {fmtSec(gap)} later
            {Math.abs(gap - holdPlusStable) <= 0.15
              ? <>: {sec(q.hold_s)} while {L} was avoided, then {sec(q.return_stable_s)} for {L} to stay usable.</>
              : <>. The return rule needs at least {sec(q.hold_s)} of avoidance and {sec(q.return_stable_s)} of stable use.</>}
            {ex.events.some((e) => e.actor === "proposed" && e.t > ex.returnGap!.tBack && e.t < ex.t && e.reason?.kind === "predict-duplicate") && (
              <> The trend then fell again, so it duplicated and, at {fmtClock(ex.t)}, switched a second time.</>
            )}
          </p>
        )}
        {agree && agree.total > 0 && (
          <p>
            <b>Check against the whole run.</b> Using the logged time until unusable and the rebuilt margin, the rule above reproduces the logged
            action at <V>{agree.match.toLocaleString("en-US")} of {agree.total.toLocaleString("en-US")}</V> decisions
            ({fmtNum((100 * agree.match) / agree.total, 1)}%) where <Ctrl name="Proposed" /> did not switch.
            {agree.total - agree.match > 0 && (() => {
              const miss = agree.total - agree.match;
              const other = miss - agree.nearMargin - agree.windowEdge;
              const parts = [
                agree.nearMargin > 0 ? `${fmtCount(agree.nearMargin)} within 0.06 s of m, 2m or 3m (time left is logged to ${num(0.1)} s)` : null,
                agree.windowEdge > 0 ? `${fmtCount(agree.windowEdge)} exactly at the edge of a handover window, where the decider's clock is a float` : null,
                other > 0 ? `${fmtCount(other)} not explained by rounding` : null,
              ].filter(Boolean);
              return <> Of the {fmtCount(miss)} that differ, {parts.join("; ")}.</>;
            })()}
          </p>
        )}
        {(mP !== null || mB !== null) && (
          <p>
            <b>Engine metric, for comparison.</b> <span className={s.codeName}>radio_leave_minus_fail_s</span> uses the first time the view left the radio on the way out:
            {" "}<Ctrl name="Baseline" /> <V>{mB === null ? "–" : fmtSec(mB)}</V>, <Ctrl name="Proposed" /> <V>{mP === null ? "–" : fmtSec(mP)}</V>. Negative means it left before the radio failed.
          </p>
        )}
      </div>
    </Panel>
  );
}
