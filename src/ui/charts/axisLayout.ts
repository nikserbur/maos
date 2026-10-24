/**
 * Раскладка подписей оси X без наездов (X1 §6.3 п. 2: «10-22 18:35-22 19:46»).
 * Ширина подписи — по числу символов моно-шрифта делений (JetBrains Mono 11 px ≈ 6,7 px/символ),
 * между соседями — зазор. Первая и последняя подписи сохраняются всегда; наезжающая на
 * предыдущую — пропускается; если жадный проход выкинул больше ~40 % подписей, берётся
 * равномерный шаг (каждая k-я), чтобы расстояния читались как регулярные.
 * `priority` — подписи, которые не выкидываются никогда («сейчас» у веера — граница факта и
 * прогноза): они кладутся первыми, крайние и остальные — только если не мешают им. Без DOM — vitest.
 */

/** Ширина символа моно-шрифта делений, px (JetBrains Mono 11 px). */
export const TICK_CHAR_W = 6.7
/** Минимальный зазор между соседними подписями, px. */
export const TICK_GAP = 12
/** Доля пропущенных подписей, после которой жадная раскладка заменяется равномерным шагом. */
const DROP_LIMIT = 0.4

export interface PlacedLabel {
  /** Индекс подписи в исходном массиве. */
  i: number
  /** Центр подписи по X (после прижатия к краям плота). */
  tx: number
  /** Половина ширины подписи, px. */
  half: number
}

/** Центр подписи: по делению, но целиком внутри [x0, x1] (у краёв прижимается к плоту). */
function centerOf(x: number, half: number, x0: number, x1: number): number {
  if (x1 - x0 <= half * 2) return (x0 + x1) / 2
  return Math.max(x0 + half, Math.min(x1 - half, x))
}

/**
 * Жадный проход по кандидатам: первый кладётся всегда, последний — всегда и ему резервируется
 * место (кандидат, который налезет на последний, пропускается).
 */
function greedy(cands: ReadonlyArray<PlacedLabel>, gap: number): PlacedLabel[] {
  if (cands.length === 0) return []
  if (cands.length === 1) return [cands[0]]
  const last = cands[cands.length - 1]
  const out: PlacedLabel[] = [cands[0]]
  let right = cands[0].tx + cands[0].half
  for (let k = 1; k < cands.length - 1; k++) {
    const c = cands[k]
    if (c.tx - c.half < right + gap) continue
    if (c.tx + c.half + gap > last.tx - last.half) continue
    out.push(c)
    right = c.tx + c.half
  }
  out.push(last)
  return out
}

/**
 * Раскладка с обязательными подписями: сначала обязательные (по порядку, без наездов между собой),
 * затем крайние, затем остальные слева направо — каждая только если не задевает уже положенные.
 */
function withPriority(cands: ReadonlyArray<PlacedLabel>, must: ReadonlySet<number>, gap: number): PlacedLabel[] {
  const out: PlacedLabel[] = []
  const fits = (c: PlacedLabel) => out.every((p) => !overlaps(p, c, gap))
  const first = cands[0]
  const last = cands[cands.length - 1]
  const order = [
    ...cands.filter((c) => must.has(c.i)),
    ...[first, last].filter((c) => !must.has(c.i)),
    ...cands.slice(1, -1).filter((c) => !must.has(c.i)),
  ]
  for (const c of order) if (!out.includes(c) && fits(c)) out.push(c)
  return out.sort((a, b) => a.tx - b.tx)
}

/**
 * Какие подписи показать и где: `labels[i]` стоит над `xs[i]`; результат — без пересечений.
 * `step` — предварительное прореживание вызывающего кода (каждая step-я и последняя).
 * `priority` — индексы подписей, которые остаются всегда (крайние уступают им место).
 */
export function placeXLabels(
  labels: ReadonlyArray<string>,
  xs: ReadonlyArray<number>,
  x0: number,
  x1: number,
  charW = TICK_CHAR_W,
  gap = TICK_GAP,
  step = 1,
  priority: ReadonlyArray<number> = [],
): PlacedLabel[] {
  const n = Math.min(labels.length, xs.length)
  if (n === 0) return []
  const at = (i: number): PlacedLabel => {
    const half = (labels[i].length * charW) / 2
    return { i, tx: centerOf(xs[i], half, x0, x1), half }
  }
  const must = new Set(priority.filter((i) => Number.isInteger(i) && i >= 0 && i < n))
  const stepped: PlacedLabel[] = []
  for (let i = 0; i < n; i++) if (i % Math.max(1, step) === 0 || i === n - 1 || must.has(i)) stepped.push(at(i))
  if (must.size > 0) return withPriority(stepped, must, gap)

  const best = greedy(stepped, gap)
  const dropped = stepped.length - best.length
  if (stepped.length < 3 || dropped / stepped.length <= DROP_LIMIT) return best

  // Много выкинуто → равномерный шаг: наименьшее k, при котором ни один кандидат не пропущен.
  for (let k = 2; k < stepped.length; k++) {
    const cands = stepped.filter((_, j) => j % k === 0 || j === stepped.length - 1)
    const placed = greedy(cands, gap)
    if (placed.length === cands.length) return placed
  }
  return best
}

/** Пересекаются ли две размещённые подписи с учётом зазора (для тестов и отладки). */
export function overlaps(a: PlacedLabel, b: PlacedLabel, gap = TICK_GAP): boolean {
  const [l, r] = a.tx <= b.tx ? [a, b] : [b, a]
  return r.tx - r.half < l.tx + l.half + gap
}
