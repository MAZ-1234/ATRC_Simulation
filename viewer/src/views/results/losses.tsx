/**
 * "Where Proposed does not win" (DESIGN.md 6.2.1). Same block, same chart sizes and the
 * same type as the Headline: the losses carry equal weight. Content follows
 * edge_mlc/RESULTS.md "Where the proposed design does not win", but every sentence is a
 * template filled from results.js, and further items are generated wherever an ablation
 * beats Proposed with non-overlapping 95% intervals.
 */
import { useMemo } from "react";
import { configLabel, fmtNum, fmtMB, fmtRate, getScenario, variantLabel } from "../../data/loader";
import { Block } from "./Block";
import { DotFacets, facet, type DotRow } from "./DotFacets";
import { LossMatrix } from "./LossMatrix";
import { ReplayLink } from "./ReplayLink";
import { c, lc, textOf, type Parts } from "./prose";
import {
  sm, has, compare, pctPair, fpair, def, scopeOf, nOf, scanLosses, sourceInfo, SCAN, type Loss,
} from "./data";
import {
  ABLATION, Adaptive, ENGINE_NOTE, adaptive, caption, configRows, marksFor, minN, policyRows, urgentFirst, videoFirst,
} from "./blocks";
import {
  longestDivergence, longestNeither, missionEnd, uploadRequested, worstDelayWhileUploading, type MomentSpec, type Pair, type Moment,
} from "./moments";
import { computeChapters } from "../../data/events";
import s from "./Results.module.css";

/** Radio-lost chapter (the first predicted failure on the route), opened 5 s before. */
function radioLostMoment(p: Pair): Moment | null {
  const run = p.right ?? p.left;
  if (!run) return null;
  const ch = computeChapters(run).find((x) => x.index === 0);
  return ch ? { t: ch.seekT, what: "the radio fading behind the ridge" } : null;
}

const lowerSay = (better: "higher" | "lower", aBetter: boolean, hi: string, lo: string) =>
  (better === "higher") === aBetter ? hi : lo;

// ------------------------------------------------------------------ every comparison

function EveryComparison({ variant }: { variant: string }) {
  const scan = useMemo(() => scanLosses(variant), [variant]);
  const clear = scan.losses.filter((l) => l.outcome === "clear");
  const claim: Parts = [`On the ${lc(variantLabel(variant))} mission, another deployable configuration has a better mean than `, c("Proposed"),
    ` in ${scan.losses.length} of ${scan.compared} comparisons.`];
  const detail: Parts = [];
  if (clear.length === 0) detail.push("In none of them do the 95% intervals separate.");
  else {
    detail.push(`In ${clear.length} the 95% intervals do not overlap: `);
    const byCfg = new Map<string, Loss[]>();
    clear.forEach((l) => byCfg.set(l.config, [...(byCfg.get(l.config) ?? []), l]));
    Array.from(byCfg.entries()).forEach(([cfg, ls], i, arr) => {
      detail.push(c(cfg), ` on ${ls.map((l) => SCAN.find((m) => m.key === l.metric)!.short.toLowerCase()).join(" and ")}`);
      detail.push(i === arr.length - 1 ? "." : i === arr.length - 2 ? "; and " : "; ");
    });
  }
  const n = nOf("Proposed", variant);
  const spec: MomentSpec = useMemo(() => ({
    key: "notwin-matrix", variant, needs: ["left", "right"], what: "the longest stretch only Baseline could see",
    compute: (p) => longestDivergence(p, "left", "the longest stretch only Baseline could see") ?? longestNeither(p, "the longest stretch neither could see"),
  }), [variant]);
  return (
    <Block id="notwin-matrix" level={3} title="Every comparison" scope={scopeOf(variant)} claim={claim} detail={detail}
      chart={<LossMatrix variant={variant} title="Where each configuration's mean beats Proposed's" ariaLabel={textOf(claim)}
        caption={`Each cell compares two means and their 95% CIs, n = ${n ?? "–"} seeds each. Oracles are left out: they read ground truth. Hover a cell for both values. ${ENGINE_NOTE} Source: ${sourceInfo().dir}/summary.csv.`} />}
      caveat={<>a better mean with overlapping intervals may be noise at n = {n ?? "–"}; every such cell is still marked and listed in the data table.</>}
      replay={<ReplayLink spec={spec} preload />}
    />
  );
}

// ------------------------------------------------------------------ 1. adaptive vs video-first

function AdaptiveVsVideoFirst({ variant }: { variant: string }) {
  const rows = useMemo<DotRow[]>(() => policyRows(variant).filter((r) => r.config !== "Proposed (urgent_first)"), [variant]);
  const facets = useMemo(() => [facet("useful_view_pct"), facet("interruptions"), facet("req_mean_s")], []);
  const V = sm("Proposed - uploads", variant, "useful_view_pct"), A = sm("Proposed", variant, "useful_view_pct");
  const Vi = sm("Proposed - uploads", variant, "interruptions"), Ai = sm("Proposed", variant, "interruptions");
  const u = compare(V, A, "higher"), i = compare(Vi, Ai, "lower");
  const [vu, au] = fpair("useful_view_pct", V.mean, A.mean);
  const [vi, ai] = fpair("interruptions", Vi.mean, Ai.mean);
  const claim: Parts = [videoFirst(true), ` has ${u.aBetter ? "more" : "less"} usable view than `, adaptive(), ` (${vu} against ${au}) and ${i.aBetter ? "fewer" : "more"} interruptions (${vi} against ${ai}).`];
  const detail: Parts = [];
  detail.push(u.clear || i.clear
    ? `The 95% intervals ${u.clear && i.clear ? "do not overlap on either" : `do not overlap on ${u.clear ? "usable view" : "interruptions"}`}. `
    : "The 95% intervals overlap on both. ");
  const Ar = sm("Proposed", variant, "req_mean_s"), Vr = sm("Proposed - uploads", variant, "req_mean_s");
  const [ar, vr] = fpair("req_mean_s", Ar.mean, Vr.mean);
  if (compare(Ar, Vr, "lower").aBetter) detail.push("What ", adaptive(), ` buys is upload time: requested uploads arrive in ${ar} on average, against ${vr}.`);
  else detail.push("Requested uploads are not faster with ", adaptive(), ` either: ${ar} against ${vr}.`);
  const n = minN(nOf("Proposed", variant), nOf("Proposed - uploads", variant));
  const spec: MomentSpec = useMemo(() => ({
    key: "notwin-videofirst", variant, cmp: "Proposed - uploads", needs: ["right"], what: "the crater scan request",
    compute: uploadRequested("lidar_crater", "the crater scan request"),
  }), [variant]);
  return (
    <Block id="notwin-videofirst" level={3} title="Adaptive uploads against video-first" scope={scopeOf(variant)} claim={claim} detail={detail}
      chart={<DotFacets title="Usable view, interruptions and upload time by upload policy" cols={3} rows={rows} facets={facets}
        marks={marksFor(variant)} n={n} rowHeader="Upload policy" labelWidth={176} ariaLabel={textOf(claim)} caption={caption(n, ENGINE_NOTE)} />}
      caveat={<>video-first is Proposed with adaptive upload scheduling switched off; both policies behave the same while driving or reversing and differ only while stopped or in precision manoeuvres (deciders/proposed.py).</>}
      replay={<ReplayLink spec={spec} preload />}
    />
  );
}

// ------------------------------------------------------------------ 2. prediction's small effect

function PredictionEffect({ variant }: { variant: string }) {
  const rows = useMemo(() => configRows(["Proposed - predict", "Proposed"].filter((x) => has(x, variant))), [variant]);
  const facets = useMemo(() => [facet("useful_view_pct"), facet("interruptions"), facet("interruptions_transition")], []);
  const Q = sm("Proposed - predict", variant, "useful_view_pct"), P = sm("Proposed", variant, "useful_view_pct");
  const [qq, pp] = pctPair(Q.mean, P.mean);
  const d = Q.mean !== null && P.mean !== null ? Math.abs(P.mean - Q.mean) : null;
  const dDp = d !== null && d < 0.1 ? 2 : 1;
  const claim: Parts = [`Without predictive switching, usable view is ${qq} against `, c("Proposed"), `'s ${pp}: a difference of ${fmtNum(d, dDp)} points.`];
  const detail: Parts = [];
  const cu = compare(P, Q, "higher");
  detail.push(`The 95% intervals ${cu.clear ? "do not overlap" : "overlap"}. `);
  const Pi = sm("Proposed", variant, "interruptions"), Qi = sm("Proposed - predict", variant, "interruptions");
  const [pi, qi] = fpair("interruptions", Pi.mean, Qi.mean);
  const ci = compare(Pi, Qi, "lower");
  detail.push(`In interruptions it is ${pi} with prediction and ${qi} without (intervals ${ci.clear ? "do not overlap" : "overlap"}). `);
  const Pt = sm("Proposed", variant, "interruptions_transition"), Qt = sm("Proposed - predict", variant, "interruptions_transition");
  const [pt, qt] = fpair("interruptions_transition", Pt.mean, Qt.mean);
  detail.push(`Around link changes: ${pt} against ${qt}.`);
  const n = minN(nOf("Proposed", variant), nOf("Proposed - predict", variant));
  const spec: MomentSpec = useMemo(() => ({
    key: "notwin-predict", variant, cmp: "Proposed - predict", needs: ["right"], what: "the radio fading behind the ridge", compute: radioLostMoment,
  }), [variant]);
  return (
    <Block id="notwin-predict" level={3} title="Predictive switching" scope={scopeOf(variant)} claim={claim} detail={detail}
      chart={<DotFacets title="Proposed with and without predictive switching" cols={3} rows={rows} facets={facets}
        marks={marksFor(variant)} n={n} labelWidth={176} ariaLabel={textOf(claim)} caption={caption(n, ENGINE_NOTE)} />}
      caveat={<>prediction uses only measured link values and the published Starlink handover schedule, never ground truth (deciders/proposed.py).</>}
      replay={<ReplayLink spec={spec} preload />}
    />
  );
}

// ------------------------------------------------------------------ 3. crater scan vs urgent-first

function CraterScan() {
  const variant = "nominal";
  const rows = useMemo(() => policyRows(variant), []);
  const facets = useMemo(() => [facet("lidar_crater_s"), facet("req_mean_s"), facet("useful_crater")], []);
  const A = sm("Proposed", variant, "lidar_crater_s"), U = sm("Proposed (urgent_first)", variant, "lidar_crater_s");
  const [aa, uu] = fpair("lidar_crater_s", A.mean, U.mean);
  const uFaster = compare(U, A, "lower").aBetter;
  const claim: Parts = uFaster
    ? [urgentFirst(true), ` delivers the crater scan in ${uu}; `, adaptive(), ` takes ${aa}.`]
    : [Adaptive(), ` delivers the crater scan in ${aa}; `, urgentFirst(), ` takes ${uu}.`];
  const detail: Parts = [];
  if (A.mean !== null && U.mean !== null && U.mean > 0 && uFaster) detail.push(`That is ${fmtNum(A.mean / U.mean, 1)} times as long. `);
  const Ac = sm("Proposed", variant, "useful_crater"), Uc = sm("Proposed (urgent_first)", variant, "useful_crater");
  const [ac, uc] = fpair("useful_crater", Ac.mean, Uc.mean);
  const keep = compare(Ac, Uc, "higher");
  detail.push(`In the crater, `, adaptive(), `'s view is usable ${ac} of the time, `, urgentFirst(), `'s ${uc} (intervals ${keep.clear ? "do not overlap" : "overlap"}).`);
  const sc = getScenario();
  const scanMb = sc ? Object.values(sc.driver.events).flat().find((x) => x.id === "lidar_crater")?.size_mb ?? null : null;
  const cap = sc?.variants?.nominal?.params?.crater_cap ?? null;
  const n = minN(...rows.map((r) => nOf(r.config!, variant)));
  const spec: MomentSpec = useMemo(() => ({
    key: "notwin-crater", variant, cmp: "Proposed (urgent_first)", needs: ["right"], what: "the crater scan request",
    compute: uploadRequested("lidar_crater", "the crater scan request"),
  }), []);
  return (
    <Block id="notwin-crater" level={3} title="Crater scan delivery" scope={scopeOf(variant)} claim={claim} detail={detail}
      chart={<DotFacets title="Crater scan delivery and the crater view, by upload policy" cols={3} rows={rows} facets={facets}
        marks={marksFor(variant)} n={n} rowHeader="Upload policy" labelWidth={176} ariaLabel={textOf(claim)} caption={caption(n)} />}
      caveat={<>adaptive puts requested uploads first only while the detected manoeuvre is stopped or precision (deciders/proposed.py)
        {scanMb !== null && cap !== null ? <>; the crater scan is {fmtMB(scanMb)} and the crater link {fmtRate(cap)} (A).</> : "."}</>}
      replay={<ReplayLink spec={spec} preload />}
    />
  );
}

// ------------------------------------------------------------------ 4. video delay while uploading

function DelayWhileUploading({ variant }: { variant: string }) {
  const configs = ["Baseline", "Baseline + duplicate video", "Proposed"].filter((x) => has(x, variant));
  const rows = useMemo(() => configRows(configs), [variant]); // eslint-disable-line
  const facets = useMemo(() => [facet("video_delay_p95_bulk_ms"), facet("video_delay_p95_ms"), facet("bg_delivered_mb")], []);
  const P = sm("Proposed", variant, "video_delay_p95_bulk_ms"), B = sm("Baseline", variant, "video_delay_p95_bulk_ms");
  const [pb, bb] = fpair("video_delay_p95_bulk_ms", P.mean, B.mean);
  const claim: Parts = ["While uploading, ", c("Proposed"), `'s video delay p95 is ${pb}; `, c("Baseline"), `'s is ${bb}.`];
  const detail: Parts = [];
  const cmp = compare(P, B, "lower");
  detail.push(`The 95% intervals ${cmp.clear ? "do not overlap" : "overlap"}. `);
  const Pa = sm("Proposed", variant, "video_delay_p95_ms"), Ba = sm("Baseline", variant, "video_delay_p95_ms");
  const [pa, ba] = fpair("video_delay_p95_ms", Pa.mean, Ba.mean);
  detail.push(`Over the whole mission it is ${pa} against ${ba}. `);
  const Pg = sm("Proposed", variant, "bg_delivered_mb"), Bg = sm("Baseline", variant, "bg_delivered_mb");
  const [pg, bg] = fpair("bg_delivered_mb", Pg.mean, Bg.mean);
  detail.push(c("Proposed"), ` also delivers ${pg} of background data, `, c("Baseline"), ` ${bg}.`);
  const n = nOf("Proposed", variant);
  const spec: MomentSpec = useMemo(() => ({
    key: "notwin-delay", variant, needs: ["right"], what: "Proposed's worst video delay while uploading", compute: worstDelayWhileUploading,
  }), [variant]);
  return (
    <Block id="notwin-delay" level={3} title="Video delay while uploading" scope={scopeOf(variant)} claim={claim} detail={detail}
      chart={<DotFacets title="Video delay while uploading, over the mission, and background data delivered" cols={3} rows={rows} facets={facets}
        marks={marksFor(variant)} n={n} labelWidth={176} ariaLabel={textOf(claim)} caption={caption(n)} />}
      caveat={<>video delay p95 counts every delivered frame of both cameras; "while uploading" keeps only frames captured while bulk data was being sent, and each controller uploads at different times and amounts (sim/engine.py).</>}
      replay={<ReplayLink spec={spec} preload />}
    />
  );
}

// ------------------------------------------------------------------ 5. no shaping clears background fastest

function NoShaping() {
  const variant = "nominal";
  const configs = ["Baseline (no shaping)", "Baseline", "Proposed"].filter((x) => has(x, variant));
  const rows = useMemo(() => configRows(configs), []); // eslint-disable-line
  const facets = useMemo(() => [facet("bg_backlog_mb_at_end"), facet("video_delay_p95_bulk_ms"), facet("interruptions"), facet("useful_view_pct")], []);
  const G = sm("Baseline (no shaping)", variant, "bg_backlog_mb_at_end"), P = sm("Proposed", variant, "bg_backlog_mb_at_end");
  const [gg, pp] = fpair("bg_backlog_mb_at_end", G.mean, P.mean);
  const claim: Parts = [c("Baseline (no shaping)"), ` ends the mission with ${gg} of background data left; `, c("Proposed"), ` with ${pp}.`];
  const Gd = sm("Baseline (no shaping)", variant, "video_delay_p95_bulk_ms"), Pd = sm("Proposed", variant, "video_delay_p95_bulk_ms");
  const Gi = sm("Baseline (no shaping)", variant, "interruptions"), Pi = sm("Proposed", variant, "interruptions");
  const [gd, pd] = fpair("video_delay_p95_bulk_ms", Gd.mean, Pd.mean);
  const [gi, pi] = fpair("interruptions", Gi.mean, Pi.mean);
  const worse = compare(Gd, Pd, "lower").aBetter === false && compare(Gi, Pi, "lower").aBetter === false;
  const detail: Parts = [worse ? "It pays with the live view: " : "Its live view: ",
    `video delay p95 while uploading ${gd} against ${pd}, and ${gi} view interruptions against ${pi}.`];
  const n = minN(...configs.map((x) => nOf(x, variant)));
  const spec: MomentSpec = useMemo(() => ({
    key: "notwin-noshaping", variant, cmp: "Baseline (no shaping)", needs: ["right"], what: "the end of the mission", compute: missionEnd,
  }), []);
  return (
    <Block id="notwin-noshaping" level={3} title="Background data without shaping" scope={scopeOf(variant)} claim={claim} detail={detail}
      chart={<DotFacets title="Background data left, and what the live view pays for it" cols={2} rows={rows} facets={facets}
        marks={marksFor(variant)} n={n} labelWidth={176} ariaLabel={textOf(claim)} caption={caption(n, ENGINE_NOTE)} />}
      caveat={<>Baseline (no shaping) sends uploads like plain TCP and fills the modem queue; it is a reference, not a recommended setting (deciders/baseline.py).</>}
      replay={<ReplayLink spec={spec} preload />}
    />
  );
}

// ------------------------------------------------------------------ further items, generated

/** (config, metric) pairs the items above already discuss, so generated items do not repeat them. */
const COVERED: Record<string, string[]> = {
  "Proposed - uploads": ["useful_view_pct", "interruptions", "req_mean_s"],
  "Proposed - predict": ["useful_view_pct", "interruptions", "interruptions_transition"],
};

function AblationLoss({ variant, cfg, losses }: { variant: string; cfg: string; losses: Loss[] }) {
  const rows = useMemo(() => configRows([cfg, "Proposed"]), [cfg]);
  const keys = losses.map((l) => l.metric);
  const facets = useMemo(() => [...keys, ...(keys.includes("useful_view_pct") ? [] : ["useful_view_pct"])].slice(0, 3).map((k) => facet(k)), [keys.join()]); // eslint-disable-line
  const claim: Parts = [`Without ${ABLATION[cfg]}, `];
  losses.forEach((l, i) => {
    const [a, p] = fpair(l.metric, l.other.mean, l.proposed.mean);
    if (i === 0) claim.push(`${def(l.metric).noun} is ${a} against `, c("Proposed"), `'s ${p}`);
    else claim.push(`${i === losses.length - 1 ? " and" : ","} ${def(l.metric).noun} ${a} against ${p}`);
  });
  claim.push(".");
  const detail: Parts = [`The 95% intervals do not overlap${losses.length > 1 ? " on any of these" : ""}. `];
  const A = sm(cfg, variant, "useful_view_pct"), P = sm("Proposed", variant, "useful_view_pct");
  if (!keys.includes("useful_view_pct") && A.mean !== null && P.mean !== null) {
    const [aa, pp] = pctPair(A.mean, P.mean);
    detail.push(`Usable view ${lowerSay("higher", compare(P, A, "higher").aBetter, "still falls", "rises")} without it: ${aa} against ${pp}.`);
  }
  const n = minN(nOf(cfg, variant), nOf("Proposed", variant));
  const id = `notwin-${cfg.replace(/[^a-z]+/gi, "-").toLowerCase()}`;
  const spec: MomentSpec = useMemo(() => ({
    key: id, variant, cmp: cfg, needs: ["left", "right"], what: "the longest stretch only Baseline could see",
    compute: (p) => longestDivergence(p, "left", "the longest stretch only Baseline could see"),
  }), [variant, cfg]); // eslint-disable-line
  const delayNote = keys.some((k) => k.startsWith("video_delay"));
  return (
    <Block id={id} level={3} title={`Without ${ABLATION[cfg]}`} scope={scopeOf(variant)} claim={claim} detail={detail}
      chart={<DotFacets title={`${configLabel(cfg)} against Proposed`} cols={3} rows={rows} facets={facets}
        marks={marksFor(variant)} n={n} labelWidth={176} ariaLabel={textOf(claim)} caption={caption(n)} />}
      caveat={delayNote
        ? <>video delay p95 counts every delivered frame of both cameras, including the camera the operator does not need at that moment (sim/engine.py).</>
        : <>this item is generated because the 95% intervals do not overlap on {lc(variantLabel(variant))}; ablation runs were scored, not exported as traces.</>}
      replay={<ReplayLink spec={spec} preload />}
    />
  );
}

function GeneratedAblationLosses({ variant }: { variant: string }) {
  const scan = useMemo(() => scanLosses(variant), [variant]);
  const items = Object.keys(ABLATION).map((cfg) => ({
    cfg,
    losses: scan.losses.filter((l) => l.config === cfg && l.outcome === "clear" && !(COVERED[cfg] ?? []).includes(l.metric)),
  })).filter((x) => x.losses.length > 0);
  return <>{items.map((x) => <AblationLoss key={x.cfg} variant={variant} cfg={x.cfg} losses={x.losses} />)}</>;
}

// ------------------------------------------------------------------ the section

export function NotWin({ variant }: { variant: string }) {
  return (
    <section id="notwin" className={s.notWin} aria-labelledby="notwin-title" data-section="notwin">
      <header className={s.sectionHead}>
        <h2 id="notwin-title" className={s.sectionTitle}>Where Proposed does not win</h2>
        <p className={s.sectionIntro}>
          The same scoring and the same seeds as the rest of this page. Each item is a comparison the data does not settle in <span className="ctrl-proposed">Proposed</span>'s favour.
        </p>
      </header>
      <EveryComparison variant={variant} />
      <AdaptiveVsVideoFirst variant={variant} />
      <PredictionEffect variant={variant} />
      <CraterScan />
      <DelayWhileUploading variant={variant} />
      <NoShaping />
      <GeneratedAblationLosses variant={variant} />
    </section>
  );
}

