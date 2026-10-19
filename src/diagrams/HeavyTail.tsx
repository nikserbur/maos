/**
 * Тяжёлый хвост длительности операции — ровно алгоритм sample_dur (Scheduler.cpp):
 * тело — логнормаль со средним t̄ и σ из PERT-моментов; с вероятностью w
 * множитель M = min(9, U^(−1/a)) — Парето с индексом a, ограниченный 9×;
 * с вероятностью r — переделка +0,5·t̄. Это НЕ β-PERT.
 * Гистограмма — по логарифмическим корзинам, высота в √-шкале (видимость хвоста).
 */
import type { DiagramProps } from './types'
import { C, S1, S2, Frame, Label, fmt, gauss, lin, mean, rng } from './primitives'

const N = 800
const CV = 0.18
const TAIL_W = 0.08
const TAIL_A = 2.2
const RISK = 0.05
const CAP = 9
const X_LO = 0.5
const X_HI = 14
const BINS = 48
const TAIL_FROM = 2

/** Сэмплы t/t̄ по алгоритму sample_dur при t̄ = 1. */
const SAMPLES: number[] = (() => {
  const r = rng(42)
  const sl = Math.sqrt(Math.log(1 + CV * CV))
  const mu = -0.5 * sl * sl
  return Array.from({ length: N }, () => {
    let d = Math.exp(mu + sl * gauss(r))
    if (r() < TAIL_W) d *= Math.min(CAP, Math.pow(Math.max(1e-9, 1 - r()), -1 / TAIL_A))
    if (r() < RISK) d += 0.5
    return d
  })
})()
const E_T = mean(SAMPLES)
const L0 = Math.log(X_LO)
const L1 = Math.log(X_HI)
const COUNTS: number[] = (() => {
  const c = new Array<number>(BINS).fill(0)
  for (const v of SAMPLES) {
    const b = Math.floor(((Math.log(v) - L0) / (L1 - L0)) * BINS)
    if (b >= 0 && b < BINS) c[b]++
  }
  return c
})()
const MAXC = Math.max(...COUNTS)
/** Детерминированный джиттер для «зерна» под осью. */
const JITTER: number[] = (() => { const r = rng(7); return SAMPLES.map(() => r()) })()

const TITLE = 'Длительность операции: логнормаль + усечённый Парето-хвост'
const DESC =
  `Распределение отношения длительности к нормативу t̄ по ${N} сэмплам: тело — логнормаль, ` +
  `с вероятностью ${TAIL_W * 100} % — множитель Парето (индекс ${fmt(TAIL_A)}), ограниченный ${CAP}×; ` +
  `с вероятностью ${RISK * 100} % — переделка +0,5·t̄. Среднее E[t] ≈ ${fmt(E_T, 2)}·t̄ > t̄.`

export function HeavyTail({ compact }: DiagramProps) {
  const g = compact
    ? { x0: 10, x1: 270, base: 106, h: 84, fs: 9.5 }
    : { x0: 56, x1: 612, base: 232, h: 180, fs: 11 }
  const lx = lin(L0, L1, g.x0, g.x1)
  const x = (v: number) => lx(Math.log(v))
  const bw = (g.x1 - g.x0) / BINS
  const hOf = (c: number) => Math.sqrt(c / MAXC) * g.h

  return (
    <Frame compact={compact} title={TITLE} desc={DESC}>
      {COUNTS.map((c, i) => {
        if (!c) return null
        const left = g.x0 + i * bw
        const isTail = Math.exp(L0 + ((i + 0.5) / BINS) * (L1 - L0)) >= TAIL_FROM
        return (
          <rect key={i} x={left + 0.4} y={g.base - hOf(c)} width={bw - 0.8} height={hOf(c)}
            fill={isTail ? C.risk : C.model} fillOpacity={isTail ? 0.85 : 0.6} />
        )
      })}
      <line x1={g.x0} y1={g.base} x2={g.x1} y2={g.base} stroke={C.line} />
      {/* Предел 9× */}
      <line x1={x(CAP)} y1={g.base} x2={x(CAP)} y2={g.base - g.h * 0.72} stroke={C.ink} strokeWidth={S1} strokeDasharray="4 3" />
      <Label x={x(CAP) + (compact ? 4 : -4)} y={g.base - g.h * 0.72 + 8} size={g.fs} color={C.ink} anchor={compact ? 'start' : 'end'}>
        {compact ? '9×' : 'предел 9× (усечение)'}
      </Label>

      {compact ? (
        <g>
          <Label x={x(1.25)} y={g.base - g.h - 2} size={9.5} color={C.ink}>логнормаль</Label>
          <Label x={x(3)} y={g.base - g.h * 0.45} size={9.5} color={C.ink}>Парето-хвост</Label>
          <Label x={g.x1} y={g.base + 14} size={9.5} anchor="end">t / t̄, лог. шкала</Label>
          <circle cx={x(E_T)} cy={g.base} r={3} fill={C.ink} />
        </g>
      ) : (
        <g>
          {/* Зерно: каждый сэмпл — точка под осью */}
          {SAMPLES.map((v, i) => v >= X_LO && v <= X_HI && (
            <circle key={i} cx={x(v)} cy={g.base + 34 + JITTER[i] * 16} r={0.9}
              fill={v >= TAIL_FROM ? C.risk : C.bone} opacity={0.55} />
          ))}
          {[0.5, 1, 2, 5, 9].map((t) => (
            <g key={t}>
              <line x1={x(t)} y1={g.base} x2={x(t)} y2={g.base + 4} stroke={C.line} />
              <Label x={x(t)} y={g.base + 16} anchor="middle" size={10}>{`×${fmt(t, t < 1 ? 1 : 0)}`}</Label>
            </g>
          ))}
          <line x1={x(E_T)} y1={g.base} x2={x(E_T)} y2={g.base - g.h - 8} stroke={C.ink} strokeDasharray="2 3" />
          <circle cx={x(E_T)} cy={g.base} r={4.5} fill={C.ink} />
          <Label x={x(E_T) + 4} y={g.base - g.h - 12} size={10.5} color={C.ink}>{`E[t] ≈ ${fmt(E_T, 2)}·t̄ > t̄`}</Label>

          <Label x={x(1.32)} y={g.base - g.h + 6} size={g.fs} color={C.ink} weight={600}>тело: логнормаль</Label>
          <Label x={x(1.32)} y={g.base - g.h + 20} size={10}>μ, σ из PERT-моментов</Label>
          <Label x={x(1.32)} y={g.base - g.h + 33} size={10} mono>{'t̄ = (a+4m+b)/6, σ = (b−a)/6'}</Label>
          <line x1={x(1.55)} y1={g.base - g.h * 0.36} x2={x(1.9)} y2={g.base - g.h * 0.52} stroke={C.muted} />
          <Label x={x(1.95)} y={g.base - g.h * 0.52} size={10.5}>{'переделка: +0,5·t̄ с вер. r'}</Label>
          <Label x={x(2.6)} y={g.base - g.h * 0.3} size={g.fs} color={C.ink} weight={600}>хвост Парето</Label>
          <Label x={x(2.6)} y={g.base - g.h * 0.3 + 14} size={10}>{`вес w = ${fmt(TAIL_W, 2)}, индекс a = ${fmt(TAIL_A)}`}</Label>
          <Label x={x(2.6)} y={g.base - g.h * 0.3 + 28} size={10} mono>{'M = min(9, U^{−1/a})'}</Label>

          <Label x={g.x1} y={g.base + 74} anchor="end" size={10.5}>{'длительность / норматив t̄ (логарифмическая шкала)'}</Label>
          <Label x={g.x0 - 30} y={g.base - g.h / 2} anchor="middle" size={10.5} rotate={-90}>частота (√-шкала)</Label>
          <line x1={g.x0} y1={g.base} x2={g.x0} y2={g.base - g.h} stroke={C.line} strokeWidth={S2 / 3} />
        </g>
      )}
    </Frame>
  )
}
