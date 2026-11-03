"""Extra timeline checks: speed popovers, presenter mode, who-saw / upload readouts, DPR 2."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

PORT = sys.argv[1] if len(sys.argv) > 1 else "5183"
OUT = Path(__file__).resolve().parent.parent / ".screens"
BASE = f"http://localhost:{PORT}/"
PIN_JS = """document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style');
  st.textContent = '@media (min-width: 1024px) { #view-panel > div { height: calc(100vh - var(--appbar-h)); } }';
  document.head.appendChild(st); });"""
errors = []


def page(b, w, h, theme="light", presenter=False, dpr=1):
    ctx = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=dpr)
    ctx.add_init_script(f"try{{localStorage.setItem('edge-mlc-viewer.theme','{theme}');localStorage.setItem('edge-mlc-viewer.presenter','{'on' if presenter else 'off'}')}}catch(e){{}}")
    ctx.add_init_script(PIN_JS)
    pg = ctx.new_page()
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
    pg.on("pageerror", lambda e: errors.append(str(e)))
    return ctx, pg


def hover_row(pg, label_start, frac):
    tb = pg.evaluate("""() => { const e = document.querySelector('[aria-label="Mission timeline cursor"]'); const b = e.getBoundingClientRect(); return {x: b.x, w: b.width}; }""")
    y = pg.evaluate(f"""() => {{ const l = [...document.querySelectorAll('[class*=label]')].find(e => e.textContent.trim().startsWith('{label_start}'));
      if (!l) return null; const b = l.getBoundingClientRect(); return b.y + b.height / 2; }}""")
    pg.mouse.move(tb["x"] + tb["w"] * frac, y)
    pg.wait_for_timeout(350)


with sync_playwright() as p:
    b = p.chromium.launch()
    # compact speed popover
    ctx, pg = page(b, 1280, 720)
    pg.goto(BASE + "#/replay?t=655"); pg.wait_for_selector('[aria-label="Mission timeline cursor"]'); pg.wait_for_timeout(1500)
    pg.get_by_role("button", name="More").click(); pg.wait_for_timeout(250)
    pg.screenshot(path=str(OUT / "timeline-1280x720-light-speedmenu.png"))
    pg.keyboard.press("Escape")
    hover_row(pg, "Who saw", 0.62)
    pg.screenshot(path=str(OUT / "timeline-1280x720-light-whosaw-hover.png"))
    hover_row(pg, "Uploads", 0.483)
    pg.screenshot(path=str(OUT / "timeline-1280x720-light-upload-hover.png"))
    ctx.close()
    # narrow speed popover
    ctx, pg = page(b, 768, 1024, "dark")
    pg.goto(BASE + "#/replay?t=655"); pg.wait_for_selector('[aria-label="Mission timeline cursor"]'); pg.wait_for_timeout(1500)
    pg.get_by_role("button", name="Speed 4×").click(); pg.wait_for_timeout(250)
    pg.screenshot(path=str(OUT / "timeline-768x1024-dark-speedmenu.png"))
    ctx.close()
    # presenter mode
    for (w, h) in [(1280, 720), (1440, 900)]:
        ctx, pg = page(b, w, h, presenter=True)
        pg.goto(BASE + "#/replay?t=655"); pg.wait_for_selector('[aria-label="Mission timeline cursor"]'); pg.wait_for_timeout(1500)
        pg.screenshot(path=str(OUT / f"timeline-{w}x{h}-light-presenter.png"))
        ctx.close()
    # DPR 2 crop of the tracks
    ctx, pg = page(b, 1440, 900, dpr=2)
    pg.goto(BASE + "#/replay?t=655"); pg.wait_for_selector('[aria-label="Mission timeline cursor"]'); pg.wait_for_timeout(1500)
    pg.screenshot(path=str(OUT / "timeline-1440x900-light-dpr2-crop.png"), clip={"x": 0, "y": 590, "width": 720, "height": 250})
    ctx.close()
    b.close()
print("console errors:", errors or "none")
