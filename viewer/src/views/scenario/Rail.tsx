/**
 * Right rail (DESIGN.md 6.3): the variant switcher with each variant's differences from
 * nominal in plain words, and the assumptions list. Every assumption row carries the
 * "(A)" badge; hovering a row highlights its zone on the route chart and the chart's
 * zones highlight the row back.
 */
import { useRef, type KeyboardEvent } from "react";
import { Badge, Button } from "../../components";
import { showInReplay, useStore } from "../../state";
import { fmtClock, variantLabel } from "../../data/loader";
import type { RunData, Scenario } from "../../data/types";
import { assumptionItems, passTime, variantHasAssumed, variantSentence } from "./model";
import s from "./Scenario.module.css";

export function VariantPicker({ sc, variant }: { sc: Scenario; variant: string }) {
  const setVariant = useStore((st) => st.setVariant);
  const names = Object.keys(sc.variants);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent) => {
    const dir = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    e.stopPropagation();
    const i = (names.indexOf(variant) + dir + names.length) % names.length;
    setVariant(names[i]);
    refs.current[i]?.focus();
  };
  return (
    <div role="radiogroup" aria-label="Scenario variant" className={s.variants} onKeyDown={onKey}>
      {names.map((n, i) => {
        const sel = n === variant;
        return (
          <button key={n} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={sel}
            tabIndex={sel ? 0 : -1} className={`${s.variant} ${sel ? s.variantSel : ""}`} onClick={() => setVariant(n)}
            title={`${n}: ${sc.variants[n].description}`}>
            <span className={s.variantHead}>
              <span className={s.variantName}>{variantLabel(n)}</span>
              {variantHasAssumed(sc, n) && <Badge kind="assumption" title="Changes values marked (A) in sim/scenario.py DEFAULTS" />}
            </span>
            <span className={s.variantText}>{variantSentence(sc, n)}</span>
          </button>
        );
      })}
    </div>
  );
}

interface AssumptionsProps {
  sc: Scenario;
  variant: string;
  run: RunData | null;
  hoverZone: string | null;
  onHoverZone: (k: string | null) => void;
}

export function Assumptions({ sc, variant, run, hoverZone, onHoverZone }: AssumptionsProps) {
  const items = assumptionItems(sc, variant);
  const groups = Array.from(new Set(items.map((i) => i.group)));
  return (
    <div className={s.assumptions}>
      <p className={s.railLead}>
        Numbers marked (A) in the simulator source are assumptions, not measurements. Values below are read from the exported scenario.
      </p>
      {groups.map((g) => (
        <section key={g} className={s.aGroup} aria-labelledby={`ag-${g}`}>
          <h3 id={`ag-${g}`} className={s.aGroupTitle}>{g}</h3>
          <ul className={s.aList}>
            {items.filter((i) => i.group === g).map((it) => {
              const on = !!hoverZone && it.zones.includes(hoverZone);
              const t = it.km !== undefined ? passTime(run, it.km, "out") : null;
              return (
                <li key={it.key} className={`${s.aItem} ${on ? s.aItemOn : ""}`}
                  onMouseEnter={() => it.zones[0] && onHoverZone(it.zones[0])}
                  onMouseLeave={() => it.zones[0] && onHoverZone(null)}
                  onFocus={() => it.zones[0] && onHoverZone(it.zones[0])}
                  onBlur={() => it.zones[0] && onHoverZone(null)}>
                  <span className={s.aText}>{it.text}</span>
                  <Badge kind="assumption" className={s.aBadge} title={`Assumption, marked (A) in ${it.source}`} />
                  {t !== null && (
                    <Button variant="quiet" className={s.aReplay} onClick={() => showInReplay({ t: Math.max(0, t - 2) })}
                      aria-label={`Show in replay at ${fmtClock(t)}`}>Show in replay</Button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
