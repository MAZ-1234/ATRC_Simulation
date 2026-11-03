# EDGE-MLC mission viewer

A web viewer for the EDGE multi-link controller simulation. It replays one mission twice,
Baseline on the left console and Proposed on the right, on the same seed and terrain, and
shows the 20-seed results, the scenario and the method behind them. The design system is
in [`DESIGN.md`](DESIGN.md); the data format is in [`src/data/README.md`](src/data/README.md)
and [`src/data/types.ts`](src/data/types.ts).

The build is a single `dist/index.html` (JS, CSS and fonts inlined) plus the simulation
data in `dist/data/`. Open it straight from disk: no server, no network.

Every number and claim on screen is computed from the exported simulator output at run
time. Nothing is typed in by hand, and the viewer never re-scores a run.

## Views

| Key | View | What it answers |
|---|---|---|
| 1 | Replay | Could the operator see what they needed, moment by moment? Simulated camera tiles at the delivered resolution and frame rate, the verdict against the operator requirements, each controller's decision log, true and measured link health, and a whole-mission timeline. Full-screen theatre (F) and a guided chapter tour (G). |
| 2 | Results | The 20-seed comparison with 95% intervals: headline, link changes, upload policies, handover headroom against the oracles, variants, ablation, segments, crater capacity, buffer size, and "Where Proposed does not win". |
| 3 | Scenario | The route, link ground truth against km for each variant, Starlink handovers, the driver script and the uploads. Assumptions are marked (A). |
| 4 | Method | How each controller decides, how the run is scored, and a worked prediction taken from the demo seed. |

## The 3-minute demo

The viewer opens on Replay at 0:03 (where the engine's scoring starts) on the demo seed.
The demo seed is chosen by the exporter (`typical_seed`): the nominal seed whose Baseline and
Proposed results are jointly closest to the 20-seed mean. It is never the best case.

1. Point at the timeline: Baseline's band (grey) tears far more often than Proposed's (blue).
   The "who saw" lane totals when only one controller had a usable view.
2. Click the "2.35 km" chapter. It plays the crater (Starlink only, 1 Mbps) at 4x. The
   verdict line under each console names the requirement that failed; the caption gives
   both controllers' usable share of the crater for this seed.
3. Click "1.55 km" for the radio fade and read Proposed's decision log: it predicts the
   failure and moves the front camera before the radio breaks.
4. Press 2 for Results: the headline, then "Where Proposed does not win".
5. "Show in replay" on any result jumps back to the moment that shows it.

Theatre: press F (or "Full screen" in the playback bar) to fill the screen with both
operators' camera feeds, Baseline left and Proposed right, with each side's verdict, a
running "usable so far" share (equal to the run's usable-view metric at the end of the
mission) and a scrubber over both usability ribbons. C switches between only the needed
camera and front and rear; Esc or F exits.

Hands-free alternative: press G (or "Play tour" next to the chapter chips) to play every chapter back to back at 4×, each followed by a short hold on its claim caption, with Previous / Pause / Next / Stop on the caption card; it works in theatre (F) too, and any seek or step ends it.
Click a chapter's claim sentence on the tour card ("How we got these numbers ›") for the
derivation: the operator requirement per manoeuvre, the samples the chapter counts, usable ÷
samples for each controller, the check against the engine's own segment metric, why the other
samples failed, why Proposed scored higher or lower in that stretch (built from what each
controller sent, cut and switched there), a side-by-side summary of how the two controllers
work with a link to the Method tab, and one typical sample worked through. Esc or "Back to the tour" resumes it.

Keys: Space play/pause, arrows step, `[` `]` speed, J/K previous/next event, 1-4 views,
T theme, P presenter mode, F theatre, C theatre cameras, G tour, `?` all shortcuts.

## 1. Export the simulation data

Run from `edge_mlc/` with the project venv. It writes `viewer/public/data/`:

```
../.venv/Scripts/python sim/export_viewer.py
```

- Default: seed 0 for all 7 variants (Baseline and Proposed; nominal also Baseline +
  duplicate video, Proposed (urgent_first) and the perfect-link-choice oracle), plus the
  demo seed for the nominal set. 22 runs, about 1 min on 12 cores, about 92 MB.
- `--seeds N`, `--variants ...` and `--configs ...` widen or narrow the export.
- `results.js` reads `edge_mlc/results_run/` (20 seeds) when its `summary.csv` exists,
  otherwise the committed 3-seed `edge_mlc/results/`. Produce the 20-seed set with
  `../.venv/Scripts/python sim/run_experiments.py --out results_run` (about 10 min on 12 cores).

## 2. Build and run

```
cd viewer
npm install
npm run dev        # http://localhost:5173 (serves public/data/)
npm run build      # tsc --noEmit, then vite build -> dist/index.html + dist/data/
npm run preview    # serves dist/
npm run typecheck
```

Run `npm run build` again after every re-export: the build copies `public/data/` into
`dist/data/`. To check a build in headless Chromium (every view, three sizes, both themes,
console errors logged; output in the gitignored `viewer/.screens/`):

```
../.venv/Scripts/python scripts/screenshot_all.py
```

## 3. Layout

| Path | What it holds |
|---|---|
| `src/styles/` | `tokens.css` (the only file with hex values), `base.css`, `fonts.css` |
| `src/format.ts` | every number formatter (DESIGN.md 8) |
| `src/data/` | `types.ts` (contract), `loader.ts`, `labels.ts`, `events.ts` |
| `src/state/` | the store, playback clock, URL hash sync, hooks |
| `src/components/` | shared primitives: Panel, Stat, Legend, SegmentedControl, Badge, Tooltip, Popover, ChartFrame, axes, colours |
| `src/app/` | app bar, keyboard, shortcut sheet, SVG patterns, live region |
| `src/views/replay/` | `route/`, `spine/`, `consoles/` (camera tiles, verdict, decision log), `timeline/` (timeline, playback bar) |
| `src/views/results/`, `scenario/`, `method/` | one folder per view |

Rules from DESIGN.md that are easy to miss:

- No hex outside `tokens.css`. The camera tiles' outdoor palette is the one exception.
- In SVG, set colours through `style={{ fill: "var(--...)" }}`, not the `fill=`/`stroke=` attributes.
- Canvas code reads its colours from `useTokens()` and redraws when they change.
- The viewer never re-scores. It reads usability from `samples.useful` and the metrics.
- Decode enum codes with the run's own `enums` through `dec()`, `linksOf()` and `linkNameOf()`.
