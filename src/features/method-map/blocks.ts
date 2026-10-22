/**
 * Восемь канонических блоков (PLAN-V2 §3 — имена и порядок обязательны) и их
 * фиксированная раскладка L0 (UX-V2 §3.5): ряд [1]…[5] слева направо по
 * «гармонической» диагонали (A6 §1: прогресс — снизу-слева вверх-вправо),
 * под ним [6] [7] [8]. Координаты — в единицах сетки 8 px.
 */
import type { BlockId, NodeShape } from './types'

export interface BlockMeta {
  id: BlockId
  /** Номер блока 1…8. */
  n: number
  title: string
  /** Подпись для полосы и чипов (≤ 12 символов). */
  short: string
  /** Чем блок занимается — одна строка для панели и подсказок. */
  summary: string
  /** Глиф грамматики A6 §6. */
  shape: NodeShape
  /** CSS-токен цвета блока `--block-n` (только бейджи/обводки, не заливка). */
  colorVar: string
  pos: { x: number; y: number; w: number; h: number }
}

const W = 27
const H = 15
const GAP_X = 41
const ROW_2_Y = 32

export const BLOCKS: readonly BlockMeta[] = [
  { id: 'external', n: 1, title: 'Внешние условия', short: 'условия', shape: 'point',
    summary: 'Макро: ставка, курс, инфляция, цены, спрос, логистика, тарифы — сценарий.',
    colorVar: 'var(--block-1)', pos: { x: 0, y: 8, w: W, h: H } },
  { id: 'distributions', n: 2, title: 'Распределения', short: 'распред.', shape: 'disc',
    summary: 'Обученные распределения цен и длительностей: хвосты, копула, PERT → lognormal + Pareto.',
    colorVar: 'var(--block-2)', pos: { x: GAP_X, y: 6, w: W, h: H } },
  { id: 'internal', n: 3, title: 'Внутренние условия', short: 'внутр.', shape: 'square',
    summary: 'Мощности, календари, ТО/поломки, персонал, запасы, оборотный капитал, кредитная линия.',
    colorVar: 'var(--block-3)', pos: { x: GAP_X * 2, y: 4, w: W, h: H } },
  { id: 'decisions', n: 4, title: 'Решения', short: 'решения', shape: 'triangle',
    summary: 'Портфель (Стадия 2), расписание (Стадия 1), запасы, транши, инвестиции, цены передачи.',
    colorVar: 'var(--block-4)', pos: { x: GAP_X * 3, y: 2, w: W, h: H } },
  { id: 'criteria', n: 5, title: 'Критерии', short: 'критерии', shape: 'triangle',
    summary: 'CVaR прибыли и кассы, DSCR, OTD, цена робастности и ликвидности, ДИ.',
    colorVar: 'var(--block-5)', pos: { x: GAP_X * 4, y: 0, w: W, h: H } },
  { id: 'agents', n: 6, title: 'Агенты', short: 'агенты', shape: 'disc',
    summary: 'RL L0/L2 со структурными ходами; игры: цена анархии, Штакельберг.',
    colorVar: 'var(--block-6)', pos: { x: GAP_X, y: ROW_2_Y, w: W, h: H } },
  { id: 'monitoring', n: 7, title: 'Прогноз и мониторинг', short: 'монит.', shape: 'disc',
    summary: 'CRPS/MASE, бэктест, план-факт, раннее предупреждение.',
    colorVar: 'var(--block-7)', pos: { x: GAP_X * 2, y: ROW_2_Y, w: W, h: H } },
  { id: 'llm', n: 8, title: 'LLM (MENTAT)', short: 'LLM', shape: 'point',
    summary: 'Объяснение решений по графу расчёта: «почему так».',
    colorVar: 'var(--block-8)', pos: { x: GAP_X * 3, y: ROW_2_Y, w: W, h: H } },
]

export const BLOCK_META: Readonly<Record<BlockId, BlockMeta>> = Object.freeze(
  Object.fromEntries(BLOCKS.map((b) => [b.id, b])) as Record<BlockId, BlockMeta>,
)

export function blockOf(id: BlockId): BlockMeta {
  return BLOCK_META[id]
}

/** «[4]» — номер блока в квадратных скобках, как в документах. */
export function blockTag(id: BlockId): string {
  return `[${BLOCK_META[id].n}]`
}

export function isBlockId(s: string): s is BlockId {
  return Object.prototype.hasOwnProperty.call(BLOCK_META, s)
}
