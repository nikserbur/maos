/**
 * «Цена робастности» (Bertsimas & Sim 2004): плотности прибыли портфеля
 * max E (пунктир) и робастного max CVaR_α (сплошная). Стрелки: −ΔE — сколько
 * ожидаемой прибыли отдаём; +ΔCVaR — насколько лучше средний худший исход.
 * Плотности — аналитические смеси нормальных; квантили и CVaR интегрируются численно.
 */
import type { DiagramProps } from './types'
import { C, S1, S2, Arrow, Frame, Label, fmt, lin, pathOf } from './primitives'

type Mix = ReadonlyArray<readonly [w: number, mu: number, sd: number]>

/** Портфель max E: выше среднее, но тяжёлый левый хвост (концентрация). */
const MAX_E: Mix = [[0.82, 11.5, 3.0], [0.18, 3.0, 4.2]]
/** Робастный: ниже среднее, тоньше хвост (диверсификация). */
const ROBUST: Mix = [[0.92, 9.4, 2.2], [0.08, 5.5, 2.5]]
const ALPHA = 0.1
const LO = -8
const HI = 22
const STEP = 0.05

function pdf(m: Mix, v: number): number {
  return m.reduce((s, [w, mu, sd]) => s + (w * Math.exp(-0.5 * ((v - mu) / sd) ** 2)) / (sd * Math.sqrt(2 * Math.PI)), 0)
}

interface Stats { grid: Array<[number, number]>; mean: number; varA: number; cvar: number; peak: number }

function stats(m: Mix): Stats {
  const grid: Array<[number, number]> = []
  let cdf = 0
  let tailSum = 0
  let varA = LO
  let reached = false
  for (let v = LO; v <= HI; v += STEP) {
    const f = pdf(m, v)
    grid.push([v, f])
    if (!reached) {
      cdf += f * STEP
      tailSum += v * f * STEP
      if (cdf >= ALPHA) { reached = true; varA = v }
    }
  }
  return {
    grid,
    mean: m.reduce((s, [w, mu]) => s + w * mu, 0),
    varA,
    cvar: tailSum / ALPHA,
    peak: Math.max(...grid.map(([, f]) => f)),
  }
}

const SE = stats(MAX_E)
const SR = stats(ROBUST)
const PEAK = Math.max(SE.peak, SR.peak)

const TITLE = 'Цена робастности: −ΔE ради +ΔCVaR'
const DESC =
  `Портфель max E: среднее ${fmt(SE.mean)} млн ₽, CVaR ${fmt(SE.cvar)}. Робастный: среднее ${fmt(SR.mean)}, ` +
  `CVaR ${fmt(SR.cvar)}. Цена робастности ΔE = ${fmt(SE.mean - SR.mean)} млн ₽; ` +
  `выигрыш в среднем худшем исходе ΔCVaR = ${fmt(SR.cvar - SE.cvar)} млн ₽.`

export function PriceOfRobustness({ compact }: DiagramProps) {
  const g = compact
    ? { x0: 12, x1: 268, base: 100, h: 66, fs: 9.5, eY: 20, cY: 118 }
    : { x0: 40, x1: 610, base: 232, h: 150, fs: 11, eY: 50, cY: 270 }
  const x = lin(LO, HI, g.x0, g.x1)
  const y = (f: number) => g.base - (f / PEAK) * g.h
  const curve = (s: Stats) => pathOf(s.grid.map(([v, f]) => [x(v), y(f)] as const))
  const tail = SE.grid.filter(([v]) => v <= SE.varA).map(([v, f]) => [x(v), y(f)] as const)
  const tailArea = `${pathOf(tail)} L${x(SE.varA).toFixed(1)},${g.base} L${x(LO).toFixed(1)},${g.base} Z`

  return (
    <Frame compact={compact} title={TITLE} desc={DESC}>
      {/* Хвост портфеля max E, который «срезает» робастное решение — акцент */}
      <path d={tailArea} fill={C.risk} fillOpacity={0.18} />
      <path d={`${curve(SR)} L${g.x1},${g.base} L${g.x0},${g.base} Z`} fill={C.model} fillOpacity={0.1} />
      <path d={curve(SE)} fill="none" stroke={C.ink} strokeWidth={S1} strokeDasharray="5 3" />
      <path d={curve(SR)} fill="none" stroke={C.model} strokeWidth={S2} />
      <line x1={g.x0} y1={g.base} x2={g.x1} y2={g.base} stroke={C.line} />

      {/* Средние: ○ max E, ● робастный; −ΔE */}
      <line x1={x(SE.mean)} y1={g.base} x2={x(SE.mean)} y2={g.eY} stroke={C.muted} strokeDasharray="2 3" />
      <line x1={x(SR.mean)} y1={g.base} x2={x(SR.mean)} y2={g.eY} stroke={C.muted} strokeDasharray="2 3" />
      <circle cx={x(SE.mean)} cy={g.base} r={compact ? 3.5 : 5} fill={C.ground} stroke={C.ink} strokeWidth={S1} />
      <circle cx={x(SR.mean)} cy={g.base} r={compact ? 3.5 : 5} fill={C.model} />
      <Arrow x1={x(SE.mean)} y1={g.eY} x2={x(SR.mean)} y2={g.eY} color={C.goal} width={S2} head={compact ? 6 : 9} />
      <Label x={x(SE.mean) + 6} y={g.eY + 4} size={g.fs} color={C.ink} weight={600}>
        {compact ? '−ΔE' : `−ΔE = ${fmt(SR.mean - SE.mean)} (цена робастности)`}
      </Label>

      {/* CVaR: max E → робастный, +ΔCVaR */}
      <line x1={x(SE.cvar)} y1={g.base} x2={x(SE.cvar)} y2={g.cY - 6} stroke={C.risk} strokeDasharray="2 3" />
      <line x1={x(SR.cvar)} y1={g.base} x2={x(SR.cvar)} y2={g.cY - 6} stroke={C.model} strokeDasharray="2 3" />
      <Arrow x1={x(SE.cvar)} y1={g.cY - 6} x2={x(SR.cvar)} y2={g.cY - 6} color={C.risk} width={S2} head={compact ? 6 : 9} />
      <Label x={x(SR.cvar) + 8} y={g.cY - 2} size={g.fs} color={C.ink} weight={600}>
        {compact ? '+ΔCVaR' : `+ΔCVaR = ${fmt(SR.cvar - SE.cvar)} · худший случай лучше`}
      </Label>

      {!compact && (
        <g>
          {[-5, 0, 5, 10, 15, 20].map((t) => (
            <g key={t}>
              <line x1={x(t)} y1={g.base} x2={x(t)} y2={g.base + 4} stroke={C.line} />
              <Label x={x(t)} y={g.base + 15} anchor="middle" size={10}>{fmt(t, 0)}</Label>
            </g>
          ))}
          <Label x={g.x1} y={g.base + 15} anchor="end" size={10.5}>прибыль, млн ₽</Label>
          <line x1={430} y1={86} x2={456} y2={86} stroke={C.ink} strokeWidth={S1} strokeDasharray="5 3" />
          <Label x={462} y={90} size={10.5} color={C.ink}>{'x_{E} = argmax E'}</Label>
          <line x1={430} y1={104} x2={456} y2={104} stroke={C.model} strokeWidth={S2} />
          <Label x={462} y={108} size={10.5} color={C.ink}>{'x* = argmax CVaR_{α}'}</Label>
          <rect x={432} y={116} width={22} height={10} fill={C.risk} fillOpacity={0.18} />
          <Label x={462} y={125} size={10.5}>{'худшие α у x_{E}'}</Label>
        </g>
      )}
    </Frame>
  )
}
