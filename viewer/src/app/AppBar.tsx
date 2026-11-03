import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import { Badge, Button, Popover, Select, Tooltip } from "../components";
import { useStore, VIEWS, VIEW_LABEL, RIGHT_CONFIG, useBreakpoint } from "../state";
import {
  getManifest, getResults, isFullResults, seedsFor, configsFor, typicalSeed, variantLabel, isOracle,
  REGEN_COMMAND,
} from "../data/loader";
import s from "./AppBar.module.css";

export const PRODUCT_NAME = "EDGE-MLC mission viewer";

/** Copy example 9 (DESIGN.md 10). */
const LOW_SEED_COPY =
  "The 20-seed run has not finished. Showing the 3 committed seeds, so intervals are rough. Results update when results_run/summary.csv appears.";

function Tabs() {
  const view = useStore((st) => st.view);
  const setView = useStore((st) => st.setView);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent) => {
    const i = VIEWS.indexOf(view);
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + VIEWS.length) % VIEWS.length;
    setView(VIEWS[n]);
    refs.current[n]?.focus();
  };
  return (
    <div role="tablist" aria-label="Views" className={s.tabs} onKeyDown={onKey}>
      {VIEWS.map((v, i) => (
        <button key={v} ref={(el) => { refs.current[i] = el; }} id={`tab-${v}`} role="tab" type="button"
          aria-selected={view === v} aria-controls="view-panel" tabIndex={view === v ? 0 : -1}
          className={[s.tab, view === v ? s.tabActive : ""].join(" ")} onClick={() => setView(v)}
          title={`${VIEW_LABEL[v]} (key ${i + 1})`}>
          {VIEW_LABEL[v]}
        </button>
      ))}
    </div>
  );
}

/** Below this width the selector labels are hidden (values describe themselves). */
const LABELS_MIN_WIDTH = 1500;
/**
 * Below this width the selectors move into the "Run" popover. DESIGN.md 6.1.3 does this
 * below 1024px; the bar needs it from 1240px so it never scrolls sideways (DESIGN-GAP).
 */
const MENU_MAX_WIDTH = 1240;
function useMinWidth(px: number): boolean {
  const get = () => window.innerWidth >= px;
  const [ok, setOk] = useState(get);
  useEffect(() => {
    const on = () => setOk(get());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [px]); // eslint-disable-line
  return ok;
}

/**
 * Results source badge. DESIGN-GAP: DESIGN.md 5.2 describes a "Run" selector, but each
 * export embeds exactly one results folder (results_run/ once complete, else results/), so
 * the source is shown as a badge; switching means re-exporting.
 */
function SourceBadge() {
  const results = getResults();
  const n = results?.n_seeds ?? 0;
  if (isFullResults()) {
    return (
      <Tooltip content={`Results from edge_mlc/results_run/, ${n} seeds per configuration.`}>
        <Badge kind="neutral" tabIndex={0}>{n} seeds</Badge>
      </Tooltip>
    );
  }
  return (
    <Tooltip title={LOW_SEED_COPY} content={`Then re-export the data: ${REGEN_COMMAND} (from edge_mlc/).`}>
      <Badge kind="status-warn" tabIndex={0}>{n}-seed results</Badge>
    </Tooltip>
  );
}

/** Variant, seed and compare selectors. `labels` = show the Variant and Seed labels. */
function Selectors({ stacked, labels = true }: { stacked?: boolean; labels?: boolean }) {
  const { variant, seed, compare } = useStore(useShallow((st) => ({ variant: st.variant, seed: st.seed, compare: st.compare })));
  const { setVariant, setSeed, setCompare } = useStore.getState();
  const manifest = getManifest();
  const typical = typicalSeed(variant);
  const variants = manifest?.variants ?? [];
  const seeds = seedsFor(variant);
  const configs = configsFor(variant, seed).filter((c) => c !== RIGHT_CONFIG);

  return (
    <div className={[s.selectors, stacked ? s.stacked : ""].join(" ")}>
      <SourceBadge />
      <Select label="Variant" hideLabel={!labels} value={variant} title={`Scenario variant (code name: ${variant})`}
        options={variants.map((v) => ({ value: v, label: variantLabel(v) }))} onChange={setVariant} />
      <Select label="Seed" hideLabel={!labels} value={seed}
        title="Seed of the replayed runs. Typical = the seed whose crater result is closest to the mean."
        options={seeds.map((x) => ({ value: x, label: `${labels ? "" : "Seed "}${x}${x === typical ? ", typical" : ""}` }))} onChange={setSeed} />
      <Select label="Compare" hideLabel={!labels} value={compare} title="Configuration on the left console. The right console is always Proposed."
        options={configs.map((c) => ({ value: c, label: `${labels ? "" : "Left: "}${c}${isOracle(c) ? " (upper bound)" : ""}` }))} onChange={setCompare} />
    </div>
  );
}

export function AppBar({ onShortcuts }: { onShortcuts: () => void }) {
  const bp = useBreakpoint();
  const { theme, presenter, toggleTheme, togglePresenter } = useStore(useShallow((st) => ({
    theme: st.theme, presenter: st.presenter, toggleTheme: st.toggleTheme, togglePresenter: st.togglePresenter,
  })));
  const [runOpen, setRunOpen] = useState(false);
  const runBtn = useRef<HTMLButtonElement>(null);
  const narrow = bp === "narrow";
  const wideLabels = useMinWidth(LABELS_MIN_WIDTH);
  const menu = !useMinWidth(MENU_MAX_WIDTH);

  return (
    <header className={s.bar}>
      <span className={s.name}>{narrow ? "EDGE-MLC viewer" : PRODUCT_NAME}</span>
      <Tabs />
      <div className={s.right}>
        {menu ? (
          <>
            <Button ref={runBtn} onClick={() => setRunOpen((o) => !o)} aria-expanded={runOpen} aria-haspopup="dialog">
              Run
              <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden><path d="M1 1 L5 5 L9 1" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
            </Button>
            <Popover open={runOpen} onClose={() => setRunOpen(false)} anchorRef={runBtn} placement="bottom-end" title="Run" width={320}>
              <Selectors stacked labels />
            </Popover>
          </>
        ) : (
          <Selectors labels={wideLabels} />
        )}
        {!narrow && (
          <Button pressed={presenter} onClick={togglePresenter} title="Presenter mode: larger text and thicker lines (key P)">
            Presenter
          </Button>
        )}
        <Button variant="icon" onClick={toggleTheme} aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title={`${theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} (key T)`}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
            <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 1.75 A6.25 6.25 0 0 1 8 14.25 Z" fill="currentColor" />
          </svg>
        </Button>
        <Button variant="icon" onClick={onShortcuts} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (key ?)">?</Button>
      </div>
    </header>
  );
}
