import { describe, expect, it } from 'vitest'
import { getNode } from '../method-map/registry'
import { MENTAT_TEMPLATES, explainPath, templatesFor } from './explainPath'

describe('explainPath', () => {
  it('walks against data edges from a result to its inputs with depth and edge labels', () => {
    const p = explainPath('crit.schedule')
    expect(p[0]).toMatchObject({ id: 'crit.schedule', depth: 0 })
    const schedule = p.find((s) => s.id === 'dec.schedule')
    expect(schedule).toMatchObject({ depth: 1, via: { label: 'KPI расписания', to: 'crit.schedule' } })
    const durations = p.find((s) => s.id === 'dist.durations')
    expect(durations?.depth).toBe(2)
    // рёбра «объяснение» (сам MENTAT) в путь не входят
    expect(p.some((s) => s.id === 'llm.mentat')).toBe(false)
    // без повторов
    expect(new Set(p.map((s) => s.id)).size).toBe(p.length)
  })

  it('reaches the agent node through guardrails and the profit criterion', () => {
    const ids = explainPath('ag.rl').map((s) => s.id)
    expect(ids).toContain('ag.guardrails')
    expect(ids).toContain('crit.profit')
  })

  it('returns nothing for an unknown node; every template targets a real node', () => {
    expect(explainPath('nope')).toEqual([])
    for (const t of MENTAT_TEMPLATES) expect(getNode(t.target), t.id).toBeDefined()
    expect(templatesFor('agents')[0].id).toBe('rl')
    expect(templatesFor('agents')).toHaveLength(MENTAT_TEMPLATES.length)
  })
})
