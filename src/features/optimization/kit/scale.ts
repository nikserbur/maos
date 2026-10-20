/**
 * Чистая геометрия графиков экранов «Оптимизация», «Сценарии», «Прогноз»:
 * линейная шкала, «круглые» деления оси, подписи денег без знака ₽.
 * Без DOM и React — покрыто vitest (scale.test.ts).
 */
import { money, num } from '../../../explain/format'

/** Линейное отображение [d0, d1] → [r0, r1]; вырожденный домен → середина диапазона. */
export function linear(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const span = d1 - d0
  if (!Number.isFinite(span) || span === 0) return () => (r0 + r1) / 2
  const k = (r1 - r0) / span
  return (v: number) => r0 + (v - d0) * k
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** Шаг 1·10ⁿ, 2·10ⁿ или 5·10ⁿ, ближайший к span/count (как d3.tickIncrement). */
function niceStep(span: number, count: number): number {
  const raw = span / Math.max(1, count)
  const pow = 10 ** Math.floor(Math.log10(raw))
  const f = raw / pow
  const nice = f >= Math.SQRT2 * 5 ? 10 : f >= Math.sqrt(10) ? 5 : f >= Math.SQRT2 ? 2 : 1
  return nice * pow
}

/**
 * «Круглые» деления внутри [lo, hi] (включая концы, если они кратны шагу).
 * niceTicks(-1.3e6, 4.1e6, 5) → [-1e6, 0, 1e6, 2e6, 3e6, 4e6].
 */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return []
  if (lo === hi) return [lo]
  const a = Math.min(lo, hi)
  const b = Math.max(lo, hi)
  const step = niceStep(b - a, count)
  const first = Math.ceil(a / step - 1e-9) * step
  const out: number[] = []
  for (let v = first; v <= b + step * 1e-9 && out.length < 50; v += step) {
    // Гасим двоичный «шум» (0.30000000000000004) и отрицательный ноль.
    const r = Math.round(v / step) * step
    out.push(Object.is(r, -0) ? 0 : Number(r.toPrecision(12)))
  }
  return out
}

const RUB_TAIL = / ₽$/

/** Деньги для подписей оси: «−1,2 млн» (единица — в подписи оси). */
export function axisMoney(v: number): string {
  return money(v).replace(RUB_TAIL, '')
}

/** Короткое число для оси цены: 12 400 → «12,4 тыс.», 86 → «86». */
export function axisNum(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e6) return axisMoney(v)
  if (a >= 1e4) return axisMoney(v)
  return num(v)
}

/** Нижний α-хвост выборки по гистограмме: доля прогонов левее порога x. */
export function shareBelow(bins: ReadonlyArray<{ x0: number; x1: number; count: number }>, x: number): number {
  let total = 0
  let below = 0
  for (const b of bins) {
    total += b.count
    if (b.x1 <= x) below += b.count
    else if (b.x0 < x) below += (b.count * (x - b.x0)) / Math.max(1e-12, b.x1 - b.x0)
  }
  return total > 0 ? below / total : 0
}

/** Индекс ближайшей точки (в пикселях) к курсору; −1, если список пуст. */
export function nearestIndex(points: ReadonlyArray<{ x: number; y: number }>, px: number, py: number): number {
  let best = -1
  let bestD = Infinity
  points.forEach((p, i) => {
    const d = (p.x - px) ** 2 + (p.y - py) ** 2
    if (d < bestD) {
      bestD = d
      best = i
    }
  })
  return best
}

/** id для <defs>, пригодный для url(#…): useId() даёт «:r1:», двоеточия ломают ссылку. */
export function svgId(reactId: string, suffix: string): string {
  return `${reactId.replace(/[^A-Za-z0-9_-]/g, '')}-${suffix}`
}
