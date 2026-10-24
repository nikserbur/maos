/**
 * Цель поиска порядка одной фразой (X2 «ответ словами»): веса пресета → «Минимизируем срок; хвост
 * риска штрафуем вдвое слабее». Формула F — в «i» (plan.objective_weights). Чистая функция.
 */
import { num } from '../../../explain/format'
import type { WizardFields } from './wizardStore'

const EPS = 1e-9

function relation(r: number): string {
  if (Math.abs(r - 1) < EPS) return 'наравне со сроком'
  if (Math.abs(r - 0.5) < EPS) return 'вдвое слабее'
  if (Math.abs(r - 2) < EPS) return 'вдвое сильнее'
  return r < 1 ? `слабее (×${num(r, 2)} к сроку)` : `сильнее (×${num(r, 2)} к сроку)`
}

export function objectiveSentence(f: Pick<WizardFields, 'wTime' | 'wRisk' | 'wCost'>): string {
  const parts: string[] = []
  if (f.wTime > EPS) {
    parts.push('Минимизируем срок')
    parts.push(f.wRisk > EPS ? `хвост риска штрафуем ${relation(f.wRisk / f.wTime)}` : 'хвост риска не штрафуем')
  } else if (f.wRisk > EPS) {
    parts.push('Минимизируем хвост риска срока')
  }
  if (f.wCost > EPS) parts.push(parts.length ? `переналадки — с весом ${num(f.wCost, 2)}` : 'Минимизируем переналадки')
  return parts.length ? parts.join('; ') : 'Все веса нулевые — порядок операций не оптимизируется'
}
