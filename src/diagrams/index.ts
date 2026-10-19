/**
 * Реестр абстрактных поясняющих схем (язык «Конструктивный Кандинский»).
 * Каждая схема — React-SVG компонент на токенах темы; id стабильны и
 * используются слоем объяснений «i» (src/explain) и экраном «Методика».
 *
 * Схемы грузятся лениво (отдельные чанки): реестр сам по себе крошечный, а
 * Component уже обёрнут в собственный Suspense — потребителю ничего оборачивать
 * не нужно; на время загрузки виден плейсхолдер той же пропорции 2:1.
 *
 * Контракт: docs/AUDIT-2026-10.md §4.4.
 */
import { Suspense, createElement, lazy, type ComponentType } from 'react'
import type { DiagramId, DiagramMeta, DiagramProps } from './types'
import './diagrams.css'

export type { DiagramId, DiagramMeta, DiagramProps } from './types'

type Loader = () => Promise<ComponentType<DiagramProps>>

function lazyDiagram(load: Loader): ComponentType<DiagramProps> {
  const Lazy = lazy(() => load().then((Component) => ({ default: Component })))
  function Diagram(props: DiagramProps) {
    return createElement(
      Suspense,
      { fallback: createElement('div', { className: 'dg-placeholder', 'aria-hidden': true }) },
      createElement(Lazy, props),
    )
  }
  return Diagram
}

const ENTRIES: ReadonlyArray<readonly [DiagramId, string, Loader]> = [
  ['two-stages', 'Иерархическая двухуровневая модель', () => import('./TwoStages').then((m) => m.TwoStages)],
  ['cvar-tail', 'CVaR — среднее худших α', () => import('./CvarTail').then((m) => m.CvarTail)],
  ['price-of-robustness', 'Цена робастности', () => import('./PriceOfRobustness').then((m) => m.PriceOfRobustness)],
  ['pareto', 'Граница Парето «доходность — риск»', () => import('./Pareto').then((m) => m.Pareto)],
  ['correlation-diversification', 'Корреляция и диверсификация', () => import('./CorrelationDiversification').then((m) => m.CorrelationDiversification)],
  ['heavy-tail', 'Тяжёлый хвост длительности', () => import('./HeavyTail').then((m) => m.HeavyTail)],
  ['lot-streaming', 'Транспортные партии', () => import('./LotStreaming').then((m) => m.LotStreaming)],
  ['dispatch-rules', 'Диспетчерские правила', () => import('./DispatchRules').then((m) => m.DispatchRules)],
  ['toc', 'Теория ограничений: барабан — буфер — канат', () => import('./Toc').then((m) => m.Toc)],
  ['little-law', 'Закон Литтла', () => import('./LittleLaw').then((m) => m.LittleLaw)],
  ['idef0', 'IDEF0: стрелки ICOM', () => import('./Idef0').then((m) => m.Idef0)],
  ['forecast-decomposition', 'Декомпозиция прогноза', () => import('./ForecastDecomposition').then((m) => m.ForecastDecomposition)],
  ['mrp', 'MRP: от валовой потребности к запуску', () => import('./Mrp').then((m) => m.Mrp)],
  ['npv', 'ЧДД, ВНД и срок окупаемости', () => import('./Npv').then((m) => m.Npv)],
  ['agent-layers', 'Агентный слой RL', () => import('./AgentLayers').then((m) => m.AgentLayers)],
]

/** Все 15 схем; тип оставлен Partial ради совместимости контракта. */
export const DIAGRAMS: Partial<Record<DiagramId, DiagramMeta>> = Object.fromEntries(
  ENTRIES.map(([id, title, load]) => [id, { id, title, Component: lazyDiagram(load) }]),
)

/** Порядок схем (как в «Методике»: по потоку данных). */
export const DIAGRAM_IDS: readonly DiagramId[] = ENTRIES.map(([id]) => id)

export function getDiagram(id: DiagramId | undefined): DiagramMeta | undefined {
  return id ? DIAGRAMS[id] : undefined
}
