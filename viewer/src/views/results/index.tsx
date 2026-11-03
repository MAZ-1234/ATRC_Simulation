/**
 * Results view (DESIGN.md 6.2, 6.2.1, 6.2.2, 8). Results reads as an argument: a left
 * rail indexes the sections (scroll-spy), and every block keeps the same order: claim,
 * one chart, "Show data", a one-line caveat, "Show in replay". Every number is read from
 * window.SIM_RESULTS at runtime; nothing is typed in by hand.
 *
 * Sections that compare the main configurations follow the variant chosen in the app bar
 * (falling back to nominal when results.js has no row for it). Sections whose
 * configurations only ran on fixed variants (upload policies, oracles, the sweeps) say
 * their own scope in the block header.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, Select } from "../../components";
import { useBreakpoint, useReducedMotion, useStore } from "../../state";
import { getResults, variantLabel, REGEN_COMMAND, REGEN_CWD } from "../../data/loader";
import { Ablation, Buffer, Capacity, Handover, Headline, Segments, Transitions, Uploads, Variants } from "./blocks";
import { NotWin } from "./losses";
import { nOf, resultsVariant, sourceInfo } from "./data";
import s from "./Results.module.css";

const SECTIONS: { id: string; label: string }[] = [
  { id: "headline", label: "Headline" },
  { id: "transitions", label: "When a link changes" },
  { id: "uploads", label: "Upload policies" },
  { id: "handover", label: "Handover headroom" },
  { id: "variants", label: "Variants" },
  { id: "ablation", label: "Ablation" },
  { id: "segments", label: "By segment" },
  { id: "capacity", label: "Crater capacity" },
  { id: "buffer", label: "Buffer size" },
  { id: "notwin", label: "Where Proposed does not win" },
];

/** Offset of the sticky app bar (and the narrow section picker) for scroll-spy. */
function topOffset(): number {
  let h = 48;
  try { h = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--appbar-h")) || 48; } catch { /* default */ }
  const picker = document.querySelector(`.${s.picker}`) as HTMLElement | null;
  return h + (picker?.getBoundingClientRect().height ?? 0) + 24;
}

function useScrollSpy(ids: string[]): string {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    let raf = 0;
    const measure = () => {
      raf = 0;
      const off = topOffset();
      let cur = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top - off <= 8) cur = id;
      }
      // At the bottom of the page the last section is current even if its top never reaches the bar.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) cur = ids[ids.length - 1];
      setActive(cur);
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(measure); };
    measure();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => { window.removeEventListener("scroll", on); window.removeEventListener("resize", on); if (raf) cancelAnimationFrame(raf); };
  }, [ids.join("|")]); // eslint-disable-line
  return active;
}

export function ResultsView() {
  const selected = useStore((st) => st.variant);
  const res = getResults();
  const bp = useBreakpoint();
  const reduced = useReducedMotion();
  const variant = resultsVariant(selected);
  const src = useMemo(() => sourceInfo(), []);
  const ids = useMemo(() => SECTIONS.map((x) => x.id), []);
  const active = useScrollSpy(ids);
  const contentRef = useRef<HTMLDivElement>(null);

  const go = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    // DESIGN.md 9.2: nothing slides, so the jump is instant (no smooth scrolling).
    el.scrollIntoView({ behavior: "auto", block: "start" });
    const h = el.querySelector("h2") as HTMLElement | null;
    if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
  }, [reduced]); // eslint-disable-line

  if (!res?.summary || res.summary.rows.length === 0) {
    return (
      <div className={s.emptyWrap}>
        <EmptyState title="results.js has no summary table, so there are no results to show." command={REGEN_COMMAND} cwd={REGEN_CWD} kind="bad">
          Run the experiments (sim/run_experiments.py), export the viewer data, then reload.
        </EmptyState>
      </div>
    );
  }

  const n = nOf("Proposed", variant);
  const narrow = bp === "narrow";

  return (
    <div className={s.view}>
      {narrow ? (
        <div className={s.picker}>
          <Select label="Section" value={active} onChange={go} options={SECTIONS.map((x) => ({ value: x.id, label: x.label }))} />
        </div>
      ) : (
        <nav className={s.rail} aria-label="Results sections">
          <ul className={s.railList}>
            {SECTIONS.map((x) => (
              <li key={x.id}>
                <button type="button" className={s.railLink} aria-current={active === x.id ? "location" : undefined} onClick={() => go(x.id)}>
                  {x.label}
                </button>
              </li>
            ))}
          </ul>
          <dl className={s.source}>
            <dt>Source</dt>
            <dd className={s.sourceDir}>edge_mlc/{src.dir}</dd>
            <dd>{src.phrase}</dd>
            <dt>Variants present</dt>
            <dd>{src.variants.map(variantLabel).join(", ")}</dd>
          </dl>
        </nav>
      )}

      <div className={s.content} ref={contentRef}>
        <header className={s.header}>
          <div className={s.headRow}>
            <h1 className={s.title}>Results</h1>
            <span className={s.headScope}>{n ?? "–"} seeds, {variantLabel(variant).toLowerCase()}</span>
          </div>
          <p className={s.intro}>
            Every number on this page is read from edge_mlc/{src.dir} ({src.phrase}) and every sentence is filled in from it.
            {" "}Dots are means and bars are 95% confidence intervals.
            {selected !== variant && <> The {variantLabel(selected).toLowerCase()} variant has no summary rows, so this page shows nominal.</>}
          </p>
          <p className={s.intro}>
            The sections run from the headline to the evidence behind it. Every comparison that does not settle in{" "}
            <span className="ctrl-proposed">Proposed</span>&apos;s favour is collected at the end, in{" "}
            <button type="button" className={s.inlineLink} onClick={() => go("notwin")}>Where Proposed does not win</button>, with the same charts and the same weight.
          </p>
        </header>
        <Headline variant={variant} />
        <Transitions variant={variant} />
        <Uploads />
        <Handover />
        <Variants />
        <Ablation variant={variant} />
        <Segments variant={variant} />
        <Capacity />
        <Buffer />
        <NotWin variant={variant} />
      </div>
    </div>
  );
}
