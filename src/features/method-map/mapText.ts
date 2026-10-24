/**
 * Общие подписи живого состояния карты (X2 P-129): склонения единиц (plural из format.ts), ISO-время,
 * «CVaR₁₀ % …» с уровнем хвоста из паспорта α. Один источник для deriveNodes ([1]…[5]) и deriveLoops ([6]…[8]).
 */
import { NBSP, money, num } from '../../explain/format'
import type { NodeLive } from './types'

export type Live = Record<string, NodeLive>

export const iso = (ms: number | null | undefined): string | undefined => (ms ? new Date(ms).toISOString() : undefined)

/** Склонения единиц карты — одна таблица, plural() из format.ts. */
export const W = {
  product: ['изделие', 'изделия', 'изделий'], operation: ['операция', 'операции', 'операций'],
  machine: ['станок', 'станка', 'станков'], wcType: ['тип РЦ', 'типа РЦ', 'типов РЦ'], worker: ['рабочий', 'рабочих', 'рабочих'],
  routing: ['техкарта', 'техкарты', 'техкарт'], order: ['заказ', 'заказа', 'заказов'], regime: ['режим', 'режима', 'режимов'],
  position: ['покупная позиция', 'покупные позиции', 'покупных позиций'], move: ['ход', 'хода', 'ходов'],
  scenario: ['сценарий', 'сценария', 'сценариев'], kind: ['вид', 'вида', 'видов'], formula: ['формула', 'формулы', 'формул'],
} as const

const SUB_DIGITS = '₀₁₂₃₄₅₆₇₈₉'
/** «10» → «₁₀»: индекс уровня хвоста как в формулах (CVaR₁₀ %). */
const sub = (s: string): string => s.replace(/\d/g, (d) => SUB_DIGITS[Number(d)])

/** «CVaR₁₀ % −53,7 млн ₽» — уровень хвоста из паспорта α. */
export function cvarText(alpha: number, cvar: number): string {
  return `CVaR${sub(num(alpha * 100, 0))}${NBSP}% ${money(cvar)}`
}
