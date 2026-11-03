"""Screenshot the Results view: viewports and full pages at three sizes, both themes,
each block at 1440 light, a hover tooltip, the data table, and a Show in replay click.
Usage: python results_shots.py [port] [mode]   mode: all (default) | blocks | quick"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

PORT = sys.argv[1] if len(sys.argv) > 1 else "5184"
MODE = sys.argv[2] if len(sys.argv) > 2 else "all"
OUT = Path(__file__).resolve().parent.parent / ".screens"
OUT.mkdir(exist_ok=True)
SIZES = [("1440x900", 1440, 900), ("1280x720", 1280, 720), ("768x1024", 768, 1024)]
URL = f"http://localhost:{PORT}/#/results"

errors = []


def page(b, w, h, theme, presenter=False):
    ctx = b.new_context(viewport={"width": w, "height": h})
    ctx.add_init_script(f"try{{localStorage.setItem('edge-mlc-viewer.theme','{theme}')}}catch(e){{}}")
    pg = ctx.new_page()
    pg.on("console", lambda m: m.type == "error" and errors.append(f"{w}x{h} {theme}: {m.text}"))
    pg.on("pageerror", lambda e: errors.append(f"{w}x{h} {theme}: {e}"))
    pg.goto(URL)
    pg.wait_for_selector("#headline")
    pg.wait_for_timeout(1500)
    if presenter:
        pg.keyboard.press("p")
        pg.wait_for_timeout(500)
    return ctx, pg


with sync_playwright() as p:
    b = p.chromium.launch()
    themes = ["light", "dark"] if MODE != "quick" else ["light"]
    if MODE in ("all", "quick"):
        for theme in themes:
            for name, w, h in SIZES:
                ctx, pg = page(b, w, h, theme)
                pg.screenshot(path=str(OUT / f"results-{name}-{theme}.png"))
                if theme == "light" or name == "1440x900":
                    pg.screenshot(path=str(OUT / f"results-{name}-{theme}-full.png"), full_page=True)
                sw = pg.evaluate("document.documentElement.scrollWidth")
                print(theme, name, "scrollWidth", sw, "of", w)
                # scroll to the losses section via the rail / picker
                if w >= 1024:
                    pg.click("nav[aria-label='Results sections'] button:has-text('Where Proposed does not win')")
                else:
                    pg.select_option("select", "notwin")
                pg.wait_for_timeout(400)
                pg.screenshot(path=str(OUT / f"results-{name}-{theme}-notwin.png"))
                ctx.close()

    if MODE in ("all", "blocks"):
        for theme in (["light", "dark"] if MODE == "blocks" else ["light"]):
            ctx, pg = page(b, 1440, 900, theme)
            ids = pg.eval_on_selector_all("section[id]", "els => els.map(e => e.id)")
            for i in ids:
                el = pg.locator(f"section#{i}")
                el.scroll_into_view_if_needed()
                pg.wait_for_timeout(150)
                if i == "notwin":
                    continue
                el.screenshot(path=str(OUT / f"results-block-{i}-{theme}.png"))
            ctx.close()

    if MODE == "all":
        ctx, pg = page(b, 1440, 900, "light")
        # hover a headline dot row
        box = pg.locator("#headline svg[role='img']").first.bounding_box()
        pg.mouse.move(box["x"] + box["width"] * 0.6, box["y"] + 60)
        pg.wait_for_timeout(300)
        pg.screenshot(path=str(OUT / "results-hover-1440x900-light.png"))
        # matrix hover + show data
        m = pg.locator("#notwin-matrix")
        m.scroll_into_view_if_needed()
        mb = pg.locator("#notwin-matrix svg[role='img']").first.bounding_box()
        pg.mouse.move(mb["x"] + mb["width"] * 0.66, mb["y"] + mb["height"] * 0.6)
        pg.wait_for_timeout(300)
        pg.screenshot(path=str(OUT / "results-matrix-hover-1440x900-light.png"))
        pg.locator("#notwin-matrix button:has-text('Show data')").click()
        pg.wait_for_timeout(200)
        m.screenshot(path=str(OUT / "results-matrix-data-1440x900-light.png"))
        # presenter mode
        ctx.close()
        ctx, pg = page(b, 1280, 720, "light", presenter=True)
        pg.screenshot(path=str(OUT / "results-1280x720-light-presenter.png"))
        ctx.close()
        # Show in replay from the headline (waits for the background trace load)
        ctx, pg = page(b, 1440, 900, "light")
        btn = pg.locator("#headline button:has-text('Show in replay')")
        pg.wait_for_timeout(6000)
        label = btn.inner_text()
        btn.click()
        pg.wait_for_timeout(2500)
        print("replay button:", label)
        print("after click:", pg.evaluate("location.hash"))
        pg.screenshot(path=str(OUT / "results-to-replay-1440x900-light.png"))
        ctx.close()
        # labels of every Show in replay button once traces are in
        ctx, pg = page(b, 1440, 900, "light")
        pg.wait_for_timeout(9000)
        for t in pg.locator("button:has-text('Show in replay')").all_inner_texts():
            print("  ", t)
        claims = pg.eval_on_selector_all("section[id] > p", "els => els.map(e => e.closest('section').id + ': ' + e.innerText)")
        print("\n".join(claims))
        ctx.close()
    b.close()
print("console errors:", errors or "none")
