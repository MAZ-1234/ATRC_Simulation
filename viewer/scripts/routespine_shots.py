"""Screenshots of the Replay route strip and truth spine (light + dark, three sizes, key moments).

usage: python scripts/routespine_shots.py [port] [themes] [only-size]
Saves to viewer/.screens/routespine-*.png and prints console errors.
"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

PORT = sys.argv[1] if len(sys.argv) > 1 else "5181"
THEMES = sys.argv[2].split(",") if len(sys.argv) > 2 else ["light", "dark"]
ONLY = sys.argv[3] if len(sys.argv) > 3 else None
OUT = Path(__file__).resolve().parent.parent / ".screens"
OUT.mkdir(exist_ok=True)
SIZES = [("1440x900", 1440, 900), ("1280x720", 1280, 720), ("768x1024", 768, 1024)]
# (name, hash query) moments that matter for these two slots
MOMENTS = [
    ("t0", "t=0"),
    ("crater", "t=595.0"),        # crater, reversing soon; Starlink 1 Mbps truth vs measured
    ("handover", "t=548.5"),      # Starlink handover countdown (due at 552)
    ("blackout", "t=800.0"),      # jammer blackout: Starlink down
    ("inspect", "t=880.0"),       # uploads queued: still + clip
]

errors = []
with sync_playwright() as p:
    b = p.chromium.launch()
    for theme in THEMES:
        for name, w, h in SIZES:
            if ONLY and ONLY != name:
                continue
            ctx = b.new_context(viewport={"width": w, "height": h})
            ctx.add_init_script(f"try{{localStorage.setItem('edge-mlc-viewer.theme','{theme}')}}catch(e){{}}")
            pg = ctx.new_page()
            pg.on("console", lambda m, n=name: m.type == "error" and errors.append(f"{n}: {m.text}"))
            pg.on("pageerror", lambda e, n=name: errors.append(f"{n}: {e}"))
            for mname, q in MOMENTS:
                pg.goto(f"http://localhost:{PORT}/#/replay?{q}")
                pg.wait_for_timeout(1800 if mname == "t0" else 900)
                pg.screenshot(path=str(OUT / f"routespine-{name}-{theme}-{mname}.png"))
            # chapter chip click: plays at 4x; grab mid-chapter
            pg.goto(f"http://localhost:{PORT}/#/replay?t=0")
            pg.wait_for_timeout(1200)
            chips = pg.locator("[aria-label^='Start chapter']")
            if chips.count() >= 3:
                chips.nth(2).click()
                pg.wait_for_timeout(1500)
                pg.keyboard.press("Space")  # pause for a stable frame
                pg.wait_for_timeout(300)
                pg.mouse.move(5, h - 5)
                pg.wait_for_timeout(200)
                pg.screenshot(path=str(OUT / f"routespine-{name}-{theme}-chapter.png"))
                # chip tooltip
                chips.nth(3).hover()
                pg.wait_for_timeout(600)
                pg.screenshot(path=str(OUT / f"routespine-{name}-{theme}-chiptip.png"), clip={"x": 0, "y": 0, "width": w, "height": min(h, 360)})
            # route hover readout
            box = pg.locator("svg[aria-label^='Route schematic']").bounding_box()
            if box:
                pg.mouse.move(box["x"] + box["width"] * 0.80, box["y"] + box["height"] * 0.6)
                pg.wait_for_timeout(400)
                pg.screenshot(path=str(OUT / f"routespine-{name}-{theme}-routehover.png"), clip={"x": 0, "y": 0, "width": w, "height": min(h, 360)})
            # link row tooltip
            pg.mouse.move(5, h - 5)
            pg.goto(f"http://localhost:{PORT}/#/replay?t=595.0")
            pg.wait_for_timeout(900)
            rows = pg.locator("[aria-label^='Starlink:']")
            if rows.count():
                rows.first.focus()
                pg.wait_for_timeout(300)
                pg.screenshot(path=str(OUT / f"routespine-{name}-{theme}-linktip.png"))
            ctx.close()
    b.close()
print("console errors:", errors or "none")
