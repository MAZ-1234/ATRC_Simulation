/** Small text helpers shared by the Method sections. */
import type { ReactNode } from "react";
import { Badge, Tooltip } from "../../components";
import { fmtNum, levelTooltip } from "../../data/loader";
import type { LadderLevel } from "../../data/types";
import s from "./Method.module.css";

/** Fraction 0-1 as a percent with the fewest decimals that keep the value exact (0.05 -> "5%", 0.025 -> "2.5%", 0.0025 -> "0.25%"). */
export function pct(x: number): string {
  const v = x * 100;
  const d = Math.abs(v - Math.round(v)) < 1e-9 ? 0 : Math.abs(v * 10 - Math.round(v * 10)) < 1e-9 ? 1 : 2;
  return `${v.toFixed(d)}%`;
}

/** Seconds with the decimals the config uses (2 -> "2.0 s", 0.5 -> "0.5 s"). */
export function sec(x: number): string {
  return `${fmtNum(x, Math.abs(x * 10 - Math.round(x * 10)) < 1e-9 ? 1 : 2)} s`;
}

/** Plain number with a true minus and the fewest decimals that keep it exact. */
export function num(x: number): string {
  const d = Math.abs(x - Math.round(x)) < 1e-9 ? 0 : Math.abs(x * 10 - Math.round(x * 10)) < 1e-9 ? 1 : 2;
  return fmtNum(x, d);
}

/** Controller name in prose (controller text colour, weight 500). */
export function Ctrl({ name }: { name: "Baseline" | "Proposed" }) {
  return <span className={name === "Baseline" ? "ctrl-baseline" : "ctrl-proposed"}>{name}</span>;
}

/** A value that comes from the data, set in text-1 weight 500 so it reads as a figure. */
export function V({ children }: { children: ReactNode }) {
  return <span className={s.v}>{children}</span>;
}

/** Ladder level chip with its tooltip ("L3: 320×240, 20 fps, about 700 kbps"). */
export function Level({ l }: { l: LadderLevel | undefined }) {
  if (!l) return null;
  return (
    <Tooltip content={levelTooltip(l)}>
      <span tabIndex={0} className={s.levelChip}><Badge kind="level">{l.name}</Badge></span>
    </Tooltip>
  );
}

/** Code identifier, shown in the UI face (no monospace anywhere). */
export function Code({ children }: { children: ReactNode }) {
  return <span className={s.code}>{children}</span>;
}
