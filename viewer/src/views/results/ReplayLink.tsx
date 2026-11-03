/**
 * "Show in replay" link (DESIGN.md 6.2): jumps to the exact variant, seed, left-console
 * configuration and moment that shows a result. The moment is computed from the trace;
 * traces load on demand (or in the background with `preload`).
 */
import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components";
import { showInReplay } from "../../state";
import { loadRun, peekRun, fmtClock, variantLabel } from "../../data/loader";
import { resolve, type Moment, type MomentSpec } from "./moments";
import s from "./Results.module.css";

const cache = new Map<string, Moment | null>();

function computeOnce(spec: MomentSpec, leftId: string | null, rightId: string | null): Moment | null | undefined {
  const key = `${spec.key}|${leftId}|${rightId}`;
  if (cache.has(key)) return cache.get(key);
  const left = peekRun(leftId) ?? null;
  const right = peekRun(rightId) ?? null;
  if ((spec.needs.includes("left") && !left) || (spec.needs.includes("right") && !right)) return undefined;
  let m: Moment | null = null;
  try { m = spec.compute({ left, right }); } catch { m = null; }
  cache.set(key, m);
  return m;
}

export function ReplayLink({ spec, preload, note }: { spec: MomentSpec; preload?: boolean; note?: string }) {
  const r = useMemo(() => resolve(spec), [spec.key, spec.variant, spec.seed, spec.cmp]); // eslint-disable-line
  const [, bump] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const ids = spec.needs.map((n) => (n === "left" ? r.leftId : r.rightId));
  const loaded = ids.every((id) => id && peekRun(id));
  const moment = loaded ? computeOnce(spec, r.leftId, r.rightId) : undefined;

  useEffect(() => {
    if (!preload || loaded || ids.some((id) => !id)) return;
    let alive = true;
    // Background load on idle so first paint of Results is not delayed.
    const go = () => Promise.all(ids.map((id) => loadRun(id!))).then(() => { if (alive) bump((x) => x + 1); }).catch(() => {});
    const h = window.setTimeout(go, 400);
    return () => { alive = false; window.clearTimeout(h); };
  }, [preload, loaded, ids.join("|")]); // eslint-disable-line

  if (r.seed === null || !r.rightId || ids.some((id) => !id)) {
    return <p className={s.replayRow}><span className={s.replayNote}>No trace for this result was exported, so it cannot be opened in Replay.</span></p>;
  }

  const where = `${spec.variant !== "nominal" ? `${variantLabel(spec.variant)}, ` : ""}seed ${r.seed}`;
  const what = moment?.what ?? spec.what;
  const label = `Show in replay: ${what}, ${where}${moment ? `, ${fmtClock(moment.t)}` : ""}`;

  const open = async () => {
    setFailed(null);
    let m = moment;
    if (m === undefined) {
      setBusy(true);
      try {
        await Promise.all(ids.map((id) => loadRun(id!)));
        m = computeOnce(spec, r.leftId, r.rightId);
      } catch (e) {
        setBusy(false);
        setFailed(e instanceof Error ? e.message : "The trace could not be loaded.");
        return;
      }
      setBusy(false);
    }
    if (!m) { setFailed(`This trace has no ${spec.what} to show.`); return; }
    showInReplay({ variant: r.variant, seed: r.seed!, t: m.t, cmp: r.cmp });
  };

  const left = r.cmpFallback ? `Left console: Baseline (${spec.cmp} has no trace for this seed).` : r.cmp !== "Baseline" ? `Left console: ${r.cmp}.` : null;
  return (
    <div className={s.replayRow}>
      <Button onClick={open} disabled={busy}>{busy ? `Loading seed ${r.seed}` : label}</Button>
      {(left || note) && <span className={s.replayNote}>{[left, note].filter(Boolean).join(" ")}</span>}
      {failed && <span className={s.replayNote} role="alert">{failed}</span>}
    </div>
  );
}
