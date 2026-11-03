/**
 * "Why Proposed scored higher / lower here" and "How the two controllers work", inside
 * "How we got these numbers" (ClaimExplainer). The reasons are built from evidence in the
 * chapter's scope, never typed in:
 *   - which links were truly up, and how much capacity they had (truth.<link>.up / .cap);
 *   - what each controller SENT on the needed camera (cams.<cam>.tlevel against the
 *     requirement's min_w and min_fps) and its most common level;
 *   - how often it cut the camera nobody needed (tlevel PAUSED or TRICKLE);
 *   - predictive actions on the needed camera (decisions.cols.<cam>_action DUPLICATE/SWITCH),
 *     changes of its primary link (samples.link), and for the radio chapter the engine's
 *     radio_leave_minus_fail_s;
 *   - the most common failure reason of the not-usable samples (ClaimExplainer's count).
 * A sentence only appears when its evidence is present; the wording stays "the trace shows".
 */
import type { ReactNode } from "react";
import type { CamName, LadderLevel, Manoeuvre } from "../../../data/types";
import { Button, ctrlClass } from "../../../components";
import { dec, decisionIndexAt, ladderOf, linkLabel, manoeuvreLabel } from "../../../data/loader";
import { fmtClock, fmtCount, fmtMbps, fmtPct, fmtSec } from "../../../format";
import { useStore } from "../../../state";
import type { Side } from "./ClaimExplainer";
import { attribute, ranked, type Attribution, type Cause } from "./attribution";
import s from "./ClaimExplainer.module.css";

/** A level at or below this is "cut": PAUSED (0) or TRICKLE (1). */
const CUT_LEVEL = 1;
/** Usable-time differences up to this are about one Starlink handover dropout, s. */
const NOISE_S = 2;

const FAIL_NOUN: Record<string, string> = {
  never: "no frame received yet",
  stale: "frames arriving too late",
  fps: "too low a frame rate",
  width: "too small a picture",
  rounding: "frames just over the age limit",
};

interface Evidence {
  /** Share of the scope (0-1) where the needed camera was SENT at a level meeting its limits. */
  sentOk: number | null;
  /** Most common level sent on the needed camera, and its share. */
  modal: { lv: LadderLevel; share: number } | null;
  /** Share of the scope where the camera NOT needed was paused or at 1 fps. */
  otherCut: number | null;
  /** Share of the scope where the needed camera was duplicated on two links. */
  dup: number;
  /** Changes of the needed camera's primary link inside the scope. */
  switches: number;
  /** Starts of a DUPLICATE or SWITCH action on the needed camera, and the first one. */
  predictive: { n: number; first: number | null };
}

function evidenceOf(x: Side): Evidence {
  const run = x.run;
  const sm = run.samples;
  const act = run.decisions?.cols;
  let ok = 0;
  let other = 0;
  let dup = 0;
  let switches = 0;
  let prevLink: number | null = null;
  let prevAct = "";
  let pn = 0;
  let pFirst: number | null = null;
  const levels = new Map<number, number>();
  for (const k of x.idx) {
    const man = dec(run, "man", sm.man[k]) as Manoeuvre | null;
    const req = man ? run.meta.requirements[man] : undefined;
    if (!req) continue;
    const cam = req.cam;
    const otherCam: CamName = cam === "front" ? "rear" : "front";
    const tl = run.cams?.[cam]?.tlevel[k];
    if (tl !== undefined) {
      levels.set(tl, (levels.get(tl) ?? 0) + 1);
      const lv = ladderOf(run, tl);
      if (lv && lv.w >= req.min_w && lv.fps >= req.min_fps) ok++;
    }
    const ol = run.cams?.[otherCam]?.tlevel[k];
    if (ol !== undefined && ol <= CUT_LEVEL) other++;
    if (sm.dup[k] === 1) dup++;
    if (prevLink !== null && sm.link[k] !== prevLink) switches++;
    prevLink = sm.link[k];
    if (act) {
      const code = (cam === "front" ? act.front_action : act.rear_action)[decisionIndexAt(run, sm.t[k])];
      const name = code >= 0 ? run.enums.action[code] ?? "" : "";
      const on = name === "DUPLICATE" || name === "SWITCH";
      if (on && name !== prevAct) { pn++; pFirst = pFirst ?? sm.t[k]; }
      prevAct = on ? name : "";
    }
  }
  const n = x.idx.length;
  let modal: Evidence["modal"] = null;
  for (const [lvIdx, c] of levels) {
    const lv = ladderOf(run, lvIdx);
    if (lv && (!modal || c / n > modal.share)) modal = { lv, share: c / n };
  }
  return {
    sentOk: n ? ok / n : null, modal, otherCut: n ? other / n : null, dup: n ? dup / n : 0, switches,
    predictive: { n: pn, first: pFirst },
  };
}

const pct = (f: number | null) => fmtPct(f === null ? null : 100 * f, 0);
const times = (n: number) => `${fmtCount(n)} ${n === 1 ? "time" : "times"}`;
const lvText = (lv: LadderLevel) => (lv.w > 0 ? `${lv.w}×${lv.h} at ${lv.fps} fps` : "paused");

/** The links that were truly up in the scope, from the right run's ground truth. */
function linksLine(x: Side): string | null {
  const run = x.run;
  if (!run.truth || !x.idx.length) return null;
  const parts: string[] = [];
  for (const ln of run.meta.links) {
    const tr = run.truth[ln];
    if (!tr) continue;
    const caps: number[] = [];
    let up = 0;
    for (const k of x.idx) if (tr.up[k] === 1) { up++; caps.push(tr.cap[k]); }
    caps.sort((a, b) => a - b);
    const med = caps.length ? caps[Math.floor(caps.length / 2)] : null;
    const share = up / x.idx.length;
    parts.push(share === 0 ? `${linkLabel(ln)} down` : `${linkLabel(ln)} up ${pct(share)} of the time (median ${fmtMbps(med)})`);
  }
  return parts.length ? parts.join("; ") : null;
}

function Name({ x }: { x: Side }) {
  return <span className={ctrlClass(x.config)}><b>{x.label}</b></span>;
}

// ------------------------------------------------------------------ in short

/** How each manoeuvre reads in a sentence ("... the picture it needs for the precision approach"). */
const MAN_PHRASE: Record<string, string> = {
  DRIVE: "driving", REVERSE: "reversing", PRECISION: "the precision approach", STOPPED: "the stop",
};

/** Short noun phrase for a cause, for the second sentence ("Another 2.3 s came from ..."). */
function causePhrase(c: Cause, a: Attribution): string {
  switch (c) {
    case "level": return "sending the picture size the manoeuvre needs (mission awareness)";
    case "link": return a.predicted ? "moving off a failing link before it dropped (prediction)" : "being on a link that stayed up";
    case "bandwidth": return "pausing the camera nobody needed to free bandwidth (mission awareness)";
    default: return "where random dropouts happened to fall";
  }
}

/** The main-cause sentence, in plain terms. `win` saw when `lose` did not. */
function causeSentence(c: Cause, a: Attribution, win: Side, lose: Side): string {
  const W = win.label;
  const Lo = lose.label;
  const proposedWins = win.run.meta.decider !== "baseline";
  const man = a.levelMan ? MAN_PHRASE[a.levelMan] ?? a.levelMan.toLowerCase() : "this manoeuvre";
  const req = a.levelMan ? win.run.meta.requirements[a.levelMan] : undefined;
  const need = a.winnerW ?? req?.min_w;
  const dead = a.deadLink ? linkLabel(a.deadLink) : "its link";
  const alive = a.winnerLink ? linkLabel(a.winnerLink) : "another link";
  switch (c) {
    case "level":
      return proposedWins
        ? `Mostly mission awareness: ${W} knew the operator needed a ${need ?? "larger"} px picture for ${man} and sent it, while ${Lo}, which does not know the manoeuvre, kept sending ${a.loserW ?? "a smaller"} px.`
        : `Mostly picture level: ${W} happened to send the ${need ?? "larger"} px picture that ${man} needs, while ${Lo} held the needed camera lower because its capacity estimate said the higher level would not fit.`;
    case "link":
      if (!proposedWins) return `Mostly link choice: ${Lo}'s needed camera was on ${dead} when it faltered, while ${W}'s was on ${alive}, which stayed up.`;
      return a.predicted
        ? `Mostly predictive switching: ${W} saw ${dead} failing and moved the needed camera to ${alive} before it dropped, while ${Lo} stayed on ${dead} until after it had failed.`
        : `Mostly link choice: when ${dead} failed, ${W}'s needed camera was already on ${alive}, while ${Lo} was still on ${dead} and only switched after the drop.`;
    case "bandwidth":
      return `Mostly bandwidth priority, part of mission awareness: on links too weak for both cameras, ${W} paused the camera nobody needed and gave the needed one all the capacity, while ${Lo} kept splitting it between both.`;
    default:
      return `No single decision explains it: ${Lo}'s extra losses line up with random dropouts that happened to hit it and not ${W}.`;
  }
}

/** 2-3 plain sentences: which decision made the difference, from the per-sample attribution. */
function InShort({ L, R }: { L: Side; R: Side }) {
  const dt = R.run.meta.dt;
  const forR = attribute(R, L); // R usable, L not
  const forL = attribute(L, R); // L usable, R not
  const diff = (R.pct ?? 0) - (L.pct ?? 0);

  // Every link down for most of the stretch: nothing to decide.
  let anyUp = 0;
  for (const k of R.idx) if (R.run.meta.links.some((ln) => R.run.truth?.[ln]?.up[k] === 1)) anyUp++;
  const out: string[] = [];
  if (R.idx.length && anyUp / R.idx.length < 0.1 && (L.pct ?? 0) < 5 && (R.pct ?? 0) < 5) {
    out.push("Every link was down for this stretch, so neither controller could deliver any video: no decision can help here.");
  } else if (Math.abs(diff) < 0.5 && (L.pct ?? 0) >= 95 && (R.pct ?? 0) >= 95) {
    out.push("Both controllers kept a usable view nearly all the time: with links this good, neither had to make a hard decision.");
  } else {
    const [win, lose, a, rev] = diff >= 0 ? [R, L, forR, forL] : [L, R, forL, forR];
    const order = ranked(a);
    if (order.length) {
      out.push(causeSentence(order[0][0], a, win, lose));
      const second = order[1];
      if (second && second[1] >= 0.25 * a.n && second[1] * dt >= 0.5) out.push(`Another ${fmtSec(second[1] * dt, 1)} came from ${causePhrase(second[0], a)}.`);
    }
    const back = ranked(rev)[0];
    if (back && rev.n * dt >= 1 && out.length < 3) {
      out.push(`${lose.label} could see when ${win.label} could not for ${fmtSec(rev.n * dt, 1)}, mostly from ${causePhrase(back[0], rev)}.`);
    }
  }
  if (!out.length) return null;
  return (
    <p className={s.inShort}><b>In short: </b>{out.join(" ")}</p>
  );
}

export function ClaimWhy({ left: L, right: R, chapterIndex }: { left: Side; right: Side; chapterIndex: number }) {
  const eL = evidenceOf(L);
  const eR = evidenceOf(R);
  const dt = R.run.meta.dt;
  const uL = L.usable * L.run.meta.dt;
  const uR = R.usable * dt;
  const gap = uR - uL;
  const better = (R.pct ?? 0) - (L.pct ?? 0);
  const heading = better >= 0.5 ? `Why ${R.label} scored higher here` : better <= -0.5 ? `Why ${R.label} scored lower here` : "Why the two scores are about the same";

  // The manoeuvre that dominates the scope, and its requirement (the one the score is about).
  const man = R.mans[0]?.[0];
  const req = man ? R.run.meta.requirements[man] : undefined;
  const topL = L.fails[0];
  const topR = R.fails[0];
  const notL = L.idx.length - L.usable;
  const notR = R.idx.length - R.usable;

  const items: ReactNode[] = [];
  const links = linksLine(R);
  if (links) items.push(<>Links truly available in this stretch (the same for both runs): {links}.</>);

  if (eL.sentOk !== null && eR.sentOk !== null && req && man) {
    items.push(
      <>
        What each controller sent on the camera the operator needed: <Name x={L} /> a level that meets the{" "}
        {manoeuvreLabel(man).toLowerCase()} limits ({req.min_w} px, {fmtCount(req.min_fps)} fps) for {pct(eL.sentOk)} of the
        stretch{eL.modal ? `, most often ${lvText(eL.modal.lv)}` : ""}; <Name x={R} /> {pct(eR.sentOk)}
        {eR.modal ? `, most often ${lvText(eR.modal.lv)}` : ""}.
        {eR.sentOk - eL.sentOk >= 0.1 && <>
          {" "}{R.label} reads the manoeuvre and sends the level its requirement asks for; {L.label} sets quality from
          measured packet loss alone, so it does not know that {manoeuvreLabel(man).toLowerCase()} needs {req.min_w} px.
        </>}
        {eL.sentOk - eR.sentOk >= 0.1 && <>
          {" "}Here {L.label} sent the higher level. {R.label} sends the lowest level that meets the requirement and that its
          capacity estimate says will fit; when that estimate is low, it holds the camera lower.
        </>}
      </>,
    );
  }

  if (eL.otherCut !== null && eR.otherCut !== null && Math.abs(eR.otherCut - eL.otherCut) >= 0.2) {
    const [hi, lo, eh, el] = eR.otherCut > eL.otherCut ? [R, L, eR, eL] : [L, R, eL, eR];
    items.push(
      <>
        The camera nobody needed: <Name x={hi} /> paused it or cut it to 1 fps for {pct(eh.otherCut)} of the stretch,
        leaving its bandwidth to the needed camera; <Name x={lo} /> did so {pct(el.otherCut)} of the time
        {lo === L ? ", because it always streams both cameras" : ""}.
      </>,
    );
  }

  if (chapterIndex === 0) {
    const mL = L.run.metrics.radio_leave_minus_fail_s;
    const mR = R.run.metrics.radio_leave_minus_fail_s;
    const say = (v: number | null | undefined) =>
      typeof v !== "number" ? "no radio change was measured" : v < 0 ? `moved off the radio ${fmtSec(-v, 1)} before it failed` : `moved off the radio ${fmtSec(v, 1)} after it failed`;
    items.push(
      <>
        Timing of the radio handover (the engine's <code>radio_leave_minus_fail_s</code>): <Name x={L} /> {say(mL)};{" "}
        <Name x={R} /> {say(mR)}. A switch before the failure means the operator never sees the dying link.
      </>,
    );
  }

  if (eR.predictive.n > 0 || eL.predictive.n > 0) {
    const p = (x: Side, e: Evidence) => e.predictive.n > 0
      ? <><Name x={x} /> acted ahead of a predicted link failure {times(e.predictive.n)} (a duplicate on a second link or an early switch), first at {fmtClock(e.predictive.first)}</>
      : <><Name x={x} /> made no predictive move</>;
    items.push(<>{p(R, eR)}; {p(L, eL)}. The needed camera changed its main link {times(eL.switches)} with {L.label} and {times(eR.switches)} with {R.label}.</>);
  } else if (eL.switches + eR.switches > 0) {
    items.push(<>The needed camera changed its main link {times(eL.switches)} with <Name x={L} /> and {times(eR.switches)} with <Name x={R} />; neither made a predictive move here.</>);
  }
  if (eL.switches > eR.switches) {
    items.push(<>Each of {L.label}'s link changes is a reaction to a threshold that was already crossed, so the view can drop while it moves.</>);
  }

  if (topL && notL > 0) {
    const t = (x: Side, f: [string, number], n: number, first = false) => <>{first ? "Most" : "most"} of <Name x={x} />'s not-usable time was {FAIL_NOUN[f[0]] ?? f[0]} ({fmtCount(f[1])} of {fmtCount(n)} samples)</>;
    items.push(<>{topR && notR > 0 ? <>{t(L, topL, notL, true)}; {t(R, topR, notR)}.</> : <>{t(L, topL, notL, true)}; <Name x={R} /> was usable throughout.</>}</>);
    const weak = (f?: [string, number]) => f && (f[0] === "fps" || f[0] === "stale");
    if (weak(topL) && weak(topR) && (L.pct ?? 100) < 50 && (R.pct ?? 100) < 50) {
      items.push(
        <>
          Both controllers mostly failed on frame rate or late frames: the links here could not carry the needed camera
          reliably, and no controller can create capacity. What a controller can still decide is how much of what there is
          goes to the camera that matters.
        </>,
      );
    }
  }

  // Only when the trace shows no decision that differs in a way that explains the gap.
  const decisionGap = eL.switches !== eR.switches
    || (eL.sentOk !== null && eR.sentOk !== null && Math.abs(eL.sentOk - eR.sentOk) >= 0.1);
  if (Math.abs(gap) <= NOISE_S && Math.abs(gap) > 0 && !decisionGap) {
    items.push(
      <>
        The difference is only {fmtSec(Math.abs(gap), 1)} of usable view, about the length of one Starlink handover
        dropout. A gap this small can come from where a random dropout fell, so read it together with the 20-seed results.
      </>,
    );
  }

  const goMethod = () => {
    const st = useStore.getState();
    st.stopTour();
    st.setTheatre(false);
    st.setView("method");
    // Method mounts on the next frame; then bring "Baseline decides like this" into view.
    window.setTimeout(() => document.getElementById("decide-baseline")?.scrollIntoView({ block: "start" }), 60);
  };

  return (
    <>
      <h3>{heading}</h3>
      <InShort L={L} R={R} />
      <p>
        {Math.abs(gap) < dt / 2
          ? <>Both controllers had the same usable time in this stretch.</>
          : <><Name x={gap > 0 ? R : L} /> had {fmtSec(Math.abs(gap), 1)} more usable view than <Name x={gap > 0 ? L : R} /> here
            ({fmtSec(Math.max(uR, uL), 1)} against {fmtSec(Math.min(uR, uL), 1)}). What the trace shows about why:</>}
      </p>
      <ul className={s.whyList}>
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>

      <div className={s.how2}>
        <h4 className={s.how2Title}>How the two controllers work</h4>
        <div className={s.how2Cols}>
          <div className={s.how2Col} style={{ borderTopColor: "var(--color-ctrl-baseline)" }}>
            <h5 className={ctrlClass("Baseline")}>Baseline: today's link bonding (ATSSS / SpeedFusion style)</h5>
            <ul>
              <li>Streams both cameras all the time. It does not know whether the vehicle is driving, reversing or lining up a precision move.</li>
              <li>Raises or lowers each camera's quality from the packet loss it measures on the link.</li>
              <li>Moves video to another link only after the current one has crossed a loss or delay threshold, so it reacts after the problem has started.</li>
              <li>Uploads are shaped to a share of the link and sent at the lowest priority.</li>
            </ul>
          </div>
          <div className={s.how2Col} style={{ borderTopColor: "var(--color-ctrl-proposed)" }}>
            <h5 className={ctrlClass("Proposed")}>Proposed: mission-aware</h5>
            <ul>
              <li>Detects the manoeuvre from throttle and steering, so it knows which camera the operator needs and at what quality.</li>
              <li>Gives that camera its bandwidth first, and pauses or trickles the camera nobody needs.</li>
              <li>Predicts how long each link will stay usable. It duplicates the needed camera on a backup link, then switches before the failure.</li>
              <li>Adaptive uploads: requested files go first while stopped or in precision mode, video goes first while driving.</li>
            </ul>
          </div>
        </div>
        <Button variant="quiet" onClick={goMethod}>Full method: how each controller decides ›</Button>
      </div>
    </>
  );
}
