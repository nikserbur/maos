/**
 * Строительные блоки лонгрида «Методика»: раздел, рисунок-карточка со схемой,
 * блок формулы, чипы статуса (реализовано / Волна 1–3), выноски, литература.
 */
import type { ReactNode } from 'react'
import { getDiagram, type DiagramId } from '../../diagrams'
import { figureNumber, sectionGroup, sectionNumber, sectionTitle, type SectionId } from './toc'

/** Статус реализации: честная граница «сделано ↔ в работе ↔ план». */
export type Stage = 'done' | 'w1' | 'w2' | 'w3'

const STAGE_LABEL: Record<Stage, string> = {
  done: 'реализовано',
  w1: 'Волна 1 · внедряется',
  w2: 'Волна 2 · план',
  w3: 'Волна 3 · план',
}

export function StageChip({ stage, children }: { stage: Stage; children?: ReactNode }) {
  return (
    <span className={`mth-chip mth-chip--${stage}`}>
      <span className="mth-chip__glyph" aria-hidden="true" />
      <span className="mth-chip__stage">{STAGE_LABEL[stage]}</span>
      {children && <span className="mth-chip__what">{children}</span>}
    </span>
  )
}

export type StageItem = readonly [Stage, ReactNode]

interface SectionProps {
  id: SectionId
  stages?: readonly StageItem[]
  lead?: ReactNode
  children: ReactNode
}

export function Section({ id, stages, lead, children }: SectionProps) {
  return (
    <section id={id} className="mth-sec" aria-labelledby={`${id}-h`}>
      <header className="mth-sec__head">
        <div className="mth-sec__meta">
          <span className="mth-sec__num">{sectionNumber(id)}</span>
          <span className="mth-sec__eyebrow text-caps">{sectionGroup(id)}</span>
        </div>
        <h2 id={`${id}-h`} className="mth-sec__title">{sectionTitle(id)}</h2>
        {stages && stages.length > 0 && (
          <div className="mth-sec__stages">
            {stages.map(([s, what], i) => <StageChip key={i} stage={s}>{what}</StageChip>)}
          </div>
        )}
      </header>
      {lead && <p className="mth-lead">{lead}</p>}
      <div className="mth-prose">{children}</div>
    </section>
  )
}

/** Рисунок-карточка: полноразмерная схема + подпись. */
export function Figure({ id, caption }: { id: DiagramId; caption: ReactNode }) {
  const meta = getDiagram(id)
  if (!meta) return null
  const D = meta.Component
  return (
    <figure className="mth-fig">
      <div className="mth-fig__canvas"><D /></div>
      <figcaption className="mth-fig__cap">
        <span className="mth-fig__no text-caps">Рис. {figureNumber(id)}</span>
        <span className="mth-fig__title">{meta.title}.</span> {caption}
      </figcaption>
    </figure>
  )
}

/** Блок формулы (моноширинный, с необязательной пояснительной строкой). */
export function Formula({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="mth-formula">
      <div className="mth-formula__body">{children}</div>
      {note && <div className="mth-formula__note">{note}</div>}
    </div>
  )
}

/** Выноска: «поправка» (исправленное утверждение) или «оговорка». */
export function Callout({ tone, title, children }: { tone: 'fix' | 'note'; title: string; children: ReactNode }) {
  return (
    <aside className={`mth-callout mth-callout--${tone}`}>
      <div className="mth-callout__title text-caps"><span className="mth-callout__glyph" aria-hidden="true" />{title}</div>
      <div className="mth-callout__body">{children}</div>
    </aside>
  )
}

/** Допущения и ограничения. */
export function Notes({ title = 'Допущения и ограничения', items }: { title?: string; items: readonly ReactNode[] }) {
  return (
    <div className="mth-notes">
      <div className="mth-notes__title text-caps">{title}</div>
      <ul>{items.map((it, i) => <li key={i}>{it}</li>)}</ul>
    </div>
  )
}

/** Литература раздела (авторы, год, издание). */
export function Refs({ items }: { items: readonly string[] }) {
  return (
    <div className="mth-refs">
      <div className="mth-refs__title text-caps">Литература</div>
      <ol>{items.map((r) => <li key={r}>{r}</li>)}</ol>
    </div>
  )
}

/** Нижний индекс / верхний индекс — короткие помощники для формул в тексте. */
export const Sub = ({ children }: { children: ReactNode }) => <sub>{children}</sub>
export const Sup = ({ children }: { children: ReactNode }) => <sup>{children}</sup>
