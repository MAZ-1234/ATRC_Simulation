import { forwardRef } from "react";
import type { StatusKind } from "./colors";

export interface GlyphProps {
  /** bad = cross, warn = exclamation, good = check, unknown = question mark. */
  kind: StatusKind;
  /** Size in px (default 12). */
  size?: number;
  /** Accessible name; when omitted the glyph is decorative (aria-hidden), so pair it with a word. */
  title?: string;
  className?: string;
}

/**
 * Status glyph (DESIGN.md 2.4): the second channel that always accompanies a status colour.
 * Drawn in the matching --color-status-* token.
 */
export const Glyph = forwardRef<SVGSVGElement, GlyphProps>(function Glyph({ kind, size = 12, title, className }, ref) {
  const stroke = "currentColor";
  return (
    <svg ref={ref} className={className} width={size} height={size} viewBox="0 0 12 12"
      role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}
      style={{ flex: "none", verticalAlign: "-1px", color: `var(--color-status-${kind})` }}>
      {kind === "bad" && <path d="M2.5 2.5 L9.5 9.5 M9.5 2.5 L2.5 9.5" stroke={stroke} strokeWidth="2" strokeLinecap="round" fill="none" />}
      {kind === "warn" && (
        <g fill={stroke}>
          <rect x="5" y="1" width="2" height="7" rx="1" />
          <circle cx="6" cy="10.5" r="1.1" />
        </g>
      )}
      {kind === "good" && <path d="M2 6.5 L5 9.2 L10 3" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />}
      {kind === "unknown" && (
        <g fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round">
          <path d="M3.8 4.2 C3.8 2.2 8.2 2.2 8.2 4.2 C8.2 5.6 6 5.8 6 7.3" />
          <circle cx="6" cy="10.2" r="0.6" fill={stroke} />
        </g>
      )}
    </svg>
  );
});
