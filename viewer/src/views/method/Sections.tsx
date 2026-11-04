/**
 * The reference sections of the Method view: measurement, Proposed's needs table,
 * uploads, scoring, configurations and caveats. Tables are rendered from the exported
 * config values (scenario.js); counts and seed numbers are computed at runtime.
 */
import { Fragment, type ReactNode } from "react";
import { Badge, Glyph, Panel, Tooltip } from "../../components";
import {
  camLabel, configLabel, fmtCount, fmtFps, fmtMB, fmtMs, fmtRate, getResults, isOracle, linkLabel,
  manoeuvreLabel, tableObjects, variantLabel,
} from "../../data/loader";
import type { Manoeuvre, Scenario } from "../../data/types";
import { CODE, type DeciderParams } from "./params";
import { Code, Ctrl, Level, V, num, pct, sec } from "./text";
import s from "./Method.module.css";

const MANS: Manoeuvre[] = ["DRIVE", "PRECISION", "REVERSE", "STOPPED"];

function ModeName({ m }: { m: string }) {
  return <>{manoeuvreLabel(m)} <span className={s.codeName}>{m}</span></>;
}

/** Lowest ladder level whose frames could meet a requirement (width and frame rate). */
export function lowestMeeting(sc: Scenario, m: Manoeuvre): number | null {
  const r = sc.requirements[m];
  const i = sc.ladder.findIndex((l) => l.w >= r.min_w && l.fps >= r.min_fps);
  return i >= 0 ? i : null;
}

// ------------------------------------------------------------------ measurement

export function MeasurementSection({ sc, p }: { sc: Scenario; p: DeciderParams }) {
  const a = CODE.aimd;
  const rows: [string, ReactNode][] = [
    ["Heartbeats", <>{p.timing.hb_hz} Hz on every link, {Math.round(1 / CODE.fastHbPeriodS)} Hz while <Ctrl name="Proposed" /> has any action other than NORMAL. An echo later than <V>{fmtMs(p.timing.hb_timeout_ms)}</V> counts as missed.</>],
    ["RTT", <>Median and 90th percentile of the echoes in the last {sec(CODE.rttWindowS)}.</>],
    ["Loss", <>Missed heartbeats over the last {sec(CODE.lossWindowS)}, leaving out outages of {CODE.deadAfterMisses} or more misses in a row, then converted from round trip to one way: 1 − √(1 − round-trip loss).</>],
    ["Alive", <>Fewer than {CODE.deadAfterMisses} heartbeats missed in a row and at least one echo in the last {sec(CODE.rttWindowS)}.</>],
    ["Signal", <>Radio reports a noisy dBm reading each decision; 4G reports RSRP polled once a second; Starlink reports none.</>],
    ["Delivery", <>The hub reports what arrived and the data loss on each link every {sec(CODE.reportPeriodS)}. These reports drive the capacity estimate.</>],
  ];
  return (
    <Panel title="What both controllers measure" id="measure">
      <p className={s.lede}>
        <Ctrl name="Baseline" /> and <Ctrl name="Proposed" /> read the same snapshot from the same code (<Code>common/monitor.py</Code>).
        Neither sees the simulator&apos;s ground truth.
      </p>
      <div className={s.twoCol}>
        <table className={s.defTable}>
          <caption className="sr-only">Per-link measurements</caption>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}><th scope="row">{k}</th><td>{v}</td></tr>
            ))}
          </tbody>
        </table>
        <div>
          <h3 className={s.subTitle}>Capacity estimate (AIMD with a queue check)</h3>
          <p className={s.small}>
            Starts at {pct(a.startShare)} of nominal ({sc.link_config.map((l) => `${linkLabel(l.name)} ${fmtRate(l.nominal_kbps * a.startShare)}`).join(", ")}).
            On each report the first matching rule applies:
          </p>
          <ol className={s.numList}>
            <li>Data loss above <V>{pct(a.lossCut)}</V> while some data got through: cut to the largest of {fmtRate(a.floorKbps)}, {pct(a.cutShare)} of the estimate, or {pct(a.cutDelivered)} of what got through.</li>
            <li>Queue delay (median RTT minus the lowest RTT of the last {sec(CODE.minRttWindowS)}) above <V>{fmtMs(a.queueHighMs)}</V> while using at least {pct(a.queueUseShare)} of the estimate: hold at {pct(a.queueHold)} of what got through.</li>
            <li>Loss at most {pct(a.lossCut)} and queue delay below <V>{fmtMs(a.queueLowMs)}</V>: probe up by {pct(a.probeStep)} of the estimate when using at least {pct(a.busyShare)} of it, otherwise by {pct(a.driftStep)} of nominal, never above nominal.</li>
            <li>Anything else, such as nothing getting through (an outage, not congestion): keep the estimate.</li>
          </ol>
          <p className={s.small}>The estimate reads 0 while the link is not alive or has sent no report for {sec(CODE.rttWindowS)}.</p>
        </div>
      </div>
    </Panel>
  );
}

// ------------------------------------------------------------------ needs table

export function NeedsSection({ sc }: { sc: Scenario }) {
  const modes = MANS.filter((m) => sc.modes[m]);
  const extra = Object.keys(sc.modes).filter((m) => !(MANS as string[]).includes(m));
  return (
    <Panel title="Proposed's needs table, per detected mode" id="needs">
      <p className={s.lede}>
        This is what <Ctrl name="Proposed" /> believes each mode needs (config <Code>modes</Code>). Priority 1 is the protected camera.
        The lowest allowed level is its floor: the allocator never goes below it while a link can carry it. Limits a mode does not set
        default to {fmtMs(CODE.defaultMaxRttMs)} and {pct(CODE.defaultMaxLoss)}.
      </p>
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <th scope="col">Mode</th><th scope="col">Camera</th><th scope="col" className="num">Priority</th>
              <th scope="col">Allowed levels</th><th scope="col" className="num">RTT at most</th><th scope="col" className="num">Loss at most</th>
              <th scope="col">Floor meets the scoring requirement</th>
            </tr>
          </thead>
          <tbody>
            {modes.map((m) => {
              const cams = Object.entries(sc.modes[m]).sort((x, y) => (x[1]!.prio - y[1]!.prio));
              return cams.map(([cam, n], j) => {
                const req = sc.requirements[m];
                const low = lowestMeeting(sc, m);
                const prot = n!.prio === 1;
                const ok = prot && low !== null && cam === req.cam && n!.levels[0] >= low;
                return (
                  <tr key={`${m}-${cam}`} className={j === 0 ? s.groupStart : undefined}>
                    <td>{j === 0 ? <ModeName m={m} /> : null}</td>
                    <td>{camLabel(cam)}</td>
                    <td className="num">{n!.prio}{prot ? ", protected" : ""}</td>
                    <td><span className={s.levels}>{n!.levels.map((lv) => <Level key={lv} l={sc.ladder[lv]} />)}</span></td>
                    <td className="num">{n!.max_rtt_ms !== undefined ? fmtMs(n!.max_rtt_ms) : <span className={s.muted}>{fmtMs(CODE.defaultMaxRttMs)}</span>}</td>
                    <td className="num">{n!.max_loss !== undefined ? pct(n!.max_loss) : <span className={s.muted}>{pct(CODE.defaultMaxLoss)}</span>}</td>
                    <td>
                      {prot ? (
                        <span className={s.check}>
                          <Glyph kind={ok ? "good" : "bad"} size={12} /> {ok ? "Yes" : "No"}
                          <span className={s.muted}>
                            {" "}({manoeuvreLabel(m)} is scored on the {camLabel(req.cam, true)}{low !== null ? `; lowest level that can pass: ${sc.ladder[low].name}` : ""})
                          </span>
                        </span>
                      ) : <span className={s.muted}>Not scored</span>}
                    </td>
                  </tr>
                );
              });
            })}
          </tbody>
        </table>
      </div>
      <p className={s.foot}>
        Grey limits are the code defaults. {extra.length > 0 && <>The table also has {extra.map((e) => <Code key={e}>{e}</Code>)} (all cameras off), which only an operator button can select; the simulation never uses it.</>}
        {" "}With mission awareness switched off (<Code>Proposed - mission</Code>), both cameras get fixed needs instead: front first, {sc.ladder[CODE.fixedNeeds.lo]?.name} to {sc.ladder[CODE.fixedNeeds.hi]?.name}, {fmtMs(CODE.fixedNeeds.maxRttMs)} and {pct(CODE.fixedNeeds.maxLoss)}.
      </p>
    </Panel>
  );
}

// ------------------------------------------------------------------ uploads

const ITEM_NAME: Record<string, string> = {
  rec_: "Recording chunk", lidar_: "Route LiDAR chunk", scan_drive: "Scan while driving",
  lidar_crater: "Crater scan", still: "Still image", clip: "Video clip",
};
const STATE_WHEN: Record<string, string> = {
  CRATER_STOP1: "first stop in the crater", INSPECT: "inspection stop",
};

export function UploadsSection({ sc, p }: { sc: Scenario; p: DeciderParams }) {
  const d = sc.driver;
  const items: { id: string; name: string; mb: number; req: boolean; when: string }[] = [];
  for (const b of d.background_items) {
    items.push({ id: `${b.prefix}N`, name: ITEM_NAME[b.prefix] ?? b.prefix, mb: b.size_mb, req: false, when: `every ${num(d.background_every_s)} s` });
  }
  items.push({ id: d.scan_drive.id, name: ITEM_NAME[d.scan_drive.id] ?? d.scan_drive.id, mb: d.scan_drive.size_mb, req: true, when: `driving out, at ${d.scan_drive.at_km.toFixed(2)} km` });
  for (const [state, evs] of Object.entries(d.events)) {
    for (const e of evs) items.push({ id: e.id, name: ITEM_NAME[e.id] ?? e.id, mb: e.size_mb, req: e.requested, when: `at the ${STATE_WHEN[state] ?? state}` });
  }
  return (
    <Panel title="Uploads: three policies, one shaper" id="uploads">
      <p className={s.lede}>
        The vehicle also has data to send. Every policy uses the same shaping, link choice and camera allocation; only the order differs.
      </p>
      <div className={s.twoCol}>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <caption className={s.tCaption}>What is queued</caption>
            <thead><tr><th scope="col">Item</th><th scope="col" className="num">Size</th><th scope="col">Kind</th><th scope="col">Created</th></tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td><Tooltip content={<>Code name <Code>{it.id}</Code></>}><span tabIndex={0}>{it.name}</span></Tooltip></td>
                  <td className="num">{fmtMB(it.mb)}</td>
                  <td>{it.req ? "Requested by the operator" : "Background"}</td>
                  <td>{it.when}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <caption className={s.tCaption}>Who goes first</caption>
            <thead><tr><th scope="col">Policy</th><th scope="col">Driving, reversing</th><th scope="col">Stopped, precision</th><th scope="col">Run as</th></tr></thead>
            <tbody>
              <tr><td><Code>video_first</Code></td><td>Cameras</td><td>Cameras</td><td><Code>Proposed - uploads</Code></td></tr>
              <tr><td><Code>urgent_first</Code></td><td>Requested uploads</td><td>Requested uploads</td><td><Code>Proposed (urgent_first)</Code></td></tr>
              <tr><td><Code>adaptive</Code></td><td>Cameras</td><td>Requested uploads</td><td><Ctrl name="Proposed" /></td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <ul className={s.bullets}>
        <li>&ldquo;Requested uploads first&rdquo; means the requested item reserves its rate before the cameras are allocated, so it outranks camera quality above the floor. The protected camera&apos;s floor is never given up.</li>
        <li>Bulk rate budget: <V>{pct(p.uploads.bulk_budget_share)}</V> of the bulk link&apos;s capacity estimate, minus commands ({fmtRate(sc.constants.TELEM_KBPS)}) and the cameras already on that link; when a requested upload goes first, only the protected camera&apos;s lowest allowed level is subtracted. Requested items go before background ones, oldest first.</li>
        <li>Router queue guard (simulator): once a link&apos;s queue holds more than <V>{fmtMs(p.uploads.queue_guard_ms)}</V> of data, bulk is capped at what the link can drain.</li>
        <li>The adaptive switch keys on the detected mode, so it still works when mission-aware camera allocation is switched off.</li>
        <li><Ctrl name="Baseline" /> is shaped the same way but has no notion of stops: cameras first, always, on its video link.</li>
      </ul>
    </Panel>
  );
}

// ------------------------------------------------------------------ scoring

export interface InterruptionFacts {
  seed: number;
  engine: { proposed: number | null; baseline: number | null };
  trace: { proposed: number; baseline: number } | null;
}

export function ScoringSection({ sc, facts }: { sc: Scenario; facts: InterruptionFacts | null }) {
  return (
    <Panel title="How the simulator scores a usable view" id="scoring">
      <p className={s.lede}>
        Every {sec(CODE.sampleDtS)} from t = {sec(CODE.scoreFromS)}, the simulator checks the camera that the <b>true</b> manoeuvre (from the driver script) needs.
        The view is usable only if all three limits hold. Neither controller reads this table: <Ctrl name="Baseline" /> ignores manoeuvres
        and <Ctrl name="Proposed" /> works from its own detected mode and needs table. Both are scored with the same yardstick.
      </p>
      <div className={s.twoCol}>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <caption className={s.tCaption}>Operator requirements per true manoeuvre (config <Code>requirements</Code>)</caption>
            <thead>
              <tr>
                <th scope="col">Manoeuvre</th><th scope="col">Camera</th><th scope="col" className="num">Newest frame at most</th>
                <th scope="col" className="num">Frames in the last 1 s at least</th><th scope="col" className="num">Width at least</th>
                <th scope="col">Lowest level that can pass</th><th scope="col"><span className="sr-only">Assumption</span></th>
              </tr>
            </thead>
            <tbody>
              {MANS.map((m) => {
                const r = sc.requirements[m];
                const low = lowestMeeting(sc, m);
                return (
                  <tr key={m}>
                    <td><ModeName m={m} /></td>
                    <td>{camLabel(r.cam)}</td>
                    <td className="num">{sec(r.max_age_s)}</td>
                    <td className="num">{fmtFps(r.min_fps)}</td>
                    <td className="num">{r.min_w} px</td>
                    <td>{low !== null ? <Level l={sc.ladder[low]} /> : "None"}</td>
                    <td><Tooltip content="Assumption from the config, to be backed by teleoperation literature."><span tabIndex={0}><Badge kind="assumption" /></span></Tooltip></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <caption className={s.tCaption}>Video ladder (MJPEG, config <Code>ladder</Code>). Rates are assumptions until measured on real cameras.</caption>
            <thead>
              <tr><th scope="col">Level</th><th scope="col" className="num">Frame</th><th scope="col" className="num">Frame rate</th><th scope="col" className="num">JPEG quality</th><th scope="col" className="num">Rate</th></tr>
            </thead>
            <tbody>
              {sc.ladder.map((l) => (
                <tr key={l.name}>
                  <td><Level l={l} /></td>
                  <td className="num">{l.w ? `${l.w}×${l.h}` : "No video"}</td>
                  <td className="num">{l.w ? fmtFps(l.fps) : "–"}</td>
                  <td className="num">{l.w ? l.q : "–"}</td>
                  <td className="num">{l.w ? fmtRate(l.kbps) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <dl className={s.defs}>
        <dt>Usable view (%)</dt>
        <dd>Share of scored samples where the needed camera passed. The headline number.</dd>
        <dt>Interruptions (engine metric)</dt>
        <dd>
          The number of unbroken runs of not-usable samples from t = {sec(CODE.scoreFromS)}; the longest run is reported as the longest interruption.
          This is the number in Results.
        </dd>
        <dt>Interruption stops in Replay (from the trace)</dt>
        <dd>
          Replay&apos;s &ldquo;Interruptions&rdquo; jump filter stops at each change from usable to not usable in the exported trace, from t = 0.
          It counts from the start of the trace rather than from t = {sec(CODE.scoreFromS)}, so the two counts can differ.
          {facts && facts.trace && (
            <> Seed {facts.seed}: engine metric <Ctrl name="Baseline" /> <V>{fmtCount(facts.engine.baseline)}</V>, <Ctrl name="Proposed" /> <V>{fmtCount(facts.engine.proposed)}</V>;
              {" "}trace stops <Ctrl name="Baseline" /> <V>{fmtCount(facts.trace.baseline)}</V>, <Ctrl name="Proposed" /> <V>{fmtCount(facts.trace.proposed)}</V>.</>
          )}
        </dd>
        <dt>Live view</dt>
        <dd>A secondary measure: the needed camera&apos;s newest frame is under {sec(sc.constants.FRESH_S)} old and at level {sc.ladder[CODE.liveMinLevel]?.name} or above.</dd>
      </dl>
    </Panel>
  );
}

// ------------------------------------------------------------------ configurations

const CONFIG_TEXT: Record<string, ReactNode> = {
  "Baseline": <>Threshold steering with fixed preference, fixed priorities and shaped uploads.</>,
  "Baseline + duplicate video": <>Baseline that also sends both cameras on the next link at all times.</>,
  "Baseline (no shaping)": <>Baseline with greedy, TCP-like uploads that fill the modem queue. A reference only.</>,
  "Proposed": <>Mission-aware allocation, adaptive uploads, predictive switching and two-stream FEC on the protected camera.</>,
  "Proposed - mission": <>Proposed with fixed camera needs instead of the needs table.</>,
  "Proposed - uploads": <>Proposed with the video_first upload policy.</>,
  "Proposed - predict": <>Proposed without the predictor: no early switch, duplicate or handover rule.</>,
  "Proposed - FEC": <>Proposed without two-stream FEC: the protected camera rides one link, with a second only when the predictor duplicates it.</>,
  "Proposed + base-layer copy": <>Proposed with a cheaper scheme in place of two-stream FEC: full stream on one link, base stream on every other live link.</>,
  "Proposed + full copy": <>Proposed with a whole copy of the full stream on every live link in place of two-stream FEC; the first copy wins.</>,
  "Proposed + FEC": <>Proposed with the full stream coded so any n−1 of n live links rebuild it, and no base stream.</>,
  "Proposed + graded two-stream": <>Proposed with base on every live link and the full stream needing any two links (rejected design: lower quality with two links).</>,
  "Proposed (urgent_first)": <>Proposed with the urgent_first upload policy.</>,
  "Oracle: perfect link choice": <>Runs Proposed without FEC, then reads the simulator&apos;s ground truth: the protected camera stays on its link if that link truly stays within the limits and capacity for the next {sec(CODE.oracleLookS)}, otherwise it moves to the first link that does. Commands go on every link that is truly up.</>,
  "Oracle: every up link": <>Runs Proposed without FEC, then reads ground truth and sends the protected camera, and the commands, on every link that is truly up.</>,
};

export function ConfigsSection() {
  const res = getResults();
  const rows = tableObjects(res?.summary);
  const by = new Map<string, { variant: string; n: number }[]>();
  for (const r of rows) {
    const c = String(r.config);
    if (!by.has(c)) by.set(c, []);
    by.get(c)!.push({ variant: String(r.variant), n: Number(r.n) });
  }
  const seedsText = (list: { variant: string; n: number }[]) => {
    const groups = new Map<number, string[]>();
    for (const x of list) { if (!groups.has(x.n)) groups.set(x.n, []); groups.get(x.n)!.push(variantLabel(x.variant)); }
    return Array.from(groups.entries()).sort((a, b) => b[0] - a[0])
      .map(([n, vs]) => `${n} on ${vs.length > 2 ? `${vs.length} variants` : vs.join(" and ")}`).join("; ");
  };
  return (
    <Panel title="Configurations compared" id="configs">
      <p className={s.lede}>
        On a given variant and seed, every configuration meets identical link conditions, so differences come from the decisions alone.
        Seed counts come from the results{res ? <> in <Code>{res.source_dir}</Code></> : null}.
      </p>
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead><tr><th scope="col">Configuration</th><th scope="col">What it is</th><th scope="col">Seeds</th></tr></thead>
          <tbody>
            {Array.from(by.keys()).map((c) => (
              <tr key={c}>
                <td className={s.cfgName}>
                  {c === "Baseline" || c === "Proposed" ? <Ctrl name={c} /> : <span className="ctrl-other">{configLabel(c)}</span>}
                </td>
                <td>{CONFIG_TEXT[c] ?? <span className={s.muted}>No description</span>}</td>
                <td>{seedsText(by.get(c)!)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={s.foot}>
        <Glyph kind="warn" size={12} /> The oracles read ground truth that no real vehicle has. They show how much a perfect handover could gain; they cannot be deployed.
        {Array.from(by.keys()).some((c) => isOracle(c)) ? null : " This run has no oracle results."}
      </p>
    </Panel>
  );
}

// ------------------------------------------------------------------ caveats

export interface CaveatFacts {
  paramsExported: boolean;
  floorsMatch: { match: number; total: number };
}

// DESIGN-GAP: 6.4 asks for the caveats "verbatim from RESULTS.md". Its first and third bullets are
// kept in substance; its second ("Results above are 3 seeds") does not match the data, so the seed
// counts are computed from results.js instead. The other items are caveats the code itself states.
export function CaveatsSection({ sc, facts }: { sc: Scenario; facts: CaveatFacts }) {
  const res = getResults();
  const nBy = res?.n_seeds_by_variant ?? {};
  const groups = new Map<number, string[]>();
  for (const [v, n] of Object.entries(nBy)) { if (!groups.has(n)) groups.set(n, []); groups.get(n)!.push(variantLabel(v)); }
  const minN = Math.min(...Object.values(nBy));
  const items: ReactNode[] = [
    <>Every value marked (A) in the code and config is an assumption, including the operator requirements table and the video ladder rates.</>,
    <>
      Seeds per variant in this run:{" "}
      {Array.from(groups.entries()).sort((a, b) => b[0] - a[0]).map(([n, vs], j) => (
        <Fragment key={n}>{j > 0 ? "; " : ""}<V>{n}</V> for {vs.join(", ")}</Fragment>
      ))}.
      {Number.isFinite(minN) && minN < 5 && <> <Badge kind="status-warn">n = {minN}: intervals are rough</Badge></>}
    </>,
    <>The same seed gives every configuration identical link conditions, and runs are reproducible.</>,
    <>
      What is real code: the two decision modules and the link measurement (<Code>deciders/</Code>, <Code>common/monitor.py</Code>).
      What is simulated: the links, the vehicle&apos;s position, packets in flight, the modem queues, the operator&apos;s commands and the ESP32 failsafe.
    </>,
    <>
      Version 2 removed graceful degradation: the speed cap is always 1.0, stale commands are not rejected, and neither controller slows the vehicle. The ESP32 failsafe
      (stop after {sec(sc.constants.FAILSAFE_S)} without a fresh command) and the lost-link creep ({num(sc.constants.CREEP_MPS)} m/s after {sec(sc.constants.CREEP_AFTER_S)}) remain.
    </>,
    <>
      <Ctrl name="Proposed" />&apos;s needs table and the scoring table were written by the same team. The scoring code never reads the needs table,
      but their floors agree for <V>{facts.floorsMatch.match} of {facts.floorsMatch.total}</V> manoeuvres.
    </>,
    <>Replay&apos;s camera views are drawn from the simulated position, not recorded video.</>,
    facts.paramsExported
      ? <>All thresholds on this page are read from the exported data.</>
      : <>The exported data does not yet include the <Code>timing</Code>, <Code>baseline</Code>, <Code>proposed</Code> and <Code>uploads</Code> config blocks. Those thresholds are shown as copied from <Code>config/sim_themis.yaml</Code> when the viewer was built; all others are read from the exported data.</>,
  ];
  return (
    <Panel title="Caveats" id="caveats">
      <ul className={s.caveats}>
        {items.map((it, n) => <li key={n}>{it}</li>)}
      </ul>
    </Panel>
  );
}
