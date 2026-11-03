import { forwardRef, useRef, type KeyboardEvent, type ReactNode } from "react";
import s from "./SegmentedControl.module.css";

export interface SegmentOption<T extends string | number> {
  value: T;
  label: ReactNode;
  /** Tooltip / accessible description (e.g. full chapter name). */
  title?: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string | number> {
  /** Accessible name of the group, e.g. "Playback speed". */
  ariaLabel: string;
  value: T;
  options: SegmentOption<T>[];
  onChange: (v: T) => void;
  className?: string;
  /** Visible label before the well (13 text-2), e.g. "Speed". */
  label?: ReactNode;
}

/**
 * role="radiogroup" in a sunken well (DESIGN.md 7). Options 28px (32 in presenter mode).
 * Arrow keys move the selection; only the selected option is in the tab order.
 */
function SegmentedInner<T extends string | number>(
  { ariaLabel, value, options, onChange, className, label }: SegmentedControlProps<T>,
  ref: React.ForwardedRef<HTMLDivElement>,
) {
  const btns = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
  const cur = options.findIndex((o) => o.value === value);

  const onKey = (e: KeyboardEvent) => {
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    const jump = e.key === "Home" ? enabled[0] : e.key === "End" ? enabled[enabled.length - 1] : undefined;
    if (!dir && jump === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    let next = jump;
    if (next === undefined) {
      const pos = Math.max(0, enabled.indexOf(cur));
      next = enabled[(pos + dir + enabled.length) % enabled.length];
    }
    if (next !== undefined) {
      onChange(options[next].value);
      btns.current[next]?.focus();
    }
  };

  return (
    <div className={[s.wrap, className].filter(Boolean).join(" ")}>
      {label && <span className={s.label} aria-hidden>{label}</span>}
      <div ref={ref} role="radiogroup" aria-label={ariaLabel} className={s.well} onKeyDown={onKey}>
        {options.map((o, i) => {
          const sel = o.value === value;
          return (
            <button key={String(o.value)} ref={(el) => { btns.current[i] = el; }} type="button" role="radio"
              aria-checked={sel} disabled={o.disabled} title={o.title}
              tabIndex={sel || (cur < 0 && i === enabled[0]) ? 0 : -1}
              className={[s.opt, sel ? s.selected : ""].join(" ")}
              onClick={() => onChange(o.value)}>
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export const SegmentedControl = forwardRef(SegmentedInner) as <T extends string | number>(
  p: SegmentedControlProps<T> & { ref?: React.ForwardedRef<HTMLDivElement> },
) => ReturnType<typeof SegmentedInner>;
