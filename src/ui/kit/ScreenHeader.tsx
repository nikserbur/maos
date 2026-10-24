/**
 * Шапка экрана единого кита (X2 «контракт шапки»): eyebrow (капители, греческие буквы не портятся) и
 * дисплейный заголовок в одной строке · чип происхождения/контекста · подзаголовок в одну строку
 * (полный текст — в title, объяснения — в «i» или «Методике») · действия справа · бренд-линия.
 * Высота ≤ 64 px; вариант `compact` (≤ 56 px) — для деталей и результатов. Чипы блоков карты не
 * рисуются там, где под верхней панелью уже есть полоса методологии (контекст оболочки).
 */
import { createContext, useContext, type CSSProperties, type ReactNode } from 'react'
import { BlockChips } from '../BlockChip'
import type { BlockId } from '../../features/method-map/types'
import { capsNode } from './CapsLabel'
import './kit.css'

/** Оболочка сообщает шапке, видна ли полоса методологии (тогда чипы блоков — дубль). */
export const ScreenChromeContext = createContext<{ pipeline: boolean }>({ pipeline: false })

/** Ступенчатое появление секции: style={rise(2)} (задержка 2 × 40 мс). */
export function rise(i: number): CSSProperties {
  return { '--i': i } as CSSProperties
}

interface ScreenHeaderProps {
  eyebrow?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  /** Блоки карты методологии, которые реализует экран — чипы «[n] Название ↗» (UX-V2 §2.6); скрыты при полосе методологии. */
  blocks?: readonly BlockId[]
  /** Чип происхождения/контекста рядом с заголовком: «Базовый · план №28 · 17:38». */
  provenance?: ReactNode
  /** Компактная шапка деталей и результатов (≤ 56 px): без подзаголовка под заголовком. */
  compact?: boolean
  className?: string
}

export function ScreenHeader({ eyebrow, title, subtitle, actions, blocks, provenance, compact = false, className }: ScreenHeaderProps) {
  const { pipeline } = useContext(ScreenChromeContext)
  const showBlocks = !pipeline && blocks && blocks.length > 0
  const subTitle = typeof subtitle === 'string' ? subtitle : undefined
  const cls = ['dk-head', compact ? 'dk-head--compact' : '', 'dk-rise', className ?? ''].filter(Boolean).join(' ')
  return (
    <header className={cls}>
      <div className="dk-head__text">
        <div className="dk-head__line">
          {eyebrow && <p className="dk-head__eyebrow text-caps">{capsNode(eyebrow)}</p>}
          <h1 className="dk-head__title" title={typeof title === 'string' ? title : undefined}>{title}</h1>
          {provenance && <span className="dk-head__prov">{provenance}</span>}
          {showBlocks && <span className="dk-head__blocks"><BlockChips blocks={blocks} /></span>}
        </div>
        {subtitle && !compact && <p className="dk-head__sub" title={subTitle}>{subtitle}</p>}
      </div>
      {actions && <div className="dk-head__actions">{actions}</div>}
      <span className="dk-head__rule" aria-hidden="true" />
    </header>
  )
}

interface SectionProps {
  id: string
  title: ReactNode
  meta?: ReactNode
  tools?: ReactNode
  children: ReactNode
}

/** Секция экрана с заголовком h2, метой и инструментами справа (оглавление ссылается на id). */
export function Section({ id, title, meta, tools, children }: SectionProps) {
  return (
    <section id={id} className="dk-sec dk-rise" aria-labelledby={`${id}-t`}>
      <div className="dk-sec__hd">
        <div>
          <h2 className="dk-sec__title" id={`${id}-t`}>{title}</h2>
          {meta && <div className="dk-sec__meta">{capsNode(meta)}</div>}
        </div>
        {tools && <div className="dk-sec__tools">{tools}</div>}
      </div>
      {children}
    </section>
  )
}
