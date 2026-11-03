# Viewer data

The simulator output the viewer replays. It is written by
`edge_mlc/sim/export_viewer.py` into `viewer/public/data/`, and Vite copies it to
`dist/data/`. **`types.ts` in this folder is the authoritative format.**

## Loading (works from file://)

Nothing is fetched. Each file is a classic `<script>` that assigns a global:

| File | Global | Contents |
|---|---|---|
| `data/manifest.js` | `window.SIM_MANIFEST` | the run list, Baseline/Proposed pairs per variant+seed, and the export info |
| `data/scenario.js` | `window.SIM_SCENARIO` | link truth vs km for every variant, route zones, driver state machine, segments, constants |
| `data/results.js` | `window.SIM_RESULTS` | the results CSVs (summary, capacity, buffer, runs) as `{columns, rows}` tables |
| `data/runs/<id>.js` | `window.SIM_RUNS[id]` | one full replay, loaded on demand by injecting a `<script>` |

## Run files (columnar)

- `samples`, `cams.<cam>` and `truth.<link>` are on the engine's 0.1 s sample grid. Each has `meta.n_samples` entries.
- `decisions.cols` and `decisions.measured.<link>` hold one entry per `decide()` call at 10 Hz. Each has `meta.n_decisions` entries.
- `decisions.ttu` holds step functions over decision indices (Proposed only).
- Booleans are written as 0 or 1.
- Strings are integer codes into the run's own `enums`, where -1 means none. Codes are per run.
- Links are indices into `meta.links`. Ordered link lists are codes into `enums.linkset`.
- `reasons` lists `[t, text]` and keeps only reasons that are new at that decision.

## Regenerate

Run from `edge_mlc/` with the project venv:

```
../.venv/Scripts/python sim/export_viewer.py                      # default: seed 0, all variants
../.venv/Scripts/python sim/export_viewer.py --seeds 3            # seeds 0..2
../.venv/Scripts/python sim/export_viewer.py --variants nominal --configs Baseline Proposed
../.venv/Scripts/python sim/export_viewer.py --res results        # force results/ for results.js
```

The default run set has 17 runs. On `nominal` it exports Baseline, Proposed,
"Baseline + duplicate video", "Proposed (urgent_first)" and "Oracle: perfect link
choice". Every other variant gets Baseline and Proposed.

- Each run takes about 40–60 s on one core, and the runs go out in parallel.
- Each run file is about 4 MB.
- `results.js` reads `edge_mlc/results_run/` once `summary.csv` exists there, and `edge_mlc/results/` before that.

The exporter only subclasses the engine and wraps the decider; it does not change them. A run's metrics are identical to `engine.run(...)` for the same config, variant and seed.
