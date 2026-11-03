/**
 * Truth spine: the middle column of the consoles row (DESIGN.md 1, 6.1 "Spine", 7 "Link
 * health row", 6.1.3 narrow). The world both controllers share, drawn once:
 *   Links now       three link health rows (truth band vs measured value)
 *   Needed now      the operator requirement for the TRUE manoeuvre (meta.requirements)
 *   Uploads queued  requested uploads with size and per-controller progress
 *
 * Truth and the needed manoeuvre are read from the right (Proposed) run, the same reference
 * the chapters use; the left run's own values appear in tooltips and where they differ.
 * Leaf components subscribe to the cursor; the frame does not.
 */
import { useMemo } from "react";
import { Legend, Tooltip, ctrlClass, ctrlVar, type LegendItem } from "../../../components";
import { useBreakpoint, useRunPair, useStore } from "../../../state";
import {
  getScenario, sampleIndexAt, dec, uploadDeliveredAt, fmtDur, fmtKm, fmtMB, fmtSec, fmtClock,
  manoeuvreLabel, camLabel, levelTooltip, LINK_ORDER,
} from "../../../data/loader";
import type { RunData, Scenario, Upload } from "../../../data/types";
import { LinkRow, BAND_S } from "./LinkRow";
import { levelsMeeting, runTruth, type RunTruth } from "./linkTruth";
import s from "./TruthSpine.module.css";

export function TruthSpine() {
  const pair = useRunPair();
  const bp = useBreakpoint();
  // Presenter mode: the swatch legend for upload bars does not fit beside the title at 18px.
  const presenter = useStore((st) => st.presenter);
  const left = pair.left as RunData;
  const right = pair.right as RunData;
  const scenario = getScenario();
  const truth = useMemo(() => runTruth(right, scenario), [right, scenario]);
  const names = { left: pair.leftConfig, right: pair.rightConfig };

  const legend: LegendItem[] = [
    {
      key: "truth", mark: "band", color: "var(--color-border-strong)",
      label: <span title={`True capacity along ${names.right}'s run over the last ${BAND_S} s; faint = up but outside the video limits, hatched = down.`}>Truth, last {BAND_S} s</span>,
    },
    {
      key: "measured", mark: "line", color: "var(--color-text-1)",
      label: <span title={`Capacity as ${names.right}'s link monitor measured it. Hover a row for both monitors.`}>Measured</span>,
    },
  ];

  // Upload bars: left bar = left console's run, right bar = right console's run.
  const ctrlLegend: LegendItem[] = [
    { key: "l", label: names.left, mark: "band", color: ctrlVar(names.left), edge: ctrlVar(names.left, "edge") },
    { key: "r", label: names.right, mark: "band", color: ctrlVar(names.right), edge: ctrlVar(names.right, "edge") },
  ];

  return (
    <div className={`${s.root} ${s[bp]}`}>
      <section className={s.links} aria-label="Links now">
        <div className={s.head}>
          <h2>Links now</h2>
          <Legend items={legend} className={s.legend} ariaLabel="Link band legend" />
        </div>
        <LinksNow left={left} right={right} names={names} truth={truth} scenario={scenario} />
      </section>
      <section className={s.needed} aria-label="Needed now">
        <h2>Needed now</h2>
        <NeededNow left={left} right={right} leftName={names.left} />
      </section>
      <section className={s.uploads} aria-label="Uploads queued">
        <div className={s.head}>
          <h2>Uploads queued</h2>
          {bp === "compact" || (presenter && bp === "wide") ? (
            <span className={s.ctrlKey} aria-label="Upload bars: left for the left console, right for the right console">
              <span className={ctrlClass(names.left)}>{names.left}</span>
              <span className={ctrlClass(names.right)}>{names.right}</span>
            </span>
          ) : (
            <Legend items={ctrlLegend} className={s.legend} ariaLabel="Upload bar legend" />
          )}
        </div>
        <UploadsQueued left={left} right={right} names={names} dense={bp === "compact"} />
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ Links now

function LinksNow({ left, right, names, truth, scenario }: {
  left: RunData; right: RunData; names: { left: string; right: string }; truth: RunTruth; scenario: Scenario | null;
}) {
  const t = useStore((st) => st.t);
  return (
    <div className={s.linkRows}>
      {LINK_ORDER.filter((l) => right.meta.links.includes(l)).map((link) => (
        <LinkRow key={link} link={link} t={t} right={right} left={left}
          rightName={names.right} leftName={names.left} truth={truth} scenario={scenario} />
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Needed now

function NeededNow({ left, right, leftName }: { left: RunData; right: RunData; leftName: string }) {
  const codeR = useStore((st) => right.samples.man[sampleIndexAt(right, st.t)]);
  const codeL = useStore((st) => left.samples.man[sampleIndexAt(left, st.t)]);
  const man = dec(right, "man", codeR);
  const manL = dec(left, "man", codeL);
  const req = man ? right.meta.requirements[man] : undefined;
  if (!man || !req) return <p className={s.quiet}>No manoeuvre in the trace at this moment.</p>;
  const ladder = right.meta.ladder;
  const levels = levelsMeeting(ladder, req);
  const tip = (
    <>
      <div>Operator requirement for the true manoeuvre, from the config&rsquo;s requirements (A). Only the needed camera is scored.</div>
      {levels.length > 0 && (
        <div className={s.tipLevels}>
          Ladder levels that meet it:
          {levels.map((i) => <div key={i}>{levelTooltip(ladder[i])}</div>)}
        </div>
      )}
    </>
  );
  return (
    <div className={s.neededBody}>
      <Tooltip placement="bottom" content={tip} className={s.rowAnchor}>
        <p className={s.neededText} tabIndex={0}>
          {/* DESIGN.md 6.1 wireframe form: "Rear camera, 10 fps, 0.5 s old at most, 320 px wide or more". */}
          <span className={s.neededLead}>{manoeuvreLabel(man)}:</span>{" "}
          {camLabel(req.cam, true)} at {req.min_fps} fps or more, {fmtSec(req.max_age_s)} old at most, {req.min_w} px wide or more.
        </p>
      </Tooltip>
      {manL && manL !== man && (
        <p className={s.quiet}>
          <span className={ctrlClass(leftName)}>{leftName}</span>&rsquo;s run is {manoeuvreLabel(manL).toLowerCase()} at this moment.
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Uploads queued

/** Operator words for an upload. Sizes, positions and times come from the trace. */
function uploadName(u: Upload): string {
  switch (u.id) {
    case "scan_drive": return `Scan at ${fmtKm(u.created_d)}`;
    case "lidar_crater": return "Crater scan";
    case "still": return "Inspection still";
    case "clip": return "Inspection clip";
    default: return u.kind.charAt(0).toUpperCase() + u.kind.slice(1);
  }
}

interface Progress { u: Upload | null; idx: number; delivered: number; requested: boolean; done: boolean }

function progressOf(run: RunData, id: string, t: number): Progress {
  const idx = run.uploads.findIndex((x) => x.id === id);
  const u = idx >= 0 ? run.uploads[idx] : null;
  if (!u) return { u: null, idx, delivered: 0, requested: false, done: false };
  const requested = u.created_t <= t + 1e-6;
  const done = u.done_t !== null && u.done_t <= t + 1e-6;
  return { u, idx, delivered: requested ? uploadDeliveredAt(run, idx, t) : 0, requested, done };
}

function UploadsQueued({ left, right, names, dense }: { left: RunData; right: RunData; names: { left: string; right: string }; dense: boolean }) {
  const t = useStore((st) => st.t);
  const ids = useMemo(() => right.uploads.filter((u) => u.requested === 1).map((u) => u.id), [right]);
  const items = ids
    .map((id) => ({ id, l: progressOf(left, id, t), r: progressOf(right, id, t) }))
    .filter((it) => (it.l.requested || it.r.requested) && !(it.l.done && it.r.done));
  const kL = sampleIndexAt(left, t);
  const kR = sampleIndexAt(right, t);
  const bgL = left.samples.upq_bg_mb[kL];
  const bgR = right.samples.upq_bg_mb[kR];
  const backlog = (
    <p className={s.backlog}>
      Background: <span className={ctrlClass(names.left)}>{names.left}</span> {fmtMB(bgL)},{" "}
      <span className={ctrlClass(names.right)}>{names.right}</span> {fmtMB(bgR)}
    </p>
  );

  return (
    <div className={s.uploadBody}>
      {items.length === 0 ? (
        <p className={s.quiet}>No requested uploads waiting.</p>
      ) : (
        <ul className={s.upList}>
          {(dense ? items.slice(0, 1) : items).map((it) => {
            const ref = (it.r.u ?? it.l.u)!;
            return (
              <li key={it.id} className={s.upItem}>
                <UploadTip it={it} names={names} backlog={[bgL, bgR]}>
                  <div className={s.upHead} tabIndex={0}>
                    <span className={s.upName}>{uploadName(ref)}</span>
                    <span className={s.upSize}>{fmtMB(ref.size_mb)}</span>
                  </div>
                </UploadTip>
                {/* Left bar = left console, right bar = right console (mirrors the consoles). */}
                <div className={s.upBars}>
                  <ProgressBar p={it.l} name={names.left} />
                  <ProgressBar p={it.r} name={names.right} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {dense && items.length > 1 && (
        <p className={s.more}>
          Also queued: {items.slice(1).map((it) => {
            const u = (it.r.u ?? it.l.u)!;
            return `${uploadName(u)}, ${fmtMB(u.size_mb)}`;
          }).join("; ")}
        </p>
      )}
      {(items.length === 0 || (!dense && items.length === 1)) && backlog}
    </div>
  );
}

function ProgressBar({ p, name }: { p: Progress; name: string }) {
  const size = p.u?.size_mb ?? 0;
  const f = size > 0 ? Math.min(1, p.delivered / size) : 0;
  const text = !p.u ? "Not in trace"
    : !p.requested ? "Not yet"
      : p.done ? `Done, ${fmtDur(p.u.delivery_s)}`
        : fmtMB(p.delivered);
  const long = !p.u ? "not in trace"
    : !p.requested ? "not requested yet"
      : p.done ? `delivered in ${fmtDur(p.u.delivery_s)}`
        : `${fmtMB(p.delivered)} of ${fmtMB(size)} sent`;
  return (
    <div className={s.upCell} role="img" aria-label={`${name}: ${long}`}>
      <span className={s.upTrack}>
        {f > 0 && <span className={s.upFill} style={{ width: `${(f * 100).toFixed(2)}%`, background: ctrlVar(name), borderColor: ctrlVar(name, "edge") }} />}
      </span>
      <span className={s.upValue}>{text}</span>
    </div>
  );
}

function UploadTip({ it, names, backlog, children }: {
  it: { l: Progress; r: Progress }; names: { left: string; right: string }; backlog: [number, number]; children: React.ReactElement;
}) {
  const row = (p: Progress): string => {
    if (!p.u) return "Not in trace";
    const req = `requested ${fmtClock(p.u.created_t)}`;
    return p.u.done_t !== null ? `${req}, done ${fmtClock(p.u.done_t)} (${fmtDur(p.u.delivery_s)})` : `${req}, not delivered by mission end`;
  };
  return (
    <Tooltip placement="bottom" className={s.rowAnchor} title={uploadName((it.r.u ?? it.l.u)!)} rows={[
      ["Size", fmtMB((it.r.u ?? it.l.u)!.size_mb)],
      [names.left, row(it.l)],
      [names.right, row(it.r)],
      ["Background backlog", `${names.left} ${fmtMB(backlog[0])}, ${names.right} ${fmtMB(backlog[1])}`],
    ]}>
      {children}
    </Tooltip>
  );
}
