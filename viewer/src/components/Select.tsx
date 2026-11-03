import { forwardRef, useId, type ReactNode } from "react";
import s from "./Select.module.css";

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string | number> {
  /** Visible label before the control (13 text-2). */
  label: ReactNode;
  /** Hide the label visually (still read by screen readers). */
  hideLabel?: boolean;
  value: T;
  options: SelectOption<T>[];
  onChange: (v: T) => void;
  /** Tooltip on the control (e.g. the variant code name). */
  title?: string;
  disabled?: boolean;
  className?: string;
}

/** Native <select> styled to the tokens (radius-2, border-strong). Keyboard and screen readers work as native. */
function SelectInner<T extends string | number>(
  { label, hideLabel, value, options, onChange, title, disabled, className }: SelectProps<T>,
  ref: React.ForwardedRef<HTMLSelectElement>,
) {
  const id = useId();
  return (
    <span className={[s.wrap, className].filter(Boolean).join(" ")}>
      <label htmlFor={id} className={hideLabel ? "sr-only" : s.label}>{label}</label>
      <span className={s.control}>
        <select ref={ref} id={id} className={s.select} value={String(value)} title={title} disabled={disabled}
          onChange={(e) => {
            const opt = options.find((o) => String(o.value) === e.target.value);
            if (opt) onChange(opt.value);
          }}>
          {options.map((o) => (
            <option key={String(o.value)} value={String(o.value)} disabled={o.disabled}>{o.label}</option>
          ))}
        </select>
        <svg className={s.chev} width="10" height="6" viewBox="0 0 10 6" aria-hidden>
          <path d="M1 1 L5 5 L9 1" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </span>
    </span>
  );
}

export const Select = forwardRef(SelectInner) as <T extends string | number>(
  p: SelectProps<T> & { ref?: React.ForwardedRef<HTMLSelectElement> },
) => ReturnType<typeof SelectInner>;
