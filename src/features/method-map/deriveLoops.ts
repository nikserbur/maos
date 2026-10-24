/**
 * Состояния подблоков петель [6] Агенты, [7] Прогноз и мониторинг, [8] LLM (UX-V2 §4.9, X2 P-121/P-122/P-127):
 * гейт RL — словами без технических деталей сервера; прогноз — покрытие и доля изделий, где он хуже
 * наивного; MENTAT — живое состояние подключения локальной модели. Чистые функции.
 */
import { NBSP, countText, num, pct, signed } from '../../explain/format'
import { METRIC_LIST } from '../../explain/metrics'
import type { ForecastResult } from '../../lib/api'
import type { DeriveInput } from './deriveInput'
import { W, iso, type Live } from './mapText'
import type { NodeLive } from './types'

/** Номинал покрытия интервала бэктеста (P10–P90). */
const NOMINAL_COVERAGE = 0.8

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** [7] прогноз: «покрытие 67 % · хуже наивного у 5 из 76» по опубликованному прогнозу «Мониторинга». */
export function forecastLive(f: ForecastResult | null | undefined, at?: number | null): NodeLive {
  if (!f) return { state: 'default', badge: 'прогноз не запрошен', detail: 'откройте «Мониторинг» — прогноз появится здесь' }
  const bt = f.products.map((p) => p.backtest).filter((b): b is NonNullable<typeof b> => Boolean(b))
  if (bt.length === 0) {
    return { state: 'default', badge: 'проверка прогноза не запрошена', detail: `прогноз на ${num(f.months, 0)}${NBSP}мес · ${countText(f.products.length, W.product)}` }
  }
  const coverage = bt.reduce((s, b) => s + b.coverage80, 0) / bt.length
  const worse = bt.filter((b) => b.skill < 0).length
  const mostlyWorse = worse * 2 > bt.length
  return {
    updatedAt: iso(at),
    state: mostlyWorse ? 'stale' : 'estimated',
    badge: `покрытие ${pct(coverage, 0)} · хуже наивного у ${num(worse, 0)} из ${num(bt.length, 0)}`,
    detail: `номинал покрытия ${pct(NOMINAL_COVERAGE, 0)} · медиана MAPE ${pct(median(bt.map((b) => b.mape)), 1)} против ${pct(median(bt.map((b) => b.mape_naive)), 1)} у наивного`,
    reason: mostlyWorse ? 'прогноз хуже наивного у большинства изделий — упростите модель или переоцените' : undefined,
  }
}

/** [8] MENTAT: подключена ли локальная модель (GET /api/mentat/status). */
function mentatLive(input: DeriveInput): NodeLive {
  const m = input.mentat
  if (m === undefined) return { state: 'default', badge: 'статус модели не получен', detail: 'промпты и проверка верности готовы' }
  if (!m || !m.configured) {
    return { state: 'unconfigured', badge: 'модель не подключена', detail: 'промпт можно посмотреть: Cmd/Ctrl+J → «Промпт»',
      reason: 'подключите локальную модель: Cmd/Ctrl+J → «Подключение»' }
  }
  return { state: 'estimated', badge: `модель ${m.model} · локально`, detail: 'каждое число ответа сверяется с узлом графа' }
}

/**
 * Блок [6] (UX-V2 §4.9): `default` — политика не опубликована (гейт V5 не пройден, чемпион —
 * правило) или статус ещё не получен; `estimated` — опубликована или в последнем плане есть ходы.
 * Полномочия — `manual`, если отличаются от умолчаний.
 */
function agents(input: DeriveInput): Live {
  const { rl, guardrails } = input
  const mv = input.plan.result?.moves
  const live = Boolean(rl && rl.available && rl.onnxruntime && rl.l0.ok)
  let agent: NodeLive
  if (mv && mv.moves.length > 0) {
    const gain = mv.totals.profit.cvar_after - mv.totals.profit.cvar_before
    agent = { state: 'estimated', badge: `${countText(mv.moves.length, W.move)} · ΔCVaR ${signed(gain, '₽')}`,
      detail: `ДИ ${mv.totals.ci95[0] > 0 ? 'выше нуля' : 'задевает ноль'} · ${countText(mv.n_scenarios ?? 0, W.scenario)}`, updatedAt: iso(input.plan.builtAt) }
  } else if (live && rl) {
    agent = { state: 'estimated', badge: 'политика опубликована', detail: rl.l2.ok ? 'структурные ходы — в «Плане»' : 'только порядок операций' }
  } else if (rl) {
    agent = { state: 'default', badge: 'гейт не пройден · чемпион — правило',
      detail: 'политика не опубликована: не прошла гейт V5 → Агенты',
      reason: 'ни одна политика не выиграла у лучшего правила с ДИ на отложенных сценариях (V5)' }
  } else {
    agent = { state: 'default', badge: 'статус политики не получен', detail: 'сервер не ответил о политике RL' }
  }
  const allowed = guardrails ? Object.values(guardrails.allowed).filter(Boolean).length : 0
  const guard: NodeLive = guardrails
    ? { state: guardrails.frozen.length || guardrails.rejected_masks.length ? 'manual' : 'default',
      badge: `${countText(allowed, W.kind)} ходов разрешено · не больше ${countText(guardrails.limits.max_moves, W.move)}`,
      detail: `заморожено ${num(guardrails.frozen.length, 0)} · масок отклонения ${num(guardrails.rejected_masks.length, 0)}` }
    : { state: 'default', badge: 'полномочия по умолчанию' }
  return { 'ag.rl': agent, 'ag.guardrails': guard }
}

function monitoring(input: DeriveInput): Live {
  const h = input.macro?.holdout
  return {
    'mon.forecast': forecastLive(input.forecast, input.forecastAt),
    'mon.quality': h
      ? { state: 'estimated', badge: `CRPS генератора: инфляция ${num(h.variables.cpi_yoy_pp.mean_CRPS, 2)} · ставка ${num(h.variables.key_pp.mean_CRPS, 2)} · курс ${num(h.variables.usd_rub.mean_CRPS, 2)}`,
        detail: `покрытие 80 %-интервала: инфляция ${pct(h.variables.cpi_yoy_pp.coverage80, 0)} · ставка ${pct(h.variables.key_pp.coverage80, 0)} · курс ${pct(h.variables.usd_rub.coverage80, 0)}` }
      : { state: 'default', badge: 'CRPS генератора не загружен', detail: 'MASE по изделиям — после план-факта' },
    'mon.planfact': input.kpi?.plan_id
      ? { state: 'estimated', badge: 'KPI последнего плана', updatedAt: input.kpi.created_at }
      : { state: 'default', badge: 'нет KPI плана' },
    'mon.early': { state: 'planned', badge: 'в плане · волна 2' },
  }
}

/** Состояния подблоков петель [6]…[8]. */
export function loopSubblocks(input: DeriveInput): Live {
  return {
    ...agents(input),
    'ag.games': { state: 'planned', badge: 'в плане · волна 3' },
    ...monitoring(input),
    'llm.explain': { state: 'default', badge: `${countText(METRIC_LIST.length, W.formula)} с подстановкой` },
    'llm.mentat': mentatLive(input),
  }
}
