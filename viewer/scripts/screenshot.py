"""Render dist/index.html from file:// in headless Chromium and screenshot every view.

Usage (from the repo root, after `npm run build` in viewer/):
    .venv/Scripts/python viewer/scripts/screenshot.py [--out viewer/.screens] [--dist viewer/dist]

Checks: no console errors / page errors, the manifest loaded (selectors list runs),
the default run pair loads through loadRun (Data check shows both consoles), and the
J/K + Space shortcuts move the cursor. Exits non-zero when a check fails.
If Chromium is missing: .venv/Scripts/python -m playwright install chromium
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dist", default=str(HERE.parent / "dist"))
    ap.add_argument("--out", default=str(HERE.parent / ".screens"))
    args = ap.parse_args()
    dist = Path(args.dist).resolve()
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    url = (dist / "index.html").as_uri()

    failures: list[str] = []
    shots: list[Path] = []

    def check(cond: bool, msg: str) -> None:
        print(("ok   " if cond else "FAIL ") + msg)
        if not cond:
            failures.append(msg)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        for theme in ("light", "dark"):
            for (w, h, tag) in ((1440, 900, "wide"), (1280, 720, "compact"), (768, 1024, "narrow")):
                ctx = browser.new_context(viewport={"width": w, "height": h}, color_scheme=theme, device_scale_factor=1)
                page = ctx.new_page()
                errors: list[str] = []
                page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
                page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
                page.goto(url + "#/replay")
                page.wait_for_function("() => !!window.SIM_MANIFEST && !!window.SIM_SCENARIO && !!window.SIM_RESULTS")
                # Default pair loads via script injection.
                try:
                    page.wait_for_function(
                        "() => window.SIM_RUNS && window.SIM_RUNS['baseline__nominal__s0'] && window.SIM_RUNS['proposed__nominal__s0']",
                        timeout=60000,
                    )
                    loaded = True
                except Exception:
                    loaded = False
                page.wait_for_timeout(400)
                actual_theme = page.evaluate("document.documentElement.getAttribute('data-theme')")
                prefix = f"{tag}-{theme}"
                if tag == "wide":
                    check(loaded, f"[{prefix}] loadRun loaded the default pair")
                    check(actual_theme == theme, f"[{prefix}] data-theme follows prefers-color-scheme ({actual_theme})")
                    n_opts = page.locator("select").nth(0).locator("option").count()
                    check(n_opts >= 7, f"[{prefix}] variant selector lists {n_opts} variants from the manifest")
                    check(page.get_by_text("Data check").count() == 1, f"[{prefix}] Replay placeholder rendered")
                    check(page.locator("text=Usable view, this seed").count() == 2, f"[{prefix}] both consoles rendered from run data")
                    # Shortcuts: K jumps to next divergence, Space plays.
                    page.keyboard.press("k")
                    t1 = page.evaluate("location.hash")
                    check("t=" in t1 and "t=0.0" not in t1, f"[{prefix}] K jumped the cursor ({t1})")
                shots.append(out / f"replay-{prefix}.png")
                page.screenshot(path=str(shots[-1]), full_page=True)

                if tag == "wide":
                    for key, view in (("2", "results"), ("3", "scenario"), ("4", "method")):
                        page.keyboard.press(key)
                        page.wait_for_timeout(250)
                        check(view in page.evaluate("location.hash"), f"[{prefix}] key {key} opened {view}")
                        shots.append(out / f"{view}-{prefix}.png")
                        page.screenshot(path=str(shots[-1]), full_page=True)
                    page.keyboard.press("1")
                    page.keyboard.press("?")
                    page.wait_for_timeout(200)
                    check(page.get_by_role("dialog").count() == 1, f"[{prefix}] ? opened the shortcut sheet")
                    shots.append(out / f"shortcuts-{prefix}.png")
                    page.screenshot(path=str(shots[-1]))
                    page.keyboard.press("Escape")
                    page.keyboard.press("p")
                    page.wait_for_timeout(200)
                    shots.append(out / f"replay-presenter-{prefix}.png")
                    page.screenshot(path=str(shots[-1]), full_page=True)
                    page.keyboard.press("p")
                    page.keyboard.press(" ")
                    page.wait_for_timeout(700)
                    playing_t = page.evaluate("document.querySelector('[class*=clock]')?.textContent")
                    page.keyboard.press(" ")
                    check(bool(playing_t), f"[{prefix}] Space played (clock {playing_t})")

                sw = page.evaluate("document.documentElement.scrollWidth")
                check(sw <= w, f"[{prefix}] no horizontal page scroll (scrollWidth {sw} at {w})")
                check(not errors, f"[{prefix}] no console errors" + ("" if not errors else f": {errors[:3]}"))
                ctx.close()
        browser.close()

    print("\nScreenshots:")
    for s in shots:
        print("  " + str(s))
    if failures:
        print(f"\n{len(failures)} check(s) failed")
        return 1
    print("\nAll checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
