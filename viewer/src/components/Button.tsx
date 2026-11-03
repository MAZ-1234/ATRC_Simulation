import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import s from "./Button.module.css";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * default: 1px border-strong outline. quiet: no border until hover (toolbars, links like
   * "Show in replay"). icon: square, for glyph-only buttons (give it aria-label).
   */
  variant?: "default" | "quiet" | "icon";
  /** Toggle buttons: sets aria-pressed and the selected look (surface-2, weight 600). */
  pressed?: boolean;
  children?: ReactNode;
}

/**
 * Button (radius-2). Labels say exactly what happens: "Show in replay", "Show data".
 * Hover changes only the border / adds a 4% overlay; no lift, shadow or scale.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "default", pressed, className, type = "button", children, ...rest }, ref,
) {
  return (
    <button ref={ref} type={type} aria-pressed={pressed}
      className={[s.btn, s[variant], pressed ? s.pressed : "", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </button>
  );
});
