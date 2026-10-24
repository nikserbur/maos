/**
 * Одна выборка на все виды результата плана (X2 «связанные виды»): тип РЦ, станок, заказ. Живёт в
 * адресе (`?wc=…&m=…&o=…`) — F5 и скопированная ссылка восстанавливают подсветку. Баннер узкого места,
 * Гант, загрузка и фильтр очередей читают и пишут одно и то же. Прокрутка к связанному виду —
 * `revealPlanSection` (секции результата имеют стабильные id).
 */
import { useCallback, useMemo } from 'react'
import { useHashParams } from '../../shell/router'

export interface PlanSelection {
  wc: string | null
  machine: string | null
  order: number | null
}

export interface PlanSelectionApi extends PlanSelection {
  select: (patch: Partial<PlanSelection>) => void
  clear: () => void
}

const toOrder = (v: string | undefined): number | null => {
  if (v === undefined || v === '') return null
  const n = Number(v)
  return Number.isInteger(n) && n >= 0 ? n : null
}

/** Разбор выборки из параметров адреса (чистая функция). */
export function selectionFromParams(p: Readonly<Record<string, string>>): PlanSelection {
  return { wc: p.wc || null, machine: p.m || null, order: toOrder(p.o) }
}

export function usePlanSelection(): PlanSelectionApi {
  const [params, setParams] = useHashParams()
  const sel = useMemo(() => selectionFromParams(params), [params])
  const select = useCallback((patch: Partial<PlanSelection>) => {
    const next: Record<string, string | null> = {}
    if ('wc' in patch) next.wc = patch.wc ?? null
    if ('machine' in patch) next.m = patch.machine ?? null
    if ('order' in patch) next.o = patch.order === null || patch.order === undefined ? null : String(patch.order)
    setParams(next)
  }, [setParams])
  const clear = useCallback(() => setParams({ wc: null, m: null, o: null }), [setParams])
  return { ...sel, select, clear }
}

/** Прокрутить к секции результата и подсветить её на мгновение (фокус — без прыжка). */
export function revealPlanSection(id: string): void {
  const el = typeof document !== 'undefined' ? document.getElementById(id) : null
  if (!el) return
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
}
