/**
 * Типы реестра схем. Вынесены отдельно от index.ts, чтобы модули схем
 * не импортировали реестр (нет циклических зависимостей).
 */
import type { ComponentType } from 'react'

export type DiagramId =
  | 'two-stages'
  | 'cvar-tail'
  | 'price-of-robustness'
  | 'pareto'
  | 'correlation-diversification'
  | 'heavy-tail'
  | 'lot-streaming'
  | 'dispatch-rules'
  | 'toc'
  | 'little-law'
  | 'idef0'
  | 'forecast-decomposition'
  | 'mrp'
  | 'npv'
  | 'agent-layers'

export interface DiagramProps {
  /** Компактный вариант для поповера «i» (~280×140), иначе полный (~640×320). */
  compact?: boolean
}

export interface DiagramMeta {
  id: DiagramId
  title: string
  Component: ComponentType<DiagramProps>
}
