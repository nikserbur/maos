import { describe, expect, it } from 'vitest'
import type { StructuralMove } from '../../../lib/api'
import { EMPTY_DECISIONS, ZERO_IMPACT, acceptSafe, clearDecision, decide, dependantsOf, filterMoves, isSafe, parentsOf, sortByGain, statusOf, summarize } from './movesStore'

const mk = (id: string, patch: Partial<StructuralMove> = {}, gain = 1, win = 0.9, ciLo = 0.2): StructuralMove => ({
  id, kind: 'shift', status: 'proposed', targets: { order_idx: [1] }, before: {}, after: {},
  impact: { ...ZERO_IMPACT, profit: { e_before: 0, e_after: 0, cvar_before: -2, cvar_after: -2 + gain }, win_share: win, ci95: [ciLo, ciLo + 1] },
  justification: { regime: { id: 'r1', label: 'скачок ставки', share: 0.18 }, scenarios: [], map_nodes: [] },
  masks_checked: [], proposed_at: '2026-10-22', agent: { level: 'L2', policy_version: 'test', seed: 1 },
  ...patch,
})

// A ← B ← C (C зависит от B, B от A); D — независимый и небезопасный
const A = mk('A', {}, 1.4)
const B = mk('B', { depends_on: ['A'] }, 0.3)
const C = mk('C', { depends_on: ['B'] }, 0.2)
const D = mk('D', { kind: 'drop' }, 0.2, 0.58, -0.1)
const MOVES = [A, B, C, D]

describe('movesStore: dependencies', () => {
  it('lists transitive parents nearest-first and transitive dependants', () => {
    expect(parentsOf(MOVES, 'C')).toEqual(['B', 'A'])
    expect(parentsOf(MOVES, 'A')).toEqual([])
    expect(dependantsOf(MOVES, 'A')).toEqual(['B', 'C'])
    expect(dependantsOf(MOVES, 'D')).toEqual([])
  })

  it('refuses to accept a dependant alone and names the parents it needs', () => {
    const r = decide(EMPTY_DECISIONS, MOVES, 'C', 'accept')
    expect(r.needs).toEqual(['B', 'A'])
    expect(r.state).toBe(EMPTY_DECISIONS)
  })

  it('accepts the whole package with cascade', () => {
    const r = decide(EMPTY_DECISIONS, MOVES, 'C', 'accept', { cascade: true })
    expect(r.needs).toEqual([])
    expect(statusOf(A, r.state)).toBe('accepted')
    expect(statusOf(B, r.state)).toBe('accepted')
    expect(statusOf(C, r.state)).toBe('accepted')
    expect(statusOf(D, r.state)).toBe('proposed')
  })

  it('rejecting a parent cascades to dependants with a reason and keeps the original state immutable', () => {
    const r = decide(EMPTY_DECISIONS, MOVES, 'A', 'reject', { reason: 'нет поставщика' })
    expect(r.cascaded).toEqual(['B', 'C'])
    expect(r.state.reasons.A).toBe('нет поставщика')
    expect(r.state.reasons.C).toMatch(/зависит/)
    expect(statusOf(B, r.state)).toBe('rejected')
    expect(EMPTY_DECISIONS.decisions).toEqual({})
  })

  it('freezes without cascade and clears a decision back to proposed', () => {
    const frozen = decide(EMPTY_DECISIONS, MOVES, 'A', 'freeze').state
    expect(statusOf(A, frozen)).toBe('frozen')
    expect(statusOf(B, frozen)).toBe('proposed')
    const cleared = clearDecision(frozen, 'A')
    expect(statusOf(A, cleared)).toBe('proposed')
    expect(clearDecision(cleared, 'A')).toBe(cleared)
  })

  it('ignores unknown ids', () => {
    expect(decide(EMPTY_DECISIONS, MOVES, 'nope', 'accept').state).toBe(EMPTY_DECISIONS)
  })
})

describe('movesStore: safe package and summary', () => {
  it('classifies safety by win share and CI lower bound', () => {
    expect(isSafe(A)).toBe(true)
    expect(isSafe(D)).toBe(false)
    expect(isSafe(mk('x', {}, 1, 0.8, 0))).toBe(false)
  })

  it('accepts all safe moves including their parents, skipping frozen chains', () => {
    const r = acceptSafe(EMPTY_DECISIONS, MOVES)
    expect(r.accepted.sort()).toEqual(['A', 'B', 'C'])
    expect(statusOf(D, r.state)).toBe('proposed')
    const frozenA = decide(EMPTY_DECISIONS, MOVES, 'A', 'freeze').state
    const r2 = acceptSafe(frozenA, MOVES)
    expect(r2.accepted).toEqual([])
  })

  it('summarizes counts, accepted gains and disabled kinds', () => {
    const st = acceptSafe(EMPTY_DECISIONS, MOVES).state
    const s = summarize(MOVES, decide(st, MOVES, 'D', 'reject').state, { shift: true, drop: false, transfer: false })
    expect(s).toMatchObject({ proposed: 0, accepted: 3, rejected: 1, frozen: 0, disabledKinds: 2 })
    expect(s.gainAccepted).toBeCloseTo(1.9)
  })

  it('sorts by CVaR gain descending and filters by kind/status', () => {
    expect(sortByGain(MOVES).map((m) => m.id)).toEqual(['A', 'B', 'C', 'D'])
    expect(filterMoves(MOVES, EMPTY_DECISIONS, { kind: 'drop', status: 'all' }).map((m) => m.id)).toEqual(['D'])
    const st = decide(EMPTY_DECISIONS, MOVES, 'A', 'freeze').state
    expect(filterMoves(MOVES, st, { kind: 'all', status: 'frozen' }).map((m) => m.id)).toEqual(['A'])
  })
})
