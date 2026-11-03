# EDGE-MLC mission viewer: design system

This is the single source of truth for the viewer. Five developers build from it in parallel without talking to each other, so when this file states a value, use that exact value. If something is missing, choose the quietest option that is consistent with the rules here and leave a `// DESIGN-GAP:` comment.

Base direction: **Twin consoles** (plan 3). Grafted in:
- from **Range Log** (plan 1): the "who could see" differential lane, instruments that stay quiet when nominal, presenter mode, step-exact cursor motion;
- from **Torn Ribbon** (plan 2): the torn ribbon pair, km-labelled chapters, and the claim, chart, data, caveat order in Results.

---

## 1. Concept

The viewer is the remote operator's ground station, shown twice. Baseline drives the left console and Proposed drives the right console, on the same seed over the same terrain. Between them is a **truth spine**: the world both controllers share, drawn once (route position, true link state, what the monitor measured, what the operator needs right now). Along the bottom, a full-width **mission timeline** shares one time axis across every track, and one cursor moves through all of it.

The viewer exists to answer one question: **could the operator see what they needed to see?** That question is answered in two forms:
- **Now**, in the camera tiles: what each controller actually delivered at the cursor time, drawn at the delivered resolution, refreshed at the delivered frame rate, and frozen when frames stop.
- **Over the whole mission**, in the ribbon pair: each controller's usable view as a band that tears wherever the view was lost, with the "who could see" lane between the two bands.

Everything else stays quiet. A nominal state draws no colour, and only exceptions draw ink.

Audiences:
- **Judges** (3 minutes, projector). They must see the crater result (Baseline's view is usable for about 9% of the crater segment, Proposed's for about 97%, in the committed 3-seed run) without anyone reading a number to them.
- **Analysts** (laptop, unlimited time). Every mark can be inspected, every claim links to the moment that shows it, and every loss is reported with the same weight as every win.

### 1.1 The 3-minute demo path (design to this)
| Time | Action | What the judge sees |
|---|---|---|
| 0:00 | App opens on Replay at t = 0, paused | Full-mission ribbon pair already drawn. Baseline's ribbon has visibly more tears. |
| 0:15 | Press K (next chapter, "2.35 km Crater") | Cursor jumps to 5 s before the crater. Left: Baseline is still sending the front camera at a trickle and the rear tile is frozen. Right: Proposed's rear tile is live. "Needed now: rear" badge. |
| 0:45 | Press Space at 4× | Tiles move. Baseline's red "not usable" sentence persists, and Proposed's says "Usable". |
| 1:10 | K to "1.6 km Radio lost behind the ridge", then "2.75 km Jammer blackout" | Decision log: "Front camera moved to 4G 1.4 s before the radio dropped". |
| 1:50 | Press 2 (Results) | Headline dot-and-interval plot, then "Where Proposed does not win". |
| 2:40 | Click "Show in replay" on any result | Jumps back to the exact seed and moment. |

The default demo seed is the first seed in the run whose crater result is closest to the run mean. The demo must not use the best-case seed. Its time is shown in the header like any other seed.

---

## 2. Colour tokens

Set the theme on `<html data-theme="light|dark">`. With no stored choice, follow `prefers-color-scheme`. T toggles the theme and the choice is saved in `localStorage` (wrap access in try/catch). **Recommend light for projection.** The shortcut sheet says so, and presenter mode does not force it.

All contrast ratios below were measured (WCAG 2.x) against the named surface.

### 2.1 Base
```css
:root, :root[data-theme="light"] {
  --color-bg:              #E8ECEB; /* page, app bar; graphite with a cool green tint, not cream */
  --color-surface-1:       #F6F8F7; /* panels (consoles, spine, timeline, results blocks) */
  --color-surface-2:       #FFFFFF; /* plot sheet: every chart plotting area, tables */
  --color-surface-sunken:  #DDE3E2; /* empty track background, segmented-control well */
  --color-surface-video:   #0F1416; /* camera tile interior, both themes (it is video) */

  --color-text-1:          #18211F; /* primary text, cursor line, focus ring. 15.4:1 on surface-1 */
  --color-text-2:          #4F5B60; /* secondary text, axis titles. 6.6:1 on surface-1 */
  --color-text-3:          #5E6A70; /* tick labels, captions, disabled. 4.7:1 on bg, 5.2:1 on surface-1 */
  --color-text-on-video:   #E9EEF0; /* overlays inside camera tiles. 15.9:1 on video */

  --color-border:          #C5CDCE; /* panel edges, table rules (structure only) */
  --color-border-strong:   #848F95; /* control outlines, input edges. 3.1:1 on surface-1 */
  --color-grid:            #E1E6E6; /* chart gridlines on surface-2 */
  --color-grid-strong:     #C5CDCE; /* zero line, segment boundaries in charts */
  --color-focus:           #18211F; /* = text-1. Focus ring is ink, never a brand hue */
  --color-cursor:          #18211F; /* timeline cursor / playhead */
  --color-zone-wash:       #E3E9E7; /* route zones (ridge, crater, contested) shaded behind tracks */
}
:root[data-theme="dark"] {
  --color-bg:              #131A1D;
  --color-surface-1:       #1B2327;
  --color-surface-2:       #212B30;
  --color-surface-sunken:  #101619;
  --color-surface-video:   #0B0F11;

  --color-text-1:          #E4E9EA; /* 13.0:1 on surface-1 */
  --color-text-2:          #A0ACB1; /* 6.9:1 */
  --color-text-3:          #8A979F; /* 4.8:1 on surface-2 */
  --color-text-on-video:   #E9EEF0;

  --color-border:          #344149;
  --color-border-strong:   #6B7A83;
  --color-grid:            #2A3439;
  --color-grid-strong:     #3C4A52;
  --color-focus:           #E4E9EA;
  --color-cursor:          #E4E9EA;
  --color-zone-wash:       #1F292E;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { /* copy every value from [data-theme="dark"] */ }
}
```
In code, write out the `@media` block in full, repeating every dark value. The empty braces above are shorthand for that.

### 2.2 Controllers
These are the report hexes from `edge_mlc/sim/plots.py`, so the viewer and the written report share one identity. Only Baseline and Proposed get colour.

```css
:root, :root[data-theme="light"] {
  --color-ctrl-baseline:       #8A8F98; /* fills. 3.05:1 on surface-1: graphics only */
  --color-ctrl-baseline-edge:  #5C626B; /* 1px edge on every baseline fill in light theme */
  --color-ctrl-baseline-text:  #5C626B; /* labels. 5.8:1 */
  --color-ctrl-proposed:       #1764C0; /* fills + text. 5.4:1 on surface-1 */
  --color-ctrl-proposed-text:  #1764C0;
  --color-ctrl-other:          #4F5B60; /* = text-2: ablations, oracles, other policies */
}
:root[data-theme="dark"] {
  --color-ctrl-baseline:       #A3A8B0; /* 6.7:1 */
  --color-ctrl-baseline-edge:  #A3A8B0;
  --color-ctrl-baseline-text:  #A3A8B0;
  --color-ctrl-proposed:       #5B9BE6; /* 5.5:1 */
  --color-ctrl-proposed-text:  #5B9BE6;
  --color-ctrl-other:          #A0ACB1;
}
```
Every other configuration (`Proposed - mission`, `Proposed - uploads`, `Proposed - predict`, `Baseline + duplicate video`, `Proposed (urgent_first)`, `Baseline (no shaping)`, and both oracles) is drawn in `--color-ctrl-other`, identified by its row label, never by hue:
- ablations and alternative policies: hollow ring, 1.5px;
- oracles: hollow ring with a dashed 1px interval and the label suffix "(upper bound, not deployable)".

### 2.3 Links
Link hues mean **link identity only**. They are never used for status.

```css
:root, :root[data-theme="light"] {
  --color-link-radio:         #5B8C5A; /* fill, 3.7:1 */
  --color-link-radio-text:    #43703F; /* 5.4:1 */
  --color-link-starlink:      #7A5EA8; /* fill + text, 4.9:1 */
  --color-link-starlink-text: #7A5EA8;
  --color-link-lte:           #D08A3C; /* fill, 2.7:1: ALWAYS with 1px --color-link-lte-edge */
  --color-link-lte-edge:      #9A5E1C; /* 4.9:1 */
  --color-link-lte-text:      #8A5317; /* 5.9:1 */
  --link-degraded-alpha:      0.30;    /* "up but below need" tint, same as plots.py */
}
:root[data-theme="dark"] {
  --color-link-radio:         #86B985;
  --color-link-radio-text:    #86B985;
  --color-link-starlink:      #A98BD9;
  --color-link-starlink-text: #A98BD9;
  --color-link-lte:           #E3A25A;
  --color-link-lte-edge:      #E3A25A;
  --color-link-lte-text:      #E3A25A;
  --link-degraded-alpha:      0.35;
}
```
The UI name of `lte` is **4G**. Display order is always Radio, Starlink, 4G.

Link state uses the same encoding everywhere, matching the report's timeline chart:
| State | Mark |
|---|---|
| Good (meets the stream's need) | solid link fill |
| Up, degraded | link fill at `--link-degraded-alpha` |
| Down | no fill, neutral hatch (`--hatch-neutral`) |
| No data | dotted 1px outline in `--color-status-unknown` |

### 2.4 Status
Status applies to **the operator's view and to uploads**, never to links. Red has one meaning: the operator cannot see what they need.

```css
:root, :root[data-theme="light"] {
  --color-status-bad:     #B42318; /* not usable / frozen / missed. 6.2:1 */
  --color-status-warn:    #855800; /* close to limit, low seed count. 4.6:1 on its wash over bg */
  --color-status-good:    #26775B; /* table check marks ONLY, always with the word */
  --color-status-unknown: #7E898E; /* graphics only (hatch, dotted outline) */
  --color-status-bad-wash:  rgba(180, 35, 24, 0.10);
  --color-status-warn-wash: rgba(143, 95, 0, 0.10);
}
:root[data-theme="dark"] {
  --color-status-bad:     #F97066;
  --color-status-warn:    #E3B341;
  --color-status-good:    #5CC8A0;
  --color-status-unknown: #6E7B82;
  --color-status-bad-wash:  rgba(249, 112, 102, 0.14);
  --color-status-warn-wash: rgba(227, 179, 65, 0.14);
}
```
Rules:
- **A usable view is drawn in the controller's own colour, never in green.** Green would collide with radio green and with the stock traffic-light dashboard.
- Status always pairs colour with a second channel: a glyph (an SVG cross, exclamation or question mark), a hatch, a tear edge, or a word.
- Status colour on a large area is limited to the 10–14% wash. Solid red appears only as edges, glyphs and text.

### 2.5 Patterns
Define the patterns once in a hidden `<svg><defs>` in the app shell. Use these ids, and use CSS gradients for HTML elements.
```css
:root {
  --hatch-size: 5px;
  --hatch-neutral: repeating-linear-gradient(135deg, var(--color-status-unknown) 0 1px, transparent 1px var(--hatch-size));
  --hatch-bad:     repeating-linear-gradient(135deg, var(--color-status-bad) 0 1.5px, transparent 1.5px var(--hatch-size));
  --hatch-warn:    repeating-linear-gradient(45deg,  var(--color-status-warn) 0 1px, transparent 1px var(--hatch-size));
}
```
The SVG pattern ids are `pat-hatch-neutral`, `pat-hatch-bad` and `pat-hatch-warn`. They use the same angles and a 5-unit tile.

---

## 3. Typography

```
npm i @fontsource/barlow @fontsource/barlow-semi-condensed
```
```ts
import "@fontsource/barlow/400.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/600.css";
import "@fontsource/barlow-semi-condensed/500.css";
import "@fontsource/barlow-semi-condensed/600.css";
```
Verified: v5.3.0 of both packages ships the OpenType `tnum` feature. Barlow's default figures are proportional, so tabular numbers must be switched on explicitly.

Barlow comes from highway signage, which suits a vehicle on a route. **There is no monospace face anywhere**, including timestamps, the decision log and code-like names.

```css
:root {
  --font-ui:      "Barlow", system-ui, sans-serif;               /* body, log, tables, ticks */
  --font-display: "Barlow Semi Condensed", "Barlow", sans-serif; /* titles, clock, track labels, figures */

  font-size: 15px;            /* laptop root; presenter mode sets 18px */
  font-family: var(--font-ui);
  font-variant-numeric: tabular-nums lining-nums;  /* set on :root, applies everywhere */

  /* Scale: classic steps 12 13 15 18 21 24 36 at the 15px root (rem so presenter mode scales it) */
  --fs-12: 0.8rem;     /* tick labels, captions, tile overlays. Never smaller. */
  --fs-13: 0.8667rem;  /* secondary text, track labels, log timestamps, table cells */
  --fs-15: 1rem;       /* body, decision log text, controls */
  --fs-18: 1.2rem;     /* panel titles, metric values in tables */
  --fs-21: 1.4rem;     /* view titles */
  --fs-24: 1.6rem;     /* claim sentences in Results, mission clock */
  --fs-36: 2.4rem;     /* headline figure on Results (one per view, max) */

  --lh-tight: 1.15;    /* display, figures */
  --lh-ui:    1.35;    /* controls, log, tables */
  --lh-prose: 1.5;     /* claims, captions, Method prose; max 68ch */

  --fw-regular: 400; --fw-medium: 500; --fw-semibold: 600;
}
```
| Role | Font | Size | Weight |
|---|---|---|---|
| View title ("Replay") | display | 21 | 600 |
| Panel title ("Baseline", "Links now") | display | 18 | 600 |
| Mission clock | display | 24 | 600 |
| Track label | display | 13 | 500 |
| Metric value | display | 24 (36 for the single headline) | 600 |
| Body, decision log | ui | 15 | 400; the time stamp is 500 in text-2 |
| Tick labels, captions | ui | 12 | 400 in text-3 |
| Results claim sentence | ui | 24 | 500, max 40ch |

Rules:
- Sentence case everywhere. No all caps, no letter-spacing, no single-word accent colour or italic in titles.
- Left-align text. Right-align numbers in tables, aligned on the decimal by using tabular figures and a fixed number of decimals per column.
- Controller names in prose are set in the controller's text colour, weight 500. That is the only coloured text in prose.
- Units are a normal space after the number, in the same size and colour: "2.41 km", "6.1 Mbps".

---

## 4. Spacing, radius, elevation, strokes

```css
:root {
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px; --space-4: 16px;
  --space-5: 24px; --space-6: 32px; --space-7: 48px; --space-8: 64px;

  /* Radius follows hierarchy: one radius on everything is a tell */
  --radius-0: 0;    /* tracks, chart marks, ribbons */
  --radius-1: 2px;  /* badges, camera tiles, swatches */
  --radius-2: 4px;  /* buttons, segmented controls, selects, inputs */
  --radius-3: 6px;  /* panels */
  --radius-4: 8px;  /* popovers, tooltips, menus, shortcut sheet */

  /* Panels are flat: surface colour + 1px border, no shadow */
  --shadow-0: none;
  --shadow-pop: 0 1px 2px rgba(16, 22, 25, 0.12), 0 6px 20px rgba(16, 22, 25, 0.16); /* popovers only */

  --stroke-hair: 1px;    /* gridlines, borders */
  --stroke-data: 1.5px;  /* lines, interval bars, outlines */
  --stroke-bold: 2px;    /* cursor, focus ring, measured line in link health */
  --tile-ring: 2px;      /* "needed now" tile outline */
}
:root[data-theme="dark"] {
  --shadow-pop: 0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.5);
}
:root[data-presenter="on"] {
  font-size: 18px;
  --stroke-hair: 1.5px; --stroke-data: 2.25px; --stroke-bold: 3px; --tile-ring: 3px;
}
```
Presenter mode (key P, or the header button labelled "Presenter") scales type and strokes for a projector. It does not change the layout grid. At 1280×720 with presenter on, the 1280 collapse rules apply.

---

## 5. Layout and app shell

### 5.1 Grid
- Breakpoints: `wide` ≥ 1360px, `compact` 1024–1359px, `narrow` below 1024px (designed at 768).
- Page margin: 24px on wide, 16px on compact and narrow. Panel gap is 12px (`--space-3`) everywhere. Panel padding is 16px on wide and 12px on compact and narrow.
- Every time-axis chart shares the **timeline gutter**, a 168px label column (136px compact, 96px narrow), so x positions line up across panels inside a view.
- No horizontal page scroll at any width. Only the 768px timeline may scroll vertically.

### 5.2 App bar (48px, 44 compact)
```
EDGE-MLC mission viewer   Replay  Results  Scenario  Method        Run ▾  Variant ▾  Seed ▾  Compare ▾   Presenter  ◐
```
- **Tabs** (keys 1–4) are a `role="tablist"`. The active tab gets a 2px text-1 underline and weight 600. The others are text-2 weight 500. Routes are `#/replay`, `#/results`, `#/scenario` and `#/method`, with query params `?variant=nominal&seed=7&t=518.3&cmp=Baseline` so every state can be shared and deep-linked.
- **Run** chooses the results source:
  - "20 seeds (results_run)" is enabled only when `results_run/summary.csv` exists;
  - "3 seeds (committed)" is the default fallback.
  - If the 20-seed run is missing, a warn badge next to the selector reads "3-seed results". Its tooltip uses copy example 9 (section 10).
- **Variant**: nominal, harsh_handovers, heavy_jamming, no_lte, fast_fade, overlap, overlap_harsh. Each is shown in plain words first ("Nominal", "Harsh handovers", "Heavy jamming", "No 4G", "Fast radio fade", "4G overlap", "4G overlap with harsh handovers"), with the code name in the tooltip.
- **Seed** affects Replay only. The list shows the seed number and the run's mean-closeness marker "typical" on the demo seed.
- **Compare** sets the configuration of the left console (default `Baseline`). The right console is always `Proposed`. Analysts can put `Proposed - mission` on the left to see the mission-awareness ablation.
- **Theme** is a ◐ icon button with `aria-label="Switch to dark theme"` (or light).
- **Presenter** is a toggle button with `aria-pressed`.

The app bar sits on `--color-bg` with a 1px `--color-border` bottom rule. There is no logo graphic: the product name is set in display 18/600.

---

## 6. Views (wireframes at 1440×900)

### 6.1 Replay (key 1, default)
Vertical budget: app bar 48, route strip 64, consoles row 452, timeline 280, playback bar 56. Main row columns are `1fr 336px 1fr`.

```
┌ EDGE-MLC mission viewer   Replay  Results  Scenario  Method     Run ▾ Variant ▾ Seed 7 ▾ Compare ▾  Presenter ◐ ┐
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Route   0 km ▲4G base ──── ridge▒▒1.3–1.6 ──── ▲4G village 2.0 ─ trees ┃ crater ◎ ─ contested ▒▒▒ ── 3.0 km  │
│ out     ═══════════════════════════════════════════════════════════■ 2.41 km, reversing              │
│ back                                          1.4 km end ◄─────────────                                │
│ Chapters  [1.6 km Radio lost] [2.10 km Trees] [2.35 km Crater] [2.75 km Jammer blackout] [3.0 km Inspection] │
├───────────────────────────────────────┬───────────────────────┬────────────────────────────────────────┤
│ Baseline                              │ Links now             │ Proposed                               │
│ ┌ Front ────────────┐ ┌ Rear ── Needed now ┐ truth ▇ measured ─ │ ┌ Front ────────────┐ ┏ Rear ── Needed now ┓ │
│ │ ░░ pixelated ░░   │ │   frozen         │ Radio    ⟋⟋⟋ down   │ │                   │ ┃ live horizon     ┃ │
│ │                   │ │ 1.4 s old        │ Starlink ▂▂─ 1.0 Mbps│ │ 320×240, 1 fps    │ ┃ 640×480, 20 fps  ┃ │
│ │ 640×480, 10 fps   │ │ 320×240, 1 fps   │   handover in 3.2 s  │ │ via Starlink      │ ┃ via 4G, 0.2 s old┃ │
│ └ via Starlink ─────┘ └ via Starlink ────┘ 4G       ▇▇─ 6.1 Mbps│ └───────────────────┘ ┗──────────────────┛ │
│ ✕ Not usable: rear view 1.4 s old      │                       │ ✓ Usable: rear view at 20 fps, 0.2 s old │
│   (reversing needs 0.5 s or newer)     │ Needed now            │                                        │
│ Mode seen: Driving (true: Reversing)   │ Rear camera, 10 fps,  │ Mode seen: Reversing                   │
│ Decisions                              │ 0.5 s old at most,    │ Decisions                              │
│ 08:41.2  Front kept on Starlink at L4  │ 320 px wide or more   │ 08:40.9  Reverse detected: rear camera │
│          (Starlink RTT 180 ms, OK)     │                       │          first, front cut to TRICKLE   │
│ 08:39.8  …                             │ Uploads queued        │ 08:40.1  …                             │
│                                        │ Crater scan 20 MB     │                                        │
│                                        │ 3.1 MB sent           │                                        │
├───────────────────────────────────────┴───────────────────────┴────────────────────────────────────────┤
│ Segment   │leave base│radio edge│transit       │crater│contested│insp│contested│transit back│radio│     │
│ Radio     │██████████████▓▓░                                                                │▓▓██      │
│ Starlink  │█▌████▌████▌████▌████▌████▌███▂▂▂▂▌██▓▓⟋⟋▓█▌████▌████▌████▌████▌████▌████        │
│ 4G        │███▓░               ░▓████████████████████▓▓██████████████▓░                      │
│ Baseline  │███████ ████ ██████ █ ████   ███ ██████ ████████ ███    (red-edged gaps = view lost)│
│  streams  │ front/rear link sub-rows, 4px each                                                 │
│ Who saw   │       ▀       ▀▀      ▀▀▀▀▀▀▀▀  ▀    ▄          Proposed only 112 s  Baseline only 9 s │
│ Proposed  │██████████████████ ████████████████████ █████████████                              │
│  streams  │ front/rear link sub-rows                                                           │
│ Manoeuvre │Driving──────────────────────Prec Rev Prec Driving───Stopped──Driving               │
│ Uploads   │      ◆Scan 1.70 km      ◆Crater scan          ◆Still ◆Clip  ··· background chunks  │
│           │0:00      2:00      4:00      6:00 ┃ 8:41     10:00 ...                      22:04  │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ▶  ⏮ ⏭   08:41.2 / 22:04.3   2.41 km   Speed 0.5× 1× 2× [4×] 8× 16× 60×   Jump to: [Divergences] Interruptions Chapters All   ? │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
Notes:
- **Route strip.** This is a schematic on a km axis (0–3.0 km) with an out lane and a back lane. It shows zones as `--color-zone-wash` spans with sentence-case labels and 4G towers as small ▲ glyphs. The vehicle is a 10px square in text-1 with a direction chevron. There are no maps, no satellite imagery and no 3D: the simulator is position-only. The chapter chips are the Tour (see 6.1.1).
- **Consoles mirror each other.** Front is always the left tile and rear the right tile in both consoles. Both tiles are 4:3 at 232×174 on wide.
- **Spine**, top to bottom:
  - "Links now": three link health rows;
  - "Needed now": the operator requirement for the true manoeuvre, from config `requirements:`;
  - "Uploads queued": request name, size and progress per controller, as two thin bars in the controller colours.
- **Timeline.** Tracks top to bottom: segment, the three links (truth), the Baseline ribbon plus its stream sub-rows, the who-saw lane, the Proposed ribbon plus its stream sub-rows, manoeuvre (true), uploads, and the time axis. The entire mission always fits the width, with no horizontal zoom in v1. Drag-select on the axis zooms to a range, and "Show whole mission" resets it.
- **Hover tooltip on any track** shows a crosshair readout: time, km, segment, true manoeuvre, each link's truth and measured value, and each controller's usable/not-usable verdict with the reason. Clicking a track seeks to that point.

#### 6.1.1 Tour (grafted from Torn Ribbon's Story view; not a fifth view)
There are five chapters, named by km because the km values are the real sequence:
1. "1.6 km Radio lost behind the ridge"
2. "2.10 km Trees block Starlink"
3. "2.35 km Crater: 1 Mbps, stop, scan, reverse"
4. "2.75 km Jammer blackout"
5. "3.0 km Inspection stop"

Clicking a chip seeks to 5 s before the chapter and plays at 4× until 10 s after it, then pauses. While a chapter plays, a one-line **claim caption** appears under the chip row. It is built from the trace for the current seed, for example "In the crater, Proposed's view was usable for 96% of the time; Baseline's for 9%." The chip of the current chapter shows as pressed. J and K honour the "Chapters" jump filter.

#### 6.1.2 Replay at 1280×720 (compact)
- App bar 44. The route strip collapses to 40px: one lane, and the chapter chips show only km ("1.6 km"), with full names in tooltips.
- Main row 328px with columns `1fr 280px 1fr`. Tiles are 180×135. The tile footer absorbs the "via 4G" line.
- Each console's decision log shows the 3 newest entries plus a "Show all decisions" button, which opens a popover anchored to the console.
- Timeline 260px, with link tracks 12px tall (16 on wide) and the stream sub-rows hidden behind a "Show streams" toggle in the timeline header.
- The playback bar is 48px. The speed list collapses into a SegmentedControl showing 1×, 4×, 16× and a "More" menu.

#### 6.1.3 Replay at 768 wide (narrow)
```
┌ EDGE-MLC viewer   Replay Results Scenario Method   Run ▾  ◐ ┐   <- Run popover holds run/variant/seed/compare
├ Route (one lane, km only chips) ─────────────────────────────┤
├ Links now (spine as a full-width row of 3 link rows) ────────┤
├ [Side by side] [Baseline] [Proposed]                         ┤
├ Baseline console        │ Proposed console                   ┤   tiles 168×126, log 3 entries
├ Timeline (full width, page scrolls vertically)               ┤
└ Playback bar: sticky bottom, 56px, play, clock, speed menu ─┘
```
Below 600px, "Side by side" is unavailable and the toggle defaults to Proposed.

### 6.2 Results (key 2)
Results reads as an argument. Each block keeps the same order: **claim sentence, one chart, "Show data" table toggle, one-line caveat, "Show in replay" link.**

```
┌ app bar ─────────────────────────────────────────────────────────────────── Run: 20 seeds ▾ ───────┐
├──────────────────┬───────────────────────────────────────────────────────────────────────────────┤
│ Headline         │ Results                                                       20 seeds, nominal │
│ When a link      │                                                                               │
│  changes         │ Proposed keeps a usable view for 84.3% of the mission.                         │
│ Upload policies  │ Baseline manages 76.0%. Same seeds, same scoring.                              │
│ Handover         │                                                                               │
│  headroom        │ Usable view (%)        70        75        80        85        90              │
│ Variants         │   Baseline                       ├─●─┤ 76.0                                     │
│ Ablation         │   Baseline + duplicate video      ├●┤ 76.9                                     │
│ By segment       │   Proposed                                     ├●┤ 84.3                         │
│ Crater capacity  │   Oracle: perfect link choice                   ┊○┊ 84.7 (upper bound)          │
│ Buffer size      │ View interruptions (count)      same form                                     │
│ Where Proposed   │ Video delay p95 (ms)           same form                                      │
│  does not win    │ [Show data]   Dot = mean, bar = 95% CI, n = 20 seeds.                        │
│                  │ Caveat: usability thresholds are assumptions (A) from the config.             │
│ Source           │ [Show in replay: crater, seed 7, 09:12.0]                                     │
│ results_run      ├───────────────────────────────────────────────────────────────────────────────┤
│ 20 seeds         │ When a link changes ...                                                       │
└──────────────────┴───────────────────────────────────────────────────────────────────────────────┘
```
- **Left rail** (240px). Links to sections in reading order, without numbers (it is an index). Scroll-spy marks the current section with a 2px text-1 left rule. Underneath is source information: folder, n, and the variants present.
- **Content column** is at most 880px wide and left-aligned. Charts are 880 × (32px per row + 56px of axes).
- **Sections and the columns of `summary.csv` they read:**
  - Headline: `useful_view_pct`, `interruptions`, `longest_interruption_s`, `video_delay_p95_ms`.
  - When a link changes: `useful_transition_pct`, `interruptions_transition`, `radio_leave_minus_fail_s`.
  - Upload policies: `scan_drive_s`, `lidar_crater_s`, `still_s`, `clip_s`, `fps_delivered_mean_DRIVE`, with the 10 fps driving floor drawn as a reference line.
  - Handover headroom: the oracles against Proposed.
  - Variants: small multiples, one row per variant, with Baseline and Proposed dots and the ribbon-pair miniature (120×16) beside each variant name.
  - Ablation: Proposed against Proposed minus each part.
  - By segment: `useful_<segment>` for the 9 segments as a dot plot, segments on y in mission order.
  - Crater capacity: `capacity.csv`, as a line with an interval band.
  - Buffer size: `buffer.csv`.
  - Where Proposed does not win: section 6.2.1.
- Every `_ci` column is the 95% CI half-width. **When n < 5, a warn badge "n = 3: intervals are rough" sits beside the chart title.**
- Number values come only from the CSV. Nothing is typed in by hand, the claim sentences included: each one is a template filled from the data.

#### 6.2.1 Where Proposed does not win
This section gets the same visual weight as the Headline: same chart sizes, no softer colours. Its content follows `edge_mlc/RESULTS.md` § "Where the proposed design does not win". Each item has a chart and a "Show in replay" link:
1. Crater scan delivery: adaptive against urgent_first (`lidar_crater_s`).
2. Predictive switching adds little to the headline number (`Proposed - predict` against `Proposed`).
3. Unshaped uploads clear the background backlog fastest (`bg_backlog_mb_at_end`) at the cost of the live view.

Add any further row where an ablation beats Proposed in the selected run. For example, in the committed run `Proposed - uploads` scores 84.7% against Proposed's 84.3% on usable view. That comparison is computed, not hard-coded.

#### 6.2.2 Results at 1280×720 and 768
- **1280:** the rail narrows to 200px and the content column to `min(880px, 100%)`.
- **768:** the rail becomes a sticky `<select>` labelled "Section" under the app bar, and charts span the full width minus the 16px margins. Row labels wrap to two lines at most. They are never truncated without a tooltip.

### 6.3 Scenario (key 3)
This view shows the world the controllers drive through, with no controller in it.

```
┌ app bar ───────────────────────────────────────────────────────────────────────────────────────────┐
├────────────────────────────────────────────────────────────────────────────┬───────────────────────┤
│ Scenario                                              Variant: nominal ▾  │ Assumptions (A)        │
│ Link capacity along the route (Mbps), outbound                            │ Radio fades over the   │
│ Radio     ██████████████▓▓▒░                                              │  ridge 1.3–1.6 km      │
│ Starlink  ████████████████████████████▂▂▂▂▂ crater 1 Mbps  ███████       │ 4G towers at 0 and     │
│ 4G        ███▓▒░          ░▒▓████████████████████████▓▒                   │  2.0 km                │
│ zones     │ridge│        │village 4G│trees│crater│contested │inspection│  │ Starlink handovers at  │
│ km        0    0.5    1.0    1.5    2.0    2.5    3.0                     │  :12 :27 :42 :57       │
│ Return leg (3.0 to 1.4 km) drawn as a second strip, same axis             │ Jammer blackout 6 s,   │
├────────────────────────────────────────────────────────────────────────────┤  first pass past 2.75 │
│ Mission script: position over time                                       │ (each item highlights  │
│ km ▲  ╱‾‾‾‾╲___╱‾‾‾ (out to 3.0, back to 1.4), events as labelled ◆      │  its zone on hover)    │
│ Starlink handover schedule: one minute dial strip, 4 ticks                │                        │
├────────────────────────────────────────────────────────────────────────────┤ Variant differences    │
│ Mission events table: time, km, event, what the operator needs            │ table                  │
└────────────────────────────────────────────────────────────────────────────┴───────────────────────┘
```
- The km axis matches the Replay route strip: same zone labels, same order.
- Each assumption row carries an "(A)" badge. Hovering it highlights the zone on the chart, and the zone highlights the row back.
- Variant differences come from `VARIANTS` in `scenario.py`, shown as plain sentences, for example "Heavy jamming: contested zone 2.40–2.85 km, 12 s blackout."
- **1280:** the assumptions rail is 280px wide. **768:** the assumptions rail moves below the charts.

### 6.4 Method (key 4)
```
┌ app bar ───────────────────────────────────────────────────────────────────────────────────────────┐
├───────────────────────────────────────────────┬────────────────────────────────────────────────────┤
│ Baseline decides like this                    │ Proposed decides like this                         │
│ 1 Measure each link (RTT, loss, rate)         │ 1 Measure each link, plus its trend over 2 s       │
│ 2 Rank links by fixed priority                │ 2 Detect the manoeuvre (driving, reversing, ...)   │
│ 3 Steer each stream to the best link above    │ 3 Pick the camera the manoeuvre needs; give it the │
│   threshold                                   │   best link and level                              │
│ 4 Send uploads in the remaining capacity      │ 4 Move early when a link is falling or a Starlink  │
│                                               │   handover is due                                  │
│                                               │ 5 Schedule uploads around the protected view       │
├───────────────────────────────────────────────┴────────────────────────────────────────────────────┤
│ What "usable view" means (from config requirements, all (A))                                        │
│ Manoeuvre   Camera  Newest frame at most  Frame rate at least  Width at least                       │
│ Driving     front   0.5 s                 10 fps               320 px                               │
│ ...                                                                                                 │
│ Video ladder: PAUSED, TRICKLE 320×240 1 fps 15 kbps, L2 ..., L5 640×480 20 fps 2000 kbps            │
├────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Caveats (verbatim from RESULTS.md)                                                                  │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
- Numbered steps are allowed here because they are a real sequence. Step numbers are display 18/600 in text-2. Each step is one line, wrapped at 52ch.
- Requirements and ladder tables are rendered from the YAML values (exported at build time), not retyped.
- **1280:** layout unchanged. **768:** the two columns stack, Baseline first.

---

## 7. Component inventory

Every component takes `className` and forwards refs. "States" lists every state the component must render. Hover changes only the border to `--color-border-strong` or adds a 4% text-1 overlay: there is no lift, no shadow and no scale.

| Component | Anatomy | States and rules |
|---|---|---|
| **Panel** | `<section>` with surface-1 background, 1px border, radius-3 and a title row (display 18/600 plus optional right-aligned actions). | default, loading, empty, error. **Loading** shows the title plus a static text-3 line "Loading seed 7", with no shimmer. **Empty** gives the direction: "No trace for seed 12. Export traces for this run, then reload. (DESIGN-GAP: name the export command once the trace exporter exists.)" **Error** gives a status-bad glyph and a sentence naming what failed and the fix. Panels never nest panels. |
| **Metric** (stat with CI) | label (13, text-2), value (display 24/600) with unit, CI line (12, text-3, for example "95% CI 84.0–84.6, n = 20"), and an optional 120px dot-interval sparkline. | normal, low-n (warn badge "n = 3"), missing ("No data for this variant" in text-3, value shown as an en dash), compared (shows Δ against the other controller, for example "+8.3 points"). The Δ is plain text and is never coloured green or red. |
| **Legend** | inline row above the chart, left-aligned. Each item is a swatch shaped like its mark (band 16×8, line 16×2, dot 8, hatch 16×8) plus a label in 13 text-2. | static, interactive (click toggles the series, `aria-pressed`, hidden series greyed to text-3 with a struck-through swatch). |
| **SegmentedControl** | `role="radiogroup"`, sunken well, radius-2. Options are 28px tall (32 in presenter mode). | default, hover, selected (surface-2 background, 1px border-strong, weight 600), focus-visible (ring), disabled (text-3). Arrow keys move the selection. |
| **Tooltip** | surface-2 background, radius-4, shadow-pop, 1px border, max 320px, 13px text. Opens after 300 ms on hover and immediately on focus; Esc closes it. | Readout variant: rows of "label, value", with numbers right-aligned. Never more than 8 rows. |
| **Badge** | 20px tall, radius-1, 12px weight 500. | `neutral` (text-2 on sunken), `needed` ("Needed now", text-1 1px outline), `status-bad/warn/good/unknown` (glyph + word, wash background), `link` (swatch + "4G"), `level` ("L3"), `assumption` ("(A)", text-2 outline). |
| **Timeline track** | label cell (gutter width, display 13/500) plus a plot cell drawn on canvas for dense rows and SVG for overlays. | default; hover (crosshair line plus readout); focused (`role="slider"`-like with `aria-valuetext` such as "08:41.2, Starlink degraded, 1.0 Mbps"); left/right arrows move the cursor while a track is focused. **Ribbon variant:** 20px controller-colour band, with a gap where not usable. Each gap has 2px `--color-status-bad` vertical edges, a 10% bad wash inside, and a 1px baseline edge in light theme. |
| **Who-saw lane** | 14px between the ribbons, mirrored. Baseline-only seconds hang above the centre line in the Baseline colour; Proposed-only seconds sit below it in the Proposed colour. Seconds where neither controller can see get the bad hatch at full height. | The header tally reads "Proposed only 112 s, Baseline only 9 s, neither 48 s", computed from the trace, all three always shown. Clicking a block seeks to its start and opens both decision logs at that time. |
| **Playback bar** | play/pause (40px), previous/next event, clock (display 24/600, "08:41.2 / 22:04.3"), km readout, speed SegmentedControl (0.5×, 1×, 2×, 4×, 8×, 16×, 60×), jump filter SegmentedControl (Divergences, Interruptions, Chapters, All), shortcut sheet button "?". | playing, paused, at-end ("Mission ended at 22:04.3. Press Home to restart."), no-trace (disabled controls plus empty-state text). |
| **Camera tile** | 4:3, radius-1, `--color-surface-video`. A canvas renders the drawn horizon (see 9.3) at the delivered `w×h` and upscales it with `image-rendering: pixelated`. Overlays use 12px `--color-text-on-video` on a 60% black strip: top-left camera name ("Front", "Rear"), top-right the Needed now badge, bottom "640×480, 20 fps, via 4G". The frame-age bar runs along the bottom edge: its width is age / 1 s, text-on-video below 0.3 s, warn from 0.3 to 0.5 s, bad above 0.5 s. | **live**; **degraded** (delivered level below the need, pixelated); **frozen** (no new frame: image holds, a 2px bad edge appears, and the age counter shows "1.4 s old"); **paused** (level PAUSED: black with "No video sent" centred); **not needed** (no verdict, since only the needed camera is scored); **no data** (dotted unknown outline, "No frame data in this trace"). The needed tile also has a `--tile-ring` text-1 outline. |
| **Link health row** | link name in link text colour plus swatch; 30-s truth band (state encoding from 2.3); measured line overlaid (2px text-1 at 80%); current value right-aligned ("6.1 Mbps"); secondary line in text-3 ("RTT 62 ms, loss 0.4%"). For Starlink, "Handover in 3.2 s" appears from 5 s before :12, :27, :42 and :57. | good (no extra ink: a nominal row stays quiet), degraded (value in text-1 weight 600), down (value replaced by "Down" plus the hatch swatch), unknown. |
| **Decision log entry** | time (500, text-2, "08:41.2"), sentence (15/400), measured values quoted inside the sentence. A 3px left rule in the controller colour marks entries that start a divergence. | default, current (the entry at or just before the cursor gets a surface-2 background), divergence (left rule), hovered (shows its tick on the timeline). New entries do not animate in. Under reduced motion the log jumps instead of scrolling smoothly. |
| **Chart frame** | `<figure>` containing the title (display 18/600, a plain sentence of what is measured with its unit), the legend, an SVG plot on surface-2, and a `<figcaption>` for n, CI method and source. The "Show data" toggle reveals the `<table>` the chart is drawn from. | loading, empty, low-n, normal. Each frame has `role="img"` with an `aria-label` summarising the finding, and the table is always in the DOM for screen readers. |

---

## 8. Chart conventions

- **Form.** Comparisons across configurations are **dot-and-interval plots**: a dot at the mean (6px Baseline/Proposed filled, other configurations hollow rings) and a horizontal 1.5px bar across the 95% CI. Configurations go on y, the metric on x. Do not use bar-with-whisker charts or stat-card heroes.
- **Axes.** The x axis is at the bottom, with tick labels 12/text-3 and 5–7 ticks on round values. The axis title sits once at the top-left of the plot in 13/text-2 with its unit in parentheses: "Usable view (%)". There are no y-axis titles because the row labels are the axis. Gridlines are vertical only, 1px `--color-grid`; there is no plot border.
- **Zero.** Percentages and counts start at a round value near the data; the axis does not have to start at zero for dot plots. Time-series of capacity start at 0.
- **Colour.** Baseline and Proposed use their tokens. Everything else is `--color-ctrl-other`. Links use link tokens only when the chart is about links.
- **Reference lines** (thresholds such as "Driving needs 10 fps"): 1px dashed `--color-text-2`, with the label in 12/text-2 at its left end, above the line. Do not draw them in red unless the line marks the usability limit, in which case use `--color-status-bad` dashed with the label "Usability limit".
- **Annotations.** Direct-label the end of a line or row; avoid separate legends when ≤ 3 series. Annotation text is 12/text-2. Leader lines are 1px text-3. There are no arrows with heads.
- **Time axis** in Replay: labels every 2 min ("0:00, 2:00 … 22:00"), plus the cursor time label in a text-1 chip on the axis.
- **Number formatting.** All formatting lives in the shared helpers in `src/format.ts`:

  | Helper | Output | Rule |
  |---|---|---|
  | `fmtClock(t)` | "08:41.2" | mm:ss.s; above 60 min, h:mm:ss |
  | `fmtDur(s)` | "37.6 s", "3 min 03 s" | below 60 s, one decimal; from 60 s, minutes and zero-padded seconds |
  | `fmtKm(d)` | "2.41 km" | two decimals |
  | `fmtPct(x)` | "84.3%" | one decimal, no space |
  | `fmtCI(lo, hi)` | "84.0–84.6" | en dash, same decimals as the mean |
  | `fmtPm(h)` | "±0.3" | tables only |
  | `fmtMbps(x)` | "6.1 Mbps" | one decimal |
  | `fmtMs(x)` | "95 ms" | integer |
  | `fmtFps(x)` | "20 fps" | integer |
  | `fmtMB(x)` | "20 MB" | integer at or above 10, otherwise one decimal |
  | `fmtCount(n)` | "74", "1,240" | integer, thousands separator |
  | `fmtDelta(x, unit)` | "+8.3 points", "−32 ms" | true minus sign U+2212 |

  Means of counts over seeds show one decimal ("47.3 interruptions").
- **CI display.** Charts show the bar, tables show "84.3 ±0.3", prose and tooltips show "84.3% (95% CI 84.0–84.6)". n is always visible in the figcaption.
- The viewer **never re-scores**. Usable, segments and interruptions come from the simulator's output, so the viewer and RESULTS.md cannot disagree.

---

## 9. Motion and the memorable element

### 9.1 Where boldness is spent
The bold element is the **usable view**, shown live in the camera tiles and over time in the ribbon pair with the who-saw lane.
- The camera tiles are the only dark rectangles in the light theme and the only imagery in the product.
- The ribbons are the thickest solid controller-coloured marks on screen.

Everything else is quiet:
- no gradients, no glow, no decorative icons;
- link tracks stay pale when nominal;
- the spine shows nothing alarming unless something is wrong.

### 9.2 Motion rules
- Playback is the only motion that runs without user input, and the user starts it.
- The cursor moves in discrete 0.1 s steps with no easing, the way an instrument reports.
- Tiles change image only when a frame arrives at the delivered fps.
- UI responses (popover open, tab switch, theme switch, chapter jump) use `--dur-fast: 120ms` with `--ease: cubic-bezier(0.2, 0, 0, 1)`, as opacity only. Nothing slides, bounces, scales or lifts.
- There are no entrance animations and no animated number counters. The single exception: on the first load of Replay, the ribbon pair draws left to right once over 1.2 s, and only if the user has not interacted yet.
- Nothing blinks. Alarms are a solid edge and a sentence.
- `@media (prefers-reduced-motion: reduce)`:
  - `--dur-fast: 0ms`;
  - the ribbon draws complete;
  - the log jumps instead of scrolling;
  - tiles update at most 2 times per second and show the fps as text ("20 fps") instead of reproducing a stutter;
  - the scrubber jumps.

### 9.3 Camera tile drawing
Each tile shows a simple drawn horizon keyed to vehicle position, and to direction for rear. Draw it with a fixed palette that is independent of the theme, because it is a picture of the outdoors:
- sky `#9FB3BF`, far hills `#6E7F73`, ground `#8A8468`, trees `#3F5A43`, buildings `#B9B2A3`, crater rim `#5E5444`.

| km and situation | Features in the horizon |
|---|---|
| 0–0.3 km | base buildings and 4G mast |
| 1.3–1.6 km | ridge rising |
| about 2.0 km | village roofs and 4G mast |
| 2.10–2.13 km | tree line close |
| 2.35–2.45 km | crater rim; rear shows the rim when reversing |
| 2.45–2.80 km | open scrub (the jamming is invisible) |
| 3.0 km | inspection target, a simple mast with a box |

- Pan horizontally by distance travelled so motion is visible.
- The front camera looks ahead and the rear camera looks behind (the scene mirrored).
- Render at the delivered `w×h` (320×240 or 640×480) and quantise colours to 8 levels per channel at quality below 55 to mimic MJPEG.
- When frozen, hold the last drawn frame, so the image shown is the frame captured at `t − age`.
- **No fake footage, no photos, no stock imagery.** A text-3 caption under the Replay view says "Camera views are drawn from the simulated position, not recorded video."

---

## 10. Copy and voice

Voice: an engineer explaining a log to a colleague, in plain verbs and sentence case. Every reason quotes the measured value and the threshold. Nothing sells, and losses are reported with the same weight as wins.

Name things the way the operator would:
- "front camera", not "stream 0";
- "usable view", not "QoE";
- "4G", not "LTE";
- "Driving / Reversing / Precision / Stopped" for DRIVE, REVERSE, PRECISION, STOPPED (code names appear in tooltips and in Method);
- levels keep their ladder names (PAUSED, TRICKLE, L2–L5), because they are config identifiers. Each one is explained in its tooltip, for example "L3: 320×240, 20 fps, about 700 kbps".

Examples. Numbers come from data at runtime; the ones shown are from the committed 3-seed run.
1. "Front camera moved to 4G 1.4 s before the radio dropped (signal falling 3.1 dB/s)."
2. "Not usable: rear view is 1.4 s old (reversing needs 0.5 s or newer)."
3. "Reversing needs the rear camera. Baseline is still sending the front one."
4. "Starlink handover due at :27. Moved the front camera to 4G 0.6 s early."
5. "Crater link is 1 Mbps, too little for two cameras. Front cut to TRICKLE, rear kept at L3."
6. "In the crater, Proposed's view was usable 96.6% of the time; Baseline's 9.3%."
7. "Adaptive delivers the crater scan in 183 s; urgent-first in 56 s. Adaptive waits so the driving view stays above 10 fps."
8. "No decisions between 12:10 and 12:40. Press K to jump to the next divergence."
9. "The 20-seed run has not finished. Showing the 3 committed seeds, so intervals are rough. Results update when results_run/summary.csv appears."
10. "No trace for seed 12. Export traces for this run, then reload. (DESIGN-GAP: name the export command once the trace exporter exists.)"

Buttons say exactly what happens: "Show in replay", "Show data", "Show all decisions", "Show whole mission", "Start chapter". There are no "→" glyphs, no "Learn more" and no "Click here".

Errors name what failed and how to fix it, and never apologise.

Banned in UI strings:
- exclamation marks and emoji;
- "AI", "smart" and "intelligent";
- middle-dot meta strings ("A · B");
- "WORD — fragment" labels;
- all-caps labels.

---

## 11. Keyboard

Shortcuts are global unless focus is in a text input or select, or a popover is open (then only Esc works).

| Key | Action |
|---|---|
| Space | Play / pause |
| ← / → | Step 0.1 s (one sample) |
| Shift + ← / → | Step 1 s |
| Home / End | Mission start / end |
| [ / ] | Slower / faster through 0.5×, 1×, 2×, 4×, 8×, 16×, 60× |
| J / K | Previous / next event matching the jump filter (default: divergences) |
| 1 2 3 4 | Replay, Results, Scenario, Method |
| T | Toggle light / dark |
| P | Presenter mode |
| ? | Shortcut sheet (popover, lists all of the above and recommends light theme for projectors) |
| Esc | Close popover or tooltip |

- Focus ring: `outline: var(--stroke-bold) solid var(--color-focus); outline-offset: 2px;` on `:focus-visible` for every interactive element, including timeline tracks and camera tiles (tiles are focusable buttons that open an enlarged view at 2×).
- Tab order: app bar, route chips, left console, spine, right console, timeline tracks, playback bar.
- An `aria-live="polite"` region announces the verdict change at the cursor when paused, for example "Baseline view not usable. Proposed view usable."

---

## 12. Engineering conventions for parallel work

- Stack: React 18 + TypeScript + Vite, with plain CSS modules that read only the tokens above. Never write hard-coded hex values outside `tokens.css`, apart from the outdoor palette in 9.3. Charts are hand-written SVG; `d3-scale` and `d3-shape` are allowed. Dense timeline tracks and camera tiles use `<canvas>`, read token colours via `getComputedStyle` and redraw on theme change.
- Shared, owned by the shell developer: `tokens.css`, `format.ts`, the pattern `<defs>`, and these components: Panel, Badge, Legend, SegmentedControl, Tooltip and Chart frame.
- Global state is a single store holding `{view, run, variant, seed, compare, t, playing, speed, jumpFilter, theme, presenter}`, mirrored to the URL hash.
- Suggested split:
  1. shell, tokens and shared components;
  2. Replay top: route strip, consoles, camera tiles, spine;
  3. Replay bottom: timeline, ribbons, who-saw lane, playback bar, keyboard;
  4. Results;
  5. Scenario and Method.

---

## 13. Don't

- Don't use a cream-and-terracotta, black-and-neon, or broadsheet hairline-and-serif look. The base is cool graphite in both themes.
- Don't chop content into identical rounded cards with soft shadows. Panels are flat, and the radius follows hierarchy.
- Don't use gradients, glow, scanlines, glitch effects, camouflage or "HUD" chrome.
- Don't use radial gauges, speedometers, KPI hero tiles, or big-number-with-gradient treatments.
- Don't use all-caps labels, tracked-out eyebrows, a monospace face for data, middle-dot meta strings, "→" on buttons, or a single accented word in a heading.
- Don't use 01/02/03 numbering except Method's real step sequences. Chapters are named by km.
- Don't use green for "good" or "usable". The controller's colour means usable; red means not usable; link hues mean link identity.
- Don't encode status with colour alone.
- Don't use satellite maps, invented geography, 3D vehicles, photos or stock video.
- Don't re-score, round in a way that changes a comparison, or type numbers into copy by hand.
- Don't hide or soften the losses: "Where Proposed does not win" carries the same visual weight as the Headline.
- Don't use the best-case seed as the demo seed.
- Don't add hover lifts, entrance animations, animated counters, or anything that blinks.
- Don't use text smaller than 12px (`--fs-12`), or data strokes thinner than 1.5px on wide screens.
