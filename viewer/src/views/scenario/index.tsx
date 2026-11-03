/**
 * Scenario view (key 3, DESIGN.md 6.3 and 8): the world the controllers drive through,
 * with no controller in it. Contract with the shell: export `ScenarioView` (no props).
 *
 * Data: getScenario() (window.SIM_SCENARIO) for everything about the world; the Proposed
 * run of the selected variant + seed (useRunPair().right) only for "when did it happen"
 * (km -> time for "Show in replay", state entry times, upload creation, this seed's
 * Starlink outages). All numbers are computed in ./model.ts.
 *
 * DESIGN-GAP: 6.3 gives no rail width at 1440; 320px is used (280px at compact per 6.3).
 * DESIGN-GAP: 6.3 asks for "Return leg (3.0 to 1.4 km) drawn as a second strip". Link
 *   truth is a function of position only (crater and blackout aside), so a second strip
 *   would repeat the first; the route chart draws the return as a lane with its own
 *   scoring segments instead.
 * DESIGN-GAP: the timeline gutter at narrow is 96px (5.1); the Scenario charts need
 *   longer row labels ("Outage, 35% chance"), so they use 120px at narrow.
 * DESIGN-GAP: the variant switcher lives in the rail (wide/compact) with each variant's
 *   differences as sentences; at narrow it follows the charts and the header shows a select.
 */
import { useState } from "react";
import { EmptyState, Legend, Panel, Select, SegmentedControl } from "../../components";
import { getHashParam, setHashParam, useBreakpoint, useRunPair, useStore } from "../../state";
import { fmtMs, fmtFrac, variantLabel, REGEN_COMMAND, REGEN_CWD, getScenario } from "../../data/loader";
import { RouteChart } from "./RouteChart";
import { Handovers } from "./Handovers";
import { MissionProfile } from "./MissionProfile";
import { DriverScript } from "./DriverScript";
import { Uploads } from "./Uploads";
import { Assumptions, VariantPicker } from "./Rail";
import { METRICS, goodRule, lowerFirst, type Metric } from "./model";
import s from "./Scenario.module.css";

function initialMetric(): Metric {
  const m = getHashParam("metric");
  return METRICS.some((x) => x.value === m) ? (m as Metric) : "cap";
}

export function ScenarioView() {
  const sc = getScenario();
  const variant = useStore((st) => st.variant);
  const setVariant = useStore((st) => st.setVariant);
  const pair = useRunPair();
  const bp = useBreakpoint();
  const [metric, setMetricState] = useState<Metric>(initialMetric);
  const [hoverZone, setHoverZone] = useState<string | null>(null);
  const setMetric = (m: Metric) => { setMetricState(m); setHashParam("metric", m === "cap" ? null : m); };

  if (!sc) {
    return (
      <EmptyState title="data/scenario.js did not load." command={REGEN_COMMAND} cwd={REGEN_CWD} kind="bad">
        Export the viewer data, then reload.
      </EmptyState>
    );
  }
  const v = sc.variants[variant];
  if (!v) {
    return <EmptyState title={`The variant "${variant}" is not in data/scenario.js.`}>Choose another variant in the app bar.</EmptyState>;
  }
  const run = pair.right;
  const seed = pair.seed;
  const gutter = bp === "wide" ? 168 : bp === "compact" ? 136 : 120;
  const trackH = bp === "wide" ? 64 : bp === "compact" ? 56 : 52;
  const rule = goodRule(sc);
  const runNote = run
    ? <>Times and passes are read from the <span className="ctrl-proposed">Proposed</span> run, {lowerFirst(variantLabel(variant))} seed {seed}.</>
    : pair.status === "error" ? <>The run for seed {seed} did not load, so times are not shown. {pair.error && "hint" in pair.error ? String((pair.error as { hint: string }).hint) : ""}</>
      : <>Loading seed {seed} for the times of each event.</>;

  return (
    <div className={s.view}>
      <header className={s.header}>
        <div className={s.headText}>
          <h1>Scenario</h1>
          <p className={s.intro}>
            The route, the true link conditions and the driver&apos;s script that both controllers face.
            Nothing on this page depends on a controller. {runNote}
          </p>
        </div>
        {bp === "narrow" && (
          <Select label="Variant" value={variant} onChange={setVariant} title={variant}
            options={Object.keys(sc.variants).map((n) => ({ value: n, label: variantLabel(n) }))} />
        )}
      </header>

      <div className={s.grid}>
        <div className={s.main}>
          <Panel title="Link truth along the route" level={2}
            actions={<SegmentedControl ariaLabel="Value shown on the link tracks" label="Show" value={metric} onChange={setMetric}
              options={METRICS.map((m) => ({ value: m.value, label: m.label, title: `${m.title} (${m.unit})` }))} />}>
            <div className={s.stack}>
              <Legend items={[
                { key: "good", mark: "band", color: "var(--color-text-2)", label: `Meets the video limits (RTT ${fmtMs(rule.maxRttMs)}, loss ${fmtFrac(rule.maxLoss, 0)} at most)` },
                { key: "deg", mark: "band", color: "var(--color-text-2)", opacity: "var(--link-degraded-alpha)", label: "Up, outside those limits" },
                { key: "down", mark: "hatch", label: "Down" },
                { key: "crater", mark: "dashed", color: "var(--color-text-2)", label: "Starlink while the vehicle is in the crater" },
              ]} />
              <RouteChart sc={sc} variantName={lowerFirst(variantLabel(variant))} variant={v} metric={metric} run={run} seed={seed}
                gutter={gutter} trackH={trackH} hoverZone={hoverZone} onHoverZone={setHoverZone} />
              <p className="caption">
                Ground truth at t = {sc.profile_t_s} s with shadowing off, so no handover or congestion burst is in it (those are timed events, below).
                Runs add slow random shadowing (A) to radio and 4G. {sc.variants[variant].params.lte_route ? "Cell-edge 4G is drawn at its mean. " : ""}
                Hover for every value at a point; click to open Replay at its first outbound pass.
              </p>
            </div>
          </Panel>

          <Panel title="Starlink handovers" level={2}>
            <Handovers sc={sc} variant={variant} run={run} seed={seed} gutter={gutter} />
          </Panel>

          <Panel title="Driver script" level={2}>
            <div className={s.stack}>
              <p className={s.lead}>
                The operator drives the same script in every run: position and timers move it from state to state, and the
                true manoeuvre of each state decides which camera the operator needs and how good it must be.
              </p>
              {run ? <MissionProfile sc={sc} variant={v} run={run} gutter={gutter} hoverZone={hoverZone} />
                : <p className={s.pending}>Loading seed {seed} to draw position over time.</p>}
              <DriverScript sc={sc} run={run} seed={seed} />
            </div>
          </Panel>

          <Panel title="Uploads the mission asks for" level={2}>
            <Uploads sc={sc} run={run} seed={seed} />
          </Panel>
        </div>

        <aside className={s.rail} aria-label="Variant and assumptions">
          <Panel title="Variant" level={2}>
            <VariantPicker sc={sc} variant={variant} />
          </Panel>
          <Panel title="Assumptions (A)" level={2}>
            <Assumptions sc={sc} variant={variant} run={run} hoverZone={hoverZone} onHoverZone={setHoverZone} />
          </Panel>
        </aside>
      </div>
    </div>
  );
}
