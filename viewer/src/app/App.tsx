import { useCallback } from "react";
import { useStore } from "../state";
import { dataStatus } from "../data/loader";
import { AppBar } from "./AppBar";
import { PatternDefs } from "./PatternDefs";
import { ShortcutSheet } from "./ShortcutSheet";
import { LiveRegion } from "./LiveRegion";
import { DataError } from "./DataError";
import { useGlobalKeys } from "./useGlobalKeys";
import { ReplayView } from "../views/replay";
import { ResultsView } from "../views/results";
import { ScenarioView } from "../views/scenario";
import { MethodView } from "../views/method";
import s from "./App.module.css";

/**
 * App shell (DESIGN.md 5): app bar, the active view, shared SVG patterns, the shortcut
 * sheet and the aria-live region. Each view folder owns everything inside <main>.
 */
export function App() {
  const status = dataStatus();
  const view = useStore((st) => st.view);
  const sheet = useStore((st) => st.shortcutsOpen);
  const openSheet = useCallback(() => useStore.getState().setShortcutsOpen(true), []);
  useGlobalKeys(openSheet);

  if (status.missing.length > 0) return <DataError status={status} />;

  return (
    <div className={s.app} onPointerDown={() => useStore.getState().markInteracted()}>
      <PatternDefs />
      <AppBar onShortcuts={openSheet} />
      {/* <main> keeps its landmark role and the tab panel sits inside it: a role on <main>
          itself hides the main landmark and turns each view's <header> into another banner. */}
      <main className={s.main} key={view}>
        <div id="view-panel" role="tabpanel" aria-labelledby={`tab-${view}`}>
          {view === "replay" && <ReplayView />}
          {view === "results" && <ResultsView />}
          {view === "scenario" && <ScenarioView />}
          {view === "method" && <MethodView />}
        </div>
      </main>
      <ShortcutSheet open={sheet} onClose={() => useStore.getState().setShortcutsOpen(false)} />
      <LiveRegion />
    </div>
  );
}
