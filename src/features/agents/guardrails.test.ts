import { describe, expect, it } from 'vitest'
import type { StructuralMove } from '../../lib/api'
import { ZERO_IMPACT } from '../plan/moves/movesStore'
import { addFrozen, addRejectedMask, clearFrozen, defaultGuardrails, disabledKinds, guardrailRows, parseGuardrails, setLimit, toggleKind, withAlpha } from './guardrails'

const move: StructuralMove = {
  id: 'm1', kind: 'drop', status: 'proposed', targets: { order_idx: [9] }, before: {}, after: {}, impact: ZERO_IMPACT,
  justification: { regime: { id: 'r', label: 'r', share: 0 }, scenarios: [], map_nodes: [] }, masks_checked: [], proposed_at: '',
  agent: { level: 'L2', policy_version: 'v', seed: 1 },
}

describe('guardrails mapping', () => {
  it('defaults: planned kinds off, everything else on, alpha from the scenario', () => {
    const g = defaultGuardrails(0.1)
    expect(g.alpha).toBe(0.1)
    expect(g.allowed.transfer).toBe(false)
    expect(g.allowed.drop).toBe(false)
    expect(g.allowed.shift).toBe(true)
    expect(g.owner).toBe('project')
    expect(disabledKinds(g)).toEqual([])
  })

  it('rows follow the §4.7.1 order and lock planned kinds, NSI availability comes from the backend', () => {
    const rows = guardrailRows(defaultGuardrails(0.1), { reroute: false })
    expect(rows.map((r) => r.meta.kind)).toEqual(['reorder', 'reassign', 'reroute', 'split', 'merge', 'transfer', 'outsource', 'shift', 'drop', 'finance'])
    expect(rows.find((r) => r.meta.kind === 'transfer')).toMatchObject({ locked: true, on: false, state: 'в плане' })
    expect(rows.find((r) => r.meta.kind === 'reroute')!.state).toBe('нет данных НСИ')
    expect(rows.find((r) => r.meta.kind === 'reassign')!.state).toBe('разрешено')
  })

  it('toggles immutably and reports disabled kinds (synonyms collapse to shift)', () => {
    const g = defaultGuardrails(0.1)
    const off = toggleKind(g, 'shift_plus', false)
    expect(off).not.toBe(g)
    expect(off.allowed.shift).toBe(false)
    expect(g.allowed.shift).toBe(true)
    expect(disabledKinds(off)).toEqual(['shift'])
    expect(toggleKind(off, 'shift', false)).toBe(off)
  })

  it('updates limits and alpha with owner mark', () => {
    const g = setLimit(defaultGuardrails(0.1), 'max_moves', 5)
    expect(g.limits.max_moves).toBe(5)
    expect(setLimit(g, 'max_moves', Number.NaN)).toBe(g)
    const run = withAlpha(g, 0.05, 'run')
    expect(run).toMatchObject({ alpha: 0.05, owner: 'run' })
  })

  it('turns rejections and freezes into personal masks without duplicates', () => {
    let g = addRejectedMask(defaultGuardrails(0.1), move, 'неприемлемо для заказчика')
    g = addRejectedMask(g, move, 'повтор')
    expect(g.rejected_masks).toHaveLength(1)
    expect(g.rejected_masks[0]).toMatchObject({ kind: 'drop', reason: 'неприемлемо для заказчика' })
    g = addFrozen(g, { ...move, targets: { op_ids: ['op1', 'op2'], order_idx: [3] } }, 'пин')
    g = addFrozen(g, { ...move, targets: { op_ids: ['op1'] } })
    expect(g.frozen).toHaveLength(3)
    expect(clearFrozen(g).frozen).toEqual([])
  })

  it('parses stored values defensively', () => {
    expect(parseGuardrails(null, 0.1)).toBeNull()
    const g = parseGuardrails({ allowed: { shift: false, bogus: true, drop: 'yes' }, limits: { max_moves: 3, max_shift_days: 'x' }, objective: 'nope' }, 0.2)!
    expect(g.allowed.shift).toBe(false)
    expect('bogus' in g.allowed).toBe(false)
    expect(g.allowed.drop).toBe(false)
    expect(g.limits).toMatchObject({ max_moves: 3, max_shift_days: 10 })
    expect(g.objective).toBe('cvar_profit_cash')
    expect(g.alpha).toBe(0.2)
  })
})
