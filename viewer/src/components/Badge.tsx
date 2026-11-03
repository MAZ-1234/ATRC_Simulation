import { forwardRef, type ReactNode, type HTMLAttributes } from "react";
import { Glyph } from "./Glyph";
import { linkVar } from "./colors";
import { linkLabel } from "../data/labels";
import type { LinkName } from "../data/types";
import s from "./Badge.module.css";

export type BadgeKind =
  | "neutral" | "needed" | "status-bad" | "status-warn" | "status-good" | "status-unknown"
  | "link" | "level" | "assumption";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /**
   * neutral: text-2 on sunken. needed: "Needed now" with a text-1 outline.
   * status-*: glyph + word on the status wash (always pass the word as children).
   * link: swatch + link name (pass `link`). level: "L3". assumption: "(A)".
   */
  kind?: BadgeKind;
  /** For kind="link". Children default to the link's UI name ("4G"). */
  link?: LinkName;
  children?: ReactNode;
}

/** 20px badge, radius-1, 12px weight 500 (DESIGN.md 7). */
export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { kind = "neutral", link, className, children, ...rest }, ref,
) {
  const status = kind.startsWith("status-") ? (kind.slice(7) as "bad" | "warn" | "good" | "unknown") : null;
  const content =
    kind === "needed" ? children ?? "Needed now"
      : kind === "assumption" ? children ?? "(A)"
        : kind === "link" ? children ?? linkLabel(link) : children;
  return (
    <span ref={ref} className={[s.badge, s[kind.replace("-", "_")], className].filter(Boolean).join(" ")} {...rest}>
      {status && <Glyph kind={status} size={11} />}
      {kind === "link" && link && (
        <span className={s.swatch} style={{ background: linkVar(link), borderColor: linkVar(link, "edge") }} aria-hidden />
      )}
      <span>{content}</span>
    </span>
  );
});
