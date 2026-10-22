/**
 * Чип «[n] Название ↗» в шапке экрана (UX-V2 §2.6): обратная ссылка «экран → блок карты».
 * Цвет блока — только обводка и номер (токены --block-n).
 */
import type { CSSProperties } from 'react'
import { BLOCK_META } from '../features/method-map/blocks'
import type { BlockId } from '../features/method-map/types'
import './pipeline.css'

export function BlockChip({ block }: { block: BlockId }) {
  const meta = BLOCK_META[block]
  return (
    <a
      className="block-chip"
      href={`#/map/${block}`}
      style={{ '--block': meta.colorVar } as CSSProperties}
      title={`Блок [${meta.n}] на карте методологии: ${meta.summary}`}
    >
      <span className="block-chip__n mono">[{meta.n}]</span>
      <span className="block-chip__title">{meta.title}</span>
      <span className="block-chip__arrow" aria-hidden="true">↗</span>
    </a>
  )
}

/** Ряд чипов для экрана, реализующего несколько блоков. */
export function BlockChips({ blocks }: { blocks: readonly BlockId[] }) {
  if (blocks.length === 0) return null
  return (
    <span className="block-chips" aria-label="Блоки карты методологии">
      {blocks.map((b) => <BlockChip key={b} block={b} />)}
    </span>
  )
}
