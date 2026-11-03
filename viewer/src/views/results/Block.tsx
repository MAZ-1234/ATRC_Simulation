/**
 * One Results block, always in the same order (DESIGN.md 6.2): claim sentence, one chart
 * (its figure holds the "Show data" toggle), a one-line caveat, the "Show in replay" link.
 *
 * DESIGN-GAP: 6.2 allows one claim sentence at 24px, max 40ch. Several results need a
 * second, supporting sentence (the other side of the trade-off); it is set as `detail`
 * in body type under the claim so the 24px line stays one sentence.
 */
import type { ReactNode } from "react";
import { renderParts, type Parts } from "./prose";
import s from "./Results.module.css";

export interface BlockProps {
  id: string;
  /** Section name (display 18/600). */
  title: string;
  /** Scope line, right of the title: "Nominal, n = 20 seeds". */
  scope?: ReactNode;
  claim: Parts;
  detail?: Parts;
  chart: ReactNode;
  caveat: ReactNode;
  replay: ReactNode;
  /** Heading level: 2 for sections, 3 for items inside "Where Proposed does not win". */
  level?: 2 | 3;
}

export function Block({ id, title, scope, claim, detail, chart, caveat, replay, level = 2 }: BlockProps) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <section id={id} className={s.block} aria-labelledby={`${id}-title`} data-section={level === 2 ? id : undefined}>
      <header className={s.blockHead}>
        <H id={`${id}-title`} className={s.blockTitle}>{title}</H>
        {scope && <span className={s.scope}>{scope}</span>}
      </header>
      <p className={s.claim}>{renderParts(claim)}</p>
      {detail && detail.length > 0 && <p className={s.detail}>{renderParts(detail)}</p>}
      <div className={s.chart}>{chart}</div>
      <p className={s.caveat}><span className={s.caveatLabel}>Caveat:</span> {caveat}</p>
      {replay}
    </section>
  );
}
