/**
 * Decider parameters for the Method view.
 *
 * Most thresholds come from the exported data at runtime: link_config, ladder,
 * limits, requirements and modes (scenario.js / run meta) and constants.
 * Four config blocks are NOT exported yet by edge_mlc/sim/export_viewer.py:
 * `timing`, `baseline`, `proposed` and `uploads` from config/sim_themis.yaml.
 * Until they are (SHARED CHANGE REQUEST in the Method report: export them as
 * `scenario.decider_params`), the values below are a verbatim copy of that YAML.
 * `deciderParams()` prefers the exported block whenever it exists, and the view
 * labels which source it used.
 *
 * CODE holds constants that are written in the Python code itself (not in any
 * config); each one names the file it comes from.
 */
import type { Scenario } from "../../data/types";

export interface DeciderParams {
  timing: { loop_hz: number; hb_hz: number; hb_timeout_ms: number; cmd_hz: number };
  baseline: {
    bad_after: number; good_after: number; cam_down_loss: number; cam_up_after_s: number;
    cam_min_level: number; cam_max_level: number;
  };
  proposed: {
    headroom: number;
    reverse_thr: number; stopped_speed: number; stopped_for_s: number;
    precision_steer: number; precision_speed: number; mode_debounce_s: number;
    trend_window_s: number; trend_consistency: [number, number];
    margin_base_s: number; margin_per_speed_s: number; switch_cost_s: number;
    hold_s: number; return_stable_s: number;
  };
  uploads: { bulk_budget_share: number; queue_guard_ms: number };
}

/** Verbatim copy of edge_mlc/config/sim_themis.yaml (timing, baseline, proposed, uploads). */
const YAML_MIRROR: DeciderParams = {
  timing: { loop_hz: 10, hb_hz: 10, hb_timeout_ms: 300, cmd_hz: 20 },
  baseline: { bad_after: 3, good_after: 10, cam_down_loss: 0.02, cam_up_after_s: 2.0, cam_min_level: 2, cam_max_level: 5 },
  proposed: {
    headroom: 0.8,
    reverse_thr: -0.1, stopped_speed: 0.05, stopped_for_s: 2.0,
    precision_steer: 0.5, precision_speed: 0.4, mode_debounce_s: 0.3,
    trend_window_s: 2.0, trend_consistency: [5, 7],
    margin_base_s: 1.0, margin_per_speed_s: 1.0, switch_cost_s: 0.3,
    hold_s: 3.0, return_stable_s: 3.0,
  },
  uploads: { bulk_budget_share: 0.9, queue_guard_ms: 30 },
};

export interface ParamSource {
  params: DeciderParams;
  /** True when the values came from the exported data, false when from the YAML copy. */
  exported: boolean;
}

export function deciderParams(sc: Scenario | null): ParamSource {
  const exp = (sc as unknown as { decider_params?: Partial<DeciderParams> } | null)?.decider_params;
  if (exp && exp.timing && exp.baseline && exp.proposed && exp.uploads) {
    return { params: exp as DeciderParams, exported: true };
  }
  return { params: YAML_MIRROR, exported: false };
}

/** Constants written in the Python code (not config). */
export const CODE = {
  /** deciders/proposed.py ModeDetector: speed = 0.8 * speed + 0.2 * |thr|. */
  speedKeep: 0.8,
  speedNew: 0.2,
  /** proposed.py: reverse counts only within this long after a stop, s. */
  reverseAfterStopS: 1.5,
  /** proposed.py Predictor: at least this many readings before a trend is computed. */
  trendMinReadings: 8,
  /** proposed.py Predictor: moving-average width used to smooth readings. */
  trendSmooth: 3,
  /** proposed.py: limits used when a mode's need has no max_rtt_ms / max_loss. */
  defaultMaxRttMs: 600,
  defaultMaxLoss: 0.2,
  /** sim/engine.py: fast heartbeat period while any action is not NORMAL, s (20 Hz). */
  fastHbPeriodS: 0.05,
  /** sim/engine.py: hub delivery reports every this many s. */
  reportPeriodS: 0.2,
  /** common/monitor.py windows, s. */
  rttWindowS: 1.0,
  lossWindowS: 3.0,
  minRttWindowS: 10.0,
  /** common/monitor.py: a link is dead after this many heartbeats missed in a row. */
  deadAfterMisses: 3,
  /** common/monitor.py capacity estimator (AIMD with a queue check). */
  aimd: {
    startShare: 0.5, floorKbps: 50, lossCut: 0.05, cutShare: 0.5, cutDelivered: 0.85,
    queueHighMs: 80, queueUseShare: 0.5, queueHold: 0.9, queueLowMs: 30,
    busyShare: 0.7, probeStep: 0.05, driftStep: 0.0025,
  },
  /** sim/engine.py metrics: samples before this are not scored, s. */
  scoreFromS: 3.0,
  /** sim/engine.py metrics: radio_leave_minus_fail_s looks at the outbound leg between these km. */
  radioFadeKm: [1.0, 1.7] as [number, number],
  /** deciders/proposed.py FIXED_NEEDS (mission awareness off): both cameras L2-L5 at these limits. */
  fixedNeeds: { lo: 2, hi: 5, maxRttMs: 300, maxLoss: 0.05 },
  /** sim/engine.py: scoring sample period, s; "live" needs this ladder level or higher. */
  sampleDtS: 0.1,
  liveMinLevel: 2,
  /** sim/oracles.py OracleLinkChoice look-ahead, s. */
  oracleLookS: 0.5,
} as const;

/** Source file names quoted in captions. */
export const SRC = {
  config: "edge_mlc/config/sim_themis.yaml",
  baseline: "edge_mlc/deciders/baseline.py",
  proposed: "edge_mlc/deciders/proposed.py",
  monitor: "edge_mlc/common/monitor.py",
  engine: "edge_mlc/sim/engine.py",
  oracles: "edge_mlc/sim/oracles.py",
} as const;
