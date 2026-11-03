import { forwardRef, type ReactNode, type HTMLAttributes } from "react";
import { Glyph } from "./Glyph";
import s from "./Panel.module.css";

export type PanelState = "default" | "loading" | "empty" | "error";

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** Panel title (display 18/600). Omit for an untitled panel. */
  title?: ReactNode;
  /** Optional title colour role, e.g. "var(--color-ctrl-proposed-text)" for a console title. */
  titleColor?: string;
  /** Right-aligned actions in the title row (buttons, segmented controls, badges). */
  actions?: ReactNode;
  /** default renders children; loading/empty/error render `message` instead (DESIGN.md 7). */
  state?: PanelState;
  /**
   * loading: static text-3 line, e.g. "Loading seed 0" (no shimmer).
   * empty: the direction, e.g. "No trace for seed 12. Export traces for this run, then reload."
   * error: a sentence naming what failed and the fix (a bad glyph is added).
   */
  message?: ReactNode;
  /** Remove body padding (for edge-to-edge charts/canvases). */
  flush?: boolean;
  /** Heading level of the title (default 2). */
  level?: 2 | 3;
  children?: ReactNode;
}

/**
 * Flat panel: surface-1, 1px border, radius-3, no shadow. Panels never nest panels.
 *   <Panel title="Links now" actions={<Badge kind="neutral">4G</Badge>}>...</Panel>
 */
export const Panel = forwardRef<HTMLElement, PanelProps>(function Panel(
  { title, titleColor, actions, state = "default", message, flush, level = 2, className, children, ...rest }, ref,
) {
  const H = level === 3 ? "h3" : "h2";
  return (
    <section ref={ref} className={[s.panel, className].filter(Boolean).join(" ")} aria-busy={state === "loading" || undefined} {...rest}>
      {(title || actions) && (
        <header className={s.head}>
          {title && <H className={s.title} style={titleColor ? { color: titleColor } : undefined}>{title}</H>}
          {actions && <div className={s.actions}>{actions}</div>}
        </header>
      )}
      <div className={[s.body, flush ? s.flush : ""].join(" ")}>
        {state === "default" && children}
        {state === "loading" && <p className={s.loading}>{message ?? "Loading"}</p>}
        {state === "empty" && <p className={s.empty}>{message}</p>}
        {state === "error" && (
          <p className={s.error} role="alert"><Glyph kind="bad" size={14} /> <span>{message}</span></p>
        )}
      </div>
    </section>
  );
});
