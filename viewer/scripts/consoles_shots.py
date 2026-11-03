"""Screenshot the Replay consoles (camera tiles, verdict, mode, decision log).

usage: python scripts/consoles_shots.py [port] [themes] [sizes]
Saves to viewer/.screens/consoles-*.png and prints layout metrics and console errors.
"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

PORT = sys.argv[1] if len(sys.argv) > 1 else "5182"
THEMES = sys.argv[2].split(",") if len(sys.argv) > 2 else ["light", "dark"]
ALL = {"1440x900": (1440, 900), "1280x720": (1280, 720), "768x1024": (768, 1024)}
SIZES = sys.argv[3].split(",") if len(sys.argv) > 3 else list(ALL)
OUT = Path(__file__).resolve().parent.parent / ".screens"
OUT.mkdir(exist_ok=True)

# (label, cursor t): start, before crater, frozen in crater, crater precision, reversing, blackout
MOMENTS = [("start", 0.0), ("crater-5s", 585.5), ("frozen", 591.5), ("precision", 615.0),
           ("reverse", 665.0), ("blackout", 800.0), ("end", 1330.3)]

METRICS = """() => {
  const q = (sel) => [...document.querySelectorAll(sel)].map(e => { const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; });
  return { doc: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
           consoles: q('section[aria-label$=" console"]'),
           tiles: q('section[aria-label$=" console"] figure button'),
           logs: q('section[aria-label$=" console"] ol') };
}"""

errors = []
with sync_playwright() as p:
    b = p.chromium.launch()
    for theme in THEMES:
        for size in SIZES:
            w, h = ALL[size]
            ctx = b.new_context(viewport={"width": w, "height": h})
            ctx.add_init_script(f"try{{localStorage.setItem('edge-mlc-viewer.theme','{theme}')}}catch(e){{}}")
            pg = ctx.new_page()
            pg.on("console", lambda m, n=size: m.type == "error" and errors.append(f"{n}: {m.text}"))
            pg.on("pageerror", lambda e, n=size: errors.append(f"{n}: {e}"))
            first = True
            for label, t in MOMENTS:
                if size != "1440x900" and label not in ("crater-5s", "frozen", "reverse"):
                    continue
                pg.goto(f"http://localhost:{PORT}/#/replay?variant=nominal&seed=17&t={t}&cmp=Baseline")
                if first:
                    pg.wait_for_timeout(3500)
                    first = False
                else:
                    pg.reload()
                    pg.wait_for_timeout(1800)
                if label == "frozen":
                    print(theme, size, pg.evaluate(METRICS))
                full = size == "768x1024"
                pg.screenshot(path=str(OUT / f"consoles-{size}-{theme}-{label}.png"), full_page=full)
            if size == "1440x900":
                # During playback at 4x from 5 s before the crater.
                pg.goto(f"http://localhost:{PORT}/#/replay?variant=nominal&seed=17&t=585.5&cmp=Baseline")
                pg.reload()
                pg.wait_for_timeout(1800)
                pg.keyboard.press("Space")
                pg.wait_for_timeout(2300)
                pg.screenshot(path=str(OUT / f"consoles-{size}-{theme}-playing.png"))
                pg.keyboard.press("Space")
                # Enlarged tile view.
                pg.locator('section[aria-label="Proposed console"] figure button').first.click()
                pg.wait_for_timeout(400)
                pg.screenshot(path=str(OUT / f"consoles-{size}-{theme}-zoom.png"))
                pg.keyboard.press("Escape")
            if size == "1280x720":
                pg.goto(f"http://localhost:{PORT}/#/replay?variant=nominal&seed=17&t=615&cmp=Baseline")
                pg.reload()
                pg.wait_for_timeout(1800)
                btn = pg.get_by_role("button", name="Show all decisions").first
                if btn.count():
                    btn.click()
                    pg.wait_for_timeout(400)
                    pg.screenshot(path=str(OUT / f"consoles-{size}-{theme}-showall.png"))
                    pg.keyboard.press("Escape")
            ctx.close()
    b.close()
print("console errors:", errors or "none")
