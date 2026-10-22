/**
 * Меню режимов и стрессов (METHODOLOGY-V2 §2.6б) вместо ползунков sanctions/energy/logistics/key_rate:
 * «Базовый» (прогноз) · «Режим h навязан» (стресс) · «Квантильный стресс q» (только квантили) ·
 * «Исторический эпизод» [Н] · опора ставки/инфляции [НОРМ]. Редьюсер чистый: состояние меню ↔
 * `MacroMode` (JSON в `price_scenarios.macro_mode`). Слово «прогноз» — только для базового.
 */
import type { MacroMode, MacroModeName, MacroRef, MacroStress } from '../../lib/api'

export type RegimeKind = 'base' | 'regime' | 'quantile' | 'episode'

export interface RegimeMenuState {
  kind: RegimeKind
  /** Индекс навязанного режима (kind = regime). */
  regime: number
  /** Квантиль Student-t (kind = quantile), 0,01…0,99. */
  quantile: number
  /** Начало исторического эпизода `YYYY-MM` (kind = episode) и его длина в месяцах. */
  episode: string
  episodeMonths: number
  refCpi: 'flat' | 'nodes'
  refKey: 'flat' | 'custom'
  /** Пользовательская опора ставки (годовые %), если refKey = custom. */
  customKey: number | null
}

export type RegimeMenuAction =
  | { type: 'kind'; kind: RegimeKind }
  | { type: 'regime'; regime: number }
  | { type: 'quantile'; quantile: number }
  | { type: 'episode'; episode: string; months?: number }
  | { type: 'refCpi'; refCpi: 'flat' | 'nodes' }
  | { type: 'refKey'; refKey: 'flat' | 'custom'; customKey?: number | null }
  | { type: 'reset' }

export const DEFAULT_MENU: RegimeMenuState = {
  kind: 'base', regime: 1, quantile: 0.95, episode: '2022-02', episodeMonths: 6, refCpi: 'flat', refKey: 'flat', customKey: null,
}

const clampQ = (q: number): number => Math.min(0.99, Math.max(0.01, Math.round(q * 100) / 100))

export function regimeMenuReducer(s: RegimeMenuState, a: RegimeMenuAction): RegimeMenuState {
  switch (a.type) {
    case 'kind': return s.kind === a.kind ? s : { ...s, kind: a.kind }
    case 'regime': return { ...s, kind: 'regime', regime: Math.max(0, Math.floor(a.regime)) }
    case 'quantile': return { ...s, kind: 'quantile', quantile: clampQ(a.quantile) }
    case 'episode': return { ...s, kind: 'episode', episode: a.episode, episodeMonths: a.months ?? s.episodeMonths }
    case 'refCpi': return { ...s, refCpi: a.refCpi }
    case 'refKey': return { ...s, refKey: a.refKey, customKey: a.refKey === 'custom' ? (a.customKey ?? s.customKey) : null }
    case 'reset': return DEFAULT_MENU
  }
}

/** Состояние меню → контракт API. Базовый без нестандартной опоры → имя режима 'base'. */
export function toMacroMode(s: RegimeMenuState, horizonMonths = 12): MacroMode | MacroModeName {
  const ref: MacroRef = {}
  if (s.refCpi === 'nodes') ref.cpi = 'nodes'
  if (s.refKey === 'custom' && s.customKey !== null) ref.key = Array.from({ length: Math.max(1, horizonMonths) }, () => s.customKey as number)
  const hasRef = Object.keys(ref).length > 0
  let stress: MacroStress = null
  let mode: MacroModeName = 'base'
  if (s.kind === 'regime') { mode = 'regime'; stress = { regime: s.regime } }
  else if (s.kind === 'quantile') { mode = 'quantile'; stress = { quantile_t: s.quantile } }
  else if (s.kind === 'episode') { mode = 'episode'; stress = { episode: s.episode, months: s.episodeMonths } }
  if (mode === 'base' && !hasRef) return 'base'
  return { mode, ...(stress ? { stress } : {}), ...(hasRef ? { ref } : {}) }
}

/** Контракт API (JSON-строка из сценария, объект или имя) → состояние меню; мусор → базовый. */
export function fromMacroMode(raw: string | MacroMode | MacroModeName | null | undefined): RegimeMenuState {
  if (!raw || raw === 'base' || raw === 'iid_v063') return DEFAULT_MENU
  let m: MacroMode | null = null
  if (typeof raw === 'string') {
    if (raw === 'regime' || raw === 'quantile' || raw === 'episode') return DEFAULT_MENU
    try { m = JSON.parse(raw) as MacroMode } catch { return DEFAULT_MENU }
  } else m = raw
  if (!m || typeof m !== 'object') return DEFAULT_MENU
  let s: RegimeMenuState = DEFAULT_MENU
  const st = m.stress
  if (st && 'regime' in st) s = { ...s, kind: 'regime', regime: st.regime }
  else if (st && 'quantile_t' in st) s = { ...s, kind: 'quantile', quantile: clampQ(st.quantile_t) }
  else if (st && 'episode' in st) s = { ...s, kind: 'episode', episode: st.episode, episodeMonths: st.months ?? DEFAULT_MENU.episodeMonths }
  else if (m.mode === 'regime' || m.mode === 'quantile' || m.mode === 'episode') s = { ...s, kind: m.mode }
  if (m.ref?.cpi === 'nodes') s = { ...s, refCpi: 'nodes' }
  if (Array.isArray(m.ref?.key) && m.ref.key.length) s = { ...s, refKey: 'custom', customKey: m.ref.key[0] }
  return s
}

/** Подпись для чипов: «прогноз» допустимо только для базового (§2.6б). */
export function regimeLabel(s: RegimeMenuState, regimeNames: readonly string[] = []): { text: string; isForecast: boolean } {
  switch (s.kind) {
    case 'base': return { text: 'базовый — прогноз', isForecast: true }
    case 'regime': return { text: `режим «${regimeNames[s.regime] ?? s.regime}» навязан — стресс`, isForecast: false }
    case 'quantile': return { text: `квантильный стресс q = ${s.quantile.toFixed(2)}`, isForecast: false }
    case 'episode': return { text: `исторический эпизод ${s.episode} (${s.episodeMonths} мес)`, isForecast: false }
  }
}
