import { forwardRef, type ReactNode } from "react";
import s from "./Legend.module.css";

/** Swatch shape = the mark it labels (DESIGN.md 7). */
export type LegendMark = "band" | "line" | "dashed" | "dot" | "ring" | "hatch" | "hatch-bad";

export interface LegendItem {
  key: string;
  label: ReactNode;
  mark: LegendMark;
  /** CSS colour, usually a var(): "var(--color-ctrl-proposed)". Ignored for hatch marks. */
  color?: string;
  /** Optional edge colour (e.g. 4G fill needs --color-link-lte-edge; baseline fill its edge). */
  edge?: string;
  /** Band opacity (e.g. "var(--link-degraded-alpha)" for "up, degraded"). */
  opacity?: string | number;
  /** Interactive legends: series hidden (greyed, struck-through swatch). */
  hidden?: boolean;
}

export interface LegendProps {
  items: LegendItem[];
  /** When given, items become toggle buttons (aria-pressed = visible). */
  onToggle?: (key: string) => void;
  className?: string;
  /** Accessible name, default "Legend". */
  ariaLabel?: string;
}

function Swatch({ item }: { item: LegendItem }) {
  const c = item.color ?? "var(--color-text-2)";
  switch (item.mark) {
    case "band":
      return <span className={s.band} style={{ background: c, opacity: item.opacity as number | undefined, borderColor: item.edge ?? "transparent" }} />;
    case "line":
      return <span className={s.line} style={{ background: c }} />;
    case "dashed":
      return <span className={s.dashed} style={{ borderTopColor: c }} />;
    case "dot":
      return <span className={s.dot} style={{ background: c }} />;
    case "ring":
      return <span className={s.ring} style={{ borderColor: c }} />;
    case "hatch":
      return <span className={s.hatch} />;
    case "hatch-bad":
      return <span className={s.hatchBad} />;
  }
}

/** Inline legend row above a chart, left-aligned. Swatch + 13 text-2 label. */
export const Legend = forwardRef<HTMLDivElement, LegendProps>(function Legend({ items, onToggle, className, ariaLabel = "Legend" }, ref) {
  return (
    <div ref={ref} className={[s.legend, className].filter(Boolean).join(" ")} role={onToggle ? "group" : "list"} aria-label={ariaLabel}>
      {items.map((it) =>
        onToggle ? (
          <button key={it.key} type="button" className={[s.item, s.button, it.hidden ? s.hidden : ""].join(" ")}
            aria-pressed={!it.hidden} onClick={() => onToggle(it.key)}>
            <span className={s.sw}><Swatch item={it} /></span>
            <span>{it.label}</span>
          </button>
        ) : (
          <span key={it.key} className={s.item} role="listitem">
            <span className={s.sw}><Swatch item={it} /></span>
            <span>{it.label}</span>
          </span>
        ),
      )}
    </div>
  );
});
