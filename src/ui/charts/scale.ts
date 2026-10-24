/**
 * Чистая геометрия chart-системы (X1 §8, G3 1.1): линейная шкала, «круглые» деления оси,
 * компактные подписи денег/чисел, пути линий и областей, оценка ширины подписей.
 * Поднято из optimization/kit/scale.ts (там остался реэкспорт). Без DOM и React — vitest.
 */
import { money, num } from '../../explain/format'

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

/* ── Дополнения chart-системы ─────────────────────────────────────────────── */

/** Минимум и максимум конечных значений; пустой ряд → [0, 1]. */
export function extent(values: ReadonlyArray<number>): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const v of values) {
    if (!Number.isFinite(v)) continue
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  return lo <= hi ? [lo, hi] : [0, 1]
}

/**
 * Домен оси Y с полями: `includeZero` — столбцы/области растут от нуля; `pad` — доля
 * размаха сверху (и снизу, если ноль не включён). Вырожденный домен раздвигается на |lo| или 1.
 */
export function yDomain(lo: number, hi: number, includeZero: boolean, pad = 0.08): [number, number] {
  let a = includeZero ? Math.min(0, lo) : lo
  let b = includeZero ? Math.max(0, hi) : hi
  if (a === b) {
    const d = Math.abs(a) || 1
    a -= d
    b += d
  }
  const span = b - a
  b += span * pad
  if (!includeZero || a < 0) a -= span * pad
  if (includeZero && a > 0) a = 0
  return [a, b]
}

/** Деления оси Y: до `count` круглых значений внутри домена; если ни одного — границы домена. */
export function yTicks(lo: number, hi: number, count = 4): number[] {
  const t = niceTicks(lo, hi, count)
  return t.length >= 2 ? t : [lo, hi]
}

/** Шаг подписей оси X, при котором подписи не наезжают: ширина ≈ 0.6·fontPx на символ. */
export function labelStep(labels: ReadonlyArray<string>, plotW: number, fontPx = 11): number {
  const n = labels.length
  if (n <= 1) return 1
  const maxChars = labels.reduce((m, l) => Math.max(m, l.length), 0)
  // Запас 1,3: крайние подписи прижимаются к плоту и сдвигаются к соседям.
  const labelW = (maxChars * fontPx * 0.6 + 12) * 1.3
  const slot = plotW / (n - 1)
  return Math.max(1, Math.ceil(labelW / slot))
}

export interface XY { x: number; y: number }

/** Отрезки ломаной без NaN: [[точки], …] по непрерывным участкам. */
export function segments(values: ReadonlyArray<number>, xAt: (i: number) => number, yAt: (v: number) => number): XY[][] {
  const out: XY[][] = []
  let cur: XY[] = []
  values.forEach((v, i) => {
    if (Number.isFinite(v)) cur.push({ x: xAt(i), y: yAt(v) })
    else if (cur.length) { out.push(cur); cur = [] }
  })
  if (cur.length) out.push(cur)
  return out
}

/** Координата пути SVG с одним знаком («12.0», «7.5»): геометрия, не число для чтения — без ru-форматтера. */
export function svgCoord(v: number): string {
  const r = Math.round(v * 10) / 10
  return Number.isInteger(r) ? `${r === 0 ? 0 : r}.0` : String(r)
}

/** Путь SVG линии по точкам: «M x,y L x,y …»; пустой список → ''. */
export function linePath(points: ReadonlyArray<XY>): string {
  return points.map((p, i) => `${i ? 'L' : 'M'}${svgCoord(p.x)},${svgCoord(p.y)}`).join('')
}

/** Путь замкнутой области под линией до базовой линии `y0`. */
export function areaPath(points: ReadonlyArray<XY>, y0: number): string {
  if (!points.length) return ''
  const first = points[0]
  const last = points[points.length - 1]
  return `${linePath(points)}L${svgCoord(last.x)},${svgCoord(y0)}L${svgCoord(first.x)},${svgCoord(y0)}Z`
}

/** Путь полосы между верхней и нижней кривыми (веер P10–P90). */
export function bandPath(upper: ReadonlyArray<XY>, lower: ReadonlyArray<XY>): string {
  if (!upper.length || !lower.length) return ''
  const back = [...lower].reverse().map((p) => `L${svgCoord(p.x)},${svgCoord(p.y)}`).join('')
  return `${linePath(upper)}${back}Z`
}

/** Перенос подписи по словам в ≤ maxLines строк по maxChars символов; хвост — «…» только в последней строке. */
export function wrapLabel(text: string, maxChars: number, maxLines = 2): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if (next.length <= maxChars) { cur = next; continue }
    if (cur) lines.push(cur)
    cur = w.length > maxChars ? w.slice(0, maxChars - 1) + '…' : w
    if (lines.length === maxLines) break
  }
  if (cur && lines.length < maxLines) lines.push(cur)
  if (lines.length > maxLines) lines.length = maxLines
  const joined = lines.join(' ')
  if (joined.length < words.join(' ').length && lines.length === maxLines) {
    const lastLine = lines[maxLines - 1]
    lines[maxLines - 1] = lastLine.endsWith('…') ? lastLine : lastLine.slice(0, Math.max(1, maxChars - 1)) + '…'
  }
  return lines
}
