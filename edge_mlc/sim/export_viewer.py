"""Export simulation runs for the web viewer (viewer/).

  python sim/export_viewer.py                    # default set: seed 0, all variants
  python sim/export_viewer.py --seeds 3          # seeds 0..2
  python sim/export_viewer.py --variants nominal overlap --configs Baseline Proposed
  python sim/export_viewer.py --res results      # results tables from results/ (default:
                                                 #   results_run/ if its summary.csv exists)

The viewer must open from disk (file://), so nothing is fetched: every output
is a classic <script> that assigns a global (JSONP style). Outputs (--out,
default ../viewer/public/data):
  manifest.js       window.SIM_MANIFEST     list of runs + pairs hint
  scenario.js       window.SIM_SCENARIO     link truth vs position per variant, zones, driver
  results.js        window.SIM_RESULTS      results CSVs (summary/capacity/buffer/runs)
  runs/<id>.js      window.SIM_RUNS[id]     one full replay, COLUMNAR arrays
The format is documented in viewer/src/data/types.ts (authoritative) and
viewer/src/data/README.md.

Nothing in the simulator or the deciders is changed: RecordingSim subclasses
engine.Sim and only READS state after each 0.1 s sample (no random numbers
drawn, no events scheduled); RecordingDecider forwards to the real decider and
copies what it saw and decided. Metrics are identical to engine.run.
"""
import argparse
import datetime
import json
import math
import os
import re
import sys
import time
from multiprocessing import Pool

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from sim import engine                           # noqa: E402
from sim import scenario as S                    # noqa: E402
from sim.run_experiments import CFG, CONFIGS, make   # noqa: E402

EDGE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DEFAULT = os.path.normpath(os.path.join(EDGE, "..", "viewer", "public", "data"))
FORMAT_VERSION = 1
LINKS = [l["name"] for l in CFG["links"]]
CAMS = ("front", "rear")
AGE_CAP_S = 99.0                     # frame/command age is capped here (never seen = cap)
NOMINAL_SET = ["Baseline", "Proposed", "Proposed - FEC", "Baseline + duplicate video",
               "Proposed (urgent_first)", "Oracle: perfect link choice"]
OTHER_SET = ["Baseline", "Proposed"]
STATES = list(S.Driver.OUT)
MANS = list(CFG["requirements"])     # DRIVE, REVERSE, PRECISION, STOPPED
ACTIONS = ["NORMAL", "PREPARE", "DUPLICATE", "SWITCH"]
BULK_MODES = ["rate", "greedy"]
EDGE_RSRP = -114.0                   # (A) cell-edge 4G drawn at its mean in the position profile


# ---------------------------------------------------------------- small helpers
def rnd(x, n):
    """Round for JSON: None/NaN/inf -> None, integral values as int."""
    if x is None:
        return None
    x = float(x)
    if not math.isfinite(x):
        return None
    v = round(x, n)
    return int(v) if v == int(v) else v


def slug(name):
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def run_id(config, variant, seed):
    return f"{slug(config)}__{variant}__s{seed}"


class Enum:
    """String -> integer code, in first-seen order (seeded with known values)."""
    def __init__(self, known=()):
        self.vals, self.idx = [], {}
        for v in known:
            self(v)

    def __call__(self, v):
        if v is None:
            return -1
        if v not in self.idx:
            self.idx[v] = len(self.vals)
            self.vals.append(v)
        return self.idx[v]


# ---------------------------------------------------------------- recording wrappers
class RecordingDecider:
    """Forwards to the real decider; records every decide() (input snapshot +
    plan), copied at once since plans may be reused or mutated later."""

    def __init__(self, dec):
        self._dec = dec
        self.name = dec.name
        self.reject_stale = getattr(dec, "reject_stale", False)
        self.log = []

    def __getattr__(self, k):            # attach_sim etc. (oracles) still found by hasattr
        return getattr(self._dec, k)

    def decide(self, s):
        snap = {ln: (bool(L["alive"]), L["rtt_ms"], L["rtt_p90"], L["loss"], L["cap_kbps"],
                     L.get("signal"), L.get("data_loss"))
                for ln, L in s["links"].items()}
        plan = self._dec.decide(s)
        b = plan.get("bulk")
        self.log.append(dict(
            t=s["now"], snap=snap, mode=plan.get("mode"),
            video={c: (tuple(plan["video"][c]["links"]), plan["video"][c]["level"]) for c in CAMS},
            cmd=tuple(plan["cmd_links"]),
            bulk=None if not b else (b.get("link"), b.get("mode"), b.get("rate_kbps"), b.get("item")),
            actions=dict(plan.get("actions") or {}), ttu=dict(plan.get("ttu") or {}),
            hb_fast=bool(plan.get("hb_fast", False)), reasons=list(plan.get("reasons") or [])))
        return plan


class RecordingSim(engine.Sim):
    """engine.Sim plus extra per-sample fields for a replay (read-only)."""

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.n_frames_seen = 0
        self.progress = []               # (t, upload index, delivered MB), every 1 s when changed
        self._prog_last = {}

    def sample(self):
        super().sample()
        r, now = self.rows[-1], self.now
        for c in CAMS:
            arr = self.arrivals[c]       # same pruning the engine applies to the protected camera
            while arr and now - arr[0] > 1.0:
                arr.popleft()
            tcap, lv = self.view[c]
            r[f"age_{c}"] = min(now - tcap, AGE_CAP_S)
            r[f"vlevel_{c}"] = lv
            r[f"fps_{c}"] = len(arr)
            r[f"tgt_{c}"] = tuple(self.cam[c]["links"])
            r[f"tlevel_{c}"] = self.cam[c]["level"]
            r[f"lat_{c}"] = None
        for f in self.frames[self.n_frames_seen:]:  # newest frames: worst delay per camera
            k = f"lat_{f[3]}"
            r[k] = f[0] if r[k] is None else max(r[k], f[0])
        self.n_frames_seen = len(self.frames)
        r["cmd_links"] = tuple(self.cmd_links)
        r["hb_fast"] = self.hb_fast
        r["cmd_age"] = min(now - self.car_last_exec, AGE_CAP_S)
        r["creep"] = now - self.car_last_exec >= engine.CREEP_AFTER_S and now > 3
        bp = (self.plan or {}).get("bulk") or {}
        for ln in LINKS:
            T = self.truth_at(ln, r)
            r[f"tr_{ln}"] = T
            live = self.tr(ln)
            r[f"qd_{ln}"] = self.qdelay(ln, live)
            tx = engine.TELEM_KBPS * (ln in self.cmd_links[:1])
            tx += sum(self.ladder[v["level"]]["kbps"] for v in self.cam.values() if ln in v["links"])
            if bp.get("link") == ln:
                tx += self.bulk_req_kbps + self.bulk_bg_kbps
            r[f"tx_{ln}"] = tx
        pend = [u for u in self.uploads if u["delivered_kbit"] < u["size_kbit"]]
        r["upq_req_mb"] = sum(u["size_kbit"] - u["delivered_kbit"] for u in pend if u["requested"]) / 8000
        r["upq_bg_mb"] = sum(u["size_kbit"] - u["delivered_kbit"] for u in pend if not u["requested"]) / 8000
        if len(self.rows) % 10 == 0:
            for i, u in enumerate(self.uploads):
                mb = u["delivered_kbit"] / 8000
                if self._prog_last.get(i) != mb:
                    self._prog_last[i] = mb
                    self.progress.append((now, i, mb))


# ---------------------------------------------------------------- one run -> dict
def outages(ctx, t_end):
    """Starlink handover outages of this seed: [[start s, length s]]."""
    down = ctx["ho_down"][:int(t_end / S.DT) + 1]
    out, i, n = [], 0, len(down)
    while i < n:
        if down[i]:
            j = i
            while j < n and down[j]:
                j += 1
            out.append([rnd(i * S.DT, 2), rnd((j - i) * S.DT, 2)])
            i = j
        else:
            i += 1
    return out


def encode(config, variant, seed, sim, dec, metrics):
    E = dict(state=Enum(STATES), man=Enum(MANS), seg=Enum(S.SEGMENTS), mode=Enum(),
             upload=Enum([u["id"] for u in sim.uploads]), linkset=Enum(),
             action=Enum(ACTIONS), bulk_mode=Enum(BULK_MODES), cam=Enum(CAMS))
    li = {ln: i for i, ln in enumerate(LINKS)}

    def link(x):
        return li.get(x, -1) if x is not None else -1

    def lset(xs):
        return E["linkset"](tuple(li[x] for x in xs))

    rows = sim.rows
    col = lambda f: [f(r) for r in rows]   # noqa: E731
    samples = dict(
        t=col(lambda r: rnd(r["t"], 2)), d=col(lambda r: rnd(r["d"], 4)),
        dir=col(lambda r: r["dir"]), state=col(lambda r: E["state"](r["state"])),
        seg=col(lambda r: E["seg"](r["seg"])), man=col(lambda r: E["man"](r["man"])),
        prot=col(lambda r: E["cam"](r["prot"])), crater=col(lambda r: int(r["crater"])),
        v=col(lambda r: rnd(r["v_mps"], 2)),
        thr_int=col(lambda r: rnd(r["thr_int"], 2)), thr_exec=col(lambda r: rnd(r["thr_exec"], 2)),
        fs=col(lambda r: int(r["fs"])), creep=col(lambda r: int(r["creep"])),
        cmd_age=col(lambda r: rnd(r["cmd_age"], 2)),
        useful=col(lambda r: int(r["useful"])), live=col(lambda r: int(r["live"])),
        fps=col(lambda r: r["fps"]), level=col(lambda r: r["level"]),
        link=col(lambda r: link(r["link"])), dup=col(lambda r: int(r["dup"])),
        mode=col(lambda r: E["mode"](r["mode"])),
        cmd=col(lambda r: lset(r["cmd_links"])), hb_fast=col(lambda r: int(r["hb_fast"])),
        bulk=col(lambda r: int(r["bulk"])), bulk_item=col(lambda r: E["upload"](r["bulk_item"])),
        bulk_req_kbps=col(lambda r: rnd(r["bulk_req_kbps"], 0)),
        bulk_bg_kbps=col(lambda r: rnd(r["bulk_bg_kbps"], 0)),
        upq_req_mb=col(lambda r: rnd(r["upq_req_mb"], 1)), upq_bg_mb=col(lambda r: rnd(r["upq_bg_mb"], 1)),
    )
    cams = {c: dict(
        age=col(lambda r, c=c: rnd(r[f"age_{c}"], 2)), vlevel=col(lambda r, c=c: r[f"vlevel_{c}"]),
        fps=col(lambda r, c=c: r[f"fps_{c}"]), tgt=col(lambda r, c=c: lset(r[f"tgt_{c}"])),
        tlevel=col(lambda r, c=c: r[f"tlevel_{c}"]), lat=col(lambda r, c=c: rnd(r[f"lat_{c}"], 0)),
    ) for c in CAMS}
    truth = {ln: dict(
        up=col(lambda r, ln=ln: int(r[f"tr_{ln}"]["up"])),
        cap=col(lambda r, ln=ln: rnd(r[f"tr_{ln}"]["cap_kbps"], 0)),
        loss=col(lambda r, ln=ln: rnd(r[f"tr_{ln}"]["loss"], 4)),
        rtt=col(lambda r, ln=ln: rnd(2 * r[f"tr_{ln}"]["owd_ms"], 1)),
        sig=col(lambda r, ln=ln: rnd(r[f"tr_{ln}"]["signal"], 0)),
        qd=col(lambda r, ln=ln: rnd(r[f"qd_{ln}"], 0)),
        tx=col(lambda r, ln=ln: rnd(r[f"tx_{ln}"], 0)),
    ) for ln in LINKS}

    # decisions (one per decide() call, 10 Hz)
    L = dec.log
    dcol = lambda f: [f(x) for x in L]     # noqa: E731
    dec_cols = dict(
        t=dcol(lambda x: rnd(x["t"], 2)), mode=dcol(lambda x: E["mode"](x["mode"])),
        cmd=dcol(lambda x: lset(x["cmd"])), hb_fast=dcol(lambda x: int(x["hb_fast"])),
        bulk_link=dcol(lambda x: link(x["bulk"][0]) if x["bulk"] else -1),
        bulk_mode=dcol(lambda x: E["bulk_mode"](x["bulk"][1]) if x["bulk"] else -1),
        bulk_rate=dcol(lambda x: rnd(x["bulk"][2], 0) if x["bulk"] else None),
        bulk_item=dcol(lambda x: E["upload"](x["bulk"][3]) if x["bulk"] else -1),
    )
    for c in CAMS:
        dec_cols[f"{c}_links"] = dcol(lambda x, c=c: lset(x["video"][c][0]))
        dec_cols[f"{c}_level"] = dcol(lambda x, c=c: x["video"][c][1])
        dec_cols[f"{c}_action"] = dcol(lambda x, c=c: E["action"](x["actions"].get(c)))
    measured = {ln: dict(
        alive=dcol(lambda x, ln=ln: int(x["snap"][ln][0])),
        rtt=dcol(lambda x, ln=ln: rnd(x["snap"][ln][1], 0)),
        rtt_p90=dcol(lambda x, ln=ln: rnd(x["snap"][ln][2], 0)),
        loss=dcol(lambda x, ln=ln: rnd(x["snap"][ln][3], 3)),
        cap=dcol(lambda x, ln=ln: rnd(x["snap"][ln][4], 0)),
        sig=dcol(lambda x, ln=ln: rnd(x["snap"][ln][5], 0)),
        data_loss=dcol(lambda x, ln=ln: rnd(x["snap"][ln][6], 3)),
    ) for ln in LINKS}
    for blk in list(truth.values()) + list(measured.values()):
        if all(x is None for x in blk["sig"]):
            blk["sig"] = None                   # link reports no signal (Starlink, or 4G off)
    # time-until-unusable (Proposed only), as step functions: per key the
    # decision indices where the value changes, and the new value (null = no
    # predicted failure). Reasons: only those not already given the tick before.
    ttu = {}
    for k in ([f"{ln}:{st}" for ln in LINKS for st in ("cmd",) + CAMS] if any(x["ttu"] for x in L) else []):
        st, last = dict(i=[], v=[]), "unset"
        for i, x in enumerate(L):
            v = rnd(x["ttu"].get(k), 1)
            if v != last:
                st["i"].append(i)
                st["v"].append(v)
                last = v
        ttu[k] = st
    reasons, prev = [], set()
    for x in L:
        reasons += [[rnd(x["t"], 2), s] for s in x["reasons"] if s not in prev]
        prev = set(x["reasons"])

    ups = []
    for u in sim.uploads:
        dt_ = u["done_t"] - u["created_t"] if u["done_t"] is not None else None
        ups.append(dict(id=u["id"], kind=u["kind"], size_mb=rnd(u["size_kbit"] / 8000, 3),
                        requested=int(u["requested"]),
                        created_t=rnd(u["created_t"], 2), created_d=rnd(u["created_d"], 4),
                        done_t=rnd(u["done_t"], 2), done_d=rnd(u["done_d"], 4),
                        delivery_s=rnd(dt_, 2), delivered_mb=rnd(u["delivered_kbit"] / 8000, 3)))
    prog = dict(t=[rnd(p[0], 2) for p in sim.progress], u=[p[1] for p in sim.progress],
                mb=[rnd(p[2], 3) for p in sim.progress])

    R = [r for r in rows if r["t"] >= 3.0]
    trans = [[rnd(t, 2), k] for t, k in sim.transition_events(R)]
    sc, prev = [], None
    for r in rows:
        if r["state"] != prev:
            sc.append([rnd(r["t"], 2), rnd(r["d"], 4), E["state"](r["state"])])
            prev = r["state"]
    t_end = rows[-1]["t"] if rows else 0.0
    bt = sim.ctx["blackout_t"]

    kind = CONFIGS[config][0]
    meta = dict(
        format=FORMAT_VERSION, id=run_id(config, variant, seed), config=config, decider=kind,
        decider_name=dec.name, options={k: v for k, v in CONFIGS[config][1].items() if k != "cls"},
        variant=variant, seed=seed, dt=0.1, decide_dt=1 / CFG["timing"]["loop_hz"], links=LINKS,
        cams=list(CAMS), ladder=CFG["ladder"], requirements=CFG["requirements"], modes=CFG["modes"],
        limits=CFG["limits"], segments=S.SEGMENTS,
        mission_time_s=rnd(metrics["mission_time_s"], 2), completed=bool(metrics["mission_completed"]),
        n_samples=len(rows), n_decisions=len(L),
    )
    enums = {k: [list(v) if isinstance(v, tuple) else v for v in e.vals] for k, e in E.items()}
    return dict(
        meta=meta, enums=enums, samples=samples, cams=cams, truth=truth,
        decisions=dict(cols=dec_cols, measured=measured, ttu=ttu),
        reasons=reasons, uploads=ups, upload_progress=prog, transitions=trans,
        state_changes=sc,
        events=dict(blackout=None if bt is None else [rnd(bt, 2), sim.ctx["v"]["blackout_s"]],
                    starlink_outages=outages(sim.ctx, t_end)),
        metrics={k: (rnd(v, 4) if isinstance(v, (int, float, np.floating, np.integer)) else v)
                 for k, v in metrics.items()},
    )


def job(args):
    config, variant, seed = args
    t0 = time.perf_counter()
    cfg, real = make(config)
    dec = RecordingDecider(real)
    sim = RecordingSim(cfg, dec, variant, seed)
    m, _ = sim.run()
    data = encode(config, variant, seed, sim, dec, m)
    rid = data["meta"]["id"]
    js = (f"(window.SIM_RUNS = window.SIM_RUNS || {{}})[{json.dumps(rid)}] = "
          + dumps(data) + ";\n")
    info = dict(id=rid, config=config, decider=data["meta"]["decider"], variant=variant, seed=seed,
                file=f"data/runs/{rid}.js", mission_time_s=data["meta"]["mission_time_s"],
                completed=data["meta"]["completed"],
                useful_view_pct=rnd(m["useful_view_pct"], 2), interruptions=int(m["interruptions"]),
                video_delay_p95_bulk_ms=rnd(m["video_delay_p95_bulk_ms"], 1))
    return info, js, time.perf_counter() - t0


def dumps(x):
    return json.dumps(x, separators=(",", ":"), allow_nan=False, ensure_ascii=False)


def write_js(path, prefix, obj):
    s = prefix + dumps(obj) + ";\n"
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(s)
    return len(s.encode("utf-8"))


# ---------------------------------------------------------------- scenario.js
VARIANT_TEXT = {
    "nominal":         "Reference mission: conditions as designed.",
    "harsh_handovers": "Starlink handovers cause outages 80% of the time, 0.5-2.5 s long.",
    "heavy_jamming":   "Wider, steeper jamming zone (2.40-2.85 km) and a 12 s blackout.",
    "no_lte":          "No 4G anywhere on the route.",
    "fast_fade":       "Radio fades over 0.1 km (1.50-1.60) instead of 0.3 km: little warning.",
    "overlap":         "Cell-edge 4G along the whole route: link choice at a handover matters.",
    "overlap_harsh":   "Cell-edge 4G along the route plus harsh Starlink handovers.",
}


def zones(v):
    f0, f1 = v["fade"]
    z0, z1 = v["jam_zone"]
    Z = []
    add = lambda *a: Z.append(dict(zip(("name", "from_km", "to_km", "kind", "description"), a)))  # noqa: E731
    if v["lte"]:
        add("Base 4G tower", 0.0, 0.0, "tower", "4G base tower at the start; RSRP falls with log distance.")
    add("Radio fade (ridge)", f0, f1, "fade", "Mesh radio -65 -> -100 dBm over the ridge; unusable for video past ~-88 dBm.")
    add("Radio out of range", f1, 3.05, "no_radio", "Terrain beyond the ridge: radio at -105 dBm (down).")
    add("Scan requested", 1.70, 1.70, "event", "20 MB scan requested while driving, outbound (Starlink the only link).")
    if v["lte"]:
        add("Village 4G tower", 2.0, 2.0, "tower", "Second 4G tower; usable roughly 1.8-2.2 km.")
    if v["lte_route"]:
        add("Cell-edge 4G", 0.0, 3.05, "coverage", "Cell-edge 4G (~-114 dBm, fading in and out) along the whole route.")
    add("Tree cover", 2.10, 2.13, "obstruction", "Dense trees: Starlink down.")
    add("Crater", 2.35, 2.45, "crater",
        f"Approach, stop, LiDAR scan (20 MB), REVERSE out, turn. Starlink obstructed: {v['crater_cap'] / 1000:g} Mbps.")
    add("Contested zone", z0, z1, "jamming", f"Starlink jammed both ways: loss up to 15%, +300 ms RTT, 0.8 Mbps at full strength.")
    add("Jamming ramp", z0, min(z1, z0 + v["jam_ramp_km"]), "jamming_ramp",
        f"Jamming ramps from 0 to full over {v['jam_ramp_km']:g} km.")
    add("Blackout trigger", v["blackout_at"], v["blackout_at"], "trigger",
        f"First time past this point: Starlink jammed out for {v['blackout_s']:g} s (once).")
    add("Inspection site", 3.0, 3.0, "site", "25 s stop: still (4 MB) + clip (30 MB) requested, then turn around.")
    add("Mission end", 1.40, 1.40, "end", "Mission ends here on the return leg.")
    return Z


def scenario_data():
    km = [round(i * 0.01, 2) for i in range(306)]
    variants = {}
    for name in S.VARIANTS:
        ctx = S.make_ctx(name, 0, shadow=False)
        if ctx["lte_edge"] is not None:
            ctx["lte_edge"] = np.full_like(ctx["lte_edge"], EDGE_RSRP)
        prof = {}
        for ln in LINKS:
            st = [S.link_state(ln, 5.0, d, ctx) for d in km]   # t=5 s: no handover, no burst
            prof[ln] = dict(up=[int(x["up"]) for x in st], sig=[rnd(x["signal"], 1) for x in st],
                            loss=[rnd(x["loss"], 4) for x in st], rtt=[rnd(2 * x["owd_ms"], 1) for x in st],
                            cap=[rnd(x["cap_kbps"], 0) for x in st])
        ckm = [round(2.35 + i * 0.01, 2) for i in range(11)]
        cctx = {**ctx, "in_crater": True}
        cs = [S.link_state("starlink", 5.0, d, cctx) for d in ckm]
        v = {**S.DEFAULTS, **S.VARIANTS[name]}
        variants[name] = dict(
            description=VARIANT_TEXT.get(name, ""), overrides=S.VARIANTS[name],
            params={k: (list(x) if isinstance(x, tuple) else x) for k, x in v.items()},
            profile=prof,
            crater_starlink=dict(km=ckm, up=[int(x["up"]) for x in cs], loss=[rnd(x["loss"], 4) for x in cs],
                                 rtt=[rnd(2 * x["owd_ms"], 1) for x in cs], cap=[rnd(x["cap_kbps"], 0) for x in cs]),
            zones=zones(v))
    hs = next(l for l in CFG["links"] if l["name"] == "starlink")["handover_schedule"]
    return dict(
        format=FORMAT_VERSION, km=km, profile_t_s=5.0, links=LINKS,
        link_config=CFG["links"], ladder=CFG["ladder"], limits=CFG["limits"],
        requirements=CFG["requirements"], modes=CFG["modes"], variants=variants,
        # decider thresholds (config/sim_themis.yaml), so the viewer's Method view reads them
        decider_params=dict(timing=CFG["timing"], baseline=CFG["baseline"],
                            proposed=CFG["proposed"], uploads=CFG["uploads"]),
        starlink_handover=dict(period_s=hs["period_s"], offsets_s=hs["offsets_s"], pre_s=hs["pre_s"],
                               post_s=hs["post_s"], extra_rtt_ms=80.0, extra_for_s=0.5,
                               congestion_burst=dict(from_s=430.0, to_s=433.0, extra_rtt_ms=650.0)),
        driver=dict(
            states={s: dict(throttle=o[0], steer_amp=o[1], steer_offset=o[2], manoeuvre=o[3])
                    for s, o in S.Driver.OUT.items()},
            crater_states=sorted(S.CRATER_STATES),
            events={s: [dict(id=i, kind=k, size_mb=mb, requested=rq) for (i, k, mb, rq) in evs]
                    for s, evs in S.Driver.EVENTS.items()},
            # mirrors Driver._next (documentation; the engine is authoritative)
            transitions=[
                ["START", "CRUISE_OUT", "after 2 s"], ["CRUISE_OUT", "CRATER_APPROACH", "d >= 2.35 km"],
                ["CRATER_APPROACH", "CRATER_STOP1", "d >= 2.40 km"], ["CRATER_STOP1", "CRATER_REVERSE", "after 1 s"],
                ["CRATER_REVERSE", "CRATER_STOP2", "after 12 s"], ["CRATER_STOP2", "CRATER_TURN", "after 1 s"],
                ["CRATER_TURN", "CRUISE_TO_ZONE", "after 10 s"], ["CRUISE_TO_ZONE", "CONTESTED_OUT", "d >= 2.45 km"],
                ["CONTESTED_OUT", "CRUISE_TO_SITE", "d >= 2.80 km"], ["CRUISE_TO_SITE", "INSPECT", "d >= 3.00 km"],
                ["INSPECT", "TURN_AROUND", "after 25 s"], ["TURN_AROUND", "RETURN", "after 3 s"],
                ["RETURN", "END", "d <= 1.40 km"]],
            background_every_s=60.0,
            background_items=[dict(prefix="rec_", kind="recording", size_mb=10),
                              dict(prefix="lidar_", kind="lidar", size_mb=5)],
            scan_drive=dict(id="scan_drive", kind="scan", size_mb=20, at_km=1.70),
        ),
        segments=[
            dict(name="leave base", dir="out", from_km=0.0, to_km=1.3),
            dict(name="radio edge", dir="out", from_km=1.3, to_km=1.6),
            dict(name="transit", dir="out", from_km=1.6, to_km=2.35),
            dict(name="crater", dir="state", from_km=2.35, to_km=2.45, note="any CRATER_* driver state"),
            dict(name="contested out", dir="out", from_km=2.45, to_km=2.80),
            dict(name="inspection", dir="state", from_km=3.0, to_km=3.0, note="INSPECT or TURN_AROUND"),
            dict(name="contested back", dir="back", from_km=2.45, to_km=2.80),
            dict(name="transit back", dir="back", from_km=1.6, to_km=2.45),
            dict(name="radio back", dir="back", from_km=1.4, to_km=1.6)],
        constants=dict(VMAX_mps=engine.VMAX, FRESH_S=engine.FRESH_S, FAILSAFE_S=engine.FAILSAFE_S,
                       CREEP_MPS=engine.CREEP_MPS, CREEP_AFTER_S=engine.CREEP_AFTER_S,
                       TELEM_KBPS=engine.TELEM_KBPS, HUB_TO_OP_MS=engine.HUB_TO_OP_MS,
                       T_MAX_S=S.T_MAX),
    )


# ---------------------------------------------------------------- results.js
def table(path):
    df = pd.read_csv(path)
    rows = []
    for rec in df.itertuples(index=False):
        rows.append([(rnd(x, 6) if isinstance(x, (float, np.floating, int, np.integer)) and not isinstance(x, bool)
                      else (None if x is None or (isinstance(x, float) and math.isnan(x)) else x)) for x in rec])
    return dict(columns=list(df.columns), rows=rows)


def results_data(res):
    out = dict(format=FORMAT_VERSION, source_dir=os.path.relpath(res, EDGE).replace("\\", "/"))
    for n in ("summary", "capacity", "buffer", "runs"):
        p = os.path.join(res, f"{n}.csv")
        out[n] = table(p) if os.path.exists(p) else None
    runs = pd.read_csv(os.path.join(res, "runs.csv"))
    by = runs.groupby("variant")["seed"].nunique()
    out["n_seeds"] = int(by.get("nominal", by.max()))
    out["n_seeds_by_variant"] = {k: int(v) for k, v in by.items()}
    return out


TYPICAL_COLS = ["useful_view_pct", "interruptions", "useful_crater"]


def typical_seed(res):
    """Nominal seed whose Baseline AND Proposed results are jointly closest to
    their means (z-score distance over TYPICAL_COLS); None without runs.csv."""
    p = os.path.join(res, "runs.csv")
    if not os.path.exists(p):
        return None
    r = pd.read_csv(p)
    r = r[(r.variant == "nominal") & r.config.isin(["Baseline", "Proposed"])]
    w = r.pivot_table(index="seed", columns="config", values=TYPICAL_COLS)
    if len(w) < 2:
        return None
    dist = (((w - w.mean()) / w.std(ddof=1).replace(0, 1)) ** 2).sum(axis=1) ** 0.5
    s = int(dist.idxmin())
    return dict(variant="nominal", seed=s, n_seeds=len(w), distance=round(float(dist[s]), 3),
                rule="closest to the mean on " + ", ".join(TYPICAL_COLS) + " for Baseline and Proposed",
                values={f"{c}:{m}": round(float(w.loc[s, (m, c)]), 2) for m in TYPICAL_COLS
                        for c in ("Baseline", "Proposed")},
                means={f"{c}:{m}": round(float(w[(m, c)].mean()), 2) for m in TYPICAL_COLS
                       for c in ("Baseline", "Proposed")})


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=OUT_DEFAULT)
    ap.add_argument("--res", default=None, help="results dir (default results_run/ if complete, else results/)")
    ap.add_argument("--seeds", type=int, default=1, help="seeds 0..N-1")
    ap.add_argument("--variants", nargs="+", default=list(S.VARIANTS))
    ap.add_argument("--configs", nargs="+", default=None,
                    help="config names (as in run_experiments.CONFIGS) for every variant; "
                         "default: 5 configs on nominal, Baseline + Proposed elsewhere")
    ap.add_argument("--procs", type=int, default=os.cpu_count() or 1)
    a = ap.parse_args()
    for v in a.variants:
        assert v in S.VARIANTS, f"unknown variant {v}"
    for c in a.configs or []:
        assert c in CONFIGS, f"unknown config {c!r}; one of {list(CONFIGS)}"

    os.makedirs(os.path.join(a.out, "runs"), exist_ok=True)
    res = a.res or (os.path.join(EDGE, "results_run")
                    if os.path.exists(os.path.join(EDGE, "results_run", "summary.csv"))
                    else os.path.join(EDGE, "results"))
    res = os.path.abspath(res)

    # demo seed: the nominal seed closest to the mean, never the best case (also exported)
    demo = typical_seed(res) if "nominal" in a.variants else None
    seeds = {v: sorted(set(range(a.seeds)) | ({demo["seed"]} if demo and v == "nominal" else set()))
             for v in a.variants}
    jobs = [(c, v, s) for v in a.variants for s in seeds[v]
            for c in (a.configs or (NOMINAL_SET if v == "nominal" else OTHER_SET))]
    print(f"{len(jobs)} runs on {min(a.procs, len(jobs))} processes -> {a.out}")
    t0 = time.perf_counter()
    runs = []
    with Pool(max(1, min(a.procs, len(jobs)))) as p:
        for info, js, sec in p.imap_unordered(job, jobs):
            path = os.path.join(a.out, "runs", f"{info['id']}.js")
            with open(path, "w", encoding="utf-8", newline="\n") as f:
                f.write(js)
            info["bytes"] = len(js.encode("utf-8"))
            runs.append(info)
            print(f"  {info['id']:<58} {sec:6.1f} s  {info['bytes'] / 1e6:5.2f} MB  "
                  f"useful {info['useful_view_pct']}%  interr {info['interruptions']}")
    order = {(c, v, s): i for i, (c, v, s) in enumerate(jobs)}
    runs.sort(key=lambda r: order[(r["config"], r["variant"], r["seed"])])

    sb = write_js(os.path.join(a.out, "scenario.js"), "window.SIM_SCENARIO = ", scenario_data())
    rb = write_js(os.path.join(a.out, "results.js"), "window.SIM_RESULTS = ", results_data(res))
    pairs = []
    for v in a.variants:
        for s in seeds[v]:
            ids ={r["config"]: r["id"] for r in runs if r["variant"] == v and r["seed"] == s}
            pairs.append(dict(variant=v, seed=s, baseline=ids.get("Baseline"), proposed=ids.get("Proposed"),
                              others=[ids[c] for c in ids if c not in ("Baseline", "Proposed")]))
    manifest = dict(
        format=FORMAT_VERSION, runs=runs,
        configs=[c for c in CONFIGS if any(r["config"] == c for r in runs)],
        variants=[v for v in S.VARIANTS if v in a.variants],
        seeds=sorted(set().union(*seeds.values())), pairs=pairs, demo=demo,
        generated=dict(at=datetime.datetime.now().isoformat(timespec="seconds"),
                       by="edge_mlc/sim/export_viewer.py", argv=sys.argv[1:],
                       results_dir=os.path.relpath(res, EDGE).replace("\\", "/")),
    )
    mb = write_js(os.path.join(a.out, "manifest.js"), "window.SIM_MANIFEST = ", manifest)
    tot = sum(r["bytes"] for r in runs) + sb + rb + mb
    print(f"scenario.js {sb / 1e6:.2f} MB, results.js {rb / 1e6:.2f} MB ({manifest['generated']['results_dir']}), "
          f"manifest.js {mb / 1e3:.1f} kB")
    print(f"total {tot / 1e6:.1f} MB in {time.perf_counter() - t0:.0f} s")


if __name__ == "__main__":
    main()
