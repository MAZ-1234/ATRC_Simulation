/**
 * Shared SVG patterns (DESIGN.md 2.5), defined once in the shell. Reference them from any
 * SVG as fill="url(#pat-hatch-neutral)" etc. Same angles as the CSS --hatch-* gradients,
 * 5-unit tile. Colours come from tokens, so they follow the theme.
 */
export const PATTERN_IDS = {
  neutral: "pat-hatch-neutral",
  bad: "pat-hatch-bad",
  warn: "pat-hatch-warn",
} as const;

export function PatternDefs() {
  return (
    <svg width="0" height="0" aria-hidden focusable="false" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
      <defs>
        {/* 135deg stripes ("/"), like repeating-linear-gradient(135deg, ...) */}
        <pattern id={PATTERN_IDS.neutral} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0.5" y1="0" x2="0.5" y2="5" style={{ stroke: "var(--color-status-unknown)", strokeWidth: 1 }} />
        </pattern>
        <pattern id={PATTERN_IDS.bad} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0.75" y1="0" x2="0.75" y2="5" style={{ stroke: "var(--color-status-bad)", strokeWidth: 1.5 }} />
        </pattern>
        {/* 45deg stripes ("\"), like repeating-linear-gradient(45deg, ...) */}
        <pattern id={PATTERN_IDS.warn} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
          <line x1="0.5" y1="0" x2="0.5" y2="5" style={{ stroke: "var(--color-status-warn)", strokeWidth: 1 }} />
        </pattern>
      </defs>
    </svg>
  );
}
