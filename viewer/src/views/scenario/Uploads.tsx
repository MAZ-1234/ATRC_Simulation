/**
 * Upload events the mission asks for (DESIGN.md 6.3): the scan requested while driving,
 * the crater LiDAR, the inspection still and clip, and the background chunks every 60 s.
 * Sizes and triggers come from scenario.driver; creation times, positions and what the
 * operator was doing come from the loaded Proposed run (the same in every run of the
 * seed up to a few tenths of a second, because they follow the driver script).
 */
import { Badge, Button } from "../../components";
import { showInReplay } from "../../state";
import { fmtClock, fmtClockShort, fmtKm, fmtMB, manoeuvreLabel } from "../../data/loader";
import type { RunData, Scenario } from "../../data/types";
import { conditionText, manoeuvreAt, num, stateLabel, uploadLabel } from "./model";
import s from "./Scenario.module.css";

interface Props {
  sc: Scenario;
  run: RunData | null;
  seed: number;
}

interface Row {
  key: string;
  name: string;
  kind: string;
  size: number;
  requested: boolean;
  trigger: string;
  t: number | null;
  d: number | null;
  extra?: string;
}

export function Uploads({ sc, run, seed }: Props) {
  const dr = sc.driver;
  const starts = new Map(dr.transitions.map(([from, to, cond]) => [to, { from, cond }]));
  const created = (id: string) => run?.uploads.find((u) => u.id === id) ?? null;
  const rows: Row[] = [];
  const scan = created(dr.scan_drive.id);
  rows.push({
    key: dr.scan_drive.id, name: uploadLabel(dr.scan_drive.id), kind: dr.scan_drive.kind, size: dr.scan_drive.size_mb, requested: true,
    trigger: `First pass of ${fmtKm(dr.scan_drive.at_km)}, outbound`, t: scan?.created_t ?? null, d: scan?.created_d ?? null,
  });
  for (const [state, evs] of Object.entries(dr.events)) {
    const st = starts.get(state as never);
    for (const e of evs) {
      const u = created(e.id);
      rows.push({
        key: e.id, name: uploadLabel(e.id), kind: e.kind, size: e.size_mb, requested: e.requested,
        trigger: `Entering ${stateLabel(state).toLowerCase()}${st ? ` (${conditionText(st.cond, st.from).replace(/^./, (c) => c.toLowerCase())})` : ""}`,
        t: u?.created_t ?? null, d: u?.created_d ?? null,
      });
    }
  }
  const bg = run?.uploads.filter((u) => !u.requested) ?? [];
  for (const b of dr.background_items) {
    const mine = bg.filter((u) => u.id.startsWith(b.prefix));
    rows.push({
      key: b.prefix, name: uploadLabel(b.kind), kind: b.kind, size: b.size_mb, requested: false,
      trigger: `Every ${num(dr.background_every_s)} s`,
      t: mine[0]?.created_t ?? null, d: mine[0]?.created_d ?? null,
      extra: run ? `${mine.length} chunks, ${fmtMB(mine.reduce((a, u) => a + u.size_mb, 0))} in this run` : undefined,
    });
  }
  const reqTotal = rows.filter((r) => r.requested).reduce((a, r) => a + r.size, 0);
  const bgTotal = bg.reduce((a, u) => a + u.size_mb, 0);

  return (
    <div className={s.stack}>
      <div className={s.tableWrap}>
        <table className={`${s.table} ${s.uploadTable}`}>
          <caption className="sr-only">Uploads the mission requests</caption>
          <thead>
            <tr>
              <th scope="col">Upload</th>
              <th scope="col" className="num">Size <Badge kind="assumption" /></th>
              <th scope="col">Who asks</th>
              <th scope="col">When it is asked for</th>
              <th scope="col">Operator is</th>
              <th scope="col">Created, seed {seed}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const man = run && r.t !== null && r.requested ? manoeuvreAt(run, r.t) : null;
              return (
                <tr key={r.key}>
                  <th scope="row" title={r.key}>{r.name}</th>
                  <td className="num">{fmtMB(r.size)}</td>
                  <td>{r.requested ? "Operator, urgent" : "Vehicle, background"}</td>
                  <td>{r.trigger}</td>
                  <td>{man ? manoeuvreLabel(man) : r.requested ? <span className={s.muted}>{run ? "Not reached" : "Loading"}</span> : <span className={s.muted}>Any</span>}</td>
                  <td className={s.whenCell}>
                    {r.t !== null ? (
                      <span className={s.when}>
                        <span className={s.numTxt}>{r.requested ? fmtClock(r.t) : `From ${fmtClockShort(r.t)}`}</span>
                        <span className={s.sub}>{r.extra ?? fmtKm(r.d)}</span>
                        <Button variant="quiet" className={s.replayBtn} onClick={() => showInReplay({ t: r.t! })}
                          aria-label={`Show ${r.name.toLowerCase()} in replay at ${fmtClock(r.t)}`}>Show in replay</Button>
                      </span>
                    ) : <span className={s.muted}>{run ? "Not created" : "Loading"}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="caption">
        Requested by the operator: {fmtMB(reqTotal)} in total.
        {run ? ` Background in seed ${seed}: ${fmtMB(bgTotal)} queued over the mission.` : ""} Sizes are assumptions (A): 1 MB = 8,000 kbit.
      </p>
    </div>
  );
}
