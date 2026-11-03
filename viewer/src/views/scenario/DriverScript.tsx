/**
 * Driver state table (DESIGN.md 6.3 "Mission events table: time, km, event, what the
 * operator needs"). One row per state of scenario.Driver: what starts it, what the
 * operator does (throttle, steering), the TRUE manoeuvre used for scoring and the
 * operator requirement that applies (config `requirements`, all (A)), the uploads it
 * requests, and when the loaded Proposed run entered it.
 */
import { Badge, Button, Tooltip } from "../../components";
import { showInReplay } from "../../state";
import { fmtClock, fmtKm, manoeuvreLabel } from "../../data/loader";
import type { DriverState, RunData, Scenario } from "../../data/types";
import {
  conditionText, num, requirementParts, stateEntries, stateLabel, throttleOverrides, uploadLabel,
} from "./model";
import s from "./Scenario.module.css";

interface Props {
  sc: Scenario;
  run: RunData | null;
  seed: number;
}

function ThrottleBar({ v }: { v: number }) {
  // Diverging bar around zero: -1 (full reverse) .. +1 (full forward).
  const w = 56;
  const mid = w / 2;
  const len = Math.abs(v) * mid;
  return (
    <svg width={w} height={10} aria-hidden className={s.thrBar}>
      <rect x={0} y={4} width={w} height={2} style={{ fill: "var(--color-surface-sunken)" }} />
      <line x1={mid} x2={mid} y1={0} y2={10} style={{ stroke: "var(--color-border-strong)", strokeWidth: 1 }} />
      {len > 0 && <rect x={v >= 0 ? mid : mid - len} y={2} width={len} height={6} style={{ fill: "var(--color-text-2)" }} />}
    </svg>
  );
}

function steering(amp: number, off: number): string {
  const parts: string[] = [];
  if (off !== 0) parts.push(`held at ${off > 0 ? "+" : ""}${num(off)}`);
  if (amp !== 0) parts.push(`weaving ±${num(amp)}`);
  return parts.length ? parts.join(", ") : "Straight";
}

export function DriverScript({ sc, run, seed }: Props) {
  const states = Object.keys(sc.driver.states) as DriverState[];
  const starts = new Map(sc.driver.transitions.map(([from, to, cond]) => [to, { from, cond }]));
  const entries = stateEntries(run);
  const scan = sc.driver.scan_drive;
  const crater = new Set(sc.driver.crater_states);
  // The scan is requested by position (first outbound pass of at_km), not by a state: it falls
  // in the state left by the first outbound "d >= X km" transition with X beyond at_km.
  const scanState = sc.driver.transitions.find(([, , c]) => {
    const m = /^d\s*>=\s*([\d.]+)\s*km$/.exec(c);
    return m && Number(m[1]) > scan.at_km;
  })?.[0];

  return (
    <div className={s.tableWrap}>
      <table className={`${s.table} ${s.driverTable}`}>
        <caption className="sr-only">Driver script: states, triggers, operator inputs and the view the operator needs</caption>
        <thead>
          <tr>
            <th scope="col">Driver state</th>
            <th scope="col">Starts</th>
            <th scope="col">Throttle and steering</th>
            <th scope="col">
              <Tooltip content="From config requirements (all assumptions). Only this camera is scored: newest frame at most this old, at least this frame rate, at least this width.">
                <span tabIndex={0} className={s.thHelp}>True manoeuvre and what the operator needs <Badge kind="assumption" /></span>
              </Tooltip>
            </th>
            <th scope="col" className={s.colUploads}>Uploads requested</th>
            <th scope="col">First entered, seed {seed}</th>
          </tr>
        </thead>
        <tbody>
          {states.map((st) => {
            const info = sc.driver.states[st];
            const start = starts.get(st);
            const req = requirementParts(sc, info.manoeuvre);
            const ev = sc.driver.events[st] ?? [];
            const e = entries.get(st);
            const ov = throttleOverrides(run, st, info.throttle);
            const rear = sc.requirements[info.manoeuvre]?.cam === "rear";
            return (
              <tr key={st} className={crater.has(st) ? s.rowCrater : undefined}>
                <th scope="row">
                  <span title={st}>{stateLabel(st)}</span>
                  {crater.has(st) && <span className={s.sub}>Crater segment</span>}
                </th>
                <td>{start ? conditionText(start.cond, start.from) : "Mission start"}</td>
                <td className={s.thrCell}>
                  <span className={s.thrRow}><ThrottleBar v={info.throttle} /><span className={s.numTxt}>{num(info.throttle)}</span></span>
                  {info.throttle < 0 && <span className={s.sub}>Reverse</span>}
                  {ov && (
                    <span className={s.sub}>{num(ov.thr)} at {ov.from.toFixed(2)}–{fmtKm(ov.to)} (from the trace)</span>
                  )}
                  <span className={s.subPlain}>Steering {steering(info.steer_amp, info.steer_offset).toLowerCase()}</span>
                </td>
                <td>
                  {req && (
                    <span className={s.need}>
                      <span title={info.manoeuvre}>
                        <span className={s.manName}>{manoeuvreLabel(info.manoeuvre)}</span>:{" "}
                        <span className={rear ? s.strong : undefined}>{req.cam.toLowerCase()} camera</span>
                      </span>
                      <span className={s.sub}>
                        <span className={s.nowrap}>≤ {req.age} old,</span> <span className={s.nowrap}>≥ {req.fps},</span>{" "}
                        <span className={s.nowrap}>≥ {req.width} wide</span>
                      </span>
                    </span>
                  )}
                </td>
                <td className={s.colUploads}>
                  {ev.length === 0 && st !== scanState && <span className={s.muted}>None</span>}
                  {st === scanState && (
                    <span className={s.need}>
                      <span>{uploadLabel(scan.id)}, <span className={s.nowrap}>{num(scan.size_mb)} MB</span></span>
                      <span className={s.sub}>at {fmtKm(scan.at_km)}, while cruising</span>
                    </span>
                  )}
                  {ev.map((u) => <span key={u.id} className={s.block}>{uploadLabel(u.id)}, <span className={s.nowrap}>{num(u.size_mb)} MB</span></span>)}
                </td>
                <td className={s.whenCell}>
                  {e ? (
                    <span className={s.when}>
                      <span className={s.numTxt}>{fmtClock(e.t)}</span>
                      <span className={s.sub}>{fmtKm(e.d)}</span>
                      <Button variant="quiet" className={s.replayBtn} onClick={() => showInReplay({ t: e.t })}
                        aria-label={`Show ${stateLabel(st).toLowerCase()} in replay at ${fmtClock(e.t)}`}>Show in replay</Button>
                    </span>
                  ) : <span className={s.muted}>{run ? "Not reached" : "Loading"}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
