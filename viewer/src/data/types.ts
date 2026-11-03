/**
 * Data contract for the simulation viewer.
 *
 * AUTHORITATIVE: these types match exactly what `edge_mlc/sim/export_viewer.py`
 * writes into `viewer/public/data/` (copied to `dist/data/` by Vite). Data is not
 * fetched: each file is a classic <script> that assigns a global, so the built app
 * also works from file://.
 *
 *   data/manifest.js   -> window.SIM_MANIFEST = {...}
 *   data/scenario.js   -> window.SIM_SCENARIO = {...}
 *   data/results.js    -> window.SIM_RESULTS  = {...}
 *   data/runs/<id>.js  -> (window.SIM_RUNS = window.SIM_RUNS || {})["<id>"] = {...}
 *
 * Conventions used throughout
 *  - Run files are COLUMNAR: a block is an object of equal-length arrays; index i of
 *    every array in a block refers to the same instant.
 *  - Booleans are encoded as 0 | 1 (type `Bit`).
 *  - String-valued fields are integer codes into `RunData.enums[<enum name>]`; -1 means
 *    "none" (null in the simulator). Codes are PER RUN (some enums are built in
 *    first-seen order), so always decode with the run's own `enums`.
 *  - Link fields are an index into `RunMeta.links` (["radio","starlink","lte"]), -1 = none.
 *  - Link LISTS (ordered, first = primary) are codes into `enums.linkset`, whose entries
 *    are arrays of link indices, e.g. [1, 2] = ["starlink", "lte"].
 *  - Rounding: t 2 dp, d 4 dp, kbps integer, loss 4 dp (measured 3 dp), true RTT 1 dp,
 *    measured RTT integer, ages 2 dp, signals integer dBm. Integral values are written
 *    without a decimal point.
 *  - Time t is simulation seconds from mission start; position d is km along the route
 *    (0 = base, 3.0 = inspection site; the return leg runs back down to 1.4 km).
 */

// ------------------------------------------------------------------ primitives

/** Boolean encoded as 0 (false) or 1 (true). */
export type Bit = 0 | 1;
/** Index into `RunMeta.links`; -1 = no link. */
export type LinkIdx = number;
/** Code into one of `RunData.enums`; -1 = none / null. */
export type Code = number;
/** Link names as configured, in preference order (first = preferred). */
export type LinkName = "radio" | "starlink" | "lte";
export type CamName = "front" | "rear";
/** True manoeuvre of the driver script (scoring) and Proposed's detected mode. */
export type Manoeuvre = "DRIVE" | "REVERSE" | "PRECISION" | "STOPPED";
/** Plan mode string: a Manoeuvre for Proposed/oracles, "FIXED" for "Proposed - mission", "N/A" for Baseline. */
export type PlanMode = Manoeuvre | "FIXED" | "N/A" | "HIDE";
/** Graded predictive action on a protected stream (Proposed only). */
export type Action = "NORMAL" | "PREPARE" | "DUPLICATE" | "SWITCH";
export type DriverState =
  | "START" | "CRUISE_OUT" | "CRATER_APPROACH" | "CRATER_STOP1" | "CRATER_REVERSE"
  | "CRATER_STOP2" | "CRATER_TURN" | "CRUISE_TO_ZONE" | "CONTESTED_OUT" | "CRUISE_TO_SITE"
  | "INSPECT" | "TURN_AROUND" | "RETURN" | "END";
export type SegmentName =
  | "leave base" | "radio edge" | "transit" | "crater" | "contested out"
  | "inspection" | "contested back" | "transit back" | "radio back";
export type DeciderKind = "baseline" | "proposed" | "oracle";
/** A table cell from a results CSV (NaN/empty -> null). */
export type Cell = number | string | null;

// ------------------------------------------------------------------ shared config tables

/** One rung of the MJPEG video quality ladder (index = level 0..5). */
export interface LadderLevel {
  /** "PAUSED" | "TRICKLE" | "L2" | "L3" | "L4" | "L5". */
  name: string;
  /** Frame width, px (0 when paused). */
  w: number;
  /** Frame height, px. */
  h: number;
  /** Frames per second. */
  fps: number;
  /** JPEG quality (0-100). */
  q: number;
  /** Bit rate, kbit/s. */
  kbps: number;
}

/** Operator usability requirement for one TRUE manoeuvre (used only for scoring). */
export interface Requirement {
  /** Camera that must be usable ("protected" camera). */
  cam: CamName;
  /** Newest frame must be at most this old, s. */
  max_age_s: number;
  /** Frames that arrived in the last 1 s must be at least this many. */
  min_fps: number;
  /** Frame width must be at least this, px. */
  min_w: number;
}

/** One camera's need in one mode (Proposed's needs table, config `modes`). */
export interface StreamNeed {
  /** Priority, 1 = protected (highest). 9 = hidden. */
  prio: number;
  /** Allowed ladder levels, lowest = minimum useful. [0] = off. */
  levels: number[];
  /** Max RTT for this stream in this mode, ms (absent -> 600 used). */
  max_rtt_ms?: number;
  /** Max loss fraction (0-1) (absent -> 0.2 used). */
  max_loss?: number;
}
/** mode -> camera -> need. Keys: DRIVE, PRECISION, REVERSE, STOPPED, HIDE. */
export type ModesTable = Record<string, Partial<Record<CamName, StreamNeed>>>;

/** Fixed per-traffic limits shared by both deciders. */
export interface Limits {
  cmd: { /** ms */ max_rtt_ms: number; /** fraction 0-1 */ max_loss: number };
  video: { /** ms */ max_rtt_ms: number; /** fraction 0-1 */ max_loss: number };
}

/** A link as configured (config/sim_themis.yaml `links`). */
export interface LinkConfig {
  name: LinkName;
  id: number;
  /** Nominal uplink capacity, kbit/s. */
  nominal_kbps: number;
  /** Signal below which the link is unusable, dBm (radio) / RSRP dBm (lte). Absent for Starlink. */
  signal_unusable?: number;
  /** Starlink only: known satellite handover schedule. */
  handover_schedule?: { period_s: number; offsets_s: number[]; pre_s: number; post_s: number };
}

// ================================================================== manifest.js

export interface ManifestRun {
  /** Run id, `<config slug>__<variant>__s<seed>`, e.g. "proposed__nominal__s0". Key in window.SIM_RUNS. */
  id: string;
  /** Config name as in run_experiments.CONFIGS, e.g. "Baseline", "Proposed (urgent_first)". */
  config: string;
  decider: DeciderKind;
  /** Scenario variant, key of SIM_SCENARIO.variants. */
  variant: string;
  seed: number;
  /** Script path relative to index.html, e.g. "data/runs/proposed__nominal__s0.js". */
  file: string;
  /** File size, bytes. */
  bytes: number;
  /** Mission duration (or time at the 40 min hard stop), s. */
  mission_time_s: number;
  /** Mission reached its end point (1.4 km on the return leg). */
  completed: boolean;
  /** Share of time (t >= 3 s) the protected camera met the operator requirements, %. */
  useful_view_pct: number;
  /** Number of times the protected view stopped being useful. */
  interruptions: number;
  /** 95th percentile video frame delay while bulk data was sent, ms (null if none). */
  video_delay_p95_bulk_ms: number | null;
}

export interface ManifestPair {
  variant: string;
  seed: number;
  /** Run id of "Baseline" for this variant+seed, or null. */
  baseline: string | null;
  /** Run id of "Proposed" for this variant+seed, or null. */
  proposed: string | null;
  /** Ids of the other configs exported for this variant+seed. */
  others: string[];
}

export interface ManifestDemo {
  variant: string;
  seed: number;
  /** Seeds the choice was made from. */
  n_seeds: number;
  /** z-score distance from the mean (lower = more typical). */
  distance: number;
  /** Plain-language selection rule. */
  rule: string;
  /** This seed's values, keyed "<config>:<metric>". */
  values: Record<string, number>;
  /** Mean over n_seeds, same keys. */
  means: Record<string, number>;
}

export interface Manifest {
  /** Format version (currently 1). */
  format: number;
  /** All exported runs, ordered by variant, seed, config. */
  runs: ManifestRun[];
  /** Config names present, in CONFIGS order. */
  configs: string[];
  /** Variant names present, in scenario.VARIANTS order. */
  variants: string[];
  /** Seeds exported. */
  seeds: number[];
  /** Baseline/Proposed pairing per variant+seed (for side-by-side compare). */
  pairs: ManifestPair[];
  /** Demo seed chosen by the exporter (typical_seed in export_viewer.py): the nominal
   *  seed whose Baseline and Proposed results are jointly closest to the mean; null
   *  when results.runs was unavailable. Always exported. Never the best case. */
  demo: ManifestDemo | null;
  generated: {
    /** Local ISO timestamp of the export. */
    at: string;
    /** Script that wrote the data. */
    by: string;
    /** CLI arguments used. */
    argv: string[];
    /** Results directory used for results.js, relative to edge_mlc/ ("results" or "results_run"). */
    results_dir: string;
  };
}

// ================================================================== scenario.js

/** Link ground truth vs position, one entry per `Scenario.km` point (shadowing off, t = profile_t_s). */
export interface LinkProfile {
  /** Link up (1) or down (0). */
  up: Bit[];
  /** Signal, dBm (radio) or RSRP dBm (lte), 1 dp; null when the link reports none (Starlink, 4G off). */
  sig: (number | null)[];
  /** Packet loss, fraction 0-1, 4 dp. */
  loss: number[];
  /** Round-trip time (2 x one-way delay), ms, 1 dp. */
  rtt: number[];
  /** Uplink capacity, kbit/s, integer. */
  cap: number[];
}

/** A named stretch or point of the route. Points have from_km === to_km. */
export interface Zone {
  name: string;
  from_km: number;
  to_km: number;
  /**
   * "tower" (4G tower, point) | "fade" (radio fading) | "no_radio" (radio out of range)
   * | "event" (upload requested, point) | "coverage" (cell-edge 4G) | "obstruction" (trees)
   * | "crater" | "jamming" (contested zone) | "jamming_ramp" (part of the zone where jamming
   * ramps up) | "trigger" (blackout trigger, point) | "site" (inspection, point) | "end" (mission end, point).
   */
  kind: "tower" | "fade" | "no_radio" | "event" | "coverage" | "obstruction" | "crater"
    | "jamming" | "jamming_ramp" | "trigger" | "site" | "end";
  /** One-sentence explanation for tooltips. */
  description: string;
}

/** Effective scenario parameters of a variant (scenario.DEFAULTS overlaid with the variant). */
export interface VariantParams {
  /** Chance of an outage at each Starlink handover (0-1). */
  ho_p_out: number;
  /** Outage length range at a handover, [min, max] s. */
  ho_out_s: [number, number];
  /** Jamming zone, [from, to] km (both directions). */
  jam_zone: [number, number];
  /** Distance over which jamming ramps to full strength, km. */
  jam_ramp_km: number;
  /** Jammer blackout fires the first time d >= this, km. */
  blackout_at: number;
  /** Blackout length, s (once per mission). */
  blackout_s: number;
  /** 4G exists at all. */
  lte: boolean;
  /** Cell-edge 4G along the whole route. */
  lte_route: boolean;
  /** Radio fades -65 -> -100 dBm over [from, to] km. */
  fade: [number, number];
  /** Starlink capacity while in the crater, kbit/s. */
  crater_cap: number;
  /** Scale of the Starlink + 4G modem buffers. */
  buffer_scale: number;
}

export interface VariantInfo {
  /** One-sentence description of what this variant makes harder. */
  description: string;
  /** Only the parameters this variant changes. */
  overrides: Partial<VariantParams>;
  /** All effective parameters. */
  params: VariantParams;
  /** Link truth vs position, per link. Overlap variants draw cell-edge 4G at its mean (-114 dBm). */
  profile: Record<LinkName, LinkProfile>;
  /** Starlink truth inside the crater (vehicle in a crater state), every 0.01 km 2.35-2.45. */
  crater_starlink: { km: number[]; up: Bit[]; loss: number[]; rtt: number[]; cap: number[] };
  /** Route zones and points for this variant. */
  zones: Zone[];
}

export interface DriverStateInfo {
  /** Throttle asked by the driver, -1..1 (negative = reverse). */
  throttle: number;
  /** Steering sine amplitude, -1..1. */
  steer_amp: number;
  /** Steering offset, -1..1. */
  steer_offset: number;
  /** TRUE manoeuvre label used for scoring. */
  manoeuvre: Manoeuvre;
}

export interface Scenario {
  format: number;
  /** Positions of the profile samples, km: 0.00, 0.01, ... 3.05 (306 points). */
  km: number[];
  /** Time used for the profiles, s (5.0: no Starlink handover, no congestion burst). */
  profile_t_s: number;
  /** Link names in preference order. */
  links: LinkName[];
  link_config: LinkConfig[];
  ladder: LadderLevel[];
  limits: Limits;
  requirements: Record<Manoeuvre, Requirement>;
  modes: ModesTable;
  /** Every scenario variant (nominal, harsh_handovers, heavy_jamming, no_lte, fast_fade, overlap, overlap_harsh). */
  variants: Record<string, VariantInfo>;
  /**
   * config/sim_themis.yaml `timing`, `baseline`, `proposed` and `uploads` blocks (decider
   * thresholds). Optional: data exported before this field existed does not have it.
   */
  decider_params?: {
    timing: Record<string, number>;
    baseline: Record<string, number>;
    proposed: Record<string, number | number[]>;
    uploads: Record<string, number>;
  };
  /** Starlink handovers (time-driven, independent of position). */
  starlink_handover: {
    /** s */ period_s: number;
    /** Seconds within each minute: [12, 27, 42, 57]. */
    offsets_s: number[];
    /** Proposed duplicates from pre_s before ... */ pre_s: number;
    /** ... to post_s after each handover, s. */ post_s: number;
    /** Extra RTT at every handover, ms. */ extra_rtt_ms: number;
    /** For this long, s. */ extra_for_s: number;
    /** One gateway congestion burst (all seeds). */
    congestion_burst: { /** s */ from_s: number; /** s */ to_s: number; /** ms */ extra_rtt_ms: number };
  };
  driver: {
    /** State machine table (scenario.Driver.OUT). */
    states: Record<DriverState, DriverStateInfo>;
    crater_states: DriverState[];
    /** Uploads requested on entering a state. */
    events: Record<string, { id: string; kind: string; /** MB */ size_mb: number; requested: boolean }[]>;
    /** [from, to, condition] (documentation copy of Driver._next). */
    transitions: [DriverState, DriverState, string][];
    /** Background chunks are queued every this many s. */
    background_every_s: number;
    background_items: { prefix: string; kind: string; /** MB */ size_mb: number }[];
    /** One-shot requested scan while driving outbound. */
    scan_drive: { id: string; kind: string; /** MB */ size_mb: number; /** km */ at_km: number };
  };
  /** Scoring segments. dir "out"/"back" = by position on that leg; "state" = by driver state. */
  segments: { name: SegmentName; dir: "out" | "back" | "state"; from_km: number; to_km: number; note?: string }[];
  constants: {
    /** Speed at full throttle, m/s. */ VMAX_mps: number;
    /** A view is "live" if its newest frame is younger than this, s. */ FRESH_S: number;
    /** ESP32 stops without a fresh command for this long, s. */ FAILSAFE_S: number;
    /** Lost-link creep speed, m/s. */ CREEP_MPS: number;
    /** Creep starts after no executed command for this long, s. */ CREEP_AFTER_S: number;
    /** Commands + telemetry, kbit/s. */ TELEM_KBPS: number;
    /** Hub <-> operator delay, ms. */ HUB_TO_OP_MS: number;
    /** Hard stop of the simulation, s. */ T_MAX_S: number;
  };
}

// ================================================================== results.js

/** A CSV as a table: rows[i][j] is the value of columns[j]. */
export interface Table {
  columns: string[];
  rows: Cell[][];
}

export interface Results {
  format: number;
  /** Directory the CSVs came from, relative to edge_mlc/ ("results_run" if complete, else "results"). */
  source_dir: string;
  /**
   * Mean and 95% CI per config x variant. Columns: config, variant, n, then for every
   * metric `<m>` and `<m>_ci` (see RunMetrics for metric names/units).
   */
  summary: Table | null;
  /** Crater capacity sweep: config, crater_cap (kbit/s), n, metrics + _ci. */
  capacity: Table | null;
  /** Modem buffer sensitivity: config, buffer_ms (Starlink buffer, ms), n, metrics + _ci. */
  buffer: Table | null;
  /** One row per run: config, variant, seed, metrics (as RunMetrics). */
  runs: Table | null;
  /** Seeds per nominal config. */
  n_seeds: number;
  /** Seeds per variant. */
  n_seeds_by_variant: Record<string, number>;
}

// ================================================================== runs/<id>.js

export interface RunMeta {
  /** Format version (currently 1). */
  format: number;
  id: string;
  /** Config name, e.g. "Proposed". */
  config: string;
  decider: DeciderKind;
  /** Decider class name: "baseline" | "proposed" | "oracle_link" | "oracle_all_up". */
  decider_name: string;
  /** Config options, e.g. {"dup_video": true}, {"policy": "urgent_first"}, {"mission": false}. */
  options: Record<string, unknown>;
  variant: string;
  seed: number;
  /** Sample period of `samples`/`cams`/`truth`, s (0.1). */
  dt: number;
  /** Decision period of `decisions`, s (0.1). */
  decide_dt: number;
  /** Link names; LinkIdx indexes this. ["radio", "starlink", "lte"]. */
  links: LinkName[];
  /** ["front", "rear"]. */
  cams: CamName[];
  ladder: LadderLevel[];
  requirements: Record<Manoeuvre, Requirement>;
  modes: ModesTable;
  limits: Limits;
  segments: SegmentName[];
  /** Mission duration, s. */
  mission_time_s: number;
  /** Reached the end point (else hit the 40 min hard stop). */
  completed: boolean;
  /** Length of every `samples`/`cams`/`truth` array. */
  n_samples: number;
  /** Length of every `decisions.cols`/`decisions.measured` array. */
  n_decisions: number;
}

/** Per-run string tables. Decode codes as enums.<name>[code]; -1 = none. */
export interface RunEnums {
  /** Driver states (samples.state, state_changes). */
  state: DriverState[];
  /** TRUE manoeuvres (samples.man). */
  man: Manoeuvre[];
  /** Scoring segments (samples.seg). */
  seg: SegmentName[];
  /** Plan modes (samples.mode, decisions.cols.mode), first-seen order. */
  mode: PlanMode[];
  /** Upload ids (samples.bulk_item, decisions.cols.bulk_item); index i === uploads[i]. */
  upload: string[];
  /** Ordered link lists as arrays of LinkIdx (first = primary); [] = no link. */
  linkset: number[][];
  /** Proposed actions (decisions.cols.<cam>_action). */
  action: Action[];
  /** Bulk modes (decisions.cols.bulk_mode): "rate" (shaped) | "greedy" (TCP-like). */
  bulk_mode: ("rate" | "greedy")[];
  /** Cameras (samples.prot). */
  cam: CamName[];
}

/** Vehicle + scoring state every 0.1 s (engine sample grid, starts at t = 0.15). */
export interface Samples {
  /** Time, s. */
  t: number[];
  /** Position along the route, km (0 = base). */
  d: number[];
  /** Direction: +1 outbound, -1 return leg. */
  dir: (1 | -1)[];
  /** Driver state, code into enums.state. */
  state: Code[];
  /** Scoring segment, code into enums.seg; -1 = between segments. */
  seg: Code[];
  /** TRUE manoeuvre (driver script), code into enums.man. */
  man: Code[];
  /** Protected camera for the true manoeuvre (requirements.cam), code into enums.cam. */
  prot: Code[];
  /** Vehicle is in one of the crater states (Starlink obstructed). */
  crater: Bit[];
  /** Speed, m/s (absolute). */
  v: number[];
  /** Throttle the driver asked for, -1..1. */
  thr_int: number[];
  /** Throttle the vehicle executes (0 while in failsafe), -1..1. */
  thr_exec: number[];
  /** ESP32 failsafe active (no fresh command for 0.5 s). */
  fs: Bit[];
  /** Lost-link creep active (no command executed for 3 s). */
  creep: Bit[];
  /** Time since the vehicle last executed a command, s (capped at 99). */
  cmd_age: number[];
  /** Protected view meets the operator requirements for the true manoeuvre (the headline metric). */
  useful: Bit[];
  /** Protected view is "live": newest frame < 0.5 s old and level >= 2. */
  live: Bit[];
  /** Frames of the protected camera that arrived in the last 1 s. */
  fps: number[];
  /** Ladder level of the protected camera's newest frame (0 if older than max_age_s). */
  level: number[];
  /** Primary link the plan sends the protected camera on, LinkIdx (-1 = none). */
  link: LinkIdx[];
  /** Protected camera is sent on more than one link (duplicated). */
  dup: Bit[];
  /** Plan mode in effect, code into enums.mode. */
  mode: Code[];
  /** Command links in effect, code into enums.linkset (first carries telemetry). */
  cmd: Code[];
  /** Fast heartbeats (20 Hz) in effect. */
  hb_fast: Bit[];
  /** Bulk data was being sent at this instant. */
  bulk: Bit[];
  /** Upload being sent, code into enums.upload; -1 = none. */
  bulk_item: Code[];
  /** Bulk rate for a REQUESTED item, kbit/s. */
  bulk_req_kbps: number[];
  /** Bulk rate for a BACKGROUND item, kbit/s. */
  bulk_bg_kbps: number[];
  /** Requested uploads still to deliver, MB (1 dp). */
  upq_req_mb: number[];
  /** Background uploads still to deliver, MB (1 dp). */
  upq_bg_mb: number[];
}

/** Per-camera view at the operator and the camera's current target, on the sample grid. */
export interface CamSeries {
  /** Age of the newest frame at the operator, s (capped at 99 = never received). */
  age: number[];
  /** Ladder level of the newest received frame (not zeroed when old). */
  vlevel: number[];
  /** Frames that arrived in the last 1 s. */
  fps: number[];
  /** Links the camera is currently sent on, code into enums.linkset (ordered, first = primary). */
  tgt: Code[];
  /** Target ladder level (0 = paused). */
  tlevel: number[];
  /** Worst capture-to-display delay of frames that arrived since the previous sample, ms; null = none arrived. */
  lat: (number | null)[];
}

/** Ground truth of one link along this run's trajectory, on the sample grid. */
export interface TruthSeries {
  /** Link truly up. */
  up: Bit[];
  /** True uplink capacity, kbit/s. */
  cap: number[];
  /** True packet loss, fraction 0-1, 4 dp. */
  loss: number[];
  /** True RTT (2 x one-way delay, without queueing), ms, 1 dp. */
  rtt: number[];
  /** True signal, dBm (radio) / RSRP dBm (lte), integer; null when down. Whole column null for Starlink (or 4G in no_lte). */
  sig: (number | null)[] | null;
  /** Modem queue delay = backlog / capacity, ms (integer). */
  qd: number[];
  /** Offered load on this link: commands/telemetry + video targets + bulk, kbit/s. */
  tx: number[];
}

/** The plan returned by each decide() call (10 Hz). Arrays have length meta.n_decisions. */
export interface DecisionCols {
  /** Time of the decision, s (0.1, 0.2, ...; a sample at t follows the decision at t - 0.05). */
  t: number[];
  /** Plan mode, code into enums.mode ("N/A" for Baseline). */
  mode: Code[];
  /** Command links, code into enums.linkset. */
  cmd: Code[];
  /** Fast heartbeats requested (Proposed: any action other than NORMAL). */
  hb_fast: Bit[];
  /** Link for bulk uploads, LinkIdx; -1 = no bulk plan. */
  bulk_link: LinkIdx[];
  /** Bulk mode, code into enums.bulk_mode; -1 = no bulk plan. */
  bulk_mode: Code[];
  /** Bulk rate budget, kbit/s; null = no bulk plan or greedy. */
  bulk_rate: (number | null)[];
  /** Upload the plan names, code into enums.upload; -1 = none (or greedy FIFO). */
  bulk_item: Code[];
  /** Front camera links, code into enums.linkset (ordered; 2 entries = duplicated). */
  front_links: Code[];
  /** Front camera ladder level. */
  front_level: number[];
  /** Front camera predictive action, code into enums.action; -1 = none (Baseline, or not protected). */
  front_action: Code[];
  /** Rear camera links, code into enums.linkset. */
  rear_links: Code[];
  /** Rear camera ladder level. */
  rear_level: number[];
  /** Rear camera predictive action, code into enums.action; -1 = none. */
  rear_action: Code[];
}

/** What the decider MEASURED for one link (common/monitor.py snapshot), per decision. */
export interface MeasuredSeries {
  /** Link considered alive (fewer than 3 heartbeats missed in a row and an echo in the last 1 s). */
  alive: Bit[];
  /** Median heartbeat RTT over the last 1 s, ms (integer); 9999 = no echo. */
  rtt: number[];
  /** 90th percentile heartbeat RTT over the last 1 s, ms (integer); 9999 = no echo. */
  rtt_p90: number[];
  /** Heartbeat loss over 3 s converted to one-way loss, fraction 0-1, 3 dp. */
  loss: number[];
  /** Capacity estimate, kbit/s (0 when not alive or no fresh report). */
  cap: number[];
  /** Measured signal as reported (radio: noisy dBm; lte: RSRP polled 1 Hz), integer; null when down. Whole column null for Starlink. */
  sig: (number | null)[] | null;
  /** Data-packet loss reported by the hub, fraction 0-1, 3 dp. */
  data_loss: number[];
}

/**
 * Step function over decision indices: value v[j] holds from decision index i[j]
 * until the next change. null = no predicted failure (infinite).
 */
export interface StepSeries {
  /** Decision indices where the value changes (first entry is 0). */
  i: number[];
  /** Value from that index on: seconds until the link becomes unusable for the stream, 1 dp; null = never. */
  v: (number | null)[];
}

export interface Decisions {
  cols: DecisionCols;
  /** Measured snapshot the decider saw, per link name. */
  measured: Record<LinkName, MeasuredSeries>;
  /**
   * Proposed only (empty {} for Baseline): predicted time until unusable, keyed
   * "<link>:<stream>" with stream = "cmd" | "front" | "rear", e.g. "starlink:front".
   */
  ttu: Partial<Record<string, StepSeries>>;
}

export interface Upload {
  /** e.g. "rec_3", "lidar_3" (background, every 60 s), "scan_drive", "lidar_crater", "still", "clip" (requested). */
  id: string;
  /** "recording" | "lidar" | "scan" | "still" | "clip". */
  kind: string;
  /** Size, MB (1 MB = 8000 kbit). */
  size_mb: number;
  /** 1 = requested by the operator (urgent), 0 = background. */
  requested: Bit;
  /** Created at, s. */
  created_t: number;
  /** Created at position, km. */
  created_d: number;
  /** Fully delivered at, s; null = not delivered by mission end. */
  done_t: number | null;
  /** Fully delivered at position, km; null = not delivered. */
  done_d: number | null;
  /** done_t - created_t, s; null = not delivered. */
  delivery_s: number | null;
  /** Delivered by mission end, MB. */
  delivered_mb: number;
}

export interface RunEvents {
  /** Jammer blackout [start s, length s]; null if never triggered. */
  blackout: [number, number] | null;
  /** Starlink handover outages of this seed up to mission end: [start s, length s][]. */
  starlink_outages: [number, number][];
}

/**
 * Full engine metrics (sim/engine.py Sim.metrics), NaN -> null. Main keys:
 * useful_view_pct (%), live_view_pct (%), interruptions (count), longest_interruption_s (s),
 * blind_m (m driven without a useful view), video_delay_p95_ms / video_delay_p95_bulk_ms (ms),
 * useful_view_pct_bulk (%), max_cmd_gap_s (s), failsafe_stops (count), failsafe_s (s),
 * switches / false_switches / pingpongs (count), dup_overhead_pct (%), total_mbit (Mbit),
 * mission_time_s (s), mission_completed (0/1), lost_link_creep_s (s), final_d_km / max_d_km (km),
 * prot_level_mean (ladder level), `useful_<segment>` (%), `<upload id>_s` (delivery s, requested items),
 * req_mean_s / req_max_s (s), bg_backlog_mb_at_end / bg_delivered_mb (MB), bulk_mbit_total (Mbit),
 * needed_fps_while_req_drive (fps), needed_level_while_req_stopped (level),
 * fps_delivered_mean_<MAN> / level_mean_<MAN> / frame_delay_p95_ms_<MAN>,
 * n_transition_events / n_trans_updown / n_trans_capacity (count), useful_transition_pct (%),
 * interruptions_transition (count), radio_leave_minus_fail_s (s; negative = left the radio
 * before it failed), qdelay_max_<link>_ms / qdelay_bulk_max_<link>_ms (ms), bulk_qdelay_over40_pct (%),
 * stale_exec (count). Values rounded to 4 dp.
 */
export type RunMetrics = Record<string, number | null>;

export interface RunData {
  meta: RunMeta;
  enums: RunEnums;
  /** Vehicle + scoring, length meta.n_samples. */
  samples: Samples;
  /** Per camera, length meta.n_samples. */
  cams: Record<CamName, CamSeries>;
  /** Ground truth per link, length meta.n_samples. */
  truth: Record<LinkName, TruthSeries>;
  /** Decider inputs and outputs, length meta.n_decisions. */
  decisions: Decisions;
  /**
   * Decider explanations as [t s, text]. Only reasons NEW at that decision (not given
   * at the decision before) are listed, so an ongoing condition appears once when it
   * starts. Baseline: link switches and quality steps; Proposed: switches, duplication,
   * predicted failures, degraded/paused cameras.
   */
  reasons: [number, string][];
  /** All upload items, in creation order (enums.upload[i] === uploads[i].id). */
  uploads: Upload[];
  /**
   * Upload progress, sampled every 1 s and only when it changed: at time t[k] (s),
   * uploads[u[k]] had mb[k] MB delivered.
   */
  upload_progress: { t: number[]; u: number[]; mb: number[] };
  /** Ground-truth link-change events used by Experiment A: [t s, "up/down" | "capacity"]. */
  transitions: [number, "up/down" | "capacity"][];
  /** Driver state changes: [t s, d km, state code into enums.state]. */
  state_changes: [number, number, Code][];
  events: RunEvents;
  metrics: RunMetrics;
}

// ================================================================== globals

declare global {
  interface Window {
    SIM_MANIFEST?: Manifest;
    SIM_SCENARIO?: Scenario;
    SIM_RESULTS?: Results;
    SIM_RUNS?: Record<string, RunData>;
  }
}
