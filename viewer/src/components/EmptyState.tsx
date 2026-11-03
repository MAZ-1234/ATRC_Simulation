import { forwardRef, type ReactNode } from "react";
import { Glyph } from "./Glyph";
import type { StatusKind } from "./colors";
import s from "./EmptyState.module.css";

export interface EmptyStateProps {
  /** One-line statement of what is missing or failed: "No trace for seed 12." */
  title: ReactNode;
  /** The direction: what to do next. Commands go in `command`. */
  children?: ReactNode;
  /** A shell command to show verbatim (e.g. the export command). */
  command?: string;
  /** Where to run `command`, e.g. "edge_mlc/". */
  cwd?: string;
  /** Glyph: unknown (default, missing data) or bad (a failure). */
  kind?: Extract<StatusKind, "unknown" | "bad" | "warn">;
  /** Optional action button(s). */
  action?: ReactNode;
  className?: string;
}

/**
 * Empty / error direction block (DESIGN.md 10): names what is missing and how to fix it,
 * never apologises. Usable inside a Panel or as a full-page state.
 */
export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(function EmptyState(
  { title, children, command, cwd, kind = "unknown", action, className }, ref,
) {
  return (
    <div ref={ref} className={[s.wrap, className].filter(Boolean).join(" ")} role={kind === "bad" ? "alert" : undefined}>
      <p className={s.title}><Glyph kind={kind} size={14} /> <span>{title}</span></p>
      {children && <div className={s.body}>{children}</div>}
      {command && (
        <div className={s.cmdBlock}>
          {cwd && <span className={s.cwd}>Run from {cwd}</span>}
          <code className={s.cmd}>{command}</code>
        </div>
      )}
      {action && <div className={s.action}>{action}</div>}
    </div>
  );
});
