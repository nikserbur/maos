import { describe, expect, it } from 'vitest'
import type { CashLpResult } from '../../../lib/api'
import { getNode } from '../../method-map/registry'
import { optFixture, planFixture, rlFixture, stateFixture } from '../mentatFixtures'
import { buildContext, serializeContext, estimateTokens, diffRuns, buildFacts, mapAnchor } from './index'
import { truncateByBudget } from './budget'
import { ctxValue, unitKindOf } from './values'

/** Ожидаемый текст форматтера: пробелы → неразрывные (как в src/explain/format.ts). */
const t = (s: string): string => s.replace(/ /g, '\u00A0')

const base = () => ({ state: stateFixture(), opt: optFixture(), plan: planFixture(), rl: rlFixture(), scenarioName: 'Базовый' })

describe('ctxValue', () => {
  it('formats via the shared formatters and keeps the raw value for verification', () => {
    expect(ctxValue('cvar', 'CVaR', -53_312_000, '₽')).toMatchObject({ value: -53_312_000, unitKind: 'money', text: t('−53,3 млн ₽') })
    expect(ctxValue('a', 'α', 0.1, '%')).toMatchObject({ unitKind: 'pct', text: t('10 %') })
    expect(ctxValue('k', 'ставка', 16, '%/год')).toMatchObject({ unitKind: 'pp', text: t('16 %/год') })
    expect(ctxValue('h', 'часы', 1263, 'ч')?.text).toBe(t('1 263 ч'))
    expect(ctxValue('x', 'нет', null)).toBeNull()
    expect(ctxValue('x', 'NaN', Number.NaN)).toBeNull()
    expect(ctxValue('b', 'флаг', false)).toMatchObject({ unitKind: 'text', text: 'нет' })
    expect(unitKindOf('% стоимости портфеля')).toBe('pp')
  })
})

describe('buildContext', () => {
  it('centres on the asked node and walks the explanation path with distances', () => {
    const ctx = buildContext({ ...base(), asked: 'crit.profit.f.cvar' })
    expect(ctx.asked).toBe('crit.profit.f.cvar')
    expect(ctx.nodes[0]).toMatchObject({ id: 'crit.profit.f.cvar', distance: 0, status: 'расчёт' })
    const cvar = ctx.nodes[0].values?.find((v) => v.key === 'cvar')
    expect(cvar?.text).toBe(t('−53,3 млн ₽'))
    expect(ctx.nodes.find((n) => n.id === 'crit.profit')?.distance).toBe(1)
    expect(ctx.nodes.find((n) => n.id === 'dec.portfolio')?.distance).toBe(2)
    // параметр α с паспортом и факт вкладов в риск
    expect(ctx.nodes.find((n) => n.id === 'crit.profit.alpha')).toMatchObject({ kind: 'parameter', values: [expect.objectContaining({ text: t('10 %') })] })
    expect(ctx.nodes.find((n) => n.id === 'crit.profit.risk_contrib')?.values?.[0]).toMatchObject({ key: 'risk_1', unitKind: 'pct', text: t('58 %') })
    // рёбра только между узлами контекста и без рёбер «объяснение»
    const ids = new Set(ctx.nodes.map((n) => n.id))
    expect(ctx.edges.length).toBeGreaterThan(0)
    for (const e of ctx.edges) {
      expect(ids.has(e.from) && ids.has(e.to)).toBe(true)
      expect(e.kind).not.toBe('explain')
    }
  })

  it('every node has an id, a map anchor that exists on the map, and no duplicates', () => {
    const ctx = buildContext({ ...base(), asked: 'ag.rl', compare: optFixture({ run_id: 'run-bbbb2222' }) })
    expect(new Set(ctx.nodes.map((n) => n.id)).size).toBe(ctx.nodes.length)
    for (const n of ctx.nodes) {
      expect(n.id).toMatch(/^[a-z0-9_.]+$/)
      expect(getNode(n.mapNode), n.id).toBeDefined()
      for (const v of n.values ?? []) expect(v.text).not.toBe('—')
    }
    expect(ctx.nodes.find((n) => n.id === 'ag.rl.gate')).toMatchObject({ distance: 1 })
  })

  it('is deterministic: the same input gives byte-identical prompt JSON', () => {
    const a = serializeContext(buildContext({ ...base(), asked: 'dec.schedule.f.bottleneck' }))
    const b = serializeContext(buildContext({ ...base(), asked: 'dec.schedule.f.bottleneck' }))
    expect(a).toBe(b)
    expect(a).toContain('"Токарный"')
    // сырые числа в промпт не попадают — только текст
    expect(a).not.toContain('53312000')
  })

  it('respects the token budget and drops the farthest nodes first', () => {
    const full = buildContext({ ...base(), asked: 'crit.profit', budgetTokens: 20_000 })
    const small = buildContext({ ...base(), asked: 'crit.profit', budgetTokens: 900 })
    expect(small.truncated.usedTokens).toBeLessThanOrEqual(900)
    expect(small.truncated.dropped).toBeGreaterThan(0)
    expect(small.nodes.length).toBeLessThan(full.nodes.length)
    expect(small.nodes[0].id).toBe('crit.profit')
    const maxKept = Math.max(...small.nodes.map((n) => n.distance))
    const minDropped = Math.min(...full.nodes.filter((n) => !small.nodes.some((k) => k.id === n.id)).map((n) => n.distance))
    expect(maxKept).toBeLessThanOrEqual(minDropped + 1)
    expect(estimateTokens(serializeContext(small))).toBeLessThan(estimateTokens(serializeContext(full)))
  })

  it('never throws on an unsolved cash LP (time_limit, no duals) and skips only the cash facts', () => {
    const cash = { status: 'time_limit', reason: 'Time limit reached' } as unknown as CashLpResult
    const build = () => buildContext({ ...base(), cash, asked: 'dec.cash' })
    expect(build).not.toThrow()
    const ctx = build()
    expect(ctx.nodes.find((n) => n.id === 'dec.cash.duals')).toBeUndefined()
    expect(ctx.nodes.length).toBeGreaterThan(0)
    // мощности берутся из точной LP портфеля, касса без duals их не ломает
    expect(buildFacts({ opt: optFixture(), cash }).find((f) => f.id === 'dec.portfolio.duals')).toBeDefined()
    expect(buildFacts({ cash }).find((f) => f.id === 'dec.portfolio.duals')).toBeUndefined()
  })

  it('a fact can be the asked node; an unknown node gives an empty context', () => {
    const ctx = buildContext({ ...base(), asked: 'ag.rl.gate' })
    expect(ctx.nodes[0]).toMatchObject({ id: 'ag.rl.gate', distance: 0 })
    expect(ctx.nodes.find((n) => n.id === 'ag.rl')?.distance).toBe(1)
    expect(buildContext({ ...base(), asked: 'nope' }).nodes).toEqual([])
  })
})

describe('facts and diffs', () => {
  it('builds risk contributions, capacity duals and the RL gate with CI in percentage points', () => {
    const facts = buildFacts({ opt: optFixture(), rl: rlFixture(), productNames: { p1: 'Вал' } })
    const contrib = facts.find((f) => f.id === 'crit.profit.risk_contrib')
    expect(contrib?.values?.[0].label).toContain('Вал')
    expect(facts.find((f) => f.id === 'dec.portfolio.duals')?.values?.[0]).toMatchObject({ text: t('1,85 тыс. ₽') })
    const gate = facts.find((f) => f.id === 'ag.rl.gate')
    expect(gate?.values?.find((v) => v.key === 'gate_pass')?.text).toBe('нет')
    expect(gate?.values?.find((v) => v.key === 'vs_rule_lo')).toMatchObject({ unitKind: 'pp', value: 1.01 })
  })

  it('diffs two runs as current − compare and flags unequal tails', () => {
    const d = diffRuns(optFixture(), optFixture({ run_id: 'run-b', alpha: 0.05, robust: { ...optFixture().robust, metrics: { ...optFixture().robust.metrics, cvar: -50_000_000 } } }))
    const cvar = d.find((n) => n.id === 'diff.opt.cvar')
    expect(cvar?.values?.find((v) => v.key === 'delta')).toMatchObject({ value: -3_312_000, text: t('−3,31 млн ₽') })
    expect(d[0].note).toContain('условны')
    expect(diffRuns(optFixture(), null)).toEqual([])
  })

  it('truncateByBudget keeps the first item and skips what does not fit', () => {
    const r = truncateByBudget([5, 4, 3, 1], (x) => x, 6)
    expect(r.kept).toEqual([5, 1])
    expect(r.dropped).toBe(2)
    expect(truncateByBudget([9], (x) => x, 1, false).kept).toEqual([])
  })
})

describe('mapAnchor', () => {
  it('maps facts and diffs to the nearest map node', () => {
    expect(mapAnchor('crit.profit.f.cvar')).toBe('crit.profit.f.cvar')
    expect(mapAnchor('ag.rl.move.1')).toBe('ag.rl')
    expect(mapAnchor('dec.invest.cand.2')).toBe('dec.invest')
    expect(mapAnchor('zzz.yyy')).toBeNull()
  })
})
