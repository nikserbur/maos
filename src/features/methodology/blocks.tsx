/**
 * Строительные блоки лонгрида «Методика»: раздел, рисунок-карточка со схемой, блок формулы, чипы
 * стадии (единый реестр src/explain/stages.ts — тот же, что у узлов карты), выноски, литература.
 * Раздел связан с «Картой методологии» в обе стороны (X2 P-123): чипы блоков [n] и тихая ссылка
 * «На карте: N узлов →» на узлы, которые ссылаются сюда своим «Подробнее».
 */
import type { ReactNode } from 'react'
import { STAGE_META, featureChipLabel, FEATURES, isFeatureId, type FeatureId, type Stage } from '../../explain/stages'
import { countText } from '../../explain/format'
import { Chip } from '../../ui/kit'
import { BlockChips } from '../../ui/BlockChip'
import { getDiagram, type DiagramId } from '../../diagrams'
import { nodesForSection } from '../method-map/registry'
import type { BlockId } from '../method-map/types'
import { figureNumber, sectionGroup, sectionNumber, sectionTitle, type SectionId } from './toc'

export type { Stage }

/**
 * Чип стадии — тот же `Chip` кита и то же слово, что у узлов карты (STAGE_META): реализовано —
 * ● нейтрально-хорошо, волны — ○ пунктиром, приглушённо (никогда не ▲). `feature` — стадия, версия и
 * доказательство из реестра возможностей; `stage` — для пунктов без записи в реестре.
 */
export function StageChip({ stage, feature, children }: { stage?: Stage; feature?: FeatureId; children?: ReactNode }) {
  const s: Stage = feature ? FEATURES[feature].stage : stage ?? 'done'
  const meta = STAGE_META[s]
  const label = feature ? featureChipLabel(feature) : meta.label
  return (
    <span data-feature={feature} data-stage={s} title={feature ? FEATURES[feature].evidence : undefined}>
      <Chip tone={meta.tone} className={`mth-chip mth-chip--${s === 'done' ? 'done' : 'planned'}`}>
        <span className="mth-chip__stage">{label}</span>
        {children && <span className="mth-chip__what">{children}</span>}
      </Chip>
    </span>
  )
}

/** Пункт стадий раздела: [стадия, что] или [возможность реестра, что?]. */
export type StageItem = readonly [Stage | FeatureId, ReactNode?]

interface SectionProps {
  id: SectionId
  stages?: readonly StageItem[]
  /** Блоки карты [1]…[8], о которых раздел. */
  blocks?: readonly BlockId[]
  lead?: ReactNode
  children: ReactNode
}

const NODE_FORMS = ['узел', 'узла', 'узлов'] as const
const STAGE_ORDER: Readonly<Record<Stage, number>> = { done: 0, w1: 1, w2: 2, w3: 3 }
const stageOf = (s: Stage | FeatureId): Stage => (isFeatureId(s) ? FEATURES[s].stage : s)
/** Пункты стадий по порядку «реализовано → волна 1 → 2 → 3» (порядок внутри стадии — как в разделе). */
const sortStages = (items: readonly StageItem[]): StageItem[] =>
  items.map((it, i) => ({ it, i })).sort((a, b) => STAGE_ORDER[stageOf(a.it[0])] - STAGE_ORDER[stageOf(b.it[0])] || a.i - b.i).map((x) => x.it)

/** «На карте: 3 узла →» — к первому узлу, остальные перечислены в подсказке. */
function MapLink({ id }: { id: SectionId }) {
  const nodes = nodesForSection(id)
  if (nodes.length === 0) return null
  return (
    <a className="mth-sec__map" href={`#/map/${encodeURIComponent(nodes[0].id)}`} title={nodes.map((n) => n.title).join(' · ')}>
      На карте: {countText(nodes.length, NODE_FORMS)} →
    </a>
  )
}

export function Section({ id, stages, blocks, lead, children }: SectionProps) {
  return (
    <section id={id} className="mth-sec" aria-labelledby={`${id}-h`}>
      <header className="mth-sec__head">
        <div className="mth-sec__meta">
          <span className="mth-sec__num">{sectionNumber(id)}</span>
          <span className="mth-sec__eyebrow text-caps">{sectionGroup(id)}</span>
          {blocks && blocks.length > 0 && <BlockChips blocks={blocks} />}
          <MapLink id={id} />
        </div>
        <h2 id={`${id}-h`} className="mth-sec__title">{sectionTitle(id)}</h2>
        {stages && stages.length > 0 && (
          <div className="mth-sec__stages">
            {sortStages(stages).map(([s, what], i) => (isFeatureId(s)
              ? <StageChip key={i} feature={s}>{what ?? FEATURES[s].title}</StageChip>
              : <StageChip key={i} stage={s}>{what}</StageChip>))}
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
