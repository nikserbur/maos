/**
 * Последний результат «Инвестпроектов» (POST /api/analytics/investment) — переживает смену экрана, чтобы
 * MENTAT мог объяснить уже посчитанный проект (шаблон «Окупится ли инвестпроект»). Только публикация
 * готового ответа: здесь ничего не считается и не запрашивается.
 */
import { useSyncExternalStore } from 'react'
import type { InvestmentResult } from '../../lib/api'

let state: InvestmentResult | null = null
const listeners = new Set<() => void>()

export function publishInvest(result: InvestmentResult | null): void {
  if (result === state) return
  state = result
  listeners.forEach((l) => l())
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}
const snapshot = (): InvestmentResult | null => state

export function useInvestResult(): InvestmentResult | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
