/**
 * Декомпозиция прогноза цены: y_t = T_t (тренд, EMD) + S_t (гармоники) + ε_t (остаток)
 * → методом Монте-Карло веер P10 / P50 / P90. Ширина веера здесь растёт как √h —
 * так остаток накапливается в текущей реализации (случайное блуждание; см. B11).
 */
import type { DiagramProps } from './types'
import { C, S1, S2, Arrow, Frame, Label, gauss, lin, pathOf, rng, type Pt } from './primitives'

const HIST = 36
const H = 12
const Z90 = 1.2816
const SIG = 2

const trend = (t: number) => 100 + 0.6 * t + 0.004 * t * t
const harm = (t: number) => 4 * Math.sin((2 * Math.PI * t) / 12) + 1.5 * Math.sin((2 * Math.PI * t) / 6 + 1)
const RESID: number[] = (() => { const r = rng(19); return Array.from({ length: HIST }, () => SIG * gauss(r)) })()
const SERIES = RESID.map((e, t) => trend(t) + harm(t) + e)
const P50 = Array.from({ length: H + 1 }, (_, h) => trend(HIST - 1 + h) + harm(HIST - 1 + h))
const BAND = (h: number) => Z90 * SIG * Math.sqrt(h)
/** Концы смоделированных траекторий на горизонте h = 12 — «зерно» веера. */
const ENDS: Pt[] = (() => {
  const r = rng(23)
  return Array.from({ length: 36 }, () => [r() * 0.8, P50[H] + SIG * Math.sqrt(H) * gauss(r)] as const)
})()

interface Box { x0: number; x1: number; y0: number; y1: number }

function line(vals: number[], t0: number, x: (t: number) => number, y: (v: number) => number): string {
  return pathOf(vals.map((v, i) => [x(t0 + i), y(v)] as const))
}

function Row({ box, vals, lo, hi, kind, label, fs }: {
  box: Box; vals: number[]; lo: number; hi: number; kind: 'ink' | 'model' | 'thin' | 'dots'; label?: string; fs: number
}) {
  const x = lin(0, HIST - 1, box.x0, box.x1)
  const y = lin(lo, hi, box.y1, box.y0)
  return (
    <g>
      <line x1={box.x0} y1={box.y1} x2={box.x1} y2={box.y1} stroke={C.grid} />
      {kind === 'dots'
        ? vals.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={1.6} fill={C.bone} />)
        : <path d={line(vals, 0, x, y)} fill="none" stroke={kind === 'model' ? C.model : C.ink}
            strokeWidth={kind === 'model' ? S2 : kind === 'thin' ? 1.2 : S1} />}
      {label && <Label x={box.x0} y={box.y0 - 2} size={fs} color={C.ink}>{label}</Label>}
    </g>
  )
}

const TITLE = 'Прогноз: тренд + гармоники + остаток → веер P10/P50/P90'
const DESC =
  'История цены раскладывается на тренд (эмпирическая модовая декомпозиция), до трёх гармоник и остаток. ' +
  'Методом Монте-Карло строится веер прогноза на 12 месяцев: медиана P50 и границы P10 и P90.'

export function ForecastDecomposition({ compact }: DiagramProps) {
  const fs = compact ? 9 : 10.5
  const left = compact
    ? [{ x0: 8, x1: 92, y0: 18, y1: 42 }, { x0: 8, x1: 92, y0: 60, y1: 84 }, { x0: 8, x1: 92, y0: 102, y1: 126 }]
    : [{ x0: 40, x1: 282, y0: 32, y1: 78 }, { x0: 40, x1: 282, y0: 98, y1: 144 }, { x0: 40, x1: 282, y0: 164, y1: 210 }, { x0: 40, x1: 282, y0: 230, y1: 276 }]
  const trendVals = SERIES.map((_, t) => trend(t))
  const harmVals = SERIES.map((_, t) => harm(t))
  const rows = compact
    ? [
        { vals: trendVals, lo: 95, hi: 132, kind: 'model' as const, label: 'тренд' },
        { vals: harmVals, lo: -7, hi: 7, kind: 'thin' as const, label: 'гармоники' },
        { vals: RESID, lo: -7, hi: 7, kind: 'dots' as const, label: 'остаток' },
      ]
    : [
        { vals: SERIES, lo: 90, hi: 142, kind: 'ink' as const, label: 'ряд y_{t}' },
        { vals: trendVals, lo: 90, hi: 142, kind: 'model' as const, label: 'тренд T_{t} (EMD)' },
        { vals: harmVals, lo: -7, hi: 7, kind: 'thin' as const, label: 'гармоники S_{t} (≤ 3)' },
        { vals: RESID, lo: -7, hi: 7, kind: 'dots' as const, label: 'остаток ε_{t} (семейство по AIC)' },
      ]
  const fan: Box = compact ? { x0: 112, x1: 268, y0: 14, y1: 126 } : { x0: 336, x1: 600, y0: 40, y1: 264 }
  const x = lin(0, HIST - 1 + H, fan.x0, fan.x1)
  const y = lin(90, 156, fan.y1, fan.y0)
  const t0 = HIST - 1
  const upper = P50.map((v, h) => [x(t0 + h), y(v + BAND(h))] as const)
  const lower = P50.map((v, h) => [x(t0 + h), y(v - BAND(h))] as const)
  const bandPath = `${pathOf(upper)} ${pathOf([...lower].reverse()).replace('M', 'L')} Z`

  return (
    <Frame compact={compact} title={TITLE} desc={DESC}>
      {rows.map((r, i) => <Row key={i} box={left[i]} fs={fs} {...r} />)}
      {!compact && ['=', '+', '+'].map((s, i) => (
        <Label key={i} x={22} y={(left[i].y1 + left[i + 1].y0) / 2 + 12} size={16} anchor="middle" color={C.ink}>{s}</Label>
      ))}

      {/* Веер — акцентная область */}
      <path d={bandPath} fill={C.model} fillOpacity={0.16} />
      <path d={line(SERIES, 0, x, y)} fill="none" stroke={C.ink} strokeWidth={S1} />
      <path d={pathOf(P50.map((v, h) => [x(t0 + h), y(v)] as const))} fill="none" stroke={C.model} strokeWidth={S2} />
      <path d={pathOf(upper)} fill="none" stroke={C.model} strokeWidth={1} />
      <path d={pathOf(lower)} fill="none" stroke={C.model} strokeWidth={1} />
      {ENDS.map(([dx, v], i) => <circle key={i} cx={x(t0 + H) + (compact ? 2 + dx * 5 : 4 + dx * 10)} cy={y(v)} r={compact ? 1 : 1.5} fill={C.bone} />)}
      <line x1={x(t0)} y1={fan.y0} x2={x(t0)} y2={fan.y1} stroke={C.muted} strokeDasharray="2 3" />
      <line x1={fan.x0} y1={fan.y1} x2={fan.x1} y2={fan.y1} stroke={C.line} />

      {compact ? (
        <g>
          <Label x={x(t0) - 3} y={fan.y0 + 8} size={9} anchor="end">история</Label>
          <Label x={fan.x1 - 6} y={y(P50[H] + BAND(H)) - 4} size={9} anchor="end" color={C.ink}>P90</Label>
          <Label x={fan.x1 - 6} y={y(P50[H] - BAND(H)) + 11} size={9} anchor="end" color={C.ink}>P10</Label>
        </g>
      ) : (
        <g>
          <Arrow x1={290} y1={152} x2={326} y2={152} dashed color={C.muted} />
          <Label x={308} y={144} size={10} anchor="middle">МК</Label>
          <Label x={x(t0) - 4} y={fan.y0 + 10} size={10.5} anchor="end">история</Label>
          <Label x={x(t0) + 4} y={fan.y0 + 10} size={10.5}>прогноз, h = 1…12</Label>
          <Label x={fan.x1 - 8} y={y(P50[H] + BAND(H)) - 6} size={11} anchor="end" color={C.ink}>P90</Label>
          <Label x={fan.x1 - 8} y={y(P50[H]) - 6} size={11} anchor="end" color={C.ink}>P50</Label>
          <Label x={fan.x1 - 8} y={y(P50[H] - BAND(H)) + 15} size={11} anchor="end" color={C.ink}>P10</Label>
          <Label x={fan.x1} y={fan.y1 + 16} size={10.5} anchor="end">месяцы</Label>
          <Label x={fan.x0} y={fan.y1 + 34} size={10} mono>{'ширина ∝ √h · σ_{ε} (накопление остатка)'}</Label>
        </g>
      )}
    </Frame>
  )
}
