/**
 * One controller console: the left (compare config, default Baseline) or the right (always
 * Proposed). DESIGN.md 6.1 (wireframe and notes), 7 (Camera tile, Decision log entry),
 * 9.1 (the camera tiles are where the boldness is spent), 9.3, 10, 6.1.2, 6.1.3.
 *
 * Top to bottom, identical on both sides so the two consoles mirror each other:
 *   title (controller colour) / front and rear camera tiles / verdict / mode seen / decisions
 *
 * Performance: the console itself never subscribes to the cursor. `Live` (tiles, verdict,
 * mode) re-renders once per sample index; each tile repaints its canvas only when a new
 * frame arrived; the log re-renders only when a new reason passes the cursor.
 */
import { memo, useEffect, useMemo, useRef } from "react";
import type { RunData } from "../../../data/types";
import { configLabel, getScenario, sampleIndexAt } from "../../../data/loader";
import { ctrlVar } from "../../../components";
import { announce, useBreakpoint, useRunPair, useStore } from "../../../state";
import { buildWorld, type World } from "./scene";
import { lastSampleT, TILE_CAMS, tileAt } from "./model";
import { CameraTile } from "./CameraTile";
import { ModeLine, Verdict } from "./Verdict";
import { DecisionLog } from "./DecisionLog";
import s from "./Console.module.css";

export interface ConsoleProps {
  /** "left": compare config (default Baseline). "right": always Proposed. */
  side: "left" | "right";
}

/** Sample index at the cursor, or -1 once the cursor is past this run's last sample. */
function useSampleIndex(run: RunData): number {
  const end = lastSampleT(run) + run.meta.dt / 2;
  return useStore((st) => (st.t > end ? -1 : sampleIndexAt(run, st.t)));
}

/**
 * Everything that follows the cursor: title row, tiles, verdict, mode seen. On compact the
 * "Mode seen" line moves into the title row (right-aligned) so the 328px row still fits the
 * three newest decisions (DESIGN.md 6.1.2).
 * DESIGN-GAP: 6.1.2 does not say where "Mode seen" goes at 1280; this is the quietest fit.
 */
const Live = memo(function Live({ run, world, config, title, inlineMode }: {
  run: RunData; world: World; config: string; title: string; inlineMode: boolean;
}) {
  const k0 = useSampleIndex(run);
  const ended = k0 < 0;
  const k = ended ? run.meta.n_samples - 1 : k0;
  const models = useMemo(() => TILE_CAMS.map((cam) => tileAt(run, k, cam, ended)), [run, k, ended]);
  const mode = <ModeLine run={run} k={k} config={config} short={inlineMode} />;
  return (
    <>
      <div className={s.head}>
        <h2 className={s.title} style={{ color: ctrlVar(config, "text") }}>{title}</h2>
        {inlineMode && mode}
      </div>
      <div className={s.tiles}>
        {models.map((m) => <CameraTile key={m.cam} run={run} world={world} model={m} config={config} />)}
      </div>
      <Verdict run={run} k={k} config={config} endedAt={ended ? run.meta.mission_time_s : null} />
      {!inlineMode && mode}
    </>
  );
});

/**
 * Last verdict pair announced, shared by both consoles' announcers: each console mounts
 * one (so announcements continue when a narrow screen shows only one console), and the
 * shared key makes sure each change is spoken once. "" = nothing seen yet (no speech).
 */
const announced = { key: "" };

/**
 * aria-live: announce the verdict pair when it changes while paused (DESIGN.md 11), e.g.
 * "Baseline view not usable. Proposed view usable."
 */
export function VerdictAnnouncer({ left, right, leftConfig, rightConfig }: {
  left: RunData; right: RunData; leftConfig: string; rightConfig: string;
}) {
  const key = useStore((st) => {
    if (st.playing) return "";
    const v = (run: RunData) => (st.t > lastSampleT(run) + run.meta.dt / 2 ? "ended" : run.samples.useful[sampleIndexAt(run, st.t)] === 1 ? "usable" : "not usable");
    return `${v(left)}|${v(right)}`;
  });
  useEffect(() => {
    if (!key || key === announced.key) return;
    const first = announced.key === "";
    announced.key = key;
    if (first) return; // do not speak on the first verdict after load
    const [l, r] = key.split("|");
    const say = (name: string, v: string) => (v === "ended" ? `${name} mission ended.` : `${name} view ${v}.`);
    announce(`${say(leftConfig, l)} ${say(rightConfig, r)}`);
  }, [key, leftConfig, rightConfig]);
  return null;
}

export function Console({ side }: ConsoleProps) {
  const pair = useRunPair();
  const bp = useBreakpoint();
  const root = useRef<HTMLElement>(null);
  const run = (side === "left" ? pair.left : pair.right) as RunData;
  const config = side === "left" ? pair.leftConfig : pair.rightConfig;
  const variant = run.meta.variant;
  const world = useMemo(() => buildWorld(variant, getScenario()?.variants?.[variant]?.zones), [variant]);
  const title = configLabel(config, run.meta.decider);

  return (
    <section ref={root} className={s.root} aria-label={`${config} console`} data-side={side}>
      <Live run={run} world={world} config={config} title={title} inlineMode={bp === "compact"} />
      <DecisionLog run={run} config={config} side={side} compact={bp !== "wide"} clamp={bp === "compact"} anchorRef={root} />
      {pair.left && pair.right && (
        <VerdictAnnouncer left={pair.left} right={pair.right} leftConfig={pair.leftConfig} rightConfig={pair.rightConfig} />
      )}
    </section>
  );
}
