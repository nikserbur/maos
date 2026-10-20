/**
 * Оглавление «Методики»: порядок разделов = поток данных модели
 * (внешние условия → Стадия 2 → Стадия 1 → поток и инвестиции → справочник → агенты).
 * Якоря = id схем (src/diagrams) + служебные разделы (AUDIT §4.4).
 */
import type { DiagramId } from '../../diagrams'

export type SectionId =
  | 'overview'
  | DiagramId
  | 'kpi-definitions'
  | 'terminology'
  | 'validation'
  | 'competitors'
  | 'rl'

export interface TocGroup {
  title: string
  items: ReadonlyArray<{ id: SectionId; title: string }>
}

export const TOC: readonly TocGroup[] = [
  {
    title: 'Введение',
    items: [
      { id: 'overview', title: 'Что и как моделирует MAOS' },
      { id: 'two-stages', title: 'Иерархическая двухуровневая модель' },
    ],
  },
  {
    title: 'Внешние условия',
    items: [
      { id: 'forecast-decomposition', title: 'Прогноз цен: декомпозиция' },
      { id: 'correlation-diversification', title: 'Корреляция и диверсификация' },
    ],
  },
  {
    title: 'Стадия 2 · портфель',
    items: [
      { id: 'cvar-tail', title: 'CVaR — среднее худших α' },
      { id: 'price-of-robustness', title: 'Цена робастности' },
      { id: 'pareto', title: 'Граница Парето' },
    ],
  },
  {
    title: 'Стадия 1 · расписание',
    items: [
      { id: 'idef0', title: 'Маршрут как IDEF0' },
      { id: 'heavy-tail', title: 'Тяжёлые хвосты длительностей' },
      { id: 'lot-streaming', title: 'Транспортные партии' },
      { id: 'dispatch-rules', title: 'Диспетчерские правила' },
      { id: 'mrp', title: 'MRP: потребность и запуск' },
    ],
  },
  {
    title: 'Поток и инвестиции',
    items: [
      { id: 'toc', title: 'Теория ограничений' },
      { id: 'little-law', title: 'Закон Литтла' },
      { id: 'npv', title: 'ЧДД, ВНД, окупаемость' },
    ],
  },
  {
    title: 'Справочник',
    items: [
      { id: 'kpi-definitions', title: 'Определения KPI' },
      { id: 'terminology', title: 'Терминология' },
    ],
  },
  {
    title: 'Наука и рынок',
    items: [
      { id: 'validation', title: 'Верификация и валидация' },
      { id: 'competitors', title: 'Конкуренты и позиционирование' },
    ],
  },
  {
    title: 'Агентный слой',
    items: [
      { id: 'agent-layers', title: 'Агенты L0 / L1 / L2' },
      { id: 'rl', title: 'RL: постановка и дорожная карта' },
    ],
  },
]

export const SECTION_IDS: readonly SectionId[] = TOC.flatMap((g) => g.items.map((i) => i.id))

/** Номер раздела «01»…«22» — по порядку в оглавлении. */
export function sectionNumber(id: SectionId): string {
  return String(SECTION_IDS.indexOf(id) + 1).padStart(2, '0')
}

export function sectionTitle(id: SectionId): string {
  for (const g of TOC) for (const i of g.items) if (i.id === id) return i.title
  return id
}

export function sectionGroup(id: SectionId): string {
  return TOC.find((g) => g.items.some((i) => i.id === id))?.title ?? ''
}

/** Номер рисунка: порядковый номер схемы среди разделов-схем. */
const TEXT_ONLY: ReadonlySet<SectionId> = new Set<SectionId>(['overview', 'kpi-definitions', 'terminology', 'validation', 'competitors', 'rl'])
const FIGURE_ORDER = SECTION_IDS.filter((s) => !TEXT_ONLY.has(s))

export function figureNumber(id: DiagramId): number {
  return FIGURE_ORDER.indexOf(id) + 1
}

/** `#/methodology/<anchor>` → anchor ('' — без якоря; null — не наш маршрут). */
export function anchorFromHash(hash: string): string | null {
  const m = /^#\/methodology(?:\/([A-Za-z0-9-]+))?\/?$/.exec(hash)
  if (!m) return null
  return m[1] ?? ''
}

export function isSectionId(s: string): s is SectionId {
  return (SECTION_IDS as readonly string[]).includes(s)
}
