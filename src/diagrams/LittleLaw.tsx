/**
 * Закон Литтла L = λ·W (Little 1961) на кумулятивной диаграмме потока:
 * A(t) — число поступивших заказов, D(t) — завершённых. Вертикальное расстояние —
 * задел L(t), горизонтальное — время потока W_j, площадь между кривыми — Σ W_j.
 * На окне, которое начинается и заканчивается пустой системой, L̄ = λ·W̄ — тождество
 * (так считаются wip, orders_per_day и flow time в MAOS).
 */
import type { DiagramProps } from './types'
import { C, S1, S2, Arrow, Frame, Label, fmt, grainInDisc, lin, rng } from './primitives'

interface Order { a: number; d: number }
const ORDERS: Order[] = (() => {
  const r = rng(61)
  const out: Order[] = []
  let t = 0
  let lastD = 0
  for (let i = 0; i < 14; i++) {
    t += 0.6 + 2.4 * r()
    const d = Math.max(t + 5 + 5 * r(), lastD + 0.6)
    lastD = d
    out.push({ a: t, d })
  }
  return out
})()
const T_END = ORDERS[ORDERS.length - 1].d
const AREA = ORDERS.reduce((s, o) => s + (o.d - o.a), 0)
const LAMBDA = ORDERS.length / T_END
const W_BAR = AREA / ORDERS.length
const L_BAR = AREA / T_END

/** Ступенчатая кривая числа событий к моменту t. */
function steps(times: number[], x: (t: number) => number, y: (n: number) => number, tEnd: number): string {
  let d = `M${x(0)},${y(0)}`
  times.forEach((t, i) => { d += ` H${x(t).toFixed(1)} V${y(i + 1).toFixed(1)}` })
  return d + ` H${x(tEnd).toFixed(1)}`
}

const TITLE = 'Закон Литтла: задел = темп × время потока'
const DESC =
  `Кумулятивные поступления A(t) и выпуски D(t) ${ORDERS.length} заказов. Площадь между кривыми — суммарное время потока. ` +
  `Средний задел ${fmt(L_BAR)} заказа = темп ${fmt(LAMBDA, 2)} заказа/ч × среднее время потока ${fmt(W_BAR)} ч.`

export function LittleLaw({ compact }: DiagramProps) {
  const g = compact
    ? { x0: 20, x1: 270, y0: 128, y1: 14, fs: 9.5 }
    : { x0: 56, x1: 384, y0: 268, y1: 40, fs: 11 }
  const x = lin(0, T_END, g.x0, g.x1)
  const y = lin(0, ORDERS.length, g.y0, g.y1)
  const arr = ORDERS.map((o) => o.a)
  const dep = ORDERS.map((o) => o.d)
  const aPath = steps(arr, x, y, T_END)
  const dPath = steps(dep, x, y, T_END)
  // Площадь: вверх по A(t), обратно по D(t).
  const backD = [...dep].reverse().reduce((s, t, i) => s + ` V${y(dep.length - i).toFixed(1)} H${x(t).toFixed(1)}`, `L${x(T_END)},${y(ORDERS.length)}`)
  const area = `${aPath} ${backD} V${y(0)} Z`
  const j = 6
  const tL = ORDERS[8].a + 0.3
  const nA = arr.filter((t) => t <= tL).length
  const nD = dep.filter((t) => t <= tL).length

  return (
    <Frame compact={compact} title={TITLE} desc={DESC}>
      <path d={area} fill={C.model} fillOpacity={0.14} />
      <path d={aPath} fill="none" stroke={C.ink} strokeWidth={S1} />
      <path d={dPath} fill="none" stroke={C.model} strokeWidth={S2} />
      <line x1={g.x0} y1={g.y0} x2={g.x1} y2={g.y0} stroke={C.line} />
      <line x1={g.x0} y1={g.y0} x2={g.x0} y2={g.y1} stroke={C.line} />

      {/* W_j — горизонтально, L(t) — вертикально */}
      <Arrow x1={x(ORDERS[j].a)} y1={y(j + 0.5)} x2={x(ORDERS[j].d)} y2={y(j + 0.5)} color={C.goal} width={S1} head={compact ? 5 : 7} />
      <Arrow x1={x(tL)} y1={y(nD)} x2={x(tL)} y2={y(nA)} color={C.goal} width={S1} head={compact ? 5 : 7} />
      <Label x={(x(ORDERS[j].a) + x(ORDERS[j].d)) / 2} y={y(j + 0.5) - 4} size={g.fs} anchor="middle" color={C.ink}>{'W_{j}'}</Label>
      <Label x={x(tL) + 5} y={(y(nD) + y(nA)) / 2 + 4} size={g.fs} color={C.ink}>L(t)</Label>
      <Label x={x(ORDERS[3].a) - 6} y={y(4) - 2} size={g.fs} anchor="end" color={C.ink}>A(t)</Label>
      <Label x={x(ORDERS[11].d) + 6} y={y(11) + 12} size={g.fs} color={C.ink}>D(t)</Label>

      {compact ? (
        <Label x={g.x0 + 6} y={g.y1 + 8} size={11} mono color={C.ink} weight={600}>L = λ·W</Label>
      ) : (
        <g>
          <Label x={g.x1} y={g.y0 + 18} size={10.5} anchor="end">время t, ч</Label>
          <Label x={g.x0 - 30} y={(g.y0 + g.y1) / 2} size={10.5} anchor="middle" rotate={-90}>заказов (накопленно)</Label>
          <Label x={g.x0 + 8} y={g.y1 + 4} size={10.5}>{'площадь = Σ W_{j}'}</Label>

          {/* Система ● с заделом внутри */}
          <circle cx={516} cy={112} r={52} fill={C.model} fillOpacity={0.07} stroke={C.model} strokeWidth={S2} />
          {grainInDisc(516, 112, 34, Math.round(L_BAR), 4).map(([px, py], i) => (
            <rect key={i} x={px - 4} y={py - 4} width={8} height={8} fill={C.bone} opacity={0.85} />
          ))}
          <Arrow x1={418} y1={112} x2={462} y2={112} width={S2} head={9} />
          <Arrow x1={570} y1={112} x2={616} y2={112} width={S2} head={9} />
          <Label x={440} y={102} size={11} anchor="middle" color={C.ink}>λ</Label>
          <Label x={593} y={102} size={11} anchor="middle" color={C.ink}>λ</Label>
          <Label x={516} y={184} size={11} anchor="middle">задел L внутри системы</Label>
          <Label x={516} y={220} size={20} anchor="middle" mono color={C.ink} weight={600}>L = λ · W</Label>
          <Label x={428} y={248} size={10.5} mono color={C.ink}>{`L̄ = Σ W_{j} / T = ${fmt(L_BAR, 2)} заказа`}</Label>
          <Label x={428} y={266} size={10.5} mono color={C.ink}>{`λ = n / T = ${fmt(LAMBDA, 3)} заказа/ч`}</Label>
          <Label x={428} y={284} size={10.5} mono color={C.ink}>{`W̄ = Σ W_{j} / n = ${fmt(W_BAR, 2)} ч`}</Label>
          <Label x={428} y={304} size={10.5} mono color={C.ink}>{`λ·W̄ = ${fmt(LAMBDA * W_BAR, 2)} = L̄ ✓`}</Label>
        </g>
      )}
    </Frame>
  )
}
