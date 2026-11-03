"""Screenshots and checks for the Replay mission timeline and playback bar.

usage: python scripts/timeline_shots.py [port] [themes] [sizes]
Saves .screens/timeline-*.png, prints console errors and a playback frame-rate probe.
"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

PORT = sys.argv[1] if len(sys.argv) > 1 else "5183"
THEMES = sys.argv[2].split(",") if len(sys.argv) > 2 else ["light", "dark"]
SIZE_ARG = sys.argv[3].split(",") if len(sys.argv) > 3 else ["1440x900", "1280x720", "768x1024"]
OUT = Path(__file__).resolve().parent.parent / ".screens"
OUT.mkdir(exist_ok=True)
BASE = f"http://localhost:{PORT}/"

errors: list[str] = []
PIN = "--nopin" not in sys.argv
PIN_JS = """document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style');
  st.textContent = '@media (min-width: 1024px) { #view-panel > div { height: calc(100vh - var(--appbar-h)); } }';
  document.head.appendChild(st); });"""


def tracks_box(pg):
    return pg.evaluate("""() => { const e = document.querySelector('[aria-label="Mission timeline cursor"]');
      if (!e) return null; const b = e.getBoundingClientRect(); return {x: b.x, y: b.y, w: b.width, h: b.height}; }""")


def bottom_clip(pg, w, h):
    box = pg.evaluate("""() => { const e = document.querySelector('section[aria-label="Mission timeline"]');
      if (!e) return null; const b = e.parentElement.getBoundingClientRect(); return {y: b.y + window.scrollY}; }""")
    if not box:
        return None
    y = max(0, box["y"] - 4)
    y = int(y)
    hh = int(min(h - y, 420)) if h > y + 20 else 360
    print("clip", y, hh)
    return {"x": 0, "y": y, "width": w, "height": hh}


with sync_playwright() as p:
    b = p.chromium.launch()
    for theme in THEMES:
        for size in SIZE_ARG:
            w, h = (int(x) for x in size.split("x"))
            ctx = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=1)
            ctx.add_init_script(f"try{{localStorage.setItem('edge-mlc-viewer.theme','{theme}')}}catch(e){{}}")
            if PIN:
                # Work-around (reported): pin the Replay frame to the viewport on wide/compact so a
                # long decision log cannot push the timeline below the fold.
                ctx.add_init_script(PIN_JS)
            pg = ctx.new_page()
            tag = f"{size}-{theme}"
            pg.on("console", lambda m, n=tag: m.type == "error" and errors.append(f"{n}: {m.text}"))
            pg.on("pageerror", lambda e, n=tag: errors.append(f"{n}: {e}"))

            # 1. first load at t = 0, paused (draw-in finishes in 1.2 s)
            pg.goto(BASE + "#/replay")
            pg.wait_for_selector('[aria-label="Mission timeline cursor"]', timeout=20000)
            pg.wait_for_timeout(1800)
            pg.screenshot(path=str(OUT / f"timeline-{tag}-start.png"), full_page=size == "768x1024")

            # 2. jump to the crater chapter with the chapter filter (J/K path)
            pg.evaluate("() => document.activeElement && document.activeElement.blur()")
            pg.keyboard.press("k")  # next divergence
            pg.wait_for_timeout(200)
            pg.goto(BASE + "#/replay?t=655.0")
            pg.wait_for_timeout(1200)
            # hover readout over the Baseline ribbon at the cursor
            tb = tracks_box(pg)
            if tb:
                ry = pg.evaluate("""() => { const l = [...document.querySelectorAll('[class*=label]')].find(e => e.textContent.startsWith('Baseline'));
                  return l ? l.getBoundingClientRect().y + l.getBoundingClientRect().height / 2 : null; }""")
                hx = tb["x"] + tb["w"] * 0.495
                pg.mouse.move(hx, ry or (tb["y"] + tb["h"] * 0.4))
                pg.wait_for_timeout(400)
            pg.screenshot(path=str(OUT / f"timeline-{tag}-hover.png"), full_page=size == "768x1024")
            clip = bottom_clip(pg, w, h)
            if clip and size != "768x1024":
                pg.screenshot(path=str(OUT / f"timeline-{tag}-hover-detail.png"), clip=clip)
            pg.mouse.move(5, 5)

            # 3. zoom by dragging on the time axis (about 10:00 to 14:30)
            pg.evaluate("""() => document.querySelector('[aria-label="Mission timeline cursor"]').scrollIntoView({block: 'center'})""")
            pg.wait_for_timeout(150)
            tb = tracks_box(pg)
            if tb:
                ay = tb["y"] + tb["h"] + 12
                pg.mouse.move(tb["x"] + tb["w"] * 0.45, ay)
                pg.mouse.down()
                pg.mouse.move(tb["x"] + tb["w"] * 0.55, ay, steps=6)
                pg.mouse.move(tb["x"] + tb["w"] * 0.65, ay, steps=6)
                pg.mouse.up()
                pg.wait_for_timeout(400)
                pg.mouse.move(5, 5)
                pg.screenshot(path=str(OUT / f"timeline-{tag}-zoom.png"), full_page=size == "768x1024")
                btn = pg.get_by_role("button", name="Show whole mission")
                print(tag, "reset button visible:", btn.count() > 0)
                if btn.count():
                    btn.first.click()

            # 4. compact: show camera link rows
            if size == "1280x720":
                t = pg.get_by_role("button", name="Show camera links")
                if t.count():
                    t.first.click()
                    pg.wait_for_timeout(300)
                    pg.screenshot(path=str(OUT / f"timeline-{tag}-streams.png"))
                    t.first.click()

            # 5. play at 60x and probe the frame rate
            if theme == THEMES[0]:
                pg.goto(BASE + "#/replay?t=600")
                pg.wait_for_timeout(800)
                pg.evaluate("() => document.activeElement && document.activeElement.blur()")
                for _ in range(4):
                    pg.keyboard.press("]")
                pg.keyboard.press(" ")
                fps = pg.evaluate("""() => new Promise(res => { let n = 0; const t0 = performance.now(); let worst = 0, last = t0;
                  const f = (now) => { n++; worst = Math.max(worst, now - last); last = now; if (now - t0 < 2000) requestAnimationFrame(f); else res({fps: n / ((now - t0) / 1000), worstMs: worst}); };
                  requestAnimationFrame(f); })""")
                print(tag, "playback 60x:", fps)
                pg.screenshot(path=str(OUT / f"timeline-{tag}-playing.png"), full_page=size == "768x1024")
                pg.keyboard.press(" ")
                # at end
                pg.keyboard.press("End")
                pg.wait_for_timeout(300)
                clip = bottom_clip(pg, w, h)
                if size == "1440x900" and clip:
                    pg.screenshot(path=str(OUT / f"timeline-{tag}-end.png"), clip=clip)
            ctx.close()
    b.close()
print("console errors:", errors or "none")
