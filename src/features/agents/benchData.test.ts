import { describe, expect, it } from 'vitest'
import { NBSP } from '../../explain/format'
import {
  V4, V5, bpApprox, bpCi, bpFine, bpPoint, breachAllZero, candidateLabel, ciDomain, ciVerdict, gap, gateSummary, movesCensus, policyLabel, v5Forest, v5Rows, winCount,
} from './benchData'
import { AT_BKS_TOL, V4A2, familyMedians, familyOf, gapOf, refOf, ruleEvent, ruleLagRange, sharedMax, summarizeA2 } from './benchV4'


/** Пробелы ожидаемой строки → неразрывные (форматтеры ставят NBSP между числом и единицей). */
const nb = (t: string): string => t.replace(/ /g, NBSP)

describe('V4 A2 snapshot (расписание против BKS)', () => {
  it('has 32 instances in three families with a reference for each', () => {
    expect(V4A2.rows).toHaveLength(32)
    expect(new Set(V4A2.rows.map((r) => familyOf(r.name)))).toEqual(new Set(['taillard', 'brandimarte', 'maos']))
    expect(V4A2.rows.every((r) => refOf(r) > 0)).toBe(true)
  })

  it('reports CP-SAT = BKS on 18 of 20 with the 0,1 % tolerance (17 exactly), as in the A2 report', () => {
    const s = summarizeA2(V4A2.rows)
    expect(s.withBks).toBe(20)
    expect(s.cpsatAtBks).toBe(18)
    expect(s.cpsatExact).toBe(17)
    expect(AT_BKS_TOL).toBeCloseTo(0.001)
  })

  it('computes gaps, medians on a shared domain and the rule lag range for the chart title', () => {
    expect(gap(1865, 1231)).toBeCloseTo(0.515, 3)
    expect(gap(10, null)).toBeNull()
    const ta01 = V4A2.rows.find((r) => r.name === 'ta01')!
    expect(gapOf(ta01, 'cpsat')).toBe(0)
    expect(ruleEvent(ta01)).toBe(V4.rows.find((r) => r.name === 'ta01')!.rule_event)
    expect(ruleEvent(V4A2.rows.find((r) => familyOf(r.name) === 'maos')!)).toBeNull()
    const fams = familyMedians(V4A2.rows)
    expect(fams.map((f) => f.family)).toEqual(['taillard', 'brandimarte', 'maos'])
    for (const f of fams) {
      const meds = f.methods.map((m) => m.median)
      expect(meds).toEqual([...meds].sort((a, b) => a - b))
    }
    expect(fams[0].methods[fams[0].methods.length - 1].method).toBe('rule')
    expect(sharedMax(fams)).toBeGreaterThanOrEqual(Math.max(...fams.flatMap((f) => f.methods.map((m) => m.median))))
    const lag = ruleLagRange(fams)!
    expect(lag[0]).toBeGreaterThan(0.3)
    expect(lag[1]).toBeLessThan(0.65)
  })
})

describe('V5 snapshot', () => {
  it('reports the honest gate: no candidate passed, champion = best_rule', () => {
    const g = gateSummary(V5)
    expect(g.champion).toBe('best_rule')
    expect(g.passed).toBe(0)
    expect(g.candidates).toBe(6)
    expect(g.best?.policy).toBe('L2_edd_seed3')
  })

  it('labels the 0-move candidate «совпал с EDD» and counts wins as «N из 12»', () => {
    expect(candidateLabel(V5, 'L2_edd_seed3')).toBe('Агент поверх правила «по ближайшему сроку» · запуск 3 — 0 ходов, совпал с правилом «по ближайшему сроку»')
    expect(candidateLabel(V5, 'L0_seed1')).toBe('Агент с нуля · запуск 1')
    const best = gateSummary(V5).best!
    expect(winCount(V5, best.win)).toBe(5)
  })

  it('formats sub-basis-point differences honestly', () => {
    const best = gateSummary(V5).best!
    expect(bpApprox(best.iqm)).toBe(nb('≈ 0 б. п.'))
    expect(bpCi(best.ci95)).toBe('[−0,4; +0,1]')
    expect(bpPoint(-0.00061)).toBe('−6,1')
    expect(bpFine(0.0047, { signed: true })).toBe(nb('+47 б. п.'))
    expect(bpFine(Number.NaN)).toBe('—')
  })

  it('builds forest rows in basis points with a shared domain, and moves census', () => {
    const rows = v5Forest(V5)
    expect(rows).toHaveLength(6)
    expect(rows.every((r) => r.lo <= r.delta && r.delta <= r.hi)).toBe(true)
    const [lo, hi] = ciDomain(v5Rows(V5, 'base'))
    expect(lo).toBeLessThan(0)
    expect(hi).toBeGreaterThan(0)
    const c = movesCensus(V5)
    expect(c.idleSeeds).toEqual([3])
    expect(c.kinds[0]).toEqual({ kind: 'finance', n: 2019 })
    expect(breachAllZero(V5)).toBe(true)
  })

  it('filters rows by stress and baseline and classifies CIs', () => {
    expect(v5Rows(V5, 'joint')).toHaveLength(7)
    expect(v5Rows(V5, 'base', 'GA').every((r) => r.vs === 'GA')).toBe(true)
    expect(ciVerdict([0.1, 0.2])).toBe('above')
    expect(ciVerdict([-0.2, -0.1])).toBe('below')
    expect(ciVerdict([-0.1, 0.2])).toBe('straddles')
  })

  it('labels policies in Russian', () => {
    expect(policyLabel('L0_seed2')).toBe('Агент с нуля · запуск 2')
    expect(policyLabel('L2_edd_seed1')).toBe('Агент поверх правила «по ближайшему сроку» · запуск 1')
    expect(policyLabel('GA')).toBe('Генетический алгоритм по ключам')
  })
})
