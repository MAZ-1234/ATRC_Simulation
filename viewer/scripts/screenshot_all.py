"""Screenshot every view of the built viewer from file:// (integration check).

Usage (after `npm run build` in viewer/):
    C:/Users/zhmaz/OneDrive/Desktop/ATRC/.venv/Scripts/python viewer/scripts/screenshot_all.py
        [--dist viewer/dist] [--out viewer/.screens] [--sizes 1440x900,1280x720,768x1024]
        [--themes light,dark] [--presenter]

For each size and theme it captures:
    replay-default   Replay at t = 0, paused, after the ribbon draw-in
    replay-crater    Replay paused at the crater chapter start (computed from the trace)
    replay-playing   Replay during 4x playback from the crater chapter start
    results-top      Results, top of the page
    results-scrolled Results, scrolled to "Where Proposed does not win"
    scenario         Scenario view
    method           Method view
    shortcuts        Shortcut sheet open over Replay
PNGs go to <out>/final-<shot>-<WxH>-<theme>.png. Console errors, page errors and failed
requests are written to <out>/console.txt; the script also checks for horizontal page
scroll. Exit code is the number of problems found (0 = clean).
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

HERE = Path(__file__).resolve().parent
THEME_KEY = "edge-mlc-viewer.theme"
PRESENTER_KEY = "edge-mlc-viewer.presenter"

# JS: the demo pair ids for the current store selection (read from the manifest, not typed).
PAIR_JS = """() => {
  const m = window.SIM_MANIFEST; const d = m.demo;
  const id = (c) => (m.runs.find(r => r.config === c && r.variant === d.variant && r.seed === d.seed) || {}).id;
  return { left: id('Baseline'), right: id('Proposed'), variant: d.variant, seed: d.seed };
}"""

# JS: crater chapter seek time = first sample in a crater driver state on the right run, minus 5 s
# (the same rule as src/data/events.ts computeChapters).
CRATER_JS = """(id) => {
  const r = window.SIM_RUNS[id]; const s = r.samples;
  for (let k = 0; k < r.meta.n_samples; k++) if (s.crater[k] === 1) return Math.max(0, Math.round((s.t[k] - 5) * 10) / 10);
  return null;
}"""


def wait_pair(page: Page, pair: dict, timeout: int = 60000) -> None:
    page.wait_for_function(
        "([a, b]) => !!(window.SIM_RUNS && window.SIM_RUNS[a] && window.SIM_RUNS[b])",
        arg=[pair["left"], pair["right"]], timeout=timeout,
    )


def no_hscroll(page: Page) -> int:
    return page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dist", default=str(HERE.parent / "dist"))
    ap.add_argument("--out", default=str(HERE.parent / ".screens"))
    ap.add_argument("--sizes", default="1440x900,1280x720,768x1024")
    ap.add_argument("--themes", default="light,dark")
    ap.add_argument("--presenter", action="store_true", help="also capture Replay and Results in presenter mode (light)")
    args = ap.parse_args()

    dist = Path(args.dist).resolve()
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    url = (dist / "index.html").as_uri()
    sizes = [tuple(int(x) for x in s.split("x")) for s in args.sizes.split(",")]
    themes = args.themes.split(",")

    log: list[str] = []
    problems = 0
    shots: list[str] = []

    with sync_playwright() as p:
        browser = p.chromium.launch()

        def session(w: int, h: int, theme: str, presenter: bool = False):
            ctx = browser.new_context(viewport={"width": w, "height": h}, color_scheme=theme, device_scale_factor=1)
            ctx.add_init_script(
                f"try {{ localStorage.setItem('{THEME_KEY}', '{theme}');"
                f" localStorage.setItem('{PRESENTER_KEY}', '{'on' if presenter else 'off'}'); }} catch (e) {{}}"
            )
            page = ctx.new_page()
            errs: list[str] = []
            page.on("console", lambda m: errs.append(f"console.{m.type}: {m.text}") if m.type in ("error", "warning") else None)
            page.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
            page.on("requestfailed", lambda r: errs.append(f"requestfailed: {r.url} {r.failure}"))
            return ctx, page, errs

        def shot(page: Page, name: str, tag: str, full: bool = False) -> None:
            nonlocal problems
            path = out / f"final-{name}-{tag}.png"
            page.screenshot(path=str(path), full_page=full)
            shots.append(path.name)
            hs = no_hscroll(page)
            if hs > 0:
                problems += 1
                log.append(f"[{name}-{tag}] horizontal page scroll of {hs}px")

        def go(page: Page, hash_: str) -> None:
            page.evaluate("(h) => { location.hash = h; }", hash_)

        runs = [(w, h, th, False) for th in themes for (w, h) in sizes]
        if args.presenter:
            runs += [(1440, 900, "light", True), (1280, 720, "light", True)]

        for (w, h, theme, presenter) in runs:
            tag = f"{w}x{h}-{theme}" + ("-presenter" if presenter else "")
            t0 = time.perf_counter()
            ctx, page, errs = session(w, h, theme, presenter)
            page.goto(url + "#/replay")
            page.wait_for_function("() => !!window.SIM_MANIFEST && !!window.SIM_SCENARIO && !!window.SIM_RESULTS")
            pair = page.evaluate(PAIR_JS)
            wait_pair(page, pair)
            page.evaluate("document.fonts.ready")
            page.wait_for_timeout(1700)  # ribbon draw-in is 1.2 s on first load
            actual = page.evaluate("document.documentElement.getAttribute('data-theme')")
            if actual != theme:
                problems += 1
                log.append(f"[{tag}] data-theme is {actual}, expected {theme}")
            shot(page, "replay-default", tag)
            # Replay is one instrument frame on wide and compact: the page must not scroll vertically.
            vs = page.evaluate("() => document.documentElement.scrollHeight - document.documentElement.clientHeight")
            if w >= 1024 and vs > 0:
                problems += 1
                log.append(f"[replay-default-{tag}] Replay page scrolls vertically by {vs}px")

            crater = page.evaluate(CRATER_JS, pair["right"])
            base = f"#/replay?variant={pair['variant']}&seed={pair['seed']}&cmp=Baseline"
            go(page, f"{base}&t={crater}")
            page.wait_for_timeout(700)
            shot(page, "replay-crater", tag)
            vs = page.evaluate("() => document.documentElement.scrollHeight - document.documentElement.clientHeight")
            if w >= 1024 and vs > 0:
                problems += 1
                log.append(f"[replay-crater-{tag}] Replay page scrolls vertically by {vs}px")

            # 4x playback from the crater chapter start (Space toggles play; default speed 4x).
            page.evaluate("() => document.activeElement && document.activeElement.blur()")
            page.keyboard.press("Space")
            page.wait_for_timeout(1800)
            playing = page.evaluate("() => document.querySelector('[aria-label=Pause]') !== null")
            shot(page, "replay-playing", tag)
            page.keyboard.press("Space")
            if not playing:
                problems += 1
                log.append(f"[{tag}] Space did not start playback")

            # Shortcut sheet over Replay.
            page.keyboard.press("?")
            page.wait_for_timeout(300)
            shot(page, "shortcuts", tag)
            page.keyboard.press("Escape")
            page.wait_for_timeout(200)

            if not presenter or w == 1440:
                go(page, "#/results")
                page.wait_for_timeout(1200)
                page.evaluate("window.scrollTo(0, 0)")
                shot(page, "results-top", tag)
                found = page.evaluate("""() => {
                  const hs = [...document.querySelectorAll('h2, h3')].filter(e => /does not win/i.test(e.textContent || ''));
                  if (!hs.length) return false; hs[0].scrollIntoView({ block: 'start' }); window.scrollBy(0, -64); return true; }""")
                if not found:
                    problems += 1
                    log.append(f"[{tag}] Results: 'does not win' heading not found")
                page.wait_for_timeout(500)
                shot(page, "results-scrolled", tag)

            if not presenter:
                go(page, "#/scenario")
                page.wait_for_timeout(1200)
                page.evaluate("window.scrollTo(0, 0)")
                shot(page, "scenario", tag)

                go(page, "#/method")
                page.wait_for_timeout(1500)
                page.evaluate("window.scrollTo(0, 0)")
                shot(page, "method", tag)

            for e in errs:
                if e.startswith("console.warning"):
                    log.append(f"[{tag}] {e}")
                else:
                    problems += 1
                    log.append(f"[{tag}] ERROR {e}")
            print(f"{tag}: {len([e for e in errs if not e.startswith('console.warning')])} errors, "
                  f"{time.perf_counter() - t0:.1f} s")
            ctx.close()
        browser.close()

    n_err = sum(1 for line in log if " ERROR " in line)
    header = [f"screenshot_all.py from {url}", f"errors (console/page/request): {n_err}", f"problems: {problems}", ""]
    (out / "console.txt").write_text("\n".join(header + log) + "\n", encoding="utf-8")
    print(f"{len(shots)} screenshots, {n_err} console/page errors, {problems} problems. Log: {out / 'console.txt'}")
    return problems


if __name__ == "__main__":
    sys.exit(main())
