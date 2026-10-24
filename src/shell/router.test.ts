import { describe, expect, it } from 'vitest'
import { anchorParts, blockingGuard, buildHash, confirmLeave, joinAnchor, parseHash, registerLeaveGuard } from './router'

describe('router — адрес как состояние', () => {
  it('параметры запроса переживают круг build → parse (кириллица, пробелы, &)', () => {
    const params = { type: 'errors', q: 'план №28 & касса' }
    const hash = buildHash('admin', null, params)
    expect(hash.startsWith('#/admin?')).toBe(true)
    expect(parseHash(hash)).toEqual({ screenId: 'admin', anchor: null, params })
  })

  it('якорь и параметры вместе; пустые параметры не пишутся', () => {
    const hash = buildHash('plan', 'run/28/moves', { sel: '12', empty: '', gone: null })
    expect(hash).toBe('#/plan/run/28/moves?sel=12')
    expect(parseHash(hash)).toEqual({ screenId: 'plan', anchor: 'run/28/moves', params: { sel: '12' } })
  })

  it('прежние адреса без запроса разбираются как раньше', () => {
    expect(parseHash('#/methodology/cvar-tail')).toEqual({ screenId: 'methodology', anchor: 'cvar-tail', params: {} })
    expect(parseHash('')).toEqual({ screenId: 'scheme', anchor: null, params: {} })
    expect(parseHash('#/?x=1')).toEqual({ screenId: 'scheme', anchor: null, params: { x: '1' } })
  })

  it('сегменты якоря', () => {
    expect(anchorParts('run/28/moves')).toEqual(['run', '28', 'moves'])
    expect(anchorParts(null)).toEqual([])
    expect(joinAnchor('run', 28, undefined, '')).toBe('run/28')
  })
})

describe('страж ухода', () => {
  it('без несохранённого — уход без вопроса; с ним — спрашивает и уважает ответ', () => {
    let dirty = false
    const off = registerLeaveGuard(() => dirty)
    expect(blockingGuard()).toBeUndefined()
    expect(confirmLeave(() => false)).toBe(true)
    dirty = true
    const asked: string[] = []
    expect(confirmLeave((m) => { asked.push(m); return false })).toBe(false)
    expect(asked).toEqual(['Есть несохранённые изменения — уйти?'])
    expect(confirmLeave(() => true)).toBe(true)
    off()
    expect(blockingGuard()).toBeUndefined()
  })
})
