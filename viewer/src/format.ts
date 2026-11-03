/**
 * Number formatting (DESIGN.md section 8). Every number shown in the UI goes through
 * one of these helpers so units, decimals and dashes are identical everywhere.
 * Missing values (null, undefined, NaN) render as an en dash.
 */

/** En dash shown for a missing value. */
export const MISSING = "–";
/** True minus sign U+2212 (never a hyphen) for negative deltas. */
export const MINUS = "−";

type Num = number | null | undefined;
const ok = (x: Num): x is number => typeof x === "number" && Number.isFinite(x);
const pad2 = (n: number) => (n < 10 ? "0" : "") + n;
const thousands = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** Mission clock: "08:41.2"; from 60 min "1:02:03". Truncates to the 0.1 s step. */
export function fmtClock(t: Num): string {
  if (!ok(t)) return MISSING;
  const neg = t < 0;
  const tenths = Math.floor(Math.abs(t) * 10 + 1e-6);
  const s10 = tenths % 600;
  const totalMin = Math.floor(tenths / 600);
  const sec = `${pad2(Math.floor(s10 / 10))}.${s10 % 10}`;
  const out = totalMin >= 60
    ? `${Math.floor(totalMin / 60)}:${pad2(totalMin % 60)}:${pad2(Math.floor(s10 / 10))}`
    : `${pad2(totalMin)}:${sec}`;
  return (neg ? MINUS : "") + out;
}

/** Short clock for axis ticks: "0:00", "2:00", "22:00" (whole minutes or m:ss). */
export function fmtClockShort(t: Num): string {
  if (!ok(t)) return MISSING;
  const s = Math.round(t);
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
}

/** Duration: "37.6 s" below 60 s, "3 min 03 s" from 60 s. */
export function fmtDur(s: Num): string {
  if (!ok(s)) return MISSING;
  const a = Math.abs(s);
  const sign = s < 0 ? MINUS : "";
  if (a < 60) return `${sign}${a.toFixed(1)} s`;
  const r = Math.round(a);
  return `${sign}${Math.floor(r / 60)} min ${pad2(r % 60)} s`;
}

/** Seconds with one decimal and unit, for ages and lead times: "1.4 s". */
export function fmtSec(s: Num, decimals = 1): string {
  if (!ok(s)) return MISSING;
  return `${s < 0 ? MINUS : ""}${Math.abs(s).toFixed(decimals)} s`;
}

/** Position: "2.41 km". */
export function fmtKm(d: Num): string {
  return ok(d) ? `${d.toFixed(2)} km` : MISSING;
}

/** Percent from a 0-100 value: "84.3%". */
export function fmtPct(x: Num, decimals = 1): string {
  return ok(x) ? `${x.toFixed(decimals)}%` : MISSING;
}

/** Percent from a 0-1 fraction (loss): "0.4%". */
export function fmtFrac(x: Num, decimals = 1): string {
  return ok(x) ? `${(x * 100).toFixed(decimals)}%` : MISSING;
}

/** 95% CI range "84.0–84.6" with the same decimals as the mean. */
export function fmtCI(lo: Num, hi: Num, decimals = 1): string {
  if (!ok(lo) || !ok(hi)) return MISSING;
  const f = (v: number) => (v < 0 ? MINUS + Math.abs(v).toFixed(decimals) : v.toFixed(decimals));
  return `${f(lo)}–${f(hi)}`;
}

/** CI half-width for tables: "±0.3". */
export function fmtPm(h: Num, decimals = 1): string {
  return ok(h) ? `±${Math.abs(h).toFixed(decimals)}` : MISSING;
}

/** "84.3 ±0.3" table cell (mean and CI half-width). */
export function fmtMeanPm(mean: Num, half: Num, decimals = 1): string {
  if (!ok(mean)) return MISSING;
  return ok(half) ? `${mean.toFixed(decimals)} ${fmtPm(half, decimals)}` : mean.toFixed(decimals);
}

/** Mbit/s from kbit/s: "6.1 Mbps". */
export function fmtMbps(kbps: Num): string {
  return ok(kbps) ? `${(kbps / 1000).toFixed(1)} Mbps` : MISSING;
}

/** Rate from kbit/s choosing the unit: "700 kbps" below 1000, else "6.1 Mbps". */
export function fmtRate(kbps: Num): string {
  if (!ok(kbps)) return MISSING;
  return Math.abs(kbps) < 1000 ? `${Math.round(kbps)} kbps` : fmtMbps(kbps);
}

/** Milliseconds: "95 ms". The monitor's 9999 sentinel ("no echo") shows as a dash. */
export function fmtMs(x: Num): string {
  if (!ok(x) || x >= 9999) return MISSING;
  return `${Math.round(x)} ms`;
}

/** Frame rate: "20 fps". */
export function fmtFps(x: Num): string {
  return ok(x) ? `${Math.round(x)} fps` : MISSING;
}

/** Megabytes: "20 MB" at or above 10, otherwise "3.1 MB". */
export function fmtMB(x: Num): string {
  if (!ok(x)) return MISSING;
  return Math.abs(x) >= 10 ? `${Math.round(x)} MB` : `${x.toFixed(1)} MB`;
}

/** Signal strength: "-92 dBm" (true minus). */
export function fmtDbm(x: Num): string {
  if (!ok(x)) return MISSING;
  return `${x < 0 ? MINUS : ""}${Math.abs(Math.round(x))} dBm`;
}

/** Integer count with thousands separator: "1,240". Means of counts: pass decimals = 1. */
export function fmtCount(n: Num, decimals = 0): string {
  if (!ok(n)) return MISSING;
  const s = Math.abs(n).toFixed(decimals);
  const [i, f] = s.split(".");
  return (n < 0 ? MINUS : "") + thousands(i) + (f ? "." + f : "");
}

/** Signed delta: "+8.3 points", "−32 ms". `unit` is appended after a space when given. */
export function fmtDelta(x: Num, unit = "", decimals = 1): string {
  if (!ok(x)) return MISSING;
  const sign = x > 0 ? "+" : x < 0 ? MINUS : "";
  const v = Math.abs(x).toFixed(decimals);
  return unit ? `${sign}${v} ${unit}` : `${sign}${v}`;
}

/** Plain number with fixed decimals and a true minus: "-3.1" -> "−3.1". */
export function fmtNum(x: Num, decimals = 1): string {
  if (!ok(x)) return MISSING;
  return (x < 0 ? MINUS : "") + Math.abs(x).toFixed(decimals);
}
