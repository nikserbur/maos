/**
 * Общие примитивы схем: рамка SVG с <title>/<desc>, подписи с индексами,
 * стрелки с острыми ▲-наконечниками, фигуры словаря (● ■ ▲ ·), скобки,
 * детерминированный ГПСЧ для «зерна» и облаков точек, раскладка beeswarm.
 *
 * Грамматика (A6 §6): ● система, ■ ресурс, ▲ цель/решение, · событие;
 * сплошная — материальный поток, пунктир — информация/обратная связь.
 */
import { useId, type ReactNode } from 'react'
import './diagrams.css'

/** Семантические цвета → CSS-переменные (см. diagrams.css). */
export const C = {
  model: 'var(--dg-model)',
  goal: 'var(--dg-goal)',
  risk: 'var(--dg-risk)',
  ok: 'var(--dg-ok)',
  ink: 'var(--dg-ink)',
  muted: 'var(--dg-muted)',
  line: 'var(--dg-line)',
  grid: 'var(--dg-grid)',
  bone: 'var(--dg-bone)',
  ground: 'var(--dg-ground)',
} as const

export const FULL = { w: 640, h: 320 } as const
export const COMPACT = { w: 280, h: 140 } as const
/** Пунктир «информация / обратная связь» (период 7 — под анимацию dg-dash). */
export const DASH = '4 3'
/** Толщины линий грамматики: тонкая и силовая. */
export const S1 = 1.5
export const S2 = 3

interface FrameProps {
  compact?: boolean
  title: string
  desc: string
  children: ReactNode
}

/** Корневой SVG схемы: viewBox по режиму, role="img", доступные <title>/<desc>. */
export function Frame({ compact, title, desc, children }: FrameProps) {
  const uid = useId().replace(/:/g, '')
  const { w, h } = compact ? COMPACT : FULL
  return (
    <svg
      className={compact ? 'dg dg--compact' : 'dg dg--full'}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-labelledby={`${uid}-t ${uid}-d`}
    >
      <title id={`${uid}-t`}>{title}</title>
      <desc id={`${uid}-d`}>{desc}</desc>
      {children}
    </svg>
  )
}

/* ── Текст ───────────────────────────────────────────────────────────────── */

/** Разбор мини-разметки `x_{i}` / `x^{2}` в tspan со сдвигом базовой линии. */
function rich(s: string, size: number): ReactNode {
  if (!/[_^]\{/.test(s)) return s
  const out: ReactNode[] = []
  const re = /([_^])\{([^}]*)\}/g
  let last = 0
  let shift = 0
  let key = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) {
      out.push(<tspan key={key++} dy={shift ? -shift : undefined}>{s.slice(last, m.index)}</tspan>)
      shift = 0
    }
    const d = m[1] === '_' ? size * 0.32 : -size * 0.42
    out.push(<tspan key={key++} dy={d - shift} fontSize={size * 0.72}>{m[2]}</tspan>)
    shift = d
    last = re.lastIndex
  }
  if (last < s.length) out.push(<tspan key={key++} dy={shift ? -shift : undefined}>{s.slice(last)}</tspan>)
  return out
}

interface LabelProps {
  x: number
  y: number
  children: string
  size?: number
  anchor?: 'start' | 'middle' | 'end'
  color?: string
  weight?: number
  mono?: boolean
  rotate?: number
}

export function Label({ x, y, children, size = 11, anchor = 'start', color = C.muted, weight, mono, rotate }: LabelProps) {
  return (
    <text
      x={x}
      y={y}
      fontSize={size}
      fill={color}
      textAnchor={anchor}
      fontWeight={weight}
      className={mono ? 'dg-mono' : undefined}
      transform={rotate ? `rotate(${rotate} ${x} ${y})` : undefined}
    >
      {rich(children, size)}
    </text>
  )
}

/* ── Линии и стрелки ─────────────────────────────────────────────────────── */

interface ArrowProps {
  x1: number
  y1: number
  x2: number
  y2: number
  color?: string
  width?: number
  dashed?: boolean
  head?: number
  flow?: boolean
  opacity?: number
}

/** Острый ▲-наконечник (вершина ≈40°, как у ▲ логотипа). */
function headPoints(x2: number, y2: number, a: number, head: number): { pts: string; bx: number; by: number } {
  const bx = x2 - head * Math.cos(a)
  const by = y2 - head * Math.sin(a)
  const nx = -Math.sin(a) * head * 0.36
  const ny = Math.cos(a) * head * 0.36
  return { pts: `${x2},${y2} ${bx + nx},${by + ny} ${bx - nx},${by - ny}`, bx, by }
}

export function Arrow({ x1, y1, x2, y2, color = C.ink, width = S1, dashed, head = 7, flow, opacity }: ArrowProps) {
  const a = Math.atan2(y2 - y1, x2 - x1)
  const h = headPoints(x2, y2, a, head)
  return (
    <g opacity={opacity}>
      <line
        x1={x1} y1={y1} x2={h.bx} y2={h.by}
        stroke={color} strokeWidth={width}
        strokeDasharray={dashed ? DASH : undefined}
        className={flow ? 'dg-flow' : undefined}
      />
      <polygon points={h.pts} fill={color} />
    </g>
  )
}

interface CurveProps {
  from: [number, number]
  ctrl: [number, number]
  to: [number, number]
  color?: string
  width?: number
  dashed?: boolean
  head?: number
  flow?: boolean
}

/** Квадратичная кривая со стрелкой; направление наконечника — по касательной ctrl→to. */
export function CurveArrow({ from, ctrl, to, color = C.ink, width = S1, dashed, head = 7, flow }: CurveProps) {
  const a = Math.atan2(to[1] - ctrl[1], to[0] - ctrl[0])
  const h = headPoints(to[0], to[1], a, head)
  return (
    <g>
      <path
        d={`M${from[0]},${from[1]} Q${ctrl[0]},${ctrl[1]} ${h.bx},${h.by}`}
        fill="none" stroke={color} strokeWidth={width}
        strokeDasharray={dashed ? DASH : undefined}
        className={flow ? 'dg-flow' : undefined}
      />
      <polygon points={h.pts} fill={color} />
    </g>
  )
}

interface BracketProps {
  x1: number
  x2: number
  y: number
  color?: string
  /** Направление «зубцов»: вверх (к измеряемым объектам) или вниз. */
  up?: boolean
  tick?: number
}

/** Горизонтальная скобка-размер между x1 и x2. */
export function Bracket({ x1, x2, y, color = C.ink, up = true, tick = 5 }: BracketProps) {
  const t = up ? -tick : tick
  return (
    <path d={`M${x1},${y + t} V${y} H${x2} V${y + t}`} fill="none" stroke={color} strokeWidth={1.2} />
  )
}

/* ── Фигуры словаря ──────────────────────────────────────────────────────── */

/** ▲ — цель/решение: острый треугольник вершиной вверх. */
export function triPoints(cx: number, cy: number, w: number, h: number): string {
  return `${cx},${cy - h / 2} ${cx + w / 2},${cy + h / 2} ${cx - w / 2},${cy + h / 2}`
}

/** Полилиния → path d. */
export function pathOf(pts: ReadonlyArray<readonly [number, number]>): string {
  return pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
}

/** Линейная шкала. */
export function lin(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const k = (r1 - r0) / (d1 - d0 || 1)
  return (v) => r0 + (v - d0) * k
}

/* ── Детерминированная стохастика ────────────────────────────────────────── */

/** mulberry32: воспроизводимый ГПСЧ (никакого Math.random при рендере). */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Стандартная нормальная величина (Бокс–Мюллер). */
export function gauss(r: () => number): number {
  const u = Math.max(1e-12, r())
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r())
}

export type Pt = readonly [number, number]

/** Равномерное «зерно» внутри треугольника ▲ (барицентрически). */
export function grainInTriangle(cx: number, cy: number, w: number, h: number, n: number, seed: number): Pt[] {
  const r = rng(seed)
  const A: Pt = [cx, cy - h / 2]
  const B: Pt = [cx + w / 2, cy + h / 2]
  const D: Pt = [cx - w / 2, cy + h / 2]
  const out: Pt[] = []
  for (let i = 0; i < n; i++) {
    let u = r()
    let v = r()
    if (u + v > 1) { u = 1 - u; v = 1 - v }
    out.push([A[0] + u * (B[0] - A[0]) + v * (D[0] - A[0]), A[1] + u * (B[1] - A[1]) + v * (D[1] - A[1])])
  }
  return out
}

/** Равномерное «зерно» внутри круга ●. */
export function grainInDisc(cx: number, cy: number, R: number, n: number, seed: number): Pt[] {
  const r = rng(seed)
  return Array.from({ length: n }, () => {
    const rad = R * Math.sqrt(r())
    const a = 2 * Math.PI * r()
    return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)] as const
  })
}

/**
 * Точечная диаграмма Уилкинсона / beeswarm: значения квантуются по x
 * (шаг = диаметр точки) и укладываются симметрично вверх-вниз от оси cy.
 */
export function beeswarm(values: readonly number[], x: (v: number) => number, cy: number, r: number): Pt[] {
  const step = 2 * r + 0.4
  const stacks = new Map<number, number>()
  return values.map((v) => {
    const px = x(v)
    const bin = Math.round(px / step)
    const k = stacks.get(bin) ?? 0
    stacks.set(bin, k + 1)
    const level = Math.ceil(k / 2) * (k % 2 === 1 ? -1 : 1)
    return [bin * step, cy + level * step] as const
  })
}

/** Выборочное среднее. */
export function mean(v: readonly number[]): number {
  return v.reduce((s, x) => s + x, 0) / Math.max(1, v.length)
}

/** Эмпирические VaR/CVaR нижнего хвоста (как metrics_of в Optimizer.cpp). */
export function lowerTail(v: readonly number[], alpha: number): { sorted: number[]; k: number; varA: number; cvar: number } {
  const sorted = [...v].sort((a, b) => a - b)
  const k = Math.max(1, Math.floor(alpha * sorted.length))
  return { sorted, k, varA: sorted[k - 1], cvar: mean(sorted.slice(0, k)) }
}

/** Формат числа для подписей: ru-RU, минус U+2212. */
export function fmt(v: number, digits = 1): string {
  const s = Math.abs(v).toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  return v < 0 ? `−${s}` : s
}
