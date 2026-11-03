"""Screenshot the Method view at the design sizes, light and dark.

usage: python method_shots.py [port] [themes] [sizes]
  full-page shots plus a viewport shot scrolled to each panel; prints console errors
  and any horizontal overflow.
"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

PORT = sys.argv[1] if len(sys.argv) > 1 else "5186"
THEMES = sys.argv[2].split(",") if len(sys.argv) > 2 else ["light", "dark"]
ALL = {"1440x900": (1440, 900), "1280x720": (1280, 720), "768x1024": (768, 1024)}
SIZES = sys.argv[3].split(",") if len(sys.argv) > 3 else list(ALL)
PANELS = sys.argv[4].split(",") if len(sys.argv) > 4 else []
OUT = Path(__file__).resolve().parent.parent / ".screens"
OUT.mkdir(exist_ok=True)

errors = []
with sync_playwright() as p:
    b = p.chromium.launch()
    for theme in THEMES:
        for name in SIZES:
            w, h = ALL[name]
            ctx = b.new_context(viewport={"width": w, "height": h})
            ctx.add_init_script(f"try{{localStorage.setItem('edge-mlc-viewer.theme','{theme}')}}catch(e){{}}")
            pg = ctx.new_page()
            pg.on("console", lambda m, n=name: m.type == "error" and errors.append(f"{n}: {m.text}"))
            pg.on("pageerror", lambda e, n=name: errors.append(f"{n}: {e}"))
            pg.goto(f"http://localhost:{PORT}/#/method")
            pg.wait_for_selector("#example figure", timeout=20000)
            pg.wait_for_timeout(800)
            info = pg.evaluate("""() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
              sh: document.documentElement.scrollHeight,
              wide: [...document.querySelectorAll('main *')].filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1).slice(0, 5).map(e => e.tagName + '.' + (e.className && e.className.baseVal === undefined ? e.className : '')) })""")
            print(theme, name, info)
            pg.screenshot(path=str(OUT / f"method-{name}-{theme}-full.png"), full_page=True)
            pg.screenshot(path=str(OUT / f"method-{name}-{theme}.png"))
            for pid in PANELS:
                el = pg.locator(f"#{pid}")
                el.scroll_into_view_if_needed()
                pg.wait_for_timeout(200)
                el.screenshot(path=str(OUT / f"method-{name}-{theme}-{pid}.png"))
            ctx.close()
    b.close()
print("console errors:", errors or "none")
