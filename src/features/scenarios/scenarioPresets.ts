/**
 * Пресеты сценариев (владелец: «базовый = обучиться на истории и использовать как сценарий; больше
 * пресетов из истории — как ковид, как 2022; дружелюбнее»). Один реестр для галереи создания, карточки
 * пресета в «Условиях», пустого экрана, списка, шапки, сравнения и «Что если» Мониторинга.
 *  - «Прогноз» — только Базовый: генератор, обученный на истории ЦБ РФ 2013–2026, от сегодняшней точки.
 *  - «Как в истории» — эпизод повторяется ПО ПОРЯДКУ один раз (order=replay) от сегодняшних значений,
 *    дальше — обычная динамика; окна внутри истории и не длиннее горизонта (тест).
 *  - «Стресс-тесты» — одно условие до предела, остальное как в Базовом.
 * Фраза пресета описывает ИЗМЕНЕНИЯ того времени (п. п., %), а не уровни: повторяются шоки, не уровни.
 * Экспертные значения (разброс, связь цен, спрос) подписаны «экспертная оценка — можно изменить».
 * id пресета хранится в macro_mode (`preset`); ручная правка режима его снимает. Прогноз — только
 * Базовый без правок условий; любая правка — «что если» («Базовый + 2 правки»).
 */
import type { MacroModeName, MacroRef, PriceScenario, ScenarioPayload } from '../../lib/api'
import { NBSP, num } from '../../explain/format'
import { windowLabel } from './monthText'
import { SCENARIO_TAB_TITLES } from './scenarioRoute'
import { fromMacroMode, isForecastMode, regimeLabel, toMacroMode, type RegimeMenuState, type ScenarioMacroMode } from './regimeMenu'
import {
  CONDITION_KEYS, DEFAULT_HORIZON_MONTHS, SCENARIO_DEFAULTS, effectiveScenario, isUnset, yoyFromMonthly, type DefaultsContext, type NumericKey,
} from './scenarioDefaults'

export { crisisMonthsText, historyThen, lastWindowStart } from './presetStats'

export type PresetGroup = 'forecast' | 'history' | 'stress'
export type PresetValueKey = 'volatility' | 'market_corr' | 'demand'

export interface ScenarioPreset {
  id: string
  group: PresetGroup
  /** Полное имя: «Как 2022: санкционный шок». */
  name: string
  /** Короткое — для чипов и списка: «Как 2022». */
  short: string
  /** Одна-две фразы: что тогда изменилось (п. п., %) и когда выбирать. */
  oneLine: string
  /** Окно истории: потрясения этих месяцев повторяются по порядку один раз. */
  window?: { from: string; months: number }
  /** Своя опора ключевой ставки на весь горизонт, % годовых. */
  keyRef?: number
  /** Сдвиг уровня курса во всех путях генератора (×): доллар +30 % → 1,3. */
  fxRef?: number
  /** Экспертные значения поверх Базового. */
  values: Readonly<Partial<Record<PresetValueKey, number>>>
  /** Почему так — по каждому экспертному значению. */
  why?: Readonly<Partial<Record<PresetValueKey, string>>>
  isForecast: boolean
}

export const PRESET_GROUPS: ReadonlyArray<{ id: PresetGroup; title: string; subtitle: string }> = [
  { id: 'forecast', title: 'Прогноз', subtitle: 'обученный генератор от сегодняшних значений — единственный сценарий-прогноз' },
  { id: 'history', title: 'Как в истории', subtitle: 'повторяются изменения тех месяцев — от сегодняшних значений, не уровни того времени; после периода — обычная динамика' },
  { id: 'stress', title: 'Стресс-тесты', subtitle: 'одно условие доводим до предела, остальное — как в Базовом' },
]

/** Горизонт нового сценария, мес (один для всех пресетов и умолчаний). */
export const PRESET_MONTHS = DEFAULT_HORIZON_MONTHS
/** Разброс цен ×1 к истории — нейтраль движка (Optimizer.h, VOL_REF прогноза). */
const VOL = SCENARIO_DEFAULTS.volatility
const CRISIS_WHY = 'экспертная оценка: в кризис цены изделий колеблются сильнее и ходят вместе'

export const PRESETS: readonly ScenarioPreset[] = [
  {
    id: 'base', group: 'forecast', name: 'Базовый — обучено на истории', short: 'Базовый', isForecast: true, values: {},
    oneLine: 'Генератор выучил, как вместе двигались ключевая ставка, инфляция и курс доллара по данным Банка России, и продолжает сегодняшние значения. Кризисы входят в пути с исторической частотой.',
  },
  {
    id: 'deval-2014', group: 'history', name: 'Как в 2014–15: девальвация', short: 'Как 2014–15', isForecast: false,
    oneLine: 'Доллар за четыре месяца +75 %, ставка +9 п. п., инфляция за полгода почти удвоилась; к весне рубль отыграл больше половины.',
    window: { from: '2014-10', months: 9 }, values: { volatility: VOL * 1.5, market_corr: 0.75 },
    why: { volatility: CRISIS_WHY, market_corr: CRISIS_WHY },
  },
  {
    id: 'covid-2020', group: 'history', name: 'Как COVID-2020', short: 'Как COVID-2020', isForecast: false,
    oneLine: 'Пандемия: доллар за месяц +16 %, ставку снизили на 1,75 п. п., заказы просели.',
    window: { from: '2020-03', months: 7 }, values: { demand: 0.8 },
    why: { demand: 'экспертная оценка: провал заказов во II квартале 2020 (в генераторе спроса нет)' },
  },
  {
    id: 'sanctions-2022', group: 'history', name: 'Как 2022: санкционный шок', short: 'Как 2022', isForecast: false,
    oneLine: 'Ставка за месяц +11,5 п. п., инфляция за три месяца +9 п. п.; затем доллар подешевел почти на 40 % и ставку быстро снизили.',
    window: { from: '2022-02', months: 7 }, values: { volatility: VOL * 2, market_corr: 0.75, demand: 0.9 },
    why: { volatility: CRISIS_WHY, market_corr: CRISIS_WHY, demand: 'экспертная оценка: сжатие заказов весной 2022' },
  },
  {
    id: 'tightening-2023', group: 'history', name: 'Как 2023: разворот ставки', short: 'Как 2023', isForecast: false,
    oneLine: 'За полгода ставку подняли на 8,5 п. п., инфляция выросла на 4 п. п., доллар на пике +12 %.',
    window: { from: '2023-07', months: 6 }, values: {},
  },
  {
    id: 'tightening-2024', group: 'history', name: 'Как 2024: ставка до 21 %', short: 'Как 2024', isForecast: false,
    oneLine: 'Ставку подняли ещё на 5 п. п., доллар к ноябрю +20 %, инфляция прибавила 1 п. п. — долгие дорогие деньги.',
    window: { from: '2024-06', months: 7 }, values: {},
  },
  {
    id: 'disinflation-2017', group: 'history', name: 'Как 2017: дезинфляция', short: 'Как 2017', isForecast: false,
    oneLine: 'Спокойный год: инфляция снизилась почти на 3 п. п., ставку плавно снизили на 2,25 п. п., курс почти не менялся.',
    window: { from: '2017-01', months: 12 }, values: {},
  },
  {
    id: 'sanctions-2018', group: 'history', name: 'Как 2018: санкции апреля', short: 'Как 2018', isForecast: false,
    oneLine: 'Доллар дважды за полгода дорожал примерно на 8 % за месяц, ставка почти не менялась.',
    window: { from: '2018-04', months: 6 }, values: {},
  },
  {
    id: 'price-crisis', group: 'stress', name: 'Ценовой кризис', short: 'Ценовой кризис', isForecast: false,
    oneLine: 'Рынок изделий штормит: цены колеблются вдвое сильнее обычного и ходят вместе, спрос на 15 % ниже. Ставка, курс и инфляция — как в Базовом.',
    values: { volatility: VOL * 2, market_corr: 0.75, demand: 0.85 },
    why: { volatility: CRISIS_WHY, market_corr: CRISIS_WHY, demand: 'экспертная оценка — можно изменить' },
  },
  {
    id: 'high-rate', group: 'stress', name: 'Высокая ставка 21 %', short: 'Высокая ставка', isForecast: false,
    oneLine: 'Ключевая ставка около 21 % весь горизонт — как на пике 2024–25; инфляция и курс — как в Базовом. Проверка кассы и кредитной линии.',
    keyRef: 21, values: {},
  },
  {
    id: 'weak-ruble', group: 'stress', name: 'Слабый рубль: доллар +30 %', short: 'Слабый рубль', isForecast: false,
    oneLine: 'Доллар на 30 % дороже прогноза весь горизонт: сырьё и покупные изделия дорожают, цены сбыта догоняют частично. Ставка и инфляция — как в Базовом.',
    fxRef: 1.3, values: {},
  },
]

export function getPreset(id: string | null | undefined): ScenarioPreset | undefined {
  return PRESETS.find((p) => p.id === id)
}

/** macro_mode пресета (с id пресета). */
export function presetMacroMode(p: ScenarioPreset, horizonMonths = PRESET_MONTHS): ScenarioMacroMode {
  if (p.window) return { mode: 'episode', stress: { episode: p.window.from, months: p.window.months, order: 'replay' }, preset: p.id }
  if (p.keyRef !== undefined) return { mode: 'base', ref: { key: Array.from({ length: Math.max(1, horizonMonths) }, () => p.keyRef as number) }, preset: p.id }
  if (p.fxRef !== undefined) return { mode: 'base', ref: { fx: p.fxRef }, preset: p.id }
  return { mode: 'base', preset: p.id }
}

/** Значения нового сценария из пресета: горизонт, режим генератора, экспертные значения. */
export function presetPayload(p: ScenarioPreset): Partial<ScenarioPayload> {
  return { months: PRESET_MONTHS, macro_mode: presetMacroMode(p), ...p.values }
}

function matches(p: ScenarioPreset, s: RegimeMenuState): boolean {
  if (p.window) return s.kind === 'episode' && s.episode === p.window.from && s.episodeMonths === p.window.months && s.refFx === 1
  const plain = s.kind === 'base' && s.refCpi === 'flat'
  if (p.keyRef !== undefined) return plain && s.refKey === 'custom' && s.customKey === p.keyRef && s.refFx === 1
  if (p.fxRef !== undefined) return plain && s.refKey === 'flat' && Math.abs(s.refFx - p.fxRef) < 1e-9
  return plain && s.refKey === 'flat' && s.refFx === 1
}

/** Пресет сценария: по сохранённому id (если режим не правили), иначе по самому режиму; своя настройка — null. */
export function presetOf(raw: string | RegimeMenuState | null | undefined): ScenarioPreset | null {
  const s = typeof raw === 'object' && raw !== null ? raw : fromMacroMode(raw)
  const byId = getPreset(s.preset)
  if (byId && matches(byId, s)) return byId
  return PRESETS.find((p) => (p.window || p.keyRef !== undefined || p.fxRef !== undefined || p.id === 'base') && matches(p, s)) ?? null
}

export interface ScenarioView {
  preset: ScenarioPreset | null
  /** Полное имя пресета или режим словами («Кризисный режим весь срок»). */
  name: string
  short: string
  /** Режим словами (подсказка, сравнение). */
  mode: string
  isForecast: boolean
  glyph: '●' | '◆'
  kind: 'прогноз' | 'что если'
  /** Правок условий поверх пресета (0 — как в пресете). */
  edits: number
}

const cap = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1)

/** Короткое имя своей настройки генератора — для списка и чипа (≤ 28 знаков). */
export function shortMode(s: RegimeMenuState): string {
  switch (s.kind) {
    case 'regime': return 'Кризисный режим весь срок'
    case 'quantile': return 'Крайний путь'
    case 'episode': return `Период ${windowLabel(s.episode, s.episodeMonths)}`
    default:
      if (s.refKey === 'custom' && s.customKey !== null) return `Своя ставка ${num(s.customKey, 1)}${NBSP}%`
      if (s.refFx !== 1) return 'Свой сдвиг курса'
      return 'Своя настройка'
  }
}

/**
 * Как называть сценарий в шапке, списке, сравнении: пресет — по имени; иначе — режим словами.
 * `edits` — число правок условий поверх пресета: прогноз — только Базовый без правок.
 */
export function scenarioView(raw: string | undefined, regimeNames: readonly string[] = [], horizon?: number, edits = 0): ScenarioView {
  const s = fromMacroMode(raw)
  const p = presetOf(s)
  const mode = regimeLabel(s, regimeNames, horizon).text
  const isForecast = isForecastMode(s) && (p ? p.isForecast : true) && edits === 0
  return {
    preset: p, name: p ? p.name : cap(mode), short: p ? p.short : shortMode(s), mode, isForecast,
    glyph: isForecast ? '●' : '◆', kind: isForecast ? 'прогноз' : 'что если', edits,
  }
}

/** «Базовый + 2 правки», «Как 2022», «Кризисный режим весь срок + 1 правка». */
export function viewTitle(v: Pick<ScenarioView, 'short' | 'edits'>): string {
  if (v.edits <= 0) return v.short
  const n = v.edits
  const word = n % 10 === 1 && n % 100 !== 11 ? 'правка' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'правки' : 'правок'
  return `${v.short} + ${num(n, 0)} ${word}`
}

/** «повторяет февр.–авг. 2022» — для карточек пресетов. */
export function presetPeriod(p: ScenarioPreset): string {
  if (p.window) return `повторяет ${windowLabel(p.window.from, p.window.months)}`
  if (p.keyRef !== undefined) return `ставка ${num(p.keyRef, 0)}${NBSP}% весь горизонт`
  if (p.fxRef !== undefined) return `доллар +${num((p.fxRef - 1) * 100, 0)}${NBSP}% к прогнозу весь горизонт`
  return p.group === 'forecast' ? 'обучено на истории ЦБ РФ' : 'рынок изделий, без изменения ставки и курса'
}

/** Что пресет меняет в рынке изделий одной строкой: «разброс цен ×2 · связь цен 0,75 · спрос −15 %». */
export function presetValuesText(p: ScenarioPreset): string {
  const parts: string[] = []
  const v = p.values
  if (v.volatility !== undefined) parts.push(`разброс цен ×${num(v.volatility / VOL, 1)}`)
  if (v.market_corr !== undefined) parts.push(`связь цен ${num(v.market_corr, 2)}`)
  if (v.demand !== undefined) parts.push(`спрос ${v.demand >= 1 ? '+' : '−'}${num(Math.abs(v.demand - 1) * 100, 0)}${NBSP}%`)
  return parts.join(' · ')
}

/** Применение пресета к открытому сценарию: режим, экспертные значения; ручные инфляция и курс — к умолчанию, если не просили оставить. */
export function presetPatch(p: ScenarioPreset, months: number, keepEdits = false): Record<string, string> {
  return {
    macro_mode: JSON.stringify(presetMacroMode(p, months)),
    volatility: p.values.volatility !== undefined ? String(p.values.volatility) : '',
    market_corr: String(p.values.market_corr ?? SCENARIO_DEFAULTS.market_corr),
    demand: p.values.demand !== undefined ? String(p.values.demand) : '',
    ...(keepEdits ? {} : { inflation: '', fx: '' }),
  }
}

/** Вкладка путей цен — одно имя везде (вкладка, крошка, ссылка Мониторинга); прогноз/что если — чипом внутри. */
export const FORECAST_TAB_TITLE = SCENARIO_TAB_TITLES.forecast

/** @deprecated имя вкладки больше не зависит от режима — `FORECAST_TAB_TITLE`. */
export function forecastTabTitle(_macroMode?: string): string {
  return FORECAST_TAB_TITLE
}

/** Условия, изменённые поверх пресета (значение пресета не считается правкой; без пресета — отличие от умолчания). */
export function presetEdits(sc: Partial<PriceScenario>, ctx: DefaultsContext = {}): NumericKey[] {
  const p = presetOf(fromMacroMode(sc.macro_mode))
  const eff = effectiveScenario(sc, ctx)
  return CONDITION_KEYS.filter((k) => {
    const pv = p?.values[k as PresetValueKey]
    return pv !== undefined ? Math.abs(eff[k] - pv) > 1e-9 : !eff.isDefault[k]
  })
}

/** Вид сценария с учётом правок условий: «Базовый + 2 правки · что если». */
export function scenarioViewOf(sc: Partial<PriceScenario>, regimeNames: readonly string[] = [], ctx: DefaultsContext = {}): ScenarioView {
  const eff = effectiveScenario(sc, ctx)
  return scenarioView(sc.macro_mode, regimeNames, eff.months, presetEdits(sc, ctx).length)
}

/**
 * Режим генератора сценария вместе с ручными инфляцией и сдвигом курса — так их применяет бэкенд
 * (опора путей: ref.cpi — инфляция г/г, ref.fx — сдвиг уровня курса), чтобы карточка пресета и поля
 * показывали те же пути, что получат цены, Портфель и касса.
 */
export function scenarioMacroMode(sc: Partial<PriceScenario>, months: number): ScenarioMacroMode | MacroModeName {
  const base = toMacroMode(fromMacroMode(sc.macro_mode), months)
  const extra: MacroRef = {}
  const infl = isUnset(sc.inflation) ? NaN : Number(sc.inflation)
  const fx = isUnset(sc.fx) ? NaN : Number(sc.fx)
  if (Number.isFinite(infl)) extra.cpi = [yoyFromMonthly(infl) * 100]
  if (Number.isFinite(fx) && fx > 0 && Math.abs(fx - 1) > 1e-9) extra.fx = fx
  if (Object.keys(extra).length === 0) return base
  const m: ScenarioMacroMode = typeof base === 'string' ? { mode: base } : base
  return { ...m, ref: { ...(m.ref ?? {}), ...extra } }
}
