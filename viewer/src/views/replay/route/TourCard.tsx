/**
 * Tour card (key G): the caption for the guided tour that plays every chapter back to back
 * (store.tour, src/state/store.ts). Shows the step ("Chapter 2 of 5"), the chapter's chip
 * label and its claim sentence (the same ChapterClaim and sentence as the route strip's
 * claim caption), a progress line through the chapter's play window, and Previous /
 * Pause / Next / Stop.
 *
 * placement "frame": a two-line bar floating over the bottom of the timeline, above the
 * playback bar (rendered by RouteStrip). placement "theatre": a three-line block in
 * Theatre's top bar, between the clock and the camera controls.
 * Nothing renders while no tour is on. No entrance animation (DESIGN.md 13).
 */
import { useMemo, useRef, useState } from "react";
import { Button } from "../../../components";
import { TOUR_HOLD_MS, TOUR_HOLD_REDUCED_MS, TOUR_SPEED, useReducedMotion, usePairEvents, useRunPair, useStore, type TourState } from "../../../state";
import { getScenario } from "../../../data/loader";
import type { Chapter } from "../../../data/events";
import type { RunData } from "../../../data/types";
import { fmtCount, fmtSec } from "../../../format";
import { chipText, computeClaims } from "./claims";
import { ClaimSentence, type Names } from "./claimSentence";
import { ClaimExplainer } from "./ClaimExplainer";
import s from "./TourCard.module.css";

export function TourCard({ placement }: { placement: "frame" | "theatre" }) {
  const tour = useStore((st) => st.tour);
  if (!tour) return null;
  return <TourCardBody tour={tour} placement={placement} />;
}

function TourCardBody({ tour, placement }: { tour: TourState; placement: "frame" | "theatre" }) {
  const pair = useRunPair();
  const events = usePairEvents();
  const reduced = useReducedMotion();
  const left = pair.left as RunData | null;
  const right = pair.right as RunData | null;
  const chapters = useMemo(() => events?.chapters ?? [], [events]);
  const scenario = getScenario();
  const claims = useMemo(
    () => (left && right ? computeClaims(chapters, left, right, scenario) : []),
    [chapters, left, right, scenario],
  );
  const [explain, setExplain] = useState(false);
  // Opening the explanation pauses a running tour; closing it resumes only what it paused.
  const resume = useRef(false);
  const ch = chapters[tour.step];
  if (!ch || !left || !right) return null;

  const chip = chipText(ch, right, scenario);
  const claim = claims.find((c) => c.index === ch.index) ?? null;
  const names: Names = { left: pair.leftConfig, right: pair.rightConfig, leftDecider: left.meta.decider, rightDecider: right.meta.decider };
  const { tourGo, togglePlay, stopTour, startTour } = useStore.getState();
  const first = tour.step === 0;
  const last = tour.step >= tour.count - 1;
  const done = tour.phase === "done";
  const paused = tour.phase === "paused";
  const hold = fmtSec((reduced ? TOUR_HOLD_REDUCED_MS : TOUR_HOLD_MS) / 1000, 0);

  const status = done ? "End of tour"
    : paused ? "Paused"
      : tour.phase === "hold" ? (last ? "Last chapter" : `Next chapter in ${hold}`)
        : `Playing at ${TOUR_SPEED}×`;

  return (
    <section className={`${s.card} ${s[placement]}`} aria-label="Tour">
      <div className={s.head}>
        <span className={s.step}>Chapter {fmtCount(tour.step + 1)} of {fmtCount(tour.count)}</span>
        <h2 className={s.title} title={chip.full}>{chip.full}</h2>
        <span className={s.status}>{status}</span>
        <span className={s.controls}>
          <Button variant="quiet" disabled={first} onClick={() => tourGo(tour.step - 1)} title="Previous chapter">Previous</Button>
          {done ? (
            <Button onClick={() => startTour(0)} title="Play the tour again from the first chapter">Restart</Button>
          ) : (
            <Button variant="quiet" onClick={togglePlay} title={`${paused ? "Resume" : "Pause"} the tour (Space)`}>{paused ? "Resume" : "Pause"}</Button>
          )}
          {!done && (
            <Button onClick={() => tourGo(tour.step + 1)} title={last ? "End the tour here" : "Next chapter"}>{last ? "Finish" : "Next"}</Button>
          )}
          <Button variant="quiet" onClick={stopTour} title="Stop the tour (G)">{done ? "Close" : "Stop"}</Button>
        </span>
      </div>
      {claim ? (
        <button type="button" className={`${s.claim} ${s.claimBtn}`}
          title="How we got these numbers: the rule, the samples counted and the arithmetic"
          aria-haspopup="dialog" aria-expanded={explain}
          onClick={() => {
            const ph = useStore.getState().tour?.phase;
            resume.current = ph === "playing" || ph === "hold";
            if (resume.current) useStore.getState().pause();
            setExplain(true);
          }}>
          <ClaimSentence claim={claim} names={names} form="full" />
          <span className={s.how}>How we got these numbers ›</span>
        </button>
      ) : <p className={s.claim}>No claim for this chapter in this trace.</p>}
      {claim && (
        <ClaimExplainer open={explain} claim={claim} title={chip.full} left={left} right={right} names={names}
          onClose={() => {
            setExplain(false);
            if (resume.current) { resume.current = false; useStore.getState().play(); }
          }} />
      )}
      {!done && <Progress chapter={ch} full={tour.phase === "hold"} />}
    </section>
  );
}

/** 2px text-1 line along the card's bottom edge: how far through the chapter's play window. */
function Progress({ chapter, full }: { chapter: Chapter; full: boolean }) {
  const f = useStore((st) => (full ? 1 : Math.min(1, Math.max(0, (st.t - chapter.seekT) / (chapter.endT - chapter.seekT)))));
  return <span className={s.progress} style={{ transform: `scaleX(${f})` }} aria-hidden />;
}
