/**
 * Мост «токены дизайн-системы → WebGL/MapLibre». Материалы three.js и paint-свойства
 * MapLibre не понимают CSS-переменные и OKLCH, поэтому активная тема читается из
 * вычисленных `--*` на <html> и переводится в sRGB-hex (`#rrggbb`), который принимают
 * и THREE.Color, и MapLibre.
 *
 *  - OKLCH-литералы токенов переводятся в sRGB аналитически (без DOM — тестируемо);
 *  - любой другой синтаксис (color-mix, именованные цвета) — через 1×1 canvas
 *    (fillRect + getImageData всегда отдаёт sRGB-байты);
 *  - чтение только при монтировании и смене темы (`useTheme` наблюдает `data-theme`
 *    MutationObserver'ом), результат кэшируется на тему — в кадре работы нет.
 */
import { useTheme, type Theme } from '../../shell/theme'
import type { StageStatus } from './types'

export interface ThemeColors {
  readonly theme: Theme
  /** Фон приложения — горизонт неба и туман 3D, фон карты. */
  readonly bgApp: string
  readonly bgPanel: string
  /** Постоянные полюса бренда (одинаковы в обеих темах). */
  readonly ink: string
  readonly bone: string
  readonly accent: string
  /** Подсветка выделения (= --focus: светлее accent на тёмном, accent на светлом). */
  readonly focus: string
  readonly ultramarine: string
  readonly verdigris: string
  readonly ochre: string
  readonly status: Readonly<Record<StageStatus, string>>
  /** --chart-1 … --chart-8 (8 — «прочее»). */
  readonly chart: readonly string[]
}

type ScalarKey = Exclude<keyof ThemeColors, 'theme' | 'status' | 'chart'>

const SCALAR_TOKENS: Readonly<Record<ScalarKey, string>> = {
  bgApp: '--bg-app',
  bgPanel: '--bg-panel',
  ink: '--ink',
  bone: '--bone',
  accent: '--accent',
  focus: '--focus',
  ultramarine: '--ultramarine',
  verdigris: '--verdigris',
  ochre: '--ochre',
}

const STATUS_TOKENS: Readonly<Record<StageStatus, string>> = {
  running: '--status-running',
  setup: '--status-setup',
  idle: '--status-idle',
  down: '--status-down',
}

const CHART_TOKENS = Array.from({ length: 8 }, (_, i) => `--chart-${i + 1}`)

/**
 * Запасные значения = sRGB-hex из комментариев tokens.css. Используются ТОЛЬКО если
 * переменная не прочиталась (нет DOM, стили ещё не подключены) — не источник истины.
 */
const FALLBACK: Readonly<Record<Theme, ThemeColors>> = {
  dark: {
    theme: 'dark', bgApp: '#0d0f16', bgPanel: '#13161d', ink: '#171a24', bone: '#f2eee6',
    accent: '#4366e8', focus: '#90aefe', ultramarine: '#4366e8', verdigris: '#58c8ad', ochre: '#e9af41',
    status: { running: '#5bcc80', setup: '#f2b036', idle: '#969eb2', down: '#f75e54' },
    chart: ['#4a81eb', '#efa831', '#47b497', '#dc5426', '#95d4f6', '#924da6', '#f3e657', '#83807a'],
  },
  light: {
    theme: 'light', bgApp: '#f8f5ef', bgPanel: '#f0ece5', ink: '#171a24', bone: '#f2eee6',
    accent: '#3250d8', focus: '#3250d8', ultramarine: '#3250d8', verdigris: '#107460', ochre: '#955e00',
    status: { running: '#12773d', setup: '#c8800d', idle: '#5e636f', down: '#b7191c' },
    chart: ['#304ccc', '#cd821a', '#22876b', '#cf3b18', '#4a9dc5', '#6d2981', '#642627', '#888681'],
  },
}

/** Статусы тёмной темы — запасной цвет для кода без темы (STATUS_META.color). */
export const STATUS_FALLBACK: Readonly<Record<StageStatus, string>> = FALLBACK.dark.status

/* ── Конвертация цвета ─────────────────────────────────────────────────────── */

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))
const toByte = (v: number): number => Math.round(clamp01(v) * 255)
const gammaEncode = (x: number): number => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')
}

/** OKLCH (L 0–1, C, h°) → sRGB-hex; вне охвата — отсечение по каналам. */
export function oklchToHex(l: number, c: number, hDeg: number): string {
  const h = (hDeg * Math.PI) / 180
  const a = c * Math.cos(h)
  const b = c * Math.sin(h)
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const r = 4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_
  const g = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_
  const bl = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_
  return rgbToHex(toByte(gammaEncode(r)), toByte(gammaEncode(g)), toByte(gammaEncode(bl)))
}

const OKLCH_RE = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)(%?)\s+([\d.]+)(?:deg)?\s*(?:\/\s*[\d.]+%?\s*)?\)$/i
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

/** Разбор литерала токена без DOM: `oklch(L C H [/ a])` или `#rgb`/`#rrggbb`; иначе null. */
export function parseCssColor(raw: string): string | null {
  const v = raw.trim()
  const hex = HEX_RE.exec(v)
  if (hex) {
    const s = hex[1].length === 3 ? hex[1].replace(/./g, (ch) => ch + ch) : hex[1]
    return '#' + s.toLowerCase()
  }
  const m = OKLCH_RE.exec(v)
  if (!m) return null
  const l = Number(m[1]) / (m[2] ? 100 : 1)
  const c = m[4] ? (Number(m[3]) / 100) * 0.4 : Number(m[3])
  return oklchToHex(l, c, Number(m[5]))
}

/** Любой CSS-цвет → hex через 1×1 canvas (только в браузере). */
function createCanvasProbe(): ((css: string) => string | null) | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  const SENTINEL = '#010203'
  return (css) => {
    ctx.fillStyle = SENTINEL
    ctx.fillStyle = css // невалидная строка игнорируется — остаётся SENTINEL
    if (String(ctx.fillStyle).toLowerCase() === SENTINEL && css.trim().toLowerCase() !== SENTINEL) return null
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    return rgbToHex(r, g, b)
  }
}

/* ── Чтение темы ───────────────────────────────────────────────────────────── */

export interface ResolveResult {
  colors: ThemeColors
  /** Все токены прочитаны (иначе часть — из FALLBACK, и кэшировать нельзя). */
  complete: boolean
}

/** Чистое ядро: `readVar` даёт сырое значение `--token`, `probe` — запасной парсер. */
export function resolveThemeColors(
  theme: Theme,
  readVar: (name: string) => string,
  probe: ((css: string) => string | null) | null = null,
): ResolveResult {
  const fb = FALLBACK[theme]
  let complete = true
  const pick = (name: string, fallback: string): string => {
    const raw = readVar(name).trim()
    const hex = raw ? parseCssColor(raw) ?? probe?.(raw) ?? null : null
    if (!hex) complete = false
    return hex ?? fallback
  }
  const scalars = {} as Record<ScalarKey, string>
  for (const key of Object.keys(SCALAR_TOKENS) as ScalarKey[]) scalars[key] = pick(SCALAR_TOKENS[key], fb[key])
  const status = {} as Record<StageStatus, string>
  for (const key of Object.keys(STATUS_TOKENS) as StageStatus[]) status[key] = pick(STATUS_TOKENS[key], fb.status[key])
  const chart = CHART_TOKENS.map((name, i) => pick(name, fb.chart[i]))
  return { colors: { theme, ...scalars, status, chart }, complete }
}

let cache: ThemeColors | null = null

/** Цвета активной темы (кэш на тему; повторное чтение — только после смены темы). */
export function getThemeColors(theme: Theme): ThemeColors {
  if (cache?.theme === theme) return cache
  if (typeof document === 'undefined') return FALLBACK[theme]
  const style = getComputedStyle(document.documentElement)
  // Неполное чтение (стили ещё не подключены) тоже кэшируем: FALLBACK = значения токенов,
  // а стабильная ссылка не даёт пересоздавать материалы на каждом рендере.
  cache = resolveThemeColors(theme, (n) => style.getPropertyValue(n), createCanvasProbe()).colors
  return cache
}

/** Реактивные цвета темы для 3D/карты: меняются только при смене `data-theme`. */
export function useThemeColors(): ThemeColors {
  return getThemeColors(useTheme())
}
