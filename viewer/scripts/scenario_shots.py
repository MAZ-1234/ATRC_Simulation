"""Screenshots of the Scenario view (DESIGN.md 6.3) at the required sizes and themes.

Usage (dev server on :5185):  .venv/Scripts/python viewer/scripts/scenario_shots.py [--only TAG] [--extras]
Writes viewer/.screens/scenario-*.png and prints every browser console error plus
horizontal-overflow checks.
"""
import os
import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:5185/"
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".screens")
SIZES = [(1440, 900), (1280, 720), (768, 1024)]


def shoot(page, name, full=True):
    path = os.path.join(OUT, f"scenario-{name}.png")
    page.screenshot(path=path, full_page=full)
    print("saved", path)


def ready(page):
    page.wait_for_selector("h1:has-text('Scenario')", timeout=20000)
    page.wait_for_timeout(1500)


def overflow(page, tag):
    r = page.evaluate("""() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
        wide: [...document.querySelectorAll('main *')].filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
          .slice(0, 5).map(e => e.tagName + '.' + (e.className && e.className.baseVal === undefined ? e.className : '')) })""")
    print(tag, "scrollWidth", r["sw"], "clientWidth", r["cw"], "overflowing:", r["wide"])


def main():
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    extras = "--extras" in sys.argv
    os.makedirs(OUT, exist_ok=True)
    errors = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        for theme in ("light", "dark"):
            for w, h in SIZES:
                tag = f"{w}x{h}-{theme}"
                if only and only not in tag:
                    continue
                ctx = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=1)
                ctx.add_init_script(f"try {{ localStorage.setItem('edge-mlc-viewer.theme', '{theme}'); }} catch (e) {{}}")
                page = ctx.new_page()
                page.on("console", lambda m, tag=tag: errors.append(f"{tag}: {m.text}") if m.type == "error" else None)
                page.on("pageerror", lambda e, tag=tag: errors.append(f"{tag}: {e}"))
                page.goto(BASE + "#/scenario?variant=nominal&seed=17&cmp=Baseline")
                ready(page)
                overflow(page, tag)
                shoot(page, f"{tag}-viewport", full=False)
                shoot(page, tag)
                if extras and w == 1440:
                    svg = page.locator("[data-chart='route'] svg").first
                    box = svg.bounding_box()
                    if box:
                        page.mouse.move(box["x"] + 168 + (box["width"] - 188) * (2.40 / 3.05), box["y"] + box["height"] * 0.55)
                        page.wait_for_timeout(500)
                        shoot(page, f"{tag}-hover", full=False)
                    page.mouse.move(5, 5)
                    # hover an assumption row: zone highlight on the chart
                    row = page.locator("li:has-text('Contested zone')").first
                    if row.count():
                        page.set_viewport_size({"width": w, "height": 1500})
                        page.wait_for_timeout(300)
                        row.hover()
                        page.wait_for_timeout(300)
                        shoot(page, f"{tag}-zonehover", full=False)
                        page.set_viewport_size({"width": w, "height": h})
                    page.mouse.move(5, 5)
                    for m in ("RTT", "Loss", "Signal"):
                        page.get_by_role("radio", name=m, exact=True).click()
                        page.wait_for_timeout(300)
                        page.locator("section").first.screenshot(path=os.path.join(OUT, f"scenario-{tag}-{m.lower()}.png"))
                    page.get_by_role("radio", name="Capacity", exact=True).click()
                    for v in ("heavy_jamming", "no_lte", "overlap_harsh", "fast_fade"):
                        page.goto(BASE + f"#/scenario?variant={v}&seed=0&cmp=Baseline")
                        ready(page)
                        shoot(page, f"{tag}-{v}", full=False)
                ctx.close()
        b.close()
    print("console errors:", len(errors))
    for e in errors:
        print("  ", e)


if __name__ == "__main__":
    main()
