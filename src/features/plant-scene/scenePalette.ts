/**
 * Палитра 3D-сцены на токенах (X1 §1 п. 4, ISA-101): земля и техника — спокойные
 * нейтрали ink→bone, растительность и «цветные» материалы — приглушённые производные
 * брендовых токенов (verdigris / ochre / cinnabar / ultramarine); насыщенность остаётся
 * только у статусных колец (`ThemeColors.status`). Материалы three.js не понимают
 * CSS-переменные, поэтому палитра строится из уже разрешённых hex-ов `ThemeColors`.
 *
 *  - `n[0…8]` — нейтральная шкала от ink до bone (сталь, бетон, асфальт, стекло, белое);
 *  - семейства `red/orange/yellow/green/teal/blue/violet` — три тона: `d` тёмный,
 *    `m` средний, `l` светлый (orange = ржавчина/дерево/кирпич, yellow = разметка и опасность);
 *  - `lawn*`, `floor`, `lamp` — именованные цвета окружения.
 * Чистая функция + кэш на объект `ThemeColors` (он стабилен на тему) — в кадре работы нет.
 */
import { useThemeColors, type ThemeColors } from './themeColors'
import type { Theme } from '../../shell/theme'

export interface Tone {
  readonly d: string
  readonly m: string
  readonly l: string
}

export interface ScenePalette {
  readonly theme: Theme
  /** Нейтральная шкала из 9 ступеней: n[0] = ink … n[8] = bone. */
  readonly n: readonly string[]
  readonly red: Tone
  readonly orange: Tone
  readonly yellow: Tone
  readonly green: Tone
  readonly teal: Tone
  readonly blue: Tone
  readonly violet: Tone
  /** Газон и его сетка (открытая территория). */
  readonly lawn: string
  readonly lawnCell: string
  readonly lawnSection: string
  /** Пол цеха ≈ --bg-elevated (X1: земля --bg-card → --bg-elevated). */
  readonly floor: string
  /** Тёплый свет ламп и окон. */
  readonly lamp: string
}

/* ── Цвет: минимум арифметики в sRGB ───────────────────────────────────────── */

type Rgb = readonly [number, number, number]
const toRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as unknown as Rgb
const toHex = (c: Rgb): string => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

/** Линейное смешение a→b (t = доля b). */
export function mix(a: string, b: string, t: number): string {
  const [x, y] = [toRgb(a), toRgb(b)]
  return toHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * t) as unknown as Rgb)
}

/** Приглушение: смешение с серым той же яркости (amount 0 — без изменений, 1 — серый). */
export function mute(hex: string, amount: number): string {
  const [r, g, b] = toRgb(hex)
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722
  return mix(hex, toHex([y, y, y]), amount)
}

/** Три тона семейства: тёмный — к ink, светлый — к bone. */
function tones(base: string, c: ThemeColors): Tone {
  return { d: mix(base, c.ink, 0.5), m: base, l: mix(base, c.bone, 0.5) }
}

/* ── Палитра ───────────────────────────────────────────────────────────────── */

function buildPalette(c: ThemeColors): ScenePalette {
  const cinnabar = c.chart[3]
  const n = Array.from({ length: 9 }, (_, i) => mix(c.ink, c.bone, i / 8))
  const rust = mix(cinnabar, c.ochre, 0.55)
  return {
    theme: c.theme,
    n,
    red: tones(mute(cinnabar, 0.4), c),
    orange: tones(mute(rust, 0.45), c),
    yellow: tones(mute(c.ochre, 0.2), c),
    green: tones(mute(mix(c.verdigris, c.status.running, 0.4), 0.5), c),
    teal: tones(mute(c.verdigris, 0.35), c),
    blue: tones(mute(c.ultramarine, 0.4), c),
    violet: tones(mute(c.chart[5], 0.35), c),
    // Газон — приглушённый verdigris, утопленный в фон: не спорит с сумеречным небом.
    lawn: mix(c.verdigris, c.bgApp, c.theme === 'dark' ? 0.8 : 0.6),
    lawnCell: mix(c.verdigris, c.bgApp, c.theme === 'dark' ? 0.72 : 0.5),
    lawnSection: mix(c.verdigris, c.bgApp, c.theme === 'dark' ? 0.62 : 0.4),
    floor: mix(c.bgPanel, c.textMuted, 0.18),
    lamp: mix(c.ochre, c.bone, 0.7),
  }
}

const cache = new WeakMap<ThemeColors, ScenePalette>()

/** Палитра сцены для цветов темы (кэш по ссылке на `ThemeColors`). */
export function scenePalette(colors: ThemeColors): ScenePalette {
  let p = cache.get(colors)
  if (!p) {
    p = buildPalette(colors)
    cache.set(colors, p)
  }
  return p
}

/** Реактивная палитра 3D-сцены: меняется только при смене темы. */
export function useScenePalette(): ScenePalette {
  return scenePalette(useThemeColors())
}

/**
 * Хук для модульных таблиц цветов («const C = {…}»): `build` вызывается один раз на палитру,
 * результат стабилен по ссылке (годится для deps useMemo).
 */
export function themed<T extends object>(build: (pal: ScenePalette) => T): () => T {
  const memo = new WeakMap<ScenePalette, T>()
  return () => {
    const pal = useScenePalette()
    let value = memo.get(pal)
    if (!value) {
      value = build(pal)
      memo.set(pal, value)
    }
    return value
  }
}
