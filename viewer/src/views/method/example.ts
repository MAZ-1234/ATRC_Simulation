/**
 * Worked example for the predictor, derived from one real run (no re-scoring: usable
 * view, truth and decisions are read from the trace as the simulator wrote them).
 *
 * Selection rule (computed, not hand-picked):
 *   1. the preferred link P = meta.links[0];
 *   2. t_fail = the first scored outbound sample in the radio-fade stretch where P truly
 *      broke the video limit (same test as engine.metrics radio_leave_minus_fail_s);
 *   3. the example = the last "predicted failure of P ... switch" decision before t_fail.
 *   Fallback when the run has no such moment: its first predicted switch or duplicate.
 */
import { bisectRight, decisionIndexAt, fmtFrac, fmtMs, linkLabel, linksOf, stepValueAt } from "../../data/loader";
import type { Action, CamName, LinkName, RunData, Scenario } from "../../data/types";
import { CODE, type DeciderParams } from "./params";
import { parseReason, type ParsedReason } from "./reasons";

export interface LogEvent {
  t: number;
  actor: "proposed" | "baseline" | "truth";
  reason: ParsedReason | null;
  /** Sentence for the list (already plain language). */
  text: string;
}

export interface WorkedExample {
  cam: CamName;
  link: LinkName;
  backup: LinkName | null;
  t: number;
  /** Decision index of the example. */
  i: number;
  d: number;
  ttu: number | null;
  speed: number;
  margin: number;
  action: Action | null;
  /** Limits of the camera's need in the detected mode. */
  req: { max_rtt_ms: number; max_loss: number };
  mode: string | null;
  measured: { sig: number | null; rtt: number; rtt_p90: number; loss: number; alive: boolean };
  signalUnusable: number | null;
  /** First moment the link truly broke the video limit (engine definition), s. */
  tFail: number | null;
  failWhy: string | null;
  /** Baseline's move of its video away from the link (null if none in the window). */
  tBase: number | null;
  baseStreak: number | null;
  window: [number, number];
  events: LogEvent[];
  /** Earlier predicted switch on the same link that was followed by a move back. */
  returnGap: { tSwitch: number; tBack: number } | null;
  /** Seconds without a usable view in the window. */
  lostS: { proposed: number; baseline: number | null };
  /** True when the example came from the selection rule; false for the fallback. */
  byRule: boolean;
}

/** The detector's speed proxy at every decision, rebuilt from the logged throttle. */
export function speedSeries(run: RunData): Float64Array {
  const C = run.decisions.cols;
  const S = run.samples;
  const out = new Float64Array(C.t.length);
  let sp = 0;
  let k = -1;
  for (let i = 0; i < C.t.length; i++) {
    const t = C.t[i];
    while (k + 1 < S.t.length && S.t[k + 1] <= t + 1e-9) k++;
    const thr = k >= 0 ? S.thr_int[k] : 0;
    sp = CODE.speedKeep * sp + CODE.speedNew * Math.abs(thr);
    out[i] = sp;
  }
  return out;
}

export function marginAt(p: DeciderParams, speed: number): number {
  return p.proposed.margin_base_s + p.proposed.margin_per_speed_s * speed + p.proposed.switch_cost_s;
}

/** Predictor.scheduled_risk for a link at a clock time. */
export function scheduledRisk(sc: Scenario, link: LinkName, clock: number): boolean {
  const sch = sc.link_config.find((l) => l.name === link)?.handover_schedule;
  if (!sch) return false;
  const s = ((clock % sch.period_s) + sch.period_s) % sch.period_s;
  const mod = (x: number) => ((x % sch.period_s) + sch.period_s) % sch.period_s;
  const toNext = Math.min(...sch.offsets_s.map((o) => mod(o - s)));
  const since = Math.min(...sch.offsets_s.map((o) => mod(s - o)));
  return toNext <= sch.pre_s || since <= sch.post_s;
}

export interface Agreement {
  match: number;
  total: number;
  /** Mismatches within 0.06 s of m, 2m or 3m (time left is logged to 0.1 s). */
  nearMargin: number;
  /** Mismatches exactly at the start or end of a scheduled handover window (float clock edge). */
  windowEdge: number;
}

/** True when a clock time sits on the boundary of a handover duplication window. */
function onWindowEdge(sc: Scenario, link: LinkName, clock: number): boolean {
  const sch = sc.link_config.find((l) => l.name === link)?.handover_schedule;
  if (!sch) return false;
  const mod = (x: number) => ((x % sch.period_s) + sch.period_s) % sch.period_s;
  const s = mod(clock);
  return sch.offsets_s.some((o) => Math.abs(mod(o - s) - sch.pre_s) < 0.011 || Math.abs(mod(s - o) - sch.post_s) < 0.011);
}

/**
 * How often the logged action matches the graded rule given the logged time-until-
 * unusable and the rebuilt margin. SWITCH decisions are skipped because the logged link
 * is already the backup there.
 */
export function actionAgreement(run: RunData, sc: Scenario, p: DeciderParams, speed: Float64Array): Agreement {
  const C = run.decisions.cols;
  let match = 0;
  let total = 0;
  let nearMargin = 0;
  let windowEdge = 0;
  for (const cam of ["front", "rear"] as const) {
    const acts = C[`${cam}_action`];
    const sets = C[`${cam}_links`];
    for (let i = 0; i < acts.length; i++) {
      const a = acts[i];
      if (a < 0) continue;
      const act = run.enums.action[a];
      if (act === "SWITCH") continue;
      const links = linksOf(run, sets[i]);
      if (links.length === 0) continue;
      const cur = links[0];
      const v = stepValueAt(run.decisions.ttu[`${cur}:${cam}`], i);
      const ttu = v === null ? Infinity : v;
      const m = marginAt(p, speed[i]);
      const exp: Action = ttu < m ? "SWITCH" : ttu < 2 * m ? "DUPLICATE"
        : scheduledRisk(sc, cur, C.t[i]) ? "DUPLICATE" : ttu < 3 * m ? "PREPARE" : "NORMAL";
      total++;
      if (exp === act) match++;
      else if ([1, 2, 3].some((q) => Math.abs(ttu - q * m) <= 0.06)) nearMargin++;
      else if (onWindowEdge(sc, cur, C.t[i])) windowEdge++;
    }
  }
  return { match, total, nearMargin, windowEdge };
}

function violates(T: RunData["truth"][LinkName], k: number, lim: { max_rtt_ms: number; max_loss: number }): string | null {
  if (!T.up[k]) return "down";
  if (T.loss[k] > lim.max_loss) return "loss";
  if (T.rtt[k] > lim.max_rtt_ms) return "rtt";
  return null;
}

/** Engine's t_fail for the preferred link (engine.metrics, radio_leave_minus_fail_s). */
export function linkFailTime(run: RunData, link: LinkName): { t: number; k: number; why: string } | null {
  const S = run.samples;
  const T = run.truth[link];
  const lim = run.meta.limits.video;
  const [a, b] = CODE.radioFadeKm;
  for (let k = 0; k < S.t.length; k++) {
    if (S.t[k] < CODE.scoreFromS - 1e-9) continue;
    if (S.dir[k] > 0 && S.d[k] > a && S.d[k] < b) {
      const why = violates(T, k, lim);
      if (why) return { t: S.t[k], k, why };
    }
  }
  return null;
}

function lostSeconds(run: RunData, t0: number, t1: number): number {
  const S = run.samples;
  let n = 0;
  for (let k = Math.max(0, bisectRight(S.t, t0)); k < S.t.length && S.t[k] <= t1; k++) {
    if (S.t[k] >= t0 && !S.useful[k]) n++;
  }
  return Math.round(n) / 10;
}

export function computeExample(run: RunData, base: RunData | null, sc: Scenario, p: DeciderParams, speed: Float64Array): WorkedExample | null {
  const pref = run.meta.links[0];
  const fail = linkFailTime(run, pref);
  const parsed = run.reasons.map(([t, raw]) => ({ t, r: parseReason(raw) }));

  let pick = fail
    ? [...parsed].reverse().find((x) => x.t <= fail.t && x.r.kind === "predict-switch" && x.r.from === pref)
    : undefined;
  const byRule = !!pick;
  if (!pick) pick = parsed.find((x) => x.r.kind === "predict-switch" || x.r.kind === "predict-duplicate");
  if (!pick || !pick.r.cam) return null;

  const cam = pick.r.cam;
  const link = pick.r.from as LinkName;
  const t = pick.t;
  const i = decisionIndexAt(run, t);
  const C = run.decisions.cols;
  const M = run.decisions.measured[link];
  const mode = run.enums.mode[C.mode[i]] ?? null;
  const need = mode ? run.meta.modes[mode]?.[cam] : undefined;
  const req = { max_rtt_ms: need?.max_rtt_ms ?? CODE.defaultMaxRttMs, max_loss: need?.max_loss ?? CODE.defaultMaxLoss };
  const actCode = C[`${cam}_action`][i];
  const ttu = stepValueAt(run.decisions.ttu[`${link}:${cam}`], i);
  const k = Math.min(i, run.samples.d.length - 1);

  // Baseline: first move of its video away from the link at or after 30 s before the example.
  let tBase: number | null = null;
  let baseStreak: number | null = null;
  if (base) {
    const bm = base.reasons.map(([bt, raw]) => ({ t: bt, r: parseReason(raw) }))
      .find((x) => x.t >= t - 30 && x.r.kind === "video-link" && x.r.from === link);
    if (bm) {
      tBase = bm.t;
      const bi = decisionIndexAt(base, bm.t);
      const BM = base.decisions.measured[link];
      const lim = base.meta.limits.video;
      let n = 0;
      for (let j = bi; j >= 0; j--) {
        if (!BM.alive[j] || BM.rtt[j] > lim.max_rtt_ms || BM.loss[j] > lim.max_loss) n++;
        else break;
      }
      baseStreak = n;
    }
  }

  // Window: from the first predictive reason on this link within 30 s before, to 15 s after the later of failure and Baseline's move.
  const firstPred = parsed.find((x) => x.t >= t - 30 && x.t <= t && x.r.cam === cam && x.r.from === link
    && (x.r.kind === "predict-switch" || x.r.kind === "predict-duplicate"));
  const t0 = Math.max(0, (firstPred?.t ?? t) - 4);
  const tEnd = Math.max(t, fail?.t ?? t, tBase ?? t) + 15;
  const t1 = Math.min(run.meta.mission_time_s, tEnd);

  // Proposed events on this camera, collapsing repeats of the same action within 2 s.
  const events: LogEvent[] = [];
  let lastKey = "";
  let lastT = -Infinity;
  for (const x of parsed) {
    if (x.t < t0 || x.t > t1 || x.r.cam !== cam) continue;
    const key = `${x.r.kind}|${x.r.from}|${x.r.to}`;
    if (key === lastKey && x.t - lastT <= 2.0) { lastT = x.t; continue; }
    lastKey = key;
    lastT = x.t;
    events.push({ t: x.t, actor: "proposed", reason: x.r, text: x.r.text });
  }
  if (fail && fail.t >= t0 && fail.t <= t1) {
    const T = run.truth[link];
    const lim = run.meta.limits.video;
    const L = linkLabel(link);
    const what = fail.why === "down" ? `${L} went down`
      : fail.why === "loss" ? `${L} loss reached ${fmtFrac(T.loss[fail.k])}, above the ${fmtFrac(lim.max_loss, 0)} video limit`
        : `${L} RTT reached ${fmtMs(T.rtt[fail.k])}, above the ${fmtMs(lim.max_rtt_ms)} video limit`;
    events.push({ t: fail.t, actor: "truth", reason: null, text: `Ground truth: ${what}.` });
  }
  if (base) {
    for (const [bt, raw] of base.reasons) {
      if (bt < t0 || bt > t1) continue;
      const r = parseReason(raw);
      if (r.kind === "video-link") events.push({ t: bt, actor: "baseline", reason: r, text: r.text });
    }
  }
  events.sort((a, b) => a.t - b.t || (a.actor === "truth" ? -1 : 1));

  // Earlier predicted switch on this link followed by a move back to it.
  let returnGap: WorkedExample["returnGap"] = null;
  const sw = parsed.filter((x) => x.t >= t0 && x.t < t && x.r.cam === cam && x.r.kind === "predict-switch" && x.r.from === link);
  for (const s0 of sw) {
    const back = parsed.find((x) => x.t > s0.t && x.t < t && x.r.cam === cam && x.r.kind === "move" && x.r.to === link);
    if (back) { returnGap = { tSwitch: s0.t, tBack: back.t }; break; }
  }

  const sp = speed[i];
  return {
    cam, link, backup: (pick.r.to as LinkName) ?? null, t, i, d: run.samples.d[k],
    ttu, speed: sp, margin: marginAt(p, sp),
    action: actCode >= 0 ? run.enums.action[actCode] : null,
    req, mode,
    measured: { sig: M.sig ? M.sig[i] : null, rtt: M.rtt[i], rtt_p90: M.rtt_p90[i], loss: M.loss[i], alive: M.alive[i] === 1 },
    signalUnusable: sc.link_config.find((l) => l.name === link)?.signal_unusable ?? null,
    tFail: fail?.t ?? null,
    failWhy: fail?.why ?? null,
    tBase, baseStreak,
    window: [t0, t1],
    events,
    returnGap,
    lostS: { proposed: lostSeconds(run, t0, t1), baseline: base ? lostSeconds(base, t0, t1) : null },
    byRule,
  };
}

/** First scheduled-handover duplication in a run (for a "Show in replay" link). */
export function firstScheduledDuplicate(run: RunData): { t: number; r: ParsedReason } | null {
  for (const [t, raw] of run.reasons) {
    const r = parseReason(raw);
    if (r.kind === "scheduled-duplicate") return { t, r };
  }
  return null;
}

/** Share of scored samples where Proposed's detected mode equals the true manoeuvre. */
export function detectorAgreement(run: RunData): { match: number; total: number } {
  const S = run.samples;
  let match = 0;
  let total = 0;
  for (let k = 0; k < S.t.length; k++) {
    if (S.t[k] < CODE.scoreFromS - 1e-9) continue;
    total++;
    if (run.enums.mode[S.mode[k]] === run.enums.man[S.man[k]]) match++;
  }
  return { match, total };
}
