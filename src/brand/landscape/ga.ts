/**
 * Ядро заставки: многоэкстремальный ландшафт f(x, y) на [−1, 1]² и
 * вещественный генетический алгоритм (турнирный отбор, BLX-α скрещивание,
 * гауссова мутация с затуханием σ, элитизм). Чистые функции, детерминированно
 * по seed — без React/three, покрыто тестами (ga.test.ts).
 */

export type Rng = () => number

/** mulberry32 — быстрый детерминированный ГПСЧ. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Нормальная величина (Бокс — Мюллер). */
export function gauss(rng: Rng): number {
  const u = Math.max(rng(), 1e-12)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng())
}

export interface Peak { x: number; y: number; h: number; w: number }

export interface Landscape {
  peaks: Peak[]
  /** Индекс глобального максимума в peaks. */
  globalIdx: number
  /** f(x, y) ∈ [0, ~1]. */
  f: (x: number, y: number) => number
  /** Значение в глобальном максимуме (приближённо). */
  fMax: number
}

/**
 * Сумма гауссовых холмов: один глобальный (h = 1, не в центре) и несколько
 * «обманных» локальных (h 0.45–0.8), часть — широкие, чтобы притягивать популяцию.
 */
export function makeLandscape(seed: number, nLocal = 6): Landscape {
  const rng = mulberry32(seed)
  const peaks: Peak[] = []
  const r = 0.45 + rng() * 0.35
  const a = rng() * Math.PI * 2
  peaks.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, h: 1, w: 0.16 + rng() * 0.05 })
  for (let i = 0; i < nLocal; i++) {
    let x = 0
    let y = 0
    for (let tries = 0; tries < 20; tries++) {
      x = rng() * 1.7 - 0.85
      y = rng() * 1.7 - 0.85
      if (Math.hypot(x - peaks[0].x, y - peaks[0].y) > 0.45) break
    }
    peaks.push({ x, y, h: 0.45 + rng() * 0.35, w: 0.18 + rng() * 0.2 })
  }
  const f = (x: number, y: number) => {
    let s = 0
    for (const p of peaks) {
      const dx = x - p.x
      const dy = y - p.y
      s += p.h * Math.exp(-(dx * dx + dy * dy) / (2 * p.w * p.w))
    }
    return s
  }
  // Сливающиеся широкие холмы могут перерасти глобальный — понижаем их, пока не станут ≤ 82 %.
  for (let iter = 0; iter < 30; iter++) {
    const top = f(peaks[0].x, peaks[0].y)
    let fixed = true
    for (const p of peaks.slice(1)) {
      if (f(p.x, p.y) > 0.82 * top) { p.h *= 0.85; fixed = false }
    }
    if (fixed) break
  }
  return { peaks, globalIdx: 0, f, fMax: f(peaks[0].x, peaks[0].y) }
}

export interface Genome { x: number; y: number; fit: number }

export interface Generation {
  gen: number
  /** Популяция после отбора, скрещивания и мутации (оценена). */
  pop: Genome[]
  /** Для анимации: родители каждого потомка и позиция до мутации. */
  parents: Array<[number, number]>
  preMutation: Array<{ x: number; y: number }>
  mutated: boolean[]
  best: Genome
  mean: number
  sigma: number
}

export interface GaParams {
  popSize: number
  tournament: number
  blxAlpha: number
  mutationRate: number
  sigma0: number
  sigmaDecay: number
  sigmaMin: number
  elite: number
}

export const DEFAULT_GA: GaParams = {
  popSize: 48,
  tournament: 3,
  blxAlpha: 0.35,
  mutationRate: 0.35,
  sigma0: 0.55,
  sigmaDecay: 0.93,
  sigmaMin: 0.02,
  elite: 2,
}

const clamp = (v: number) => Math.max(-1, Math.min(1, v))

function evaluate(ls: Landscape, x: number, y: number): Genome {
  return { x, y, fit: ls.f(x, y) }
}

/** Начальная популяция — равномерно, но в стороне от глобального максимума (иначе нечего показывать). */
export function initPopulation(ls: Landscape, rng: Rng, n: number): Genome[] {
  const g = ls.peaks[ls.globalIdx]
  const pop: Genome[] = []
  while (pop.length < n) {
    const x = rng() * 2 - 1
    const y = rng() * 2 - 1
    if (Math.hypot(x - g.x, y - g.y) < 0.55) continue
    pop.push(evaluate(ls, x, y))
  }
  return pop
}

function tournament(pop: Genome[], rng: Rng, k: number): number {
  let best = Math.floor(rng() * pop.length)
  for (let i = 1; i < k; i++) {
    const c = Math.floor(rng() * pop.length)
    if (pop[c].fit > pop[best].fit) best = c
  }
  return best
}

function blx(a: number, b: number, alpha: number, rng: Rng): number {
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  const d = hi - lo
  return clamp(lo - alpha * d + rng() * (d * (1 + 2 * alpha)))
}

const bestOf = (pop: Genome[]) => pop.reduce((b, g) => (g.fit > b.fit ? g : b), pop[0])

/** Одно поколение ГА. Элиты переносятся без изменений → лучшее не ухудшается. */
export function step(
  ls: Landscape, rng: Rng, prev: Genome[], gen: number, sigma: number, p: GaParams = DEFAULT_GA,
): Generation {
  const sorted = [...prev].sort((a, b) => b.fit - a.fit)
  const pop: Genome[] = []
  const parents: Array<[number, number]> = []
  const preMutation: Array<{ x: number; y: number }> = []
  const mutated: boolean[] = []
  for (let i = 0; i < p.elite; i++) {
    const e = sorted[i]
    const idx = prev.indexOf(e)
    pop.push(e)
    parents.push([idx, idx])
    preMutation.push({ x: e.x, y: e.y })
    mutated.push(false)
  }
  while (pop.length < p.popSize) {
    const ia = tournament(prev, rng, p.tournament)
    const ib = tournament(prev, rng, p.tournament)
    const cx = blx(prev[ia].x, prev[ib].x, p.blxAlpha, rng)
    const cy = blx(prev[ia].y, prev[ib].y, p.blxAlpha, rng)
    const doMut = rng() < p.mutationRate
    const mx = doMut ? clamp(cx + gauss(rng) * sigma) : cx
    const my = doMut ? clamp(cy + gauss(rng) * sigma) : cy
    parents.push([ia, ib])
    preMutation.push({ x: cx, y: cy })
    mutated.push(doMut)
    pop.push(evaluate(ls, mx, my))
  }
  const mean = pop.reduce((s, g) => s + g.fit, 0) / pop.length
  return { gen, pop, parents, preMutation, mutated, best: bestOf(pop), mean, sigma }
}

/** Следующее σ: затухание; при стагнации — «встряска», чтобы выбраться из локального максимума. */
export function nextSigma(sigma: number, stagnant: number, p: GaParams = DEFAULT_GA): number {
  if (stagnant >= 4) return Math.min(p.sigma0, sigma * 2.2)
  return Math.max(p.sigmaMin, sigma * p.sigmaDecay)
}

/** Прогон целиком (для тестов и предрасчёта истории). */
export function run(seed: number, generations: number, p: GaParams = DEFAULT_GA): { ls: Landscape; history: Generation[] } {
  const ls = makeLandscape(seed)
  const rng = mulberry32(seed ^ 0x9e3779b9)
  let pop = initPopulation(ls, rng, p.popSize)
  let sigma = p.sigma0
  let best = bestOf(pop).fit
  let stagnant = 0
  const history: Generation[] = []
  for (let g = 1; g <= generations; g++) {
    const gen = step(ls, rng, pop, g, sigma, p)
    history.push(gen)
    stagnant = gen.best.fit > best + 1e-6 ? 0 : stagnant + 1
    best = Math.max(best, gen.best.fit)
    sigma = nextSigma(sigma, stagnant, p)
    pop = gen.pop
  }
  return { ls, history }
}
