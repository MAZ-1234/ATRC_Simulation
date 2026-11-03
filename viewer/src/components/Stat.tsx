import { forwardRef, type ReactNode } from "react";
import { Badge } from "./Badge";
import { fmtCI, fmtDelta, MISSING } from "../format";
import s from "./Stat.module.css";

export interface StatProps {
  /** Metric label (13 text-2): "Usable view". */
  label: ReactNode;
  /** Mean value; null/undefined renders the missing state. */
  value: number | null | undefined;
  /** Unit after a normal space ("%" is attached without a space). */
  unit?: string;
  /** Decimals for value, CI and delta (default 1). */
  decimals?: number;
  /** 95% CI bounds (from summary `<m>_ci` as mean ± half-width). */
  ci?: { lo: number | null; hi: number | null } | null;
  /** Number of seeds. n < 5 adds the low-n warn badge. */
  n?: number | null;
  /** Difference against the other controller, e.g. { value: 8.3, unit: "points" }. Never coloured. */
  delta?: { value: number | null; unit?: string; against?: string } | null;
  /** Headline size (36 instead of 24). One per view at most. */
  headline?: boolean;
  /** Missing-state text (default "No data for this variant"). */
  missingText?: string;
  /** Value colour, e.g. ctrlVar("Proposed", "text"). Default text-1. */
  color?: string;
  /** Optional 120px dot-interval sparkline or other figure under the CI line. */
  children?: ReactNode;
  className?: string;
}

/**
 * Metric with CI (DESIGN.md 7 "Metric"): label, value (display 24/600) with unit, CI line
 * (12 text-3, "95% CI 84.0–84.6, n = 20"), optional plain-text delta.
 */
export const Stat = forwardRef<HTMLDivElement, StatProps>(function Stat(
  { label, value, unit = "", decimals = 1, ci, n, delta, headline, missingText = "No data for this variant", color, children, className }, ref,
) {
  const has = typeof value === "number" && Number.isFinite(value);
  const lowN = typeof n === "number" && n < 5;
  const unitStr = unit === "%" ? "%" : unit ? ` ${unit}` : "";
  return (
    <div ref={ref} className={[s.stat, className].filter(Boolean).join(" ")}>
      <div className={s.label}>
        <span>{label}</span>
        {lowN && <Badge kind="status-warn">n = {n}</Badge>}
      </div>
      <div className={[s.value, headline ? s.headline : ""].join(" ")} style={color ? { color } : undefined}>
        {has ? `${value!.toFixed(decimals)}${unitStr}` : MISSING}
      </div>
      {has && ci && ci.lo !== null && ci.hi !== null && (
        <div className={s.ci}>95% CI {fmtCI(ci.lo, ci.hi, decimals)}{typeof n === "number" ? `, n = ${n}` : ""}</div>
      )}
      {!has && <div className={s.ci}>{missingText}</div>}
      {has && delta && delta.value !== null && (
        <div className={s.delta}>
          {fmtDelta(delta.value, delta.unit ?? "", decimals)}{delta.against ? ` against ${delta.against}` : ""}
        </div>
      )}
      {children}
    </div>
  );
});
