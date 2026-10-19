/**
 * Граница Парето «доходность — риск»: кандидаты-портфели в плоскости
 * (CVaR_α, E), обе оси — «больше лучше». Недоминируемые ● соединены границей;
 * ▲ — выбранное робастное решение x* = argmax CVaR; ○ — x_E = argmax E.
 * Акцент — конус точек, доминирующих выбранного кандидата p.
 */
import type { DiagramProps } from './types'
import { C, S1, S2, Frame, Label, fmt, lin, pathOf, rng, triPoints } from './primitives'

interface Cand { cvar: number; e: number; front: boolean }

/** Кандидаты под вогнутой границей E = 12 − 4t², CVaR = −2 + 8t, t ∈ [0, 1]. */
const CANDS: Cand[] = (() => {
  const r = rng(77)
  const raw: Array<[number, number]> = []
  for (let i = 0; i < 64; i++) {
    const t = r()
    const shrink = 0.25 + 3.2 * r() * r()
    raw.push([-2 + 8 * t - shrink * (0.4 + r()), 12 - 4 * t * t - shrink * (0.3 + 0.8 * r())])
  }
  for (let i = 0; i <= 7; i++) {
    const t = i / 7
    raw.push([-2 + 8 * t - 0.05 * r(), 12 - 4 * t * t - 0.05 * r()])
  }
  return raw.map(([cvar, e], i) => ({
    cvar, e,
    front: !raw.some(([c2, e2], j) => j !== i && c2 >= cvar && e2 >= e && (c2 > cvar || e2 > e)),
  }))
})()
const FRONT = CANDS.filter((c) => c.front).sort((a, b) => a.cvar - b.cvar)
const X_E = FRONT.reduce((b, c) => (c.e > b.e ? c : b), FRONT[0])
const X_STAR = FRONT.reduce((b, c) => (c.cvar > b.cvar ? c : b), FRONT[0])
/** Пример доминируемого кандидата p (ближе к центру облака). */
const P = CANDS.filter((c) => !c.front).reduce((b, c) => (Math.abs(c.cvar - 1.2) + Math.abs(c.e - 8.6) < Math.abs(b.cvar - 1.2) + Math.abs(b.e - 8.6) ? c : b))

const TITLE = 'Граница Парето: ожидаемая прибыль против CVaR'
const DESC =
  `${CANDS.length} портфелей-кандидатов; ${FRONT.length} недоминируемых образуют границу Парето. ` +
  `x_E максимизирует ожидание (E = ${fmt(X_E.e)}), робастный x* — CVaR (${fmt(X_STAR.cvar)}). ` +
  'Кандидат доминируется, если существует другой не хуже по обеим осям и лучше хотя бы по одной.'

export function Pareto({ compact }: DiagramProps) {
  const g = compact
    ? { x0: 22, x1: 270, y0: 122, y1: 12, r: 1.6, rf: 2.8, fs: 9.5 }
    : { x0: 64, x1: 600, y0: 232, y1: 28, r: 2.4, rf: 4.2, fs: 11 }
  const x = lin(-7.5, 6.8, g.x0, g.x1)
  const y = lin(4, 12.6, g.y0, g.y1)
  const frontPath = pathOf(FRONT.map((c) => [x(c.cvar), y(c.e)] as const))
  const tri = compact ? 9 : 14

  return (
    <Frame compact={compact} title={TITLE} desc={DESC}>
      {/* Конус доминирования для p — акцент */}
      <rect x={x(P.cvar)} y={g.y1} width={g.x1 - x(P.cvar)} height={y(P.e) - g.y1} fill={C.model} fillOpacity={0.09} />
      <line x1={x(P.cvar)} y1={y(P.e)} x2={x(P.cvar)} y2={g.y1} stroke={C.model} strokeDasharray="2 3" />
      <line x1={x(P.cvar)} y1={y(P.e)} x2={g.x1} y2={y(P.e)} stroke={C.model} strokeDasharray="2 3" />

      {/* Оси */}
      <line x1={g.x0} y1={g.y0} x2={g.x1} y2={g.y0} stroke={C.line} />
      <line x1={g.x0} y1={g.y0} x2={g.x0} y2={g.y1} stroke={C.line} />

      {CANDS.filter((c) => !c.front).map((c, i) => (
        <circle key={i} cx={x(c.cvar)} cy={y(c.e)} r={g.r} fill={C.bone} opacity={0.7} />
      ))}
      <path d={frontPath} fill="none" stroke={C.model} strokeWidth={S2} strokeLinejoin="round" />
      {FRONT.map((c, i) => <circle key={i} cx={x(c.cvar)} cy={y(c.e)} r={g.rf} fill={C.model} />)}
      <circle cx={x(P.cvar)} cy={y(P.e)} r={g.rf} fill="none" stroke={C.ink} strokeWidth={S1} />

      <circle cx={x(X_E.cvar)} cy={y(X_E.e)} r={g.rf + 3} fill="none" stroke={C.ink} strokeWidth={S1} />
      <polygon points={triPoints(x(X_STAR.cvar), y(X_STAR.e) - tri * 0.9, tri, tri * 1.1)} fill={C.goal} />

      <Label x={x(X_E.cvar) + 10} y={y(X_E.e) - 6} size={g.fs} color={C.ink}>{'x_{E}'}</Label>
      <Label x={x(X_STAR.cvar) - tri * 0.7} y={y(X_STAR.e) - tri * 1.5} size={g.fs} anchor="end" color={C.ink}>x*</Label>
      <Label x={x(P.cvar) - 6} y={y(P.e) + (compact ? 10 : 14)} size={g.fs} anchor="end" color={C.ink}>p</Label>

      {compact ? (
        <g>
          <Label x={g.x1} y={g.y0 + 12} size={9.5} anchor="end">CVaR →</Label>
          <Label x={g.x0 - 4} y={g.y1 + 4} size={9.5} anchor="end">E</Label>
        </g>
      ) : (
        <g>
          {[-4, -2, 0, 2, 4, 6].map((t) => (
            <g key={t}>
              <line x1={x(t)} y1={g.y0} x2={x(t)} y2={g.y0 + 4} stroke={C.line} />
              <Label x={x(t)} y={g.y0 + 16} anchor="middle" size={10}>{fmt(t, 0)}</Label>
            </g>
          ))}
          {[4, 6, 8, 10, 12].map((t) => (
            <g key={t}>
              <line x1={g.x0 - 4} y1={y(t)} x2={g.x0} y2={y(t)} stroke={C.line} />
              <Label x={g.x0 - 8} y={y(t) + 3.5} anchor="end" size={10}>{fmt(t, 0)}</Label>
            </g>
          ))}
          <Label x={g.x1} y={g.y0 + 34} anchor="end" size={10.5}>{'CVaR_{α} прибыли, млн ₽ → лучше'}</Label>
          <Label x={g.x0 - 40} y={(g.y0 + g.y1) / 2} size={10.5} rotate={-90} anchor="middle">E[прибыль], млн ₽ ↑</Label>
          <Label x={x(P.cvar) + 10} y={g.y1 + 18} size={10.5}>портфели, доминирующие p</Label>
          {/* Легенда под осью */}
          <circle cx={68} cy={296} r={g.rf} fill={C.model} />
          <Label x={78} y={300} size={10.5}>граница Парето</Label>
          <circle cx={192} cy={296} r={g.r} fill={C.bone} />
          <Label x={200} y={300} size={10.5}>доминируемые</Label>
          <polygon points={triPoints(302, 295, 10, 11)} fill={C.goal} />
          <Label x={312} y={300} size={10.5}>{'x* = argmax CVaR_{α}'}</Label>
          <circle cx={454} cy={296} r={6} fill="none" stroke={C.ink} strokeWidth={S1} />
          <Label x={466} y={300} size={10.5}>{'x_{E} = argmax E'}</Label>
        </g>
      )}
    </Frame>
  )
}
