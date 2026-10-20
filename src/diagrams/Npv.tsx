/**
 * ЧДД / ВНД / дисконтированный срок окупаемости (ВК 477) на помесячной шкале.
 * r_m = (1 + r)^{1/12} − 1 — эффективная месячная ставка (исправление B6: везде одна);
 * ЧДД(t) — накопленный дисконтированный поток; DPP — первый месяц, где ЧДД(t) ≥ 0;
 * ВНД — ставка, при которой ЧДД = 0, в годовом эффективном выражении.
 */
import type { DiagramProps } from './types'
import { C, S1, S2, Frame, Label, fmt, lin, pathOf, triPoints } from './primitives'

const CAPEX = 12
const DCF = 0.5
const RAMP = 4
const R_YEAR = 0.18
const LIFE = 48
const RM = Math.pow(1 + R_YEAR, 1 / 12) - 1

const cf = (t: number) => (t === 0 ? -CAPEX : DCF * Math.min(1, t / RAMP))
const npvAt = (rm: number) => Array.from({ length: LIFE + 1 }, (_, t) => cf(t) / Math.pow(1 + rm, t)).reduce((a, b) => a + b, 0)

const CUM_D: number[] = (() => { let s = 0; return Array.from({ length: LIFE + 1 }, (_, t) => (s += cf(t) / Math.pow(1 + RM, t))) })()
const CUM_N: number[] = (() => { let s = 0; return Array.from({ length: LIFE + 1 }, (_, t) => (s += cf(t))) })()
const NPV = CUM_D[LIFE]
const DPP = CUM_D.findIndex((v) => v >= 0)
const SPP = CUM_N.findIndex((v) => v >= 0)
const IRR_M = (() => {
  let lo = 0
  let hi = 0.5
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (npvAt(mid) > 0) lo = mid; else hi = mid }
  return (lo + hi) / 2
})()
const IRR = Math.pow(1 + IRR_M, 12) - 1

const TITLE = 'ЧДД, ВНД и дисконтированный срок окупаемости'
const DESC =
  `Инвестиция ${CAPEX} млн ₽, прирост потока ${DCF} млн ₽/мес с освоением ${RAMP} мес, ставка ${R_YEAR * 100} % годовых ` +
  `(r_m = ${fmt(RM * 100, 2)} % в месяц). ЧДД за ${LIFE} мес = ${fmt(NPV)} млн ₽, ВНД = ${fmt(IRR * 100)} % годовых, ` +
  `дисконтированный срок окупаемости ${DPP} мес (простой — ${SPP} мес).`

export function Npv({ compact }: DiagramProps) {
  const g = compact
    ? { x0: 14, x1: 270, y0: 112, y1: 14, fs: 9.5 }
    : { x0: 56, x1: 612, y0: 236, y1: 40, fs: 11 }
  const x = lin(0, LIFE, g.x0, g.x1)
  const y = lin(-CAPEX - 1, Math.max(NPV, CUM_N[LIFE]) + 1, g.y0, g.y1)
  const zero = y(0)
  const disc = CUM_D.map((v, t) => [x(t), y(v)] as const)
  const negArea = `${pathOf(disc.slice(0, DPP + 1).map(([px, py]) => [px, Math.max(py, zero)] as const))} L${x(DPP)},${zero} L${x(0)},${zero} Z`

  return (
    <Frame compact={compact} title={TITLE} desc={DESC}>
      {/* Невозмещённый капитал — акцент */}
      <path d={negArea} fill={C.risk} fillOpacity={0.14} />
      <line x1={g.x0} y1={zero} x2={g.x1} y2={zero} stroke={C.line} />
      {!compact && <path d={pathOf(CUM_N.map((v, t) => [x(t), y(v)] as const))} fill="none" stroke={C.muted} strokeWidth={S1} strokeDasharray="5 3" />}
      <path d={pathOf(disc)} fill="none" stroke={C.model} strokeWidth={S2} />
      <polygon points={triPoints(x(DPP), zero - (compact ? 8 : 12), compact ? 10 : 14, compact ? 11 : 16)} fill={C.goal} />
      <Label x={x(DPP) + (compact ? 7 : 10)} y={zero + (compact ? 12 : 18)} size={g.fs} color={C.ink} weight={600}>
        {compact ? `DPP ${DPP} мес` : `DPP = ${DPP} мес`}
      </Label>

      {compact ? (
        <g>
          <Label x={x(LIFE)} y={y(NPV) - 6} size={9.5} anchor="end" color={C.ink}>{`ЧДД ${fmt(NPV)} млн`}</Label>
          <Label x={g.x0 + 4} y={y(-CAPEX) + 14} size={9.5}>−CAPEX</Label>
        </g>
      ) : (
        <g>
          <circle cx={x(SPP)} cy={zero} r={3.5} fill={C.ground} stroke={C.muted} strokeWidth={S1} />
          <Label x={x(SPP) - 6} y={zero - 8} size={10.5} anchor="end">{`простой срок ${SPP} мес`}</Label>
          <circle cx={x(LIFE)} cy={y(NPV)} r={4} fill={C.model} />
          <Label x={x(2)} y={y(-CAPEX) + 4} size={10.5}>−CAPEX</Label>
          {/* Помесячные потоки: дисконтированный (заливка) внутри номинального (контур) */}
          {Array.from({ length: LIFE }, (_, i) => i + 1).map((t) => {
            const hN = cf(t) * 40
            const hD = (cf(t) / Math.pow(1 + RM, t)) * 40
            return (
              <g key={t}>
                <rect x={x(t) - 3} y={300 - hN} width={6} height={hN} fill="none" stroke={C.muted} strokeWidth={0.8} />
                <rect x={x(t) - 3} y={300 - hD} width={6} height={hD} fill={C.model} opacity={0.6} />
              </g>
            )
          })}
          <line x1={g.x0} y1={300} x2={g.x1} y2={300} stroke={C.line} />
          <Label x={g.x0} y={314} size={10}>{'CF_{t}: контур — номинальный, заливка — дисконтированный'}</Label>
          {[12, 24, 36].map((t) => (
            <Label key={t} x={x(t)} y={g.y0 + 30} size={10} anchor="middle">{String(t)}</Label>
          ))}
          <Label x={x(LIFE)} y={g.y0 + 30} size={10} anchor="end">{`${LIFE} мес`}</Label>
          <Label x={g.x0 + 4} y={g.y1 - 14} size={10.5} mono color={C.ink}>{`r_{m} = (1+r)^{1/12} − 1 = ${fmt(RM * 100, 2)} %`}</Label>
          <Label x={g.x0 + 4} y={g.y1 + 4} size={10.5} mono color={C.ink}>{`ЧДД = Σ CF_{t} / (1+r_{m})^{t} = ${fmt(NPV)} млн ₽`}</Label>
          <Label x={g.x0 + 4} y={g.y1 + 22} size={10.5} mono color={C.ink}>{`ВНД = ${fmt(IRR * 100)} % годовых (эфф.)`}</Label>
          <line x1={g.x0 + 260} y1={g.y1 - 18} x2={g.x0 + 284} y2={g.y1 - 18} stroke={C.model} strokeWidth={S2} />
          <Label x={g.x0 + 290} y={g.y1 - 14} size={10.5}>ЧДД(t) накопленный</Label>
          <line x1={g.x0 + 260} y1={g.y1} x2={g.x0 + 284} y2={g.y1} stroke={C.muted} strokeWidth={S1} strokeDasharray="5 3" />
          <Label x={g.x0 + 290} y={g.y1 + 4} size={10.5}>без дисконтирования</Label>
        </g>
      )}
    </Frame>
  )
}
