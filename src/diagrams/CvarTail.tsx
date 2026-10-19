/**
 * D2 «CVaR = среднее худших α» (A6 §6): beeswarm N = 200 исходов прибыли,
 * линия VaR_α, закрашенный хвост худших α, «стягивающийся» в ● CVaR; ● E;
 * скобка w_risk·(E − CVaR) — штраф за риск в критерии «среднее − риск».
 * Оценки — как metrics_of (Optimizer.cpp): k = ⌊αN⌋, VaR = P_(k), CVaR = ср. P_(1..k).
 */
import type { DiagramProps } from './types'
import {
  C, S1, Bracket, Frame, Label, beeswarm, fmt, gauss, lin, lowerTail, mean, rng,
} from './primitives'

const N = 200
const ALPHA = 0.1

/** Прибыль за горизонт, млн ₽: «нормальное» тело + редкие рыночные шоки (левый хвост). */
const OUTCOMES: number[] = (() => {
  const r = rng(2026)
  return Array.from({ length: N }, () => {
    const base = 7 + 2.6 * gauss(r)
    return r() < 0.14 ? base - (4 + 6 * r()) : base
  })
})()
const TAIL = lowerTail(OUTCOMES, ALPHA)
const E = mean(OUTCOMES)
const LO = Math.floor(TAIL.sorted[0]) - 1
const HI = Math.ceil(TAIL.sorted[N - 1]) + 1

interface Geo {
  x0: number; x1: number; cy: number; r: number; top: number; bottom: number
  markY: number; markR: number; brY: number; axisY: number | null; fs: number
}
const G_FULL: Geo = { x0: 48, x1: 608, cy: 128, r: 2.6, top: 56, bottom: 184, markY: 204, markR: 6.5, brY: 222, axisY: 262, fs: 11 }
const G_COMPACT: Geo = { x0: 14, x1: 266, cy: 56, r: 1.7, top: 20, bottom: 90, markY: 100, markR: 4.5, brY: 112, axisY: null, fs: 9.5 }

const TITLE = 'CVaR — среднее худших α исходов'
const DESC =
  `Точечная диаграмма ${N} прогонов Монте-Карло прибыли. Левее линии VaR закрашен хвост худших ` +
  `${ALPHA * 100} % исходов; их среднее — CVaR (${fmt(TAIL.cvar)} млн ₽), среднее всех — E (${fmt(E)} млн ₽). ` +
  'Разность E − CVaR, умноженная на вес риска, — штраф за риск в целевой функции.'

export function CvarTail({ compact }: DiagramProps) {
  const g = compact ? G_COMPACT : G_FULL
  const x = lin(LO, HI, g.x0, g.x1)
  const pts = beeswarm(TAIL.sorted, x, g.cy, g.r)
  const xVar = x(TAIL.varA) + g.r
  const xCvar = x(TAIL.cvar)
  const xE = x(E)
  const ticks = compact ? [] : Array.from({ length: Math.floor(HI / 5) - Math.ceil(LO / 5) + 1 }, (_, i) => (Math.ceil(LO / 5) + i) * 5)

  return (
    <Frame compact={compact} title={TITLE} desc={DESC}>
      {/* Хвост худших α — единственная акцентная область */}
      <rect x={g.x0 - 8} y={g.top} width={xVar - g.x0 + 8} height={g.bottom - g.top} fill={C.risk} fillOpacity={0.15} />
      {/* Стягивание хвоста к его среднему */}
      {pts.slice(0, TAIL.k).map(([px, py], i) => i % 2 === 0 && (
        <line key={`l${i}`} x1={px} y1={py} x2={xCvar} y2={g.markY} stroke={C.risk} strokeWidth={0.8} opacity={0.3} />
      ))}
      {pts.map(([px, py], i) => (
        <circle key={i} cx={px} cy={py} r={g.r} fill={i < TAIL.k ? C.risk : C.bone} opacity={i < TAIL.k ? 1 : 0.75} />
      ))}
      {/* VaR */}
      <line x1={xVar} y1={g.top - 6} x2={xVar} y2={g.bottom} stroke={C.ink} strokeWidth={S1} />
      <Label x={xVar + 4} y={g.top - (compact ? 8 : 4)} size={g.fs} color={C.ink}>
        {compact ? 'VaR' : `VaR_{0,1} = ${fmt(TAIL.varA)}`}
      </Label>
      <Label x={g.x0 - 4} y={g.top + (compact ? 10 : 14)} size={g.fs} color={C.ink}>
        {compact ? 'α = 10 %' : 'худшие α = 10 %'}
      </Label>

      {/* ● CVaR и ● E */}
      <circle cx={xCvar} cy={g.markY} r={g.markR} fill={C.risk} />
      <circle cx={xE} cy={g.markY} r={g.markR} fill={C.model} />
      <Label x={xCvar - g.markR - 5} y={g.markY + 4} size={g.fs} anchor="end" color={C.ink}>
        {compact ? 'CVaR' : `CVaR = ${fmt(TAIL.cvar)}`}
      </Label>
      <Label x={xE + g.markR + 5} y={g.markY + 4} size={g.fs} color={C.ink}>
        {compact ? 'E' : `E = ${fmt(E)}`}
      </Label>
      <Bracket x1={xCvar} x2={xE} y={g.brY} up />
      <Label x={(xCvar + xE) / 2} y={g.brY + (compact ? 14 : 17)} anchor="middle" size={g.fs} mono color={C.ink}>
        {'w_{risk}·(E − CVaR)'}
      </Label>

      {g.axisY !== null && (
        <g>
          <line x1={g.x0 - 8} y1={g.axisY} x2={g.x1 + 8} y2={g.axisY} stroke={C.line} strokeWidth={1} />
          {LO < 0 && HI > 0 && (
            <line x1={x(0)} y1={g.top} x2={x(0)} y2={g.axisY} stroke={C.muted} strokeWidth={1} strokeDasharray="2 3" />
          )}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x(t)} y1={g.axisY} x2={x(t)} y2={g.axisY + 4} stroke={C.line} />
              <Label x={x(t)} y={g.axisY + 16} anchor="middle" size={10}>{fmt(t, 0)}</Label>
            </g>
          ))}
          <Label x={g.x1 + 8} y={g.axisY + 34} anchor="end" size={10.5}>прибыль за горизонт, млн ₽</Label>
          <Label x={g.x1 + 8} y={g.top - 10} anchor="end" size={10.5}>{`N = ${N} прогонов`}</Label>
        </g>
      )}
    </Frame>
  )
}
