/**
 * Диспетчерские правила на микро-примере: 4 операции на одном станке.
 * Статические ключи, как в priorities() (Scheduler.cpp): SPT — min p̄; EDD — min d;
 * CR — min d / max(1, rem); MWKR — max rem (rem — остаток работы по цепочке).
 * Для каждой последовательности считаются ΣC и ΣT; ▲ — лучшее значение столбца.
 */
import type { DiagramProps } from './types'
import { C, S1, Frame, Label, triPoints } from './primitives'

interface Job { id: string; p: number; d: number; rem: number }
const JOBS: Job[] = [
  { id: 'A', p: 3, d: 14, rem: 9 },
  { id: 'B', p: 6, d: 8, rem: 6 },
  { id: 'C', p: 2, d: 12, rem: 2 },
  { id: 'D', p: 5, d: 16, rem: 11 },
]

interface Rule { name: string; key: string; f: (j: Job) => number }
const RULES: Rule[] = [
  { name: 'SPT', key: 'min p', f: (j) => j.p },
  { name: 'EDD', key: 'min d', f: (j) => j.d },
  { name: 'CR', key: 'min d/rem', f: (j) => j.d / Math.max(1, j.rem) },
  { name: 'MWKR', key: 'max rem', f: (j) => -j.rem },
]

interface Seq { rule: Rule; order: Array<Job & { s: number; c: number; t: number }>; sumC: number; sumT: number }

const SEQS: Seq[] = RULES.map((rule) => {
  let time = 0
  const order = [...JOBS].sort((a, b) => rule.f(a) - rule.f(b)).map((j) => {
    const s = time
    time += j.p
    return { ...j, s, c: time, t: Math.max(0, time - j.d) }
  })
  return {
    rule, order,
    sumC: order.reduce((a, j) => a + j.c, 0),
    sumT: order.reduce((a, j) => a + j.t, 0),
  }
})
const BEST_C = Math.min(...SEQS.map((s) => s.sumC))
const BEST_T = Math.min(...SEQS.map((s) => s.sumT))
const HORIZON = JOBS.reduce((a, j) => a + j.p, 0)

const TITLE = 'Диспетчерские правила SPT, EDD, CR, MWKR на четырёх операциях'
const DESC =
  'Четыре операции A–D с длительностью p, сроком d и остатком работы rem упорядочены четырьмя статическими ' +
  `правилами. Сумма моментов завершения минимальна у SPT (${BEST_C}), суммарная просрочка — у правила с ΣT = ${BEST_T}. ` +
  'Красным отмечена просрочка.'

export function DispatchRules({ compact }: DiagramProps) {
  const g = compact
    ? { gx: 50, gw: 216, y0: 14, rowH: 30, barH: 13, fs: 9.5 }
    : { gx: 290, gw: 256, y0: 52, rowH: 56, barH: 18, fs: 11 }
  const k = g.gw / HORIZON

  return (
    <Frame compact={compact} title={TITLE} desc={DESC}>
      {!compact && (
        <g>
          {/* Таблица исходных данных */}
          <Label x={24} y={44} size={11} color={C.ink} weight={600}>Операция</Label>
          {['p, ч', 'd, ч', 'rem, ч'].map((h, i) => (
            <Label key={h} x={128 + i * 46} y={44} size={11} color={C.ink} weight={600} anchor="end">{h}</Label>
          ))}
          <line x1={24} y1={52} x2={224} y2={52} stroke={C.line} />
          {JOBS.map((j, r) => (
            <g key={j.id}>
              <rect x={24} y={62 + r * 30} width={18} height={18} fill={C.bone} fillOpacity={0.25} stroke={C.ink} strokeWidth={1} />
              <Label x={33} y={75 + r * 30} size={11} anchor="middle" color={C.ink} weight={600}>{j.id}</Label>
              {[j.p, j.d, j.rem].map((v, i) => (
                <Label key={i} x={128 + i * 46} y={75 + r * 30} size={11} anchor="end" color={C.ink}>{String(v)}</Label>
              ))}
            </g>
          ))}
          <Label x={24} y={206} size={10}>p — длительность, d — срок,</Label>
          <Label x={24} y={220} size={10}>rem — остаток работы по цепочке</Label>
          <Label x={24} y={244} size={10}>Ключи статические: вычисляются</Label>
          <Label x={24} y={258} size={10}>один раз, без текущего «сейчас».</Label>
          <Label x={g.gx + g.gw + 30} y={36} size={11} color={C.ink} weight={600} anchor="middle">ΣC</Label>
          <Label x={g.gx + g.gw + 74} y={36} size={11} color={C.ink} weight={600} anchor="middle">ΣT</Label>
        </g>
      )}
      {SEQS.map((s, r) => {
        const y = g.y0 + r * g.rowH
        return (
          <g key={s.rule.name}>
            <Label x={g.gx - 10} y={y + g.barH * 0.72} size={g.fs + 1} anchor="end" color={C.ink} weight={600}>{s.rule.name}</Label>
            {!compact && <Label x={g.gx - 10} y={y + g.barH + 13} size={9.5} anchor="end" mono>{s.rule.key}</Label>}
            {s.order.map((j) => (
              <g key={j.id}>
                <rect x={g.gx + j.s * k + 0.5} y={y} width={j.p * k - 1} height={g.barH}
                  fill={C.bone} fillOpacity={0.22} stroke={C.ink} strokeWidth={1} />
                <Label x={g.gx + (j.s + j.p / 2) * k} y={y + g.barH * 0.72} size={g.fs} anchor="middle" color={C.ink}>{j.id}</Label>
                {j.t > 0 && (
                  <g>
                    <line x1={g.gx + j.d * k} y1={y + g.barH + 4} x2={g.gx + j.c * k} y2={y + g.barH + 4}
                      stroke={C.risk} strokeWidth={compact ? 3 : 4} />
                    <line x1={g.gx + j.d * k} y1={y - 2} x2={g.gx + j.d * k} y2={y + g.barH + 6} stroke={C.risk} strokeWidth={S1} />
                  </g>
                )}
              </g>
            ))}
            {!compact && (
              <g>
                <Label x={g.gx + g.gw + 30} y={y + g.barH * 0.72} size={11} anchor="middle" color={C.ink}>{String(s.sumC)}</Label>
                <Label x={g.gx + g.gw + 74} y={y + g.barH * 0.72} size={11} anchor="middle" color={C.ink}>{String(s.sumT)}</Label>
                {s.sumC === BEST_C && <polygon points={triPoints(g.gx + g.gw + 46, y + g.barH * 0.45, 8, 9)} fill={C.goal} />}
                {s.sumT === BEST_T && <polygon points={triPoints(g.gx + g.gw + 90, y + g.barH * 0.45, 8, 9)} fill={C.goal} />}
              </g>
            )}
          </g>
        )
      })}
      {!compact && (
        <g>
          <line x1={g.gx} y1={278} x2={g.gx + g.gw} y2={278} stroke={C.line} />
          {[0, 4, 8, 12, 16].map((t) => (
            <g key={t}>
              <line x1={g.gx + t * k} y1={278} x2={g.gx + t * k} y2={282} stroke={C.line} />
              <Label x={g.gx + t * k} y={293} size={10} anchor="middle">{String(t)}</Label>
            </g>
          ))}
          <Label x={g.gx + g.gw} y={308} size={10.5} anchor="end">время, ч · красное — просрочка Cⱼ − dⱼ</Label>
        </g>
      )}
    </Frame>
  )
}
