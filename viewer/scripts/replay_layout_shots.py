"""Screenshot the Replay layout frame at the three design sizes (light, plus dark at wide)."""
import sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

PORT = sys.argv[1] if len(sys.argv) > 1 else "5180"
OUT = Path(__file__).resolve().parent.parent / ".screens"
OUT.mkdir(exist_ok=True)
SIZES = [("1440x900", 1440, 900), ("1280x720", 1280, 720), ("768x1024", 768, 1024), ("560x900", 560, 900)]
THEMES = sys.argv[2].split(",") if len(sys.argv) > 2 else ["light"]

errors = []
with sync_playwright() as p:
    b = p.chromium.launch()
    for theme in THEMES:
        for name, w, h in SIZES:
            ctx = b.new_context(viewport={"width": w, "height": h})
            ctx.add_init_script(f"try{{localStorage.setItem('edge-mlc-viewer.theme','{theme}')}}catch(e){{}}")
            pg = ctx.new_page()
            pg.on("console", lambda m, n=name: m.type == "error" and errors.append(f"{n}: {m.text}"))
            pg.on("pageerror", lambda e, n=name: errors.append(f"{n}: {e}"))
            pg.goto(f"http://localhost:{PORT}/#/replay")
            pg.wait_for_timeout(2500)
            dims = pg.evaluate("""() => {
              const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
              return { doc: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
                       cells: [...document.querySelectorAll('main > div > div')].map(e => { const b = e.getBoundingClientRect(); return [e.className.split('_')[1] || e.className, Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; }) };
            }""")
            print(theme, name, dims)
            pg.screenshot(path=str(OUT / f"replay-layout-{name}-{theme}.png"))
            ctx.close()
    b.close()
print("console errors:", errors or "none")
