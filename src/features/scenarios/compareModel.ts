/**
 * Модель сравнения сценариев (X2 «честное сравнение»): условия — эффективные значения в тех же
 * единицах, что карточки «Условий» (% г/г, % от исторического, сдвиг к генератору и справочнику;
 * conditionFields.ts), умолчание подставлено и подписано источником («● ЦБ РФ, сент. 2026»), никогда
 * «—»; различие — по видимому тексту; у каждой не-базовой ячейки — Δ к базовой колонке с направлением
 * «лучше». Пресет — по имени и периоду. Подписи результатов — те же, что в «Портфеле». Чистые функции.
 */
import type { MacroLastObs, OptResult, PriceScenario } from '../../lib/api'
import { DASH, NBSP, money, num, pct, plural, pp, signed } from '../../explain/format'
import { objectiveLabel } from '../../explain/labels'
import { kpiLabels } from '../optimization/optTypes'
import { conditionSpec, type ConditionKey } from './conditionFields'
import { SCENARIO_DEFAULTS, effectiveScenario, yoyFromMonthly } from './scenarioDefaults'
import { scenarioView } from './scenarioPresets'

export interface CellValue { value: number | string | null | undefined; isDefault?: boolean; origin?: string }

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

export interface CompareCell { text: string; isDefault: boolean; delta: number | null; origin?: string }

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
      isDefault: Boolean(c.isDefault), origin: c.origin,
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

const POINTS = ['пункт', 'пункта', 'пунктов'] as const
/** Разница долей в процентных пунктах словом: «+1,2 пункта», «−5 пунктов» (без «п. п.»). */
const plusPct = (digits: number) => (d: number) => {
  const t = pp(d, { signed: true, digits }).replace(/[\s ]п\.[\s ]п\.$/, '')
  const shown = Math.abs(Number(t.replace(/[+−\s ]/g, '').replace(',', '.')))
  return `${t}${NBSP}${plural(shown, POINTS)}`
}
const MONTHS = ['месяц', 'месяца', 'месяцев'] as const
const monthsText = (v: number): string => `${num(v, 0)}${NBSP}${plural(Math.round(Math.abs(v)), MONTHS)}`

/** Источник умолчания поля условий словами с глифом: «● ЦБ РФ, сент. 2026», «◆ норматив предприятия». */
function originOf(key: ConditionKey, lastObs: MacroLastObs | null | undefined): string {
  const o = conditionSpec(key).origin({ lastObs, months: SCENARIO_DEFAULTS.months })
  return `${o.status === 'НОРМ' ? '◆' : o.status === 'техн.' ? '○' : '●'} ${o.source}`
}

/** Условия сценариев — эффективные значения. `names` — подписи режимов генератора; `lastObs` — точка старта ЦБ РФ. */
export function conditionRows(names: readonly string[] = [], lastObs?: MacroLastObs | null): ReadonlyArray<CompareRowDef<PriceScenario>> {
  const eff = (s: PriceScenario) => effectiveScenario(s, { lastObs })
  const cond = (key: ConditionKey, s: PriceScenario, value: number): CellValue => ({ value, isDefault: eff(s).isDefault[key], origin: originOf(key, lastObs) })
  return [
    {
      key: 'mode', label: 'Пресет и режим генератора', always: true,
      get: (s) => { const v = scenarioView(s.macro_mode, names, eff(s).months); return { value: v.preset ? `${v.name} · ${v.kind}` : `${v.short} · ${v.kind}`, isDefault: v.preset?.id === 'base' } },
    },
    { key: 'objective', label: 'Критерий', get: (s) => ({ value: objectiveLabel(eff(s).objective), isDefault: eff(s).isDefault.objective }) },
    { key: 'alpha', label: 'Доля худших сценариев в оценке риска', get: (s) => ({ value: eff(s).alpha, isDefault: eff(s).isDefault.alpha }), fmt: (v) => pct(v, 0), deltaFmt: plusPct(0) },
    { key: 'max_share', label: 'Наибольшая доля одного изделия', get: (s) => ({ value: eff(s).max_share, isDefault: eff(s).isDefault.max_share }), fmt: (v) => pct(v, 0), deltaFmt: plusPct(0) },
    { key: 'months', label: 'Горизонт прогноза', get: (s) => ({ value: eff(s).months, isDefault: eff(s).isDefault.months }), fmt: monthsText, deltaFmt: (d) => `${signed(d)}${NBSP}${plural(Math.round(Math.abs(d)), MONTHS)}` },
    { key: 'inflation', label: 'Инфляция цен сбыта, год к году', get: (s) => cond('inflation', s, yoyFromMonthly(eff(s).inflation)), fmt: (v) => pct(v, 2), deltaFmt: plusPct(2) },
    { key: 'volatility', label: 'Разброс цен, % от исторического', get: (s) => cond('volatility', s, eff(s).volatility / SCENARIO_DEFAULTS.volatility), fmt: (v) => pct(v, 0), deltaFmt: plusPct(0) },
    { key: 'market_corr', label: 'Связь цен между изделиями', get: (s) => cond('market_corr', s, eff(s).market_corr), fmt: (v) => num(v, 2), deltaFmt: (d) => signed(d) },
    { key: 'fx', label: 'Сдвиг курса доллара к генератору', get: (s) => cond('fx', s, eff(s).fx - 1), fmt: (v) => (Math.abs(v) < 1e-9 ? 'без сдвига' : signed(v, '%')), deltaFmt: plusPct(0) },
    { key: 'demand', label: 'Спрос к справочнику', get: (s) => cond('demand', s, eff(s).demand - 1), fmt: (v) => (Math.abs(v) < 1e-9 ? 'как в справочнике' : signed(v, '%')), deltaFmt: plusPct(0) },
    { key: 'dists', label: 'Распределений цен задано', get: (s) => ({ value: s.distributions?.length ?? 0 }), fmt: (v) => num(v, 0) },
    { key: 'overrides', label: 'Точечных цен задано', get: (s) => ({ value: s.overrides?.length ?? 0 }), fmt: (v) => num(v, 0) },
  ]
}

/** Доля кризисного режима генератора: только когда режимы известны (не «вперемешку» и не крайний путь). */
export function crisisShare(r: OptResult, crisisIndex: number): number | null {
  const st = r.macro?.stress
  if (st && 'quantile_t' in st) return null
  if (st && 'episode' in st && st.order !== 'replay') return null
  return r.macro?.regime_share?.[crisisIndex] ?? null
}

/** Результаты робастной оптимизации — подписи «Портфеля». */
export function resultRows(alpha: number, productName: (id: string) => string, crisisIndex = 1): ReadonlyArray<CompareRowDef<OptResult>> {
  const L = kpiLabels(alpha)
  const rub = (d: number) => signed(d, '₽')
  return [
    { key: 'e', label: L.expected, get: (r) => ({ value: r.robust.metrics.expected }), fmt: (v) => money(v), deltaFmt: rub, better: 'high', always: true },
    { key: 'cvar', label: L.cvar, get: (r) => ({ value: r.robust.metrics.cvar }), fmt: (v) => money(v), deltaFmt: rub, better: 'high', always: true },
    { key: 'worst', label: L.worst, get: (r) => ({ value: r.robust.metrics.worst_case }), fmt: (v) => money(v), deltaFmt: rub, better: 'high' },
    { key: 'ploss', label: L.p_loss, get: (r) => ({ value: r.robust.metrics.p_loss }), fmt: (v) => pct(v, 1), deltaFmt: plusPct(1), better: 'low', always: true },
    { key: 'por', label: 'Цена робастности', get: (r) => ({ value: r.price_of_robustness }), fmt: (v) => money(v), deltaFmt: rub, better: 'low' },
    { key: 'effn', label: 'Эффективное число изделий', get: (r) => ({ value: r.robust.diversification.effective_n }), fmt: (v) => num(v, 1), deltaFmt: (d) => signed(d), better: 'high' },
    { key: 'hhi', label: 'Концентрация выручки', get: (r) => ({ value: r.robust.diversification.concentration }), fmt: (v) => pct(v, 0), deltaFmt: plusPct(0), better: 'low' },
    { key: 'items', label: 'Изделий в портфеле', get: (r) => ({ value: r.robust.items.length }), fmt: (v) => num(v, 0), deltaFmt: (d) => signed(d) },
    { key: 'regime', label: 'Доля кризисных месяцев в путях', get: (r) => ({ value: crisisShare(r, crisisIndex) }), fmt: (v) => pct(v, 0), deltaFmt: plusPct(0) },
    {
      key: 'top', label: 'Главное изделие',
      get: (r) => { const top = [...r.robust.items].sort((a, b) => b.contribution - a.contribution)[0]; return { value: top ? productName(top.product_id) : null } },
    },
  ]
}
