/**
 * Vertical layout of the timeline tracks (DESIGN.md 6.1, 6.1.2, 7). Row heights are the
 * spec values; the gaps between groups absorb whatever height the cell has left, so the
 * tracks fill 280 px (wide) and 260 px (compact) exactly, and shrink to their minimum
 * when "Show streams" is on at compact.
 */
import type { CamName, LinkName } from "../../../data/types";
import type { Breakpoint } from "../../../state";
import type { Side } from "../../../data/events";

export type RowKind = "segment" | "link" | "ribbon" | "cam" | "whosaw" | "man" | "upnames" | "upload";

export interface Row {
  id: string;
  kind: RowKind;
  y: number;
  h: number;
  link?: LinkName;
  side?: Side;
  cam?: CamName;
}

export interface Layout {
  rows: Row[];
  /** Height of the track area (canvas), px. */
  height: number;
  /** Vertical extent of a labelled group: [top, bottom] for the gutter label. */
  groups: Record<string, [number, number]>;
}

/** Header (tally and controls) and time axis heights, px. */
export const HEADER_H = 32;
export const AXIS_H = 26;

const LINKS: LinkName[] = ["radio", "starlink", "lte"];
const CAMS: CamName[] = ["front", "rear"];

interface Item { kind: "row"; row: Omit<Row, "y"> }
interface Gap { kind: "gap"; base: number; min: number; flex: boolean }

export function buildLayout(bp: Breakpoint, showStreams: boolean, available: number | null): Layout {
  const linkH = bp === "wide" ? 16 : 12;
  const camH = 5;
  const seq: (Item | Gap)[] = [];
  const row = (r: Omit<Row, "y">) => seq.push({ kind: "row", row: r });
  const gap = (base: number, min: number, flex = false) => seq.push({ kind: "gap", base, min, flex });

  row({ id: "segment", kind: "segment", h: 14 });
  gap(6, 3, true);
  LINKS.forEach((link, i) => {
    if (i > 0) gap(2, 2);
    row({ id: `link-${link}`, kind: "link", link, h: linkH });
  });
  gap(10, 4, true);
  const ribbon = (side: Side) => {
    row({ id: `ribbon-${side}`, kind: "ribbon", side, h: 20 });
    if (showStreams) {
      gap(2, 1);
      CAMS.forEach((cam, i) => {
        if (i > 0) gap(1, 1);
        row({ id: `cam-${side}-${cam}`, kind: "cam", side, cam, h: camH });
      });
    }
  };
  ribbon("left");
  gap(3, 2);
  row({ id: "whosaw", kind: "whosaw", h: 14 });
  gap(3, 2);
  ribbon("right");
  gap(10, 4, true);
  row({ id: "man", kind: "man", h: 14 });
  gap(6, 3, true);
  row({ id: "upnames", kind: "upnames", h: 13 });
  gap(1, 1);
  // 8 + 4 px pitch: each upload row carries a 12px controller label in the gutter.
  row({ id: "upload-left", kind: "upload", side: "left", h: 8 });
  gap(4, 3);
  row({ id: "upload-right", kind: "upload", side: "right", h: 8 });
  gap(2, 2);

  const gaps = seq.filter((x): x is Gap => x.kind === "gap");
  const rowsH = seq.reduce((a, x) => a + (x.kind === "row" ? x.row.h : 0), 0);
  const natural = rowsH + gaps.reduce((a, g) => a + g.base, 0);
  const size = new Map<Gap, number>(gaps.map((g) => [g, g.base]));
  if (available !== null) {
    let delta = available - natural;
    if (delta > 0) {
      const flex = gaps.filter((g) => g.flex);
      const each = Math.min(14, Math.floor(delta / flex.length));
      flex.forEach((g) => size.set(g, g.base + each));
    } else if (delta < 0) {
      // Shrink gaps toward their minimum, flexible ones first.
      for (const g of [...gaps.filter((x) => x.flex), ...gaps.filter((x) => !x.flex)]) {
        if (delta >= 0) break;
        const room = g.base - g.min;
        const take = Math.min(room, -delta);
        size.set(g, g.base - take);
        delta += take;
      }
    }
  }

  const rows: Row[] = [];
  let y = 0;
  for (const x of seq) {
    if (x.kind === "gap") { y += size.get(x) ?? x.base; continue; }
    rows.push({ ...x.row, y });
    y += x.row.h;
  }
  const by = (id: string) => rows.find((r) => r.id === id);
  const span = (a: string, b: string): [number, number] => {
    const ra = by(a);
    const rb = by(b) ?? ra;
    return ra && rb ? [ra.y, rb.y + rb.h] : [0, 0];
  };
  const groups: Record<string, [number, number]> = {
    uploads: span("upnames", "upload-right"),
    "cams-left": span("cam-left-front", "cam-left-rear"),
    "cams-right": span("cam-right-front", "cam-right-rear"),
  };
  return { rows, height: y, groups };
}
