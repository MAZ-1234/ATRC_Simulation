/**
 * "How we got these numbers": opened by clicking a chapter's claim sentence on the Tour
 * card (normal frame and Theatre). It rebuilds the claim from the traces, step by step:
 *
 *   1. the rule: the operator requirement per manoeuvre (meta.requirements, config (A));
 *   2. the per-sample score: samples.useful, written by the simulator every 0.1 s
 *      (edge_mlc/sim/engine.py Sim.sample); the viewer never re-scores;
 *   3. the scope: which samples the chapter counts (claims.ts scopeFor / scopeIndices,
 *      the same selection the caption uses);
 *   4. the count: usable samples / samples in scope = the percentage on the card, and for a
 *      scoring segment the check against the engine's own metric (metrics.useful_<segment>);
 *   5. why the other samples failed (the needed camera's exported columns against the
 *      requirement, the same rule as the console verdict), the separate losses and the
 *      longest one, and one worked sample.
 *
 * Every number is computed here from the loaded runs; nothing is typed in.
 */
import { useMemo } from "react";
import type { CamName, Manoeuvre, Requirement, RunData, Scenario } from "../../../data/types";
import { Button, Popover, ctrlClass, ctrlVar } from "../../../components";
import { configLabel, dec, getScenario, ladderOf, manoeuvreLabel } from "../../../data/loader";
import { fmtClock, fmtCount, fmtPct, fmtSec } from "../../../format";
import { AGE_NEVER, requirementText, verdictAt } from "../consoles/model";
import { useStore } from "../../../state";
import { scopeFor, scopeIndices, type ChapterClaim, type Scope } from "./claims";
import { ClaimSentence, type Names } from "./claimSentence";
import { ClaimWhy } from "./ClaimWhy";
import s from "./ClaimExplainer.module.css";

type Fail = "stale" | "fps" | "width" | "never" | "rounding";

const FAIL_TEXT: Record<Fail, string> = {
  never: "no frame of the needed camera had arrived yet",
  stale: "newest frame too old",
  fps: "too few frames in the last second",
  width: "picture too small (resolution)",
  rounding: "newest frame just over the age limit (ages are rounded to 0.01 s in the export)",
};

export interface Side {
  run: RunData;
  config: string;
  label: string;
  scope: Scope;
  idx: number[];
  usable: number;
  pct: number | null;
  from: number | null;
  to: number | null;
  /** Manoeuvre -> samples in scope. */
  mans: [Manoeuvre, number][];
  /** Failure reason -> samples (a sample can fail more than one requirement). */
  fails: [Fail, number][];
  /** Loss runs inside the scope: [start t, duration s]. */
  losses: [number, number][];
  /** Engine metric for a segment scope, else null. */
  metric: { key: string; value: number } | null;
}

/** Which requirements the needed camera's exported columns fail at sample k (useful = 0). */
function failsAt(run: RunData, k: number): Fail[] {
  const man = dec(run, "man", run.samples.man[k]) as Manoeuvre | null;
  const req = man ? run.meta.requirements[man] : undefined;
  const c = req ? run.cams?.[req.cam] : undefined;
  if (!req || !c) return [];
  const age = c.age[k];
  if (age >= AGE_NEVER) return ["never"];
  const out: Fail[] = [];
  if (age > req.max_age_s + 1e-9) out.push("stale");
  if (c.fps[k] < req.min_fps) out.push("fps");
  if ((ladderOf(run, c.vlevel[k])?.w ?? 0) < req.min_w) out.push("width");
  return out.length ? out : ["rounding"];
}

function sideOf(run: RunData, config: string, index: number, scenario: Scenario | null): Side {
  const zones = scenario?.variants[run.meta.variant]?.zones ?? [];
  const scope = scopeFor(index, run, zones);
  const idx = scopeIndices(run, scope);
  const sm = run.samples;
  const dt = run.meta.dt;
  let usable = 0;
  const mans = new Map<Manoeuvre, number>();
  const fails = new Map<Fail, number>();
  const losses: [number, number][] = [];
  let lossStart: number | null = null;
  for (const k of idx) {
    const man = dec(run, "man", sm.man[k]) as Manoeuvre | null;
    if (man) mans.set(man, (mans.get(man) ?? 0) + 1);
    if (sm.useful[k] === 1) {
      usable++;
      if (lossStart !== null) { losses.push([lossStart, sm.t[k] - lossStart]); lossStart = null; }
    } else {
      if (lossStart === null) lossStart = sm.t[k];
      for (const f of failsAt(run, k)) fails.set(f, (fails.get(f) ?? 0) + 1);
    }
  }
  if (lossStart !== null && idx.length) losses.push([lossStart, sm.t[idx[idx.length - 1]] + dt - lossStart]);
  const key = scope?.kind === "segment" ? `useful_${scope.seg}` : null;
  const mv = key ? run.metrics[key] : undefined;
  return {
    run, config, label: configLabel(config, run.meta.decider), scope, idx, usable,
    pct: idx.length ? (100 * usable) / idx.length : null,
    from: idx.length ? sm.t[idx[0]] : null,
    to: idx.length ? sm.t[idx[idx.length - 1]] : null,
    mans: [...mans.entries()].sort((a, b) => b[1] - a[1]),
    fails: [...fails.entries()].sort((a, b) => b[1] - a[1]),
    losses,
    metric: key && typeof mv === "number" ? { key, value: mv } : null,
  };
}

function scopeText(scope: Scope, chapterIndex: number): string {
  if (!scope) return "no scope in this trace";
  if (scope.kind === "segment") return `every sample in the “${scope.seg}” scoring segment`;
  return chapterIndex === 3
    ? "every sample inside this run's own jammer blackout interval"
    : "every sample from entering to leaving the zone, outbound";
}

/** Usable / not usable bands for both runs over one shared time axis. */
function Strip({ sides }: { sides: Side[] }) {
  const t0 = Math.min(...sides.map((x) => x.from ?? Infinity));
  const t1 = Math.max(...sides.map((x) => (x.to ?? -Infinity) + x.run.meta.dt));
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return null;
  const W = 1000;
  const X = (t: number) => ((t - t0) / (t1 - t0)) * W;
  const ROW = 18;
  const GAP = 22;
  return (
    <figure className={s.strip}>
      <svg viewBox={`0 0 ${W} ${sides.length * (ROW + GAP)}`} preserveAspectRatio="none" role="img"
        aria-label={`Usable and not usable samples from ${fmtClock(t0)} to ${fmtClock(t1)} for ${sides.map((x) => x.label).join(" and ")}.`}>
        {sides.map((x, r) => {
          const y = r * (ROW + GAP) + GAP - 4;
          const dt = x.run.meta.dt;
          const rects: JSX.Element[] = [];
          let a = -1;
          let cur = -1;
          const flush = (end: number) => {
            if (a < 0) return;
            rects.push(
              <rect key={a} x={X(a)} y={y} width={Math.max(0.6, X(end) - X(a))} height={ROW}
                style={{ fill: cur === 1 ? ctrlVar(x.config) : "var(--color-status-bad)" }} />,
            );
          };
          for (const k of x.idx) {
            const u = x.run.samples.useful[k];
            const t = x.run.samples.t[k];
            if (u !== cur) { flush(t); a = t; cur = u; }
          }
          if (x.idx.length) flush(x.run.samples.t[x.idx[x.idx.length - 1]] + dt);
          return <g key={x.config}>{rects}</g>;
        })}
      </svg>
      <div className={s.stripRows} aria-hidden>
        {sides.map((x) => <span key={x.config} className={ctrlClass(x.config)}>{x.label}</span>)}
      </div>
      <figcaption className={s.axis}>
        <span>{fmtClock(t0)}</span>
        <span className={s.legend}>
          <i style={{ background: ctrlVar(sides[1]?.config ?? "Proposed") }} /> usable (controller colour)
          <i style={{ background: "var(--color-status-bad)" }} /> not usable
        </span>
        <span>{fmtClock(t1)}</span>
      </figcaption>
    </figure>
  );
}

function ReqTable({ rows }: { rows: [Manoeuvre, Requirement, number, number][] }) {
  return (
    <table className={s.table}>
      <thead><tr><th>Manoeuvre (driver script)</th><th>Camera that must be usable, and its limits (A)</th><th>Samples in scope</th></tr></thead>
      <tbody>
        {rows.map(([man, req, nL, nR]) => (
          <tr key={man}>
            <th scope="row">{manoeuvreLabel(man)}</th>
            <td>{requirementText(req)}</td>
            <td className={s.num}>{fmtCount(nL)} / {fmtCount(nR)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * One sample shown both ways: the first moment in scope where the two verdicts differ AND
 * the side that fails, fails for its most common reason in this scope (so the example is
 * typical, not an edge case); else the first moment the verdicts differ at all.
 */
function Worked({ left, right }: { left: Side; right: Side }) {
  const pick = useMemo(() => {
    const top = (x: Side) => x.fails[0]?.[0];
    let any: { t: number; kl: number; kr: number } | null = null;
    for (const k of right.idx) {
      const t = right.run.samples.t[k];
      const kl = left.idx.find((j) => Math.abs(left.run.samples.t[j] - t) < left.run.meta.dt / 2);
      if (kl === undefined) continue;
      const uL = left.run.samples.useful[kl];
      const uR = right.run.samples.useful[k];
      if (uL === uR) continue;
      any = any ?? { t, kl, kr: k };
      const [loser, kk] = uL === 0 ? [left, kl] : [right, k];
      const f = top(loser);
      if (f && failsAt(loser.run, kk).includes(f)) return { t, kl, kr: k, typical: true };
    }
    if (any) return { ...any, typical: false };
    const k = right.idx[0];
    if (k === undefined) return null;
    const t = right.run.samples.t[k];
    const kl = left.idx.find((j) => Math.abs(left.run.samples.t[j] - t) < left.run.meta.dt / 2);
    return kl === undefined ? null : { t, kl, kr: k, typical: false };
  }, [left, right]);
  if (!pick) return null;
  const rows: [Side, number][] = [[left, pick.kl], [right, pick.kr]];
  return (
    <div className={s.worked}>
      <p className={s.lede}>
        {pick.typical
          ? <>A typical moment: the first time in this scope that the two verdicts differ for the most common reason, at <b>{fmtClock(pick.t)}</b>:</>
          : <>The first moment in this scope where the two controllers' verdicts differ, at <b>{fmtClock(pick.t)}</b>:</>}
      </p>
      <ul className={s.list}>
        {rows.map(([x, k]) => {
          const v = verdictAt(x.run, k);
          const cam = v?.cam as CamName | undefined;
          const c = cam ? x.run.cams?.[cam] : undefined;
          const lv = c ? ladderOf(x.run, c.vlevel[k]) : undefined;
          return (
            <li key={x.config}>
              <span className={ctrlClass(x.config)}><b>{x.label}</b></span>: the true manoeuvre is{" "}
              {v ? manoeuvreLabel(v.man).toLowerCase() : "unknown"}, so the {cam ?? "needed"} camera is scored. Its newest frame
              {!c ? " is not in the trace"
                : c.age[k] >= AGE_NEVER ? " had not arrived yet"
                  : lv ? <> was {lv.w}×{lv.h} ({lv.name}), {fmtSec(c.age[k], 2)} old, with {fmtCount(c.fps[k])} frames in the last second</> : " has no picture"}.
              {" "}samples.useful = <b>{x.run.samples.useful[k]}</b>: {v ? v.sentence : "no verdict"}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SideCount({ x, chapterIndex }: { x: Side; chapterIndex: number }) {
  const longest = x.losses.reduce<[number, number] | null>((m, l) => (!m || l[1] > m[1] ? l : m), null);
  const notUsable = x.idx.length - x.usable;
  return (
    <div className={s.side} style={{ borderTopColor: ctrlVar(x.config) }}>
      <h4 className={`${s.sideTitle} ${ctrlClass(x.config)}`}>{x.label}</h4>
      <p className={s.big}>{fmtPct(x.pct)}</p>
      <p className={s.formula}>
        {fmtCount(x.usable)} usable ÷ {fmtCount(x.idx.length)} samples = {x.pct === null ? "–" : `${(x.pct / 100).toFixed(4)}`} → {fmtPct(x.pct)}
      </p>
      <dl className={s.facts}>
        <dt>Scope</dt><dd>{scopeText(x.scope, chapterIndex)}</dd>
        <dt>Time in scope</dt><dd>{x.from === null ? "–" : `${fmtClock(x.from)} to ${fmtClock((x.to ?? 0) + x.run.meta.dt)}`} ({fmtSec(x.idx.length * x.run.meta.dt, 1)}, one sample per {fmtSec(x.run.meta.dt, 1)})</dd>
        <dt>Usable time</dt><dd>{fmtSec(x.usable * x.run.meta.dt, 1)}; not usable {fmtSec(notUsable * x.run.meta.dt, 1)}</dd>
        <dt>Separate losses</dt><dd>{fmtCount(x.losses.length)}{longest ? `; longest ${fmtSec(longest[1], 1)} from ${fmtClock(longest[0])}` : ""}</dd>
        <dt>Engine check</dt>
        <dd>
          {x.metric
            ? <>the simulator's own metric <code>{x.metric.key}</code> for this run is {fmtPct(x.metric.value, 2)}
              {Math.abs(x.metric.value - (x.pct ?? NaN)) < 0.05 ? ": the same samples, the same result." : `; the count above gives ${fmtPct(x.pct, 2)}.`}</>
            : "this window has no engine metric of its own; the count above is the whole calculation."}
        </dd>
      </dl>
      {notUsable > 0 && (
        <>
          <p className={s.why}>Why the {fmtCount(notUsable)} not-usable samples failed (a sample can fail more than one limit):</p>
          <ul className={s.bars}>
            {x.fails.map(([f, n]) => (
              <li key={f}>
                <span className={s.barLabel}>{FAIL_TEXT[f]}</span>
                <span className={s.barTrack}><span className={s.barFill} style={{ width: `${(100 * n) / notUsable}%` }} /></span>
                <span className={s.num}>{fmtCount(n)} ({fmtSec(n * x.run.meta.dt, 1)})</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export interface ClaimExplainerProps {
  open: boolean;
  onClose: () => void;
  claim: ChapterClaim;
  title: string;
  left: RunData;
  right: RunData;
  names: Names;
}

export function ClaimExplainer({ open, onClose, claim, title, left, right, names }: ClaimExplainerProps) {
  const scenario = getScenario();
  const sides = useMemo(
    () => (open ? [sideOf(left, names.left, claim.index, scenario), sideOf(right, names.right, claim.index, scenario)] : null),
    [open, left, right, names.left, names.right, claim.index, scenario],
  );
  if (!open || !sides) return null;
  const [L, R] = sides;
  const mans = [...new Set([...L.mans, ...R.mans].map(([m]) => m))];
  const reqRows = mans
    .map((m) => [m, right.meta.requirements[m], L.mans.find(([x]) => x === m)?.[1] ?? 0, R.mans.find(([x]) => x === m)?.[1] ?? 0] as [Manoeuvre, Requirement, number, number])
    .filter((r) => r[1]);
  const goResults = () => {
    onClose();
    const st = useStore.getState();
    st.stopTour();
    st.setTheatre(false);
    st.setView("results");
  };

  return (
    <Popover open={open} onClose={onClose} placement="center" width={1040} className={s.pop}
      title={<>How we got these numbers <span className={s.sub}>{title}</span></>}>
      <div className={s.top}>
        <p className={s.claim}><ClaimSentence claim={claim} names={names} form="full" /></p>
        {/* First focusable, so the dialog opens at its top rather than scrolled to the footer. */}
        <Button onClick={onClose} title="Close and go back (Esc)">Back to the tour</Button>
      </div>
      <p className={s.meta}>
        One run: variant {right.meta.variant}, seed {fmtCount(right.meta.seed)}, {L.label} against {R.label}, the same
        terrain and the same random link conditions for both. Every number on this page is counted from that run's trace now.
      </p>

      <ol className={s.steps}>
        <li>
          <h3>The rule: what “usable” means</h3>
          <p>
            At every moment the operator needs one camera, chosen by what the vehicle is really doing (the driver script's
            true manoeuvre, not what the controller thinks it is doing). That camera's newest frame must meet three limits.
            These limits are configuration assumptions (A):
          </p>
          <ReqTable rows={reqRows} />
          <p className={s.note}>Sample counts are {L.label} / {R.label}.</p>
        </li>
        <li>
          <h3>The score: one yes-or-no every {fmtSec(right.meta.dt, 1)}</h3>
          <p>
            The simulator (<code>edge_mlc/sim/engine.py</code>, <code>Sim.sample</code>) checks those limits every{" "}
            {fmtSec(right.meta.dt, 1)} for each controller and writes <code>useful = 1</code> when all three pass, else{" "}
            <code>0</code>. The viewer only counts these values. It never re-scores a run.
          </p>
        </li>
        <li>
          <h3>The scope: which samples this chapter counts</h3>
          <p>
            {claim.scopeNote} The rule for each chapter is fixed and is the same for every seed and every outcome, so a chapter
            can't be picked to flatter one controller.
          </p>
          <Strip sides={sides} />
        </li>
        <li>
          <h3>The count</h3>
          <div className={s.sides}>
            <SideCount x={L} chapterIndex={claim.index} />
            <SideCount x={R} chapterIndex={claim.index} />
          </div>
        </li>
        <li>
          <ClaimWhy left={L} right={R} chapterIndex={claim.index} />
        </li>
        <li>
          <h3>One sample, worked through</h3>
          <Worked left={L} right={R} />
        </li>
      </ol>

      <div className={s.foot}>
        <p className={s.note}>
          This is one seed. The 20-seed means with 95% intervals, including where Proposed does not win, are on Results.
        </p>
        <span className={s.footButtons}>
          <Button variant="quiet" onClick={goResults}>Open Results</Button>
          <Button onClick={onClose}>Back to the tour</Button>
        </span>
      </div>
    </Popover>
  );
}
