/**
 * Режим генератора сценария (METHODOLOGY-V2 §2.6б): «Базовый (обучено на истории)» — прогноз ·
 * «Свой период из истории» (эпизод повторяется по порядку один раз — order=replay; прежнее «вперемешку»
 * бэкенд переводит в replay миграцией) · «Кризисный режим» · «Крайний путь» (квантиль из сетки
 * генератора) · опоры ставки/инфляции [НОРМ] · сдвиг курса (ref.fx, стресс «Слабый рубль»). Пресет
 * (scenarioPresets.ts) хранится в том же JSON `price_scenarios.macro_mode` полем `preset`; любая ручная
 * правка режима снимает пресет. Подписи — словами: без «YYYY-MM», «квантиль 0.95», «режим 1» и
 * текста паспорта. Слово «прогноз» — только для базового без своей опоры ставки и сдвига курса.
 */
import type { MacroMode, MacroModeName, MacroRef, MacroStress } from '../../lib/api'
import { NBSP, num, pct } from '../../explain/format'
import { windowLabel } from './monthText'

export type RegimeKind = 'base' | 'regime' | 'quantile' | 'episode'

export interface RegimeMenuState {
  kind: RegimeKind
  /** Индекс навязанного режима (kind = regime). */
  regime: number
  /** Квантиль Student-t (kind = quantile) — только из сетки генератора (stress_quantiles). */
  quantile: number
  /** Начало периода истории `YYYY-MM` (kind = episode) и его длина в месяцах. */
  episode: string
  episodeMonths: number
  refCpi: 'flat' | 'nodes'
  refKey: 'flat' | 'custom'
  /** Своя опора ставки (годовые %), если refKey = custom. */
  customKey: number | null
  /** Сдвиг уровня курса во всех путях (×); 1 — без сдвига. */
  refFx: number
  /** id пресета, из которого сценарий создан; null — своя настройка. */
  preset: string | null
}

/** macro_mode сценария: контракт API + id пресета (бэкенд лишние ключи пропускает). */
export type ScenarioMacroMode = MacroMode & { preset?: string }

export type RegimeMenuAction =
  | { type: 'kind'; kind: RegimeKind }
  | { type: 'regime'; regime: number }
  | { type: 'quantile'; quantile: number }
  | { type: 'episode'; episode: string; months?: number }
  | { type: 'refCpi'; refCpi: 'flat' | 'nodes' }
  | { type: 'refKey'; refKey: 'flat' | 'custom'; customKey?: number | null }
  | { type: 'refFx'; refFx: number }
  | { type: 'reset' }

export const DEFAULT_MENU: RegimeMenuState = {
  kind: 'base', regime: 1, quantile: 0.95, episode: '2022-02', episodeMonths: 7,
  refCpi: 'flat', refKey: 'flat', customKey: null, refFx: 1, preset: null,
}

const clampQ = (q: number): number => Math.min(0.99, Math.max(0.01, Math.round(q * 100) / 100))

/** Ручная правка режима: пресет снимается (сценарий — своя настройка). */
const manual = (s: RegimeMenuState): RegimeMenuState => ({ ...s, preset: null })

export function regimeMenuReducer(s: RegimeMenuState, a: RegimeMenuAction): RegimeMenuState {
  switch (a.type) {
    case 'kind': return s.kind === a.kind ? s : manual({ ...s, kind: a.kind })
    case 'regime': return manual({ ...s, kind: 'regime', regime: Math.max(0, Math.floor(a.regime)) })
    case 'quantile': return manual({ ...s, kind: 'quantile', quantile: clampQ(a.quantile) })
    case 'episode': return manual({ ...s, kind: 'episode', episode: a.episode, episodeMonths: Math.max(1, Math.round(a.months ?? s.episodeMonths)) })
    case 'refCpi': return manual({ ...s, refCpi: a.refCpi })
    case 'refKey': return manual({ ...s, refKey: a.refKey, customKey: a.refKey === 'custom' ? (a.customKey ?? s.customKey) : null })
    case 'refFx': return manual({ ...s, refFx: Number.isFinite(a.refFx) && a.refFx > 0 ? a.refFx : 1 })
    case 'reset': return DEFAULT_MENU
  }
}

/** Состояние меню → контракт API. Базовый без опор и пресета → имя режима 'base'. */
export function toMacroMode(s: RegimeMenuState, horizonMonths = 12): ScenarioMacroMode | MacroModeName {
  const ref: MacroRef = {}
  if (s.refCpi === 'nodes') ref.cpi = 'nodes'
  if (s.refKey === 'custom' && s.customKey !== null) ref.key = Array.from({ length: Math.max(1, horizonMonths) }, () => s.customKey as number)
  if (s.refFx !== 1) ref.fx = s.refFx
  const hasRef = Object.keys(ref).length > 0
  let stress: MacroStress = null
  let mode: MacroModeName = 'base'
  if (s.kind === 'regime') { mode = 'regime'; stress = { regime: s.regime } }
  else if (s.kind === 'quantile') { mode = 'quantile'; stress = { quantile_t: s.quantile } }
  else if (s.kind === 'episode') {
    mode = 'episode'
    stress = { episode: s.episode, months: s.episodeMonths, order: 'replay' }
  }
  if (mode === 'base' && !hasRef && !s.preset) return 'base'
  return { mode, ...(stress ? { stress } : {}), ...(hasRef ? { ref } : {}), ...(s.preset ? { preset: s.preset } : {}) }
}

/** Контракт API (JSON-строка из сценария, объект или имя) → состояние меню; мусор → базовый. */
export function fromMacroMode(raw: string | ScenarioMacroMode | MacroModeName | null | undefined): RegimeMenuState {
  if (!raw || raw === 'base' || raw === 'iid_v063') return DEFAULT_MENU
  let m: ScenarioMacroMode | null = null
  if (typeof raw === 'string') {
    if (raw === 'regime' || raw === 'quantile' || raw === 'episode') return DEFAULT_MENU
    try { m = JSON.parse(raw) as ScenarioMacroMode } catch { return DEFAULT_MENU }
  } else m = raw
  if (!m || typeof m !== 'object') return DEFAULT_MENU
  let s: RegimeMenuState = DEFAULT_MENU
  const st = m.stress
  if (st && 'regime' in st) s = { ...s, kind: 'regime', regime: st.regime }
  else if (st && 'quantile_t' in st) s = { ...s, kind: 'quantile', quantile: clampQ(st.quantile_t) }
  else if (st && 'episode' in st) {
    s = { ...s, kind: 'episode', episode: st.episode, episodeMonths: st.months ?? 12 }
  } else if (m.mode === 'regime' || m.mode === 'quantile' || m.mode === 'episode') s = { ...s, kind: m.mode }
  if (m.ref?.cpi === 'nodes') s = { ...s, refCpi: 'nodes' }
  if (Array.isArray(m.ref?.key) && m.ref.key.length) s = { ...s, refKey: 'custom', customKey: m.ref.key[0] }
  if (typeof m.ref?.fx === 'number' && Number.isFinite(m.ref.fx) && m.ref.fx > 0) s = { ...s, refFx: m.ref.fx }
  if (typeof m.preset === 'string' && m.preset) s = { ...s, preset: m.preset }
  return s
}

/** Прогноз — только базовый режим без своей опоры ставки и сдвига курса; остальное — «что если». */
export function isForecastMode(s: RegimeMenuState): boolean {
  return s.kind === 'base' && s.refKey !== 'custom' && s.refFx === 1
}

/** Имя режима HMM словами: «кризис (макс. дисперсия)» → «кризисный». */
export function regimeName(label: string | undefined): string {
  const base = (label ?? '').replace(/\s*\(.*\)\s*$/, '').trim()
  if (!base) return 'кризисный'
  return base === 'кризис' ? 'кризисный' : base
}

/** Крайний путь словами: q 0,95 → «каждый месяц шок сильнее, чем в 95 % месяцев истории». */
export function quantileText(q: number): string {
  return q >= 0.5
    ? `каждый месяц шок сильнее, чем в ${pct(q, 0)} месяцев истории`
    : `каждый месяц шок слабее, чем в ${pct(1 - q, 0)} месяцев истории`
}

/** Подпись режима словами. `horizon` — горизонт сценария, мес. */
export function regimeLabel(s: RegimeMenuState, regimeNames: readonly string[] = [], horizon?: number): { text: string; isForecast: boolean } {
  switch (s.kind) {
    case 'base':
      if (s.refKey === 'custom' && s.customKey !== null) return { text: `базовый, своя опора ставки ${pct(s.customKey / 100, 1)}`, isForecast: false }
      if (s.refFx !== 1) return { text: `базовый, доллар ${s.refFx > 1 ? '+' : '−'}${num(Math.abs(s.refFx - 1) * 100, 0)}${NBSP}% к прогнозу`, isForecast: false }
      return { text: 'базовый — прогноз по истории', isForecast: true }
    case 'regime': return { text: `навязан ${regimeName(regimeNames[s.regime])} режим на весь горизонт`, isForecast: false }
    case 'quantile': return { text: `крайний путь: ${quantileText(s.quantile)}`, isForecast: false }
    case 'episode': {
      const period = windowLabel(s.episode, s.episodeMonths)
      const part = horizon && horizon > 0 && s.episodeMonths > horizon ? `, первые ${num(horizon, 0)} мес` : ''
      return { text: `повтор ${period} по порядку${part}`, isForecast: false }
    }
  }
}

/** Нейтральный чип типа сценария: глиф + слово, без цветового тона (X2 «цвет — одна работа»). */
export function regimeChip(s: RegimeMenuState): { glyph: '●' | '◆'; word: 'прогноз' | 'что если' } {
  return isForecastMode(s) ? { glyph: '●', word: 'прогноз' } : { glyph: '◆', word: 'что если' }
}

/** Варианты расширенной настройки генератора: имя и одна строка эффекта (карточки выбора). */
export const KIND_OPTIONS: ReadonlyArray<{ id: RegimeKind; label: string; effect: string; warn?: boolean }> = [
  { id: 'base', label: 'Базовый (обучено на истории)', effect: 'прогноз: пути от сегодняшних значений, кризисы — с исторической частотой' },
  { id: 'episode', label: 'Свой период из истории', effect: 'повторяет изменения выбранных месяцев по порядку один раз' },
  { id: 'regime', label: 'Кризисный режим', effect: 'весь горизонт — кризисный режим: разброс путей шире в обе стороны', warn: true },
  { id: 'quantile', label: 'Крайний путь', effect: 'один путь с шоком заданной силы каждый месяц — предельная проверка', warn: true },
]

/** Состояние меню → строка поля сценария `macro_mode`. */
export function serializeMode(s: RegimeMenuState, horizonMonths: number): string {
  const mode = toMacroMode(s, horizonMonths)
  return typeof mode === 'string' ? mode : JSON.stringify(mode)
}

/**
 * Значение паспорта генератора словами: «flat…» → «последнее наблюдение» (+ число в скобках —
 * «последнее наблюдение — 14 %»), «nodes…» → «узлы прогноза ЦБ РФ», «14.0» → «14 %». Свободный
 * текст паспорта до интерфейса не доходит: неизвестное — «—».
 */
export function passportValueLabel(v: unknown): string {
  if (v === null || v === undefined || String(v).trim() === '') return 'последнее наблюдение'
  const s = String(v).trim()
  const inBrackets = /\((-?\d+(?:[.,]\d+)?)\)/.exec(s)
  const n = (x: string) => Number(x.replace(',', '.'))
  const pctText = (x: number) => `${num(x, Number.isInteger(x) ? 0 : 1)}${NBSP}%`
  if (/^(flat|плоская)\b/.test(s)) return inBrackets && Number.isFinite(n(inBrackets[1])) ? `последнее наблюдение — ${pctText(n(inBrackets[1]))}` : 'последнее наблюдение'
  if (/^nodes\b/.test(s)) return 'узлы прогноза ЦБ РФ'
  if (s === 'custom') return 'своя'
  if (/^-?\d+(?:[.,]\d+)?$/.test(s) && Number.isFinite(n(s))) return pctText(n(s))
  return '—'
}
