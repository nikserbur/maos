/**
 * Локальные расширения ответа /api/optimize, которых пока нет в src/lib/api.ts
 * (файл интегратора): проверка вне выборки (Optimizer.cpp, поле `oos`) и
 * необязательный блок точного решения LP (B2, поле `exact`). Все поля
 * необязательные — экран рисует их, только если бэкенд их прислал.
 */
import type { OptimizeParams, OptResult } from '../../lib/api'
import { objectiveLabel } from '../../explain/labels'
import { pct } from '../../explain/format'

/** Out-of-sample (SAA): робастный портфель на независимой выборке (seed + 9973). */
export interface OptOos {
  expected: number
  cvar: number
  worst_case: number
  std: number
  p_loss: number
  /** (E_вн − E_нов) / |E_вн| — доля. */
  gap_expected: number
  /** (CVaR_вн − CVaR_нов) / |CVaR_вн| — доля. */
  gap_cvar: number
}

export interface OptExactDual {
  wc_type: string
  /** ₽ за час мощности (двойственная цена ограничения фонда). */
  shadow_price: number
  /** Загрузка фонда, доля. */
  utilization: number
  load_hours?: number
  capacity_hours?: number
  binding?: boolean
}

/** Метрики решения: целевая функция критерия + E / CVaR / худший. */
export interface OptExactMetrics {
  objective?: number
  expected?: number
  cvar?: number
  worst?: number
}

/**
 * Блок `exact` (backend/src/Optimizer.cpp exact_compare): Rockafellar–Uryasev LP в HiGHS
 * на тех же сценариях. Разрывы `*_pct` приходят В ПРОЦЕНТАХ (100·(LP − эвр.)/|эвр.|) или null.
 */
export interface OptExact extends OptExactMetrics {
  /** optimal | not_applicable | error | статус HiGHS. */
  status?: string
  reason?: string
  solver?: string
  solver_version?: string
  criterion?: string
  /** robust | expected | best_candidate — с каким портфелем эвристики сравнивается LP. */
  heuristic_reference?: string
  n_scenarios?: number
  solve_ms?: number
  n_vars?: number
  n_rows?: number
  max_share_enforced?: boolean
  tail_k?: number
  upper_bound?: number
  portfolio?: Array<{ product_id: string; qty: number; qty_rounded?: number }>
  rounded?: OptExactMetrics & { max_share_ok?: boolean }
  heuristic?: OptExactMetrics & { n_candidates?: number; oos_objective?: number }
  gap_vs_heuristic?: {
    objective_abs?: number | null
    objective_pct?: number | null
    cvar_pct?: number | null
    expected_pct?: number | null
    worst_pct?: number | null
    oos_objective_pct?: number | null
  }
  duals?: OptExactDual[]
  pwl_segments?: number
  pwl_max_error?: number
  pwl_max_rel_error?: number
  oos?: OptExactMetrics
}

export type OptResultExt = OptResult & {
  oos?: OptOos | null
  exact?: OptExact | null
  calendar_factor?: number
  stage1_calibrated?: number
}

/**
 * Флаги точного решения: B2 добавляет `compare_exact` (или `solver: "exact"`) —
 * шлём оба, неизвестные ключи бэкенд игнорирует.
 */
export type OptRunParams = OptimizeParams & {
  compare_exact?: boolean
  solver?: 'exact'
}

export type Objective = 'cvar' | 'worstcase' | 'meanvariance' | 'minregret'

/** Имя критерия — только из общего словаря (X2 «одно имя — одна вещь»); здесь — реэкспорт. */
export { objectiveLabel }

const sentence = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

const HINTS: Readonly<Record<Objective, string>> = {
  cvar: 'Максимизировать среднюю прибыль в худших α·100 % сценариев (Rockafellar–Uryasev).',
  worstcase: 'Максимизировать гарантированный минимум прибыли (критерий Вальда).',
  meanvariance: 'Баланс ожидаемой прибыли и разброса (Марковиц).',
  minregret: 'Минимизировать наибольшее отставание от лучшего для сценария портфеля (Сэвидж).',
}

/** Критерии портфеля: подпись контрола — словарная (с прописной), короткая — словарная как есть. */
export const OBJECTIVES: ReadonlyArray<{ id: Objective; label: string; short: string; hint: string }> =
  (['cvar', 'worstcase', 'meanvariance', 'minregret'] as const).map((id) => ({
    id, label: sentence(objectiveLabel(id)), short: objectiveLabel(id), hint: HINTS[id],
  }))

/** Точная LP-постановка (Рокафеллар — Урясев) есть только для CVaR и худшего случая. */
export function lpApplies(objective: string): boolean {
  return objective === 'cvar' || objective === 'worstcase'
}

/**
 * Одна карта подписей показателей портфеля (X2): герой, «Для сравнения», проверка вне выборки и
 * подсказка Парето берут имена только отсюда. α входит в подпись CVaR/VaR — «CVaR (худшие 10 %)».
 */
export function kpiLabels(alpha: number) {
  const tail = pct(alpha, 0)
  return {
    expected: 'Ожидаемая прибыль E',
    cvar: `CVaR (худшие ${tail})`,
    var: `VaR (порог худших ${tail})`,
    worst: 'Худший сценарий',
    p_loss: 'P(убыток)',
    std: 'σ прибыли',
    regret: 'Макс. сожаление',
    share: 'Макс. доля изделия',
  } as const
}

/** Ответ бэкенда без валидного результата (нет товарных изделий и т. п.). */
export function isSoft(r: OptResultExt | null): boolean {
  return r != null && (Boolean(r.error_soft) || r.robust == null || r.expected == null)
}
