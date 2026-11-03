/**
 * Method view (key 4, DESIGN.md 6.4). Contract with the shell: export `MethodView` (no props).
 *
 * How each controller decides, faithful to edge_mlc/deciders/baseline.py and proposed.py,
 * the shared measurement layer (common/monitor.py), and how the simulator scores both
 * (sim/engine.py). Every threshold is read from the exported data (scenario.js) or, for the
 * four config blocks the exporter does not write yet, from params.ts (labelled on the page).
 * The worked example and every count are computed from the demo seed's run files.
 *
 * DESIGN-GAP: 6.4 draws three blocks (steps, usable view, caveats). The task also asks for
 *   the needs table, the measurement layer, upload policies, configurations and a worked
 *   example, so they follow as further full-width panels, with a small in-page index under
 *   the title (buttons, not links: the hash is the router).
 * DESIGN-GAP: the worked example uses the manifest's demo seed (typical, never the best case),
 *   not the app bar's seed, so the example on this page does not change under the reader.
 */
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "../../components";
import {
  getManifest, getScenario, loadRun, runIdFor, typicalSeed, REGEN_COMMAND, REGEN_CWD, variantLabel,
} from "../../data/loader";
import { computePairEvents } from "../../data/events";
import type { Manoeuvre, RunData, Scenario } from "../../data/types";
import { DEFAULT_VARIANT, useBreakpoint } from "../../state";
import { deciderParams } from "./params";
import { detectorAgreement, firstScheduledDuplicate, speedSeries } from "./example";
import { BaselineSteps, ProposedSteps, type DemoFacts } from "./Steps";
import { ExamplePanel } from "./ExamplePanel";
import {
  CaveatsSection, ConfigsSection, MeasurementSection, NeedsSection, ScoringSection, UploadsSection,
  lowestMeeting, type InterruptionFacts,
} from "./Sections";
import { parseReason } from "./reasons";
import s from "./Method.module.css";

const SECTIONS: [string, string][] = [
  ["decide-baseline", "How each decides"],
  ["scoring", "Usable view"],
  ["example", "A real prediction"],
  ["needs", "Needs table"],
  ["measure", "Measurement"],
  ["uploads", "Uploads"],
  ["configs", "Configurations"],
  ["caveats", "Caveats"],
];

interface DemoRuns {
  status: "loading" | "ready" | "error";
  run: RunData | null;
  base: RunData | null;
  error: string | null;
}

function useDemoRuns(variant: string, seed: number | null): DemoRuns {
  const [st, setSt] = useState<DemoRuns>({ status: "loading", run: null, base: null, error: null });
  useEffect(() => {
    let alive = true;
    if (seed === null) {
      setSt({ status: "error", run: null, base: null, error: `No seed is exported for ${variantLabel(variant).toLowerCase()}. Export the runs with ${REGEN_COMMAND} (from ${REGEN_CWD}), then reload.` });
      return;
    }
    const pid = runIdFor("Proposed", variant, seed);
    const bid = runIdFor("Baseline", variant, seed);
    if (!pid) {
      setSt({ status: "error", run: null, base: null, error: `Proposed seed ${seed} is not exported. Export it with ${REGEN_COMMAND} (from ${REGEN_CWD}), then reload.` });
      return;
    }
    setSt({ status: "loading", run: null, base: null, error: null });
    Promise.allSettled([loadRun(pid), bid ? loadRun(bid) : Promise.resolve(null)]).then(([p, b]) => {
      if (!alive) return;
      if (p.status === "rejected") {
        const e = p.reason as { message?: string; hint?: string };
        setSt({ status: "error", run: null, base: null, error: [e?.message, e?.hint].filter(Boolean).join(" ") || `Could not load seed ${seed}.` });
        return;
      }
      setSt({ status: "ready", run: p.value, base: b.status === "fulfilled" ? b.value : null, error: null });
    });
    return () => { alive = false; };
  }, [variant, seed]);
  return st;
}

/** Manoeuvres whose protected-camera floor in the needs table can pass the scoring requirement. */
function floorsMatch(sc: Scenario): { match: number; total: number } {
  const mans = Object.keys(sc.requirements) as Manoeuvre[];
  let match = 0;
  for (const m of mans) {
    const req = sc.requirements[m];
    const need = sc.modes[m]?.[req.cam];
    const low = lowestMeeting(sc, m);
    if (need && need.prio === 1 && low !== null && need.levels[0] >= low) match++;
  }
  return { match, total: mans.length };
}

function jump(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ block: "start" });
  const h = el.querySelector("h2");
  if (h instanceof HTMLElement) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
}

export function MethodView() {
  const sc = getScenario();
  const bp = useBreakpoint();
  const demoInfo = getManifest()?.demo ?? null;
  const variant = demoInfo?.variant ?? DEFAULT_VARIANT;
  const seed = demoInfo?.seed ?? typicalSeed(variant);
  const demo = useDemoRuns(variant, seed);
  const ps = useMemo(() => deciderParams(sc), [sc]);

  const run = demo.run;
  const base = demo.base;
  const speed = useMemo(() => (run ? speedSeries(run) : null), [run]);

  const demoFacts: DemoFacts | null = useMemo(() => {
    if (!run || seed === null) return null;
    const sch = firstScheduledDuplicate(run);
    return {
      variant, seed,
      detector: detectorAgreement(run),
      scheduled: sch ? { t: sch.t, text: parseReason(sch.r.raw).text } : null,
    };
  }, [run, variant, seed]);

  const interruptions: InterruptionFacts | null = useMemo(() => {
    if (!run || !base || seed === null) return null;
    const ev = computePairEvents(base, run);
    return {
      seed,
      engine: { proposed: run.metrics.interruptions ?? null, baseline: base.metrics.interruptions ?? null },
      trace: {
        baseline: ev.interruptions.filter((x) => x.side === "left").length,
        proposed: ev.interruptions.filter((x) => x.side === "right").length,
      },
    };
  }, [run, base, seed]);

  if (!sc) {
    return (
      <EmptyState title="data/scenario.js did not load, so there are no thresholds to show." command={REGEN_COMMAND} cwd={REGEN_CWD} kind="bad">
        Export the viewer data, then reload.
      </EmptyState>
    );
  }

  return (
    <div className={s.view}>
      <header className={s.header}>
        <h1>Method</h1>
        <p className={s.intro}>
          How each controller chooses links, camera levels and upload order, and how the simulator scores the result.
          Every threshold on this page is read from the exported configuration; every count comes from the runs.
        </p>
        <nav aria-label="Method sections">
          <ul className={s.index}>
            {SECTIONS.map(([id, label]) => (
              <li key={id}><button type="button" className={s.indexLink} onClick={() => jump(id)}>{label}</button></li>
            ))}
          </ul>
        </nav>
      </header>

      <div className={s.decide}>
        <BaselineSteps sc={sc} p={ps.params} />
        <ProposedSteps sc={sc} p={ps.params} demo={demoFacts} />
      </div>

      <ScoringSection sc={sc} facts={interruptions} />

      <ExamplePanel status={demo.status} error={demo.error} run={run} base={base} sc={sc} p={ps.params}
        speed={speed} bp={bp} variant={variant} seed={seed ?? 0} />

      <NeedsSection sc={sc} />
      <MeasurementSection sc={sc} p={ps.params} />
      <UploadsSection sc={sc} p={ps.params} />
      <ConfigsSection />
      <CaveatsSection sc={sc} facts={{ paramsExported: ps.exported, floorsMatch: floorsMatch(sc) }} />
    </div>
  );
}
