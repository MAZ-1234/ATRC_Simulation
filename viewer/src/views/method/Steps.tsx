/**
 * "Baseline decides like this" / "Proposed decides like this" (DESIGN.md 6.4).
 * Every step paraphrases edge_mlc/deciders/baseline.py or proposed.py; every number is
 * read from the exported data (limits, ladder, link_config, requirements, driver) or
 * from the decider parameters (params.ts).
 */
import type { ReactNode } from "react";
import { Button, Panel } from "../../components";
import { fmtClock, fmtDbm, fmtMs, fmtRate, linkLabel, manoeuvreLabel } from "../../data/loader";
import type { Manoeuvre, Scenario } from "../../data/types";
import { showInReplay } from "../../state";
import { CODE, type DeciderParams } from "./params";
import { Code, Ctrl, Level, V, num, pct, sec } from "./text";
import s from "./Method.module.css";

export interface Step { title: ReactNode; detail: ReactNode }

export function StepList({ steps, label }: { steps: Step[]; label: string }) {
  return (
    <ol className={s.steps} aria-label={label}>
      {steps.map((st, n) => (
        <li key={n} className={s.step}>
          <span className={s.stepNo} aria-hidden>{n + 1}</span>
          <div className={s.stepBody}>
            <p className={s.stepTitle}>{st.title}</p>
            <div className={s.stepDetail}>{st.detail}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export interface DemoFacts {
  variant: string;
  seed: number;
  detector: { match: number; total: number } | null;
  scheduled: { t: number; text: string } | null;
}

const MANS: Manoeuvre[] = ["DRIVE", "REVERSE", "PRECISION", "STOPPED"];

export function BaselineSteps({ sc, p }: { sc: Scenario; p: DeciderParams }) {
  const b = p.baseline;
  const dt = 1 / p.timing.loop_hz;
  const order = sc.links.map(linkLabel);
  const lo = sc.ladder[b.cam_min_level];
  const hi = sc.ladder[b.cam_max_level];
  const tooNarrow = MANS.filter((m) => lo && lo.w < sc.requirements[m].min_w).map((m) => manoeuvreLabel(m));
  const steps: Step[] = [
    {
      title: "Measure each link: heartbeat RTT, loss and capacity",
      detail: <p>The shared measurement layer (see Measurement). <Ctrl name="Baseline" /> checks the median RTT over the last {sec(CODE.rttWindowS)} and the loss over the last {sec(CODE.lossWindowS)}.</p>,
    },
    {
      title: <>Mark a link bad after {b.bad_after} failed checks, good after {b.good_after} clean ones</>,
      detail: (
        <p>
          One check every {sec(dt)}, separately for commands and video. Commands fail above <V>{fmtMs(sc.limits.cmd.max_rtt_ms)}</V> RTT
          or <V>{pct(sc.limits.cmd.max_loss)}</V> loss; video above <V>{fmtMs(sc.limits.video.max_rtt_ms)}</V> or <V>{pct(sc.limits.video.max_loss)}</V>.
          A link that stopped answering always fails. Bad after <V>{b.bad_after}</V> failures in a row (about {sec(b.bad_after * dt)}),
          good again after <V>{b.good_after}</V> clean checks in a row (about {sec(b.good_after * dt)}).
        </p>
      ),
    },
    {
      title: <>Steer by fixed preference: {order.join(", then ")}</>,
      detail: (
        <p>
          Commands go on the two best links, good ones first, so they are always duplicated (the ATSSS redundant mode).
          Both cameras go on the first link that is good for video. If no link is good, they stay where they are.
          The <Code>Baseline + duplicate video</Code> configuration also sends both cameras on the next link.
        </p>
      ),
    },
    {
      title: "Step a camera down on loss, up after a quiet spell",
      detail: (
        <p>
          When the video link&apos;s data loss is above <V>{pct(b.cam_down_loss)}</V>, the camera at the higher level drops one level
          (the rear camera when they are level). After <V>{sec(b.cam_up_after_s)}</V> with loss at or below <V>{pct(b.cam_down_loss)}</V>, the lower camera climbs one level
          (the front camera when level). Both cameras are always sent, between <Level l={lo} /> and <Level l={hi} />, whatever
          the vehicle is doing.{lo && tooNarrow.length > 0 && <> At {lo.name} the frame is {lo.w} px wide, too narrow for {tooNarrow.join(" and ")}.</>}
        </p>
      ),
    },
    {
      title: "Send uploads at once, shaped, on the video link",
      detail: (
        <p>
          Bulk rate = <V>{pct(p.uploads.bulk_budget_share)}</V> of the video link&apos;s capacity estimate, minus commands
          ({fmtRate(sc.constants.TELEM_KBPS)}) and both cameras. Requested items go before background ones, oldest first.
          Nothing depends on manoeuvres or stops. The <Code>Baseline (no shaping)</Code> reference instead sends greedily, filling the modem queue.
        </p>
      ),
    },
  ];
  return (
    <Panel title="Baseline decides like this" titleColor="var(--color-ctrl-baseline-text)" id="decide-baseline" className={s.decidePanel}>
      <StepList steps={steps} label="Baseline steps" />
      <p className={s.panelFoot}>Every {sec(dt)}. Source: <Code>deciders/baseline.py</Code>.</p>
    </Panel>
  );
}

export function ProposedSteps({ sc, p, demo }: { sc: Scenario; p: DeciderParams; demo: DemoFacts | null }) {
  const q = p.proposed;
  const dt = 1 / p.timing.loop_hz;
  const pref = linkLabel(sc.links[0]);
  const cruise = sc.driver.states.CRUISE_OUT?.throttle ?? null;
  const mCruise = cruise !== null ? q.margin_base_s + q.margin_per_speed_s * Math.abs(cruise) + q.switch_cost_s : null;
  const sigLimits = sc.link_config.filter((l) => l.signal_unusable !== undefined);
  const hs = sc.link_config.find((l) => l.handover_schedule)?.handover_schedule;
  const hsLink = sc.link_config.find((l) => l.handover_schedule)?.name;
  const [need, outOf] = q.trend_consistency;
  const steps: Step[] = [
    {
      title: <>Measure each link, plus its trend over the last {sec(q.trend_window_s)}</>,
      detail: (
        <p>
          The same measurement layer as <Ctrl name="Baseline" />. <Ctrl name="Proposed" /> checks limits against the 90th-percentile RTT
          over {sec(CODE.rttWindowS)}, and keeps {sec(q.trend_window_s)} of readings per link for the predictor (step 4).
        </p>
      ),
    },
    {
      title: "Detect the manoeuvre from throttle and steering",
      detail: (
        <>
          <p>Checked in this order every {sec(dt)}, on a speed proxy: the smoothed throttle,
            {" "}{num(CODE.speedKeep)} × previous + {num(CODE.speedNew)} × |throttle|.</p>
          <ul className={s.rules}>
            <li><b>Reversing</b>: throttle below <V>{num(q.reverse_thr)}</V> within {sec(CODE.reverseAfterStopS)} of being stopped, or already reversing. Applies at once.</li>
            <li><b>Stopped</b>: speed proxy below <V>{num(q.stopped_speed)}</V> for more than <V>{sec(q.stopped_for_s)}</V>.</li>
            <li><b>Precision</b>: steering beyond ±<V>{num(q.precision_steer)}</V>, or moving with a speed proxy below <V>{num(q.precision_speed)}</V>.</li>
            <li><b>Driving</b>: anything else.</li>
          </ul>
          <p>Any new mode except Reversing must hold for <V>{sec(q.mode_debounce_s)}</V>. An operator mode button would override the detector; the simulation never presses it.
            {demo?.detector && demo.detector.total > 0 && (
              <> In the demo run (seed {demo.seed}) the detected mode matched the true manoeuvre at <V>{((100 * demo.detector.match) / demo.detector.total).toFixed(1)}%</V> of scored samples.</>
            )}
          </p>
        </>
      ),
    },
    {
      title: "Give the camera this manoeuvre needs the best link and level",
      detail: (
        <>
          <p>The needs table (below) names the protected camera, its allowed levels and its limits for each mode. Each link offers
            {" "}<V>{pct(q.headroom)}</V> of its capacity estimate. Commands take the two best links that meet the command limits.</p>
          <ul className={s.rules}>
            <li>Cameras are served in priority order. A link qualifies if it meets the camera&apos;s limits, is not being avoided after a predicted failure, is not predicted to be past a limit already, and has room for the lowest allowed level.</li>
            <li>The camera stays on its link while it qualifies; otherwise it takes the first qualifying link in the order {sc.links.map(linkLabel).join(", ")}. It returns to {pref} only after {pref} has qualified for <V>{sec(q.return_stable_s)}</V> with no predicted failure, at least <V>{sec(q.hold_s)}</V> after the last switch, and never while reversing or in precision.</li>
            <li>It gets the highest allowed level that fits the room left.</li>
            <li>If no link qualifies, the protected camera keeps its lowest allowed level on the least-bad live link (degraded); other cameras drop to TRICKLE or pause.</li>
          </ul>
        </>
      ),
    },
    {
      title: <>Move early when a link is falling or a {hsLink ? linkLabel(hsLink) : "Starlink"} handover is due</>,
      detail: (
        <>
          <p>
            For each link it smooths RTT, loss and signal over {CODE.trendSmooth} readings, once it has at least {CODE.trendMinReadings}. A metric is falling only if at least
            {" "}<V>{need} of the last {outOf}</V> steps got worse; its rate is the slope of a straight-line fit. Time until unusable is the
            shortest time for any falling metric to reach the stream&apos;s limit, or 0 if one is past it already
            {sigLimits.length > 0 && <> (signal: {sigLimits.map((l, j) => <span key={l.name}>{j > 0 ? ", " : ""}{linkLabel(l.name)} <V>{fmtDbm(l.signal_unusable!)}</V></span>)})</>}.
          </p>
          <p className={s.formula}>
            m = <V>{sec(q.margin_base_s)}</V> + <V>{sec(q.margin_per_speed_s)}</V> × speed + <V>{sec(q.switch_cost_s)}</V> switch cost
            {mCruise !== null && <span className={s.formulaNote}> ({sec(Math.round(mCruise * 100) / 100)} at the cruise throttle {num(Math.abs(cruise!))})</span>}
          </p>
          <ul className={s.rules}>
            <li><b>SWITCH</b> when time left &lt; m: move to the backup now, if there is one, and avoid the old link for <V>{sec(q.hold_s)}</V>.</li>
            <li><b>DUPLICATE</b> when time left &lt; 2m: send on the backup as well.</li>
            {hs && <li><b>DUPLICATE</b> from <V>{sec(hs.pre_s)}</V> before to <V>{sec(hs.post_s)}</V> after each {linkLabel(hsLink!)} handover (:{hs.offsets_s.join(", :")} each minute).</li>}
            <li><b>PREPARE</b> when time left &lt; 3m: no move yet.</li>
            <li><b>NORMAL</b> otherwise.</li>
          </ul>
          <p>Any action other than NORMAL raises heartbeats from {p.timing.hb_hz} Hz to {Math.round(1 / CODE.fastHbPeriodS)} Hz. The backup is another live link that meets the limits now, is not itself predicted to fail within 2m, and has room; the lowest RTT wins.
            {demo?.scheduled && (
              <> First handover duplication in the demo run: {fmtClock(demo.scheduled.t)}.{" "}
                <Button variant="quiet" className={s.inlineBtn}
                  onClick={() => showInReplay({ variant: demo.variant, seed: demo.seed, t: Math.max(0, demo.scheduled!.t - 2), cmp: "Baseline" })}>
                  Show in replay
                </Button>
              </>
            )}
          </p>
        </>
      ),
    },
    {
      title: "Protect the needed camera with two-stream FEC across every live link",
      detail: (
        <>
          <p>
            Each captured frame of the protected camera is sent twice: a small <b>base stream</b> (the mode&apos;s lowest allowed level) and the
            {" "}<b>full stream</b> at the level step 3 chose. With n live links:
          </p>
          <ul className={s.rules}>
            <li>The base stream goes whole on every live link, so any single link that survives still shows a picture.</li>
            <li>The full stream is erasure coded into n pieces, one per link, so that any n−1 pieces rebuild the frame: losing any one link keeps full quality.</li>
            <li>With two live links that means a whole copy of the full stream on each (no base stream); with one live link it sends exactly what step 3 chose.</li>
            <li>The first copy of a capture to arrive is shown; a later full-quality copy of the same capture upgrades it.</li>
          </ul>
          <p>
            The predictor (step 4) still picks the link the full stream starts on. The other camera and the commands are not coded.
            Cost: the extra data shown as <Code>dup_overhead_pct</Code> in Results. The car code does not send coded streams yet; this runs in the simulator only.
          </p>
        </>
      ),
    },
    {
      title: "Schedule uploads around the protected view",
      detail: (
        <p>
          The adaptive policy: requested uploads outrank camera quality above the minimum while stopped or in precision; the cameras come first
          while driving or reversing. Bulk goes on the live link with the highest capacity estimate that meets the video loss limit, which
          may not be the video link. See Uploads.
        </p>
      ),
    },
  ];
  return (
    <Panel title="Proposed decides like this" titleColor="var(--color-ctrl-proposed-text)" id="decide-proposed" className={s.decidePanel}>
      <StepList steps={steps} label="Proposed steps" />
      <p className={s.panelFoot}>Every {sec(dt)}. Source: <Code>deciders/proposed.py</Code>. Each part can be switched off for the ablation runs.</p>
    </Panel>
  );
}
