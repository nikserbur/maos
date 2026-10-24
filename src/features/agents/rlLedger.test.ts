import { describe, expect, it } from 'vitest'
import { NBSP } from '../../explain/format'
import { rlFixture } from '../explain/mentatFixtures'
import { agentsTab } from './tabs'
import { A4S, championShares, gateView, ledgerRows, overtimeCandidate, pctV, pctVci, poolLabel, strictNearZero } from './rlLedger'


/** Пробелы ожидаемой строки → неразрывные (форматтеры ставят NBSP между числом и единицей). */
const nb = (t: string): string => t.replace(/ /g, NBSP)

describe('gate view: same verdict as MENTAT (gate_a3)', () => {
  it('reads the live gate_a3 field when the server answers', () => {
    const live = rlFixture().gate_a3!
    const g = gateView(live)
    expect(g).toMatchObject({ pass: false, g1: true, source: 'live', ruleCi: [1.01, 1.92], strictCi: [0, 0.02] })
    expect(strictNearZero(g)).toBe(true)
  })

  it('falls back to the snapshot without a server', () => {
    const g = gateView(null)
    expect(g.source).toBe('snapshot')
    expect(g.pass).toBe(A4S.a3.gate_pass)
    expect(g.pass).toBe(false)
  })
})

describe('A4 champion and the RL-found rules ledger', () => {
  it('C* is the strict champion on 49 of 60', () => {
    const [top] = championShares()
    expect(top).toEqual({ id: 'C*', n: 49, of: 60 })
    expect(poolLabel('C*')).toBe('C* — эвристика + казначейское правило')
    expect(A4S.a4.holdout_complete).toBe(false)
  })

  it('row 1 is the treasury rule in product; row 2 is the unchecked overtime candidate', () => {
    const rows = ledgerRows(gateView(null))
    expect(rows).toHaveLength(2)
    expect(rows[0].check).toEqual({ text: 'выведено RL · первая проверка ✓ · строгий контроль ≈ 0', kind: 'derived' })
    expect(rows[0].origin).not.toMatch(/сид|бит-в-бит/)
    expect(rows[0].status.text).toContain('включено по умолчанию')
    expect(rows[0].status).toMatchObject({ code: 'fin.auto_repay [НОРМ]', href: '#/map/int.finance' })
    expect(rows[0].effectNote).toBe('лучше в 29 из 30')
    expect(rows[1].check.kind).toBe('candidate')
    expect(rows[1].effectNote).toContain('6 из 30')
    const c = overtimeCandidate()
    expect(c).toMatchObject({ n: 6, of: 30, better: 4 })
  })

  it('formats % of portfolio value with explicit sign and U+2212', () => {
    expect(pctV(1.46)).toBe(nb('+1,46 %'))
    expect(pctV(-0.309)).toBe(nb('−0,31 %'))
    expect(pctV(0)).toBe(nb('0 %'))
    expect(pctVci([1.008, 1.917])).toBe(nb('[+1,01;_+1,92] %').replace('_', ' '))
  })
})

describe('agents routed tabs', () => {
  it('maps the anchor to a tab, unknown → verdict', () => {
    expect(agentsTab('evidence')).toBe('evidence')
    expect(agentsTab('guardrails')).toBe('guardrails')
    expect(agentsTab('how')).toBe('how')
    expect(agentsTab(null)).toBe('verdict')
    expect(agentsTab('nope')).toBe('verdict')
  })
})
