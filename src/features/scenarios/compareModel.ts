/**
 * Модель сравнения сценариев (X2 «честное сравнение»): условия — эффективные значения (умолчание
 * подставлено и помечено «○ по умолчанию», никогда «—»), различие — по видимому тексту (α 10 % по
 * умолчанию и заданные 10 % — одно и то же), у каждой не-базовой ячейки — Δ к базовой колонке с
 * направлением «лучше». Подписи результатов — те же, что в «Портфеле» (kpiLabels). Чистые функции.
 */
import type { OptResult, PriceScenario } from '../../lib/api'
import { DASH, NBSP, money, num, pct, pp, signed } from '../../explain/format'
import { objectiveLabel } from '../../explain/labels'
import { kpiLabels } from '../optimization/optTypes'
import { fromMacroMode, regimeLabel } from './regimeMenu'
import { effectiveScenario } from './scenarioDefaults'

export interface CellValue { value: number | string | null | undefined; isDefault?: boolean }

export interface CompareRowDef<T> {
  key: string
  label: string
  get: (item: T) => CellValue
  fmt?: (v: number) => string
  /** Разница со знаком (п. п., ₽, ×); по умолчанию — `fmt` с «+». */
  deltaFmt?: (v: number) => string
  better?: 'high' | 'low'
  /** Показывать и при равенстве (ключевые результаты). */
  always?: boolean
}

export interface CompareCell { text: string; isDefault: boolean; delta: number | null }

export interface CompareLine {
  key: string
  label: string
  cells: CompareCell[]
  differs: boolean
  always: boolean
  better?: 'high' | 'low'
  deltaFmt?: (v: number) => string
}

function text<T>(r: CompareRowDef<T>, v: CellValue['value']): string {
  if (typeof v === 'number') return Number.isFinite(v) ? (r.fmt ? r.fmt(v) : num(v)) : DASH
  return v == null || v === '' ? DASH : String(v)
}

/** Строки сравнения: тексты, пометка умолчания, Δ к первой колонке (база). */
export function buildLines<T>(rows: ReadonlyArray<CompareRowDef<T>>, items: readonly T[]): CompareLine[] {
  return rows.map((r) => {
    const vals = items.map((it) => r.get(it))
    const texts = vals.map((c) => text(r, c.value))
    const base = vals[0]?.value
    const cells = vals.map((c, i): CompareCell => ({
      text: texts[i],
      isDefault: Boolean(c.isDefault),
      delta: i > 0 && typeof c.value === 'number' && typeof base === 'number' && Number.isFinite(c.value) && Number.isFinite(base) && texts[i] !== texts[0]
        ? c.value - base : null,
    }))
    return { key: r.key, label: r.label, cells, differs: texts.some((t) => t !== texts[0]), always: Boolean(r.always), better: r.better, deltaFmt: r.deltaFmt }
  })
}

/** «Только отличающиеся»: отличающиеся + обязательные. */
export function visibleLines(lines: readonly CompareLine[], onlyDiff: boolean): CompareLine[] {
  return onlyDiff ? lines.filter((l) => l.differs || l.always) : [...lines]
}

const plusPct = (digits: number) => (d: number) => pp(d, { signed: true, digits })
const times = (v: number) => `×${num(v, 2)}`

/** Условия сценариев — эффективные значения. `names` — подписи режимов генератора. */
export function conditionRows(names: readonly string[] = []): ReadonlyArray<CompareRowDef<PriceScenario>> {
  const eff = effectiveScenario
  return [
    {
      key: 'mode', label: 'Режим генератора', always: true,
      get: (s) => { const st = fromMacroMode(s.macro_mode); return { value: regimeLabel(st, names, eff(s).months).text, isDefault: st.kind === 'base' } },
    },
    { key: 'objective', label: 'Критерий', get: (s) => ({ value: objectiveLabel(eff(s).objective), isDefault: eff(s).isDefault.objective }) },
    { key: 'alpha', label: 'α хвоста', get: (s) => ({ value: eff(s).alpha, isDefault: eff(s).isDefault.alpha }), fmt: (v) => pct(v, 0), deltaFmt: plusPct(0) },
    { key: 'max_share', label: 'Макс. доля изделия', get: (s) => ({ value: eff(s).max_share, isDefault: eff(s).isDefault.max_share }), fmt: (v) => pct(v, 0), deltaFmt: plusPct(0) },
    { key: 'months', label: 'Горизонт', get: (s) => ({ value: eff(s).months, isDefault: eff(s).isDefault.months }), fmt: (v) => `${num(v, 0)}${NBSP}мес`, deltaFmt: (d) => `${signed(d)}${NBSP}мес` },
    { key: 'inflation', label: 'Инфляция цен, в месяц', get: (s) => ({ value: eff(s).inflation, isDefault: eff(s).isDefault.inflation }), fmt: (v) => pct(v, 2), deltaFmt: plusPct(2) },
    { key: 'volatility', label: 'Волатильность цен, в месяц', get: (s) => ({ value: eff(s).volatility, isDefault: eff(s).isDefault.volatility }), fmt: (v) => pct(v, 1), deltaFmt: plusPct(1) },
    { key: 'market_corr', label: 'Корреляция цен ρ', get: (s) => ({ value: eff(s).market_corr, isDefault: eff(s).isDefault.market_corr }), fmt: (v) => num(v, 2), deltaFmt: (d) => signed(d) },
    { key: 'fx', label: 'Курс', get: (s) => ({ value: eff(s).fx, isDefault: eff(s).isDefault.fx }), fmt: times, deltaFmt: (d) => signed(d) },
    { key: 'demand', label: 'Спрос', get: (s) => ({ value: eff(s).demand, isDefault: eff(s).isDefault.demand }), fmt: times, deltaFmt: (d) => signed(d) },
    { key: 'dists', label: 'Распределений цен задано', get: (s) => ({ value: s.distributions?.length ?? 0 }), fmt: (v) => num(v, 0) },
    { key: 'overrides', label: 'Точечных цен задано', get: (s) => ({ value: s.overrides?.length ?? 0 }), fmt: (v) => num(v, 0) },
  ]
}

/** Результаты робастной оптимизации — подписи «Портфеля». */
export function resultRows(alpha: number, productName: (id: string) => string): ReadonlyArray<CompareRowDef<OptResult>> {
  const L = kpiLabels(alpha)
  const rub = (d: number) => signed(d, '₽')
  return [
    { key: 'e', label: L.expected, get: (r) => ({ value: r.robust.metrics.expected }), fmt: (v) => money(v), deltaFmt: rub, better: 'high', always: true },
    { key: 'cvar', label: L.cvar, get: (r) => ({ value: r.robust.metrics.cvar }), fmt: (v) => money(v), deltaFmt: rub, better: 'high', always: true },
    { key: 'worst', label: L.worst, get: (r) => ({ value: r.robust.metrics.worst_case }), fmt: (v) => money(v), deltaFmt: rub, better: 'high' },
    { key: 'ploss', label: L.p_loss, get: (r) => ({ value: r.robust.metrics.p_loss }), fmt: (v) => pct(v, 1), deltaFmt: plusPct(1), better: 'low', always: true },
    { key: 'por', label: 'Цена робастности', get: (r) => ({ value: r.price_of_robustness }), fmt: (v) => money(v), deltaFmt: rub, better: 'low' },
    { key: 'effn', label: 'Эффективное число изделий', get: (r) => ({ value: r.robust.diversification.effective_n }), fmt: (v) => num(v, 1), deltaFmt: (d) => signed(d), better: 'high' },
    { key: 'hhi', label: 'Концентрация (HHI)', get: (r) => ({ value: r.robust.diversification.concentration }), fmt: (v) => pct(v, 0), deltaFmt: plusPct(0), better: 'low' },
    { key: 'items', label: 'Изделий в портфеле', get: (r) => ({ value: r.robust.items.length }), fmt: (v) => num(v, 0), deltaFmt: (d) => signed(d) },
    { key: 'regime', label: 'Доля кризисного режима', get: (r) => ({ value: r.macro?.regime_share?.[1] ?? null }), fmt: (v) => pct(v, 0), deltaFmt: plusPct(0) },
    {
      key: 'top', label: 'Главное изделие',
      get: (r) => { const top = [...r.robust.items].sort((a, b) => b.contribution - a.contribution)[0]; return { value: top ? productName(top.product_id) : null } },
    },
  ]
}
