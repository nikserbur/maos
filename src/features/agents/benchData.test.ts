import { describe, expect, it } from 'vitest'
import { V4, V5, ciVerdict, familyOf, gap, gateSummary, policyLabel, referenceOf, summarizeV4, v5Rows } from './benchData'

describe('V4 snapshot', () => {
  it('has 32 instances in three families with a reference for each', () => {
    expect(V4.rows).toHaveLength(32)
    expect(new Set(V4.rows.map((r) => familyOf(r.name)))).toEqual(new Set(['taillard', 'brandimarte', 'maos']))
    expect(V4.rows.every((r) => referenceOf(r) > 0)).toBe(true)
  })

  it('computes gaps and the summary matching A1 §3 (CP-SAT at BKS on 15 of 20)', () => {
    expect(gap(1865, 1231)).toBeCloseTo(0.515, 3)
    expect(gap(10, null)).toBeNull()
    const s = summarizeV4(V4.rows)
    expect(s.withBks).toBe(20)
    expect(s.cpsatAtBks).toBe(15)
    expect(s.medRule).toBeGreaterThan(s.medGa)
  })
})

describe('V5 snapshot', () => {
  it('reports the honest gate: no candidate passed, champion = best_rule', () => {
    const g = gateSummary(V5)
    expect(g.champion).toBe('best_rule')
    expect(g.passed).toBe(0)
    expect(g.candidates).toBe(6)
    expect(g.best?.policy).toMatch(/^L2/)
  })

  it('filters rows by stress and baseline and classifies CIs', () => {
    expect(v5Rows(V5, 'joint')).toHaveLength(7)
    expect(v5Rows(V5, 'base', 'GA').every((r) => r.vs === 'GA')).toBe(true)
    expect(ciVerdict([0.1, 0.2])).toBe('above')
    expect(ciVerdict([-0.2, -0.1])).toBe('below')
    expect(ciVerdict([-0.1, 0.2])).toBe('straddles')
  })

  it('labels policies in Russian', () => {
    expect(policyLabel('L0_seed2')).toBe('L0 · сид 2')
    expect(policyLabel('L2_edd_seed1')).toBe('L2 поверх EDD · сид 1')
    expect(policyLabel('GA')).toBe('ГА по ключам')
  })
})
