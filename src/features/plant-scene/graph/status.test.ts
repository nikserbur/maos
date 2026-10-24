import { describe, expect, it } from 'vitest'
import { aggregateStatus, rollupStatus, statusWord } from './status'
import { NSI_STATUS_OPTIONS, statusFromNsi } from '../types'

describe('aggregateStatus — худший статус потомков', () => {
  it('пустой список и только выведенные станки дают ○', () => {
    expect(aggregateStatus([])).toBe('idle')
    expect(aggregateStatus(['idle', 'idle'])).toBe('idle')
  })

  it('ТО одного станка поднимает цех до ▲, авария — до ■', () => {
    expect(aggregateStatus(['running', 'idle'])).toBe('running')
    expect(aggregateStatus(['running', 'setup', 'running'])).toBe('setup')
    expect(aggregateStatus(['setup', 'down', 'running'])).toBe('down')
  })
})

describe('rollupStatus — снизу вверх, без мутации', () => {
  const nodes = [
    { id: 'f', parentId: null, status: 'idle' as const },
    { id: 's1', parentId: 'f', status: 'idle' as const },
    { id: 's2', parentId: 'f', status: 'idle' as const },
    { id: 'm1', parentId: 's1', status: 'running' as const },
    { id: 'm2', parentId: 's1', status: 'setup' as const },
    { id: 'm3', parentId: 's2', status: 'running' as const },
  ]

  it('цех берёт худший статус станков, завод — худший статус цехов', () => {
    const out = rollupStatus(nodes)
    const by = new Map(out.map((n) => [n.id, n.status]))
    expect(by.get('s1')).toBe('setup')
    expect(by.get('s2')).toBe('running')
    expect(by.get('f')).toBe('setup')
    expect(by.get('m1')).toBe('running')
  })

  it('исходные узлы не меняются, пустой контейнер сохраняет свой статус', () => {
    const lone = [{ id: 'empty', parentId: null, status: 'idle' as const }]
    expect(rollupStatus(lone)[0]).toBe(lone[0])
    rollupStatus(nodes)
    expect(nodes[1].status).toBe('idle')
  })
})

describe('словарь статусов станка', () => {
  it('справочник → схема: ТО — ▲ «ТО / ремонт», выведен — ○', () => {
    expect(statusFromNsi('active')).toBe('running')
    expect(statusFromNsi('maintenance')).toBe('setup')
    expect(statusFromNsi('decommissioned')).toBe('idle')
    expect(statusFromNsi('')).toBe('running')
    expect(NSI_STATUS_OPTIONS.map((o) => o.label)).toEqual(['В работе', 'ТО / ремонт', 'Выведен'])
  })

  it('у контейнера ○ — «нет станков в работе», а не «выведен»', () => {
    expect(statusWord('shop', 'idle')).toBe('Нет станков в работе')
    expect(statusWord('machine', 'idle')).toBe('Выведен')
    expect(statusWord('factory', 'setup')).toBe('ТО / ремонт')
  })
})
