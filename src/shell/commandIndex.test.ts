import { describe, expect, it } from 'vitest'
import { groupCommands, isMentatShortcut, isPaletteShortcut, scoreItem, searchCommands, type CommandItem } from './commandIndex'

const ITEMS: CommandItem[] = [
  { id: 's:plan', group: 'screen', title: 'План', hint: 'Решения · Стадия 1', keywords: ['plan', 'schedule'] },
  { id: 's:agents', group: 'screen', title: 'Агенты', hint: 'Решения', keywords: ['agents', 'rl'] },
  { id: 'n:ag.rl', group: 'node', title: 'Агент RL L0/L2 со структурными ходами', hint: '[6] Агенты' },
  { id: 'r:1', group: 'run', title: 'Прогон EDD · 22.10 18:55', hint: 'E[Cmax] 61 ч' },
  { id: 'a:theme', group: 'action', title: 'Переключить тему', keywords: ['theme', 'dark', 'light'] },
]

describe('command index', () => {
  it('ranks title prefix above word prefix above substring', () => {
    expect(scoreItem(ITEMS[0], 'пла')).toBe(3)
    expect(scoreItem(ITEMS[2], 'структ')).toBe(2)
    expect(scoreItem(ITEMS[2], 'ходами')).toBe(2)
    expect(scoreItem(ITEMS[3], 'cmax')).toBe(1)
    expect(scoreItem(ITEMS[0], 'xyz')).toBe(0)
  })

  it('matches latin keywords and ё/е, empty query returns everything in group order', () => {
    expect(searchCommands(ITEMS, 'rl').map((i) => i.id)).toEqual(['s:agents', 'n:ag.rl'])
    expect(searchCommands(ITEMS, 'переключить тёму').map((i) => i.id)).toEqual(['a:theme'])
    expect(searchCommands(ITEMS, '').map((i) => i.group)).toEqual(['action', 'screen', 'screen', 'run', 'node'])
    expect(searchCommands(ITEMS, '', 2)).toHaveLength(2)
  })

  it('groups results preserving order of first appearance', () => {
    const g = groupCommands(searchCommands(ITEMS, 'а'))
    expect(g.map((x) => x.group)).toEqual(['screen', 'node'])
    expect(g[0].items.map((i) => i.id)).toEqual(['s:agents', 's:plan'])
  })

  it('recognises Cmd/Ctrl+K in both layouts', () => {
    expect(isPaletteShortcut({ key: 'k', metaKey: true, ctrlKey: false, altKey: false })).toBe(true)
    expect(isPaletteShortcut({ key: 'л', metaKey: false, ctrlKey: true, altKey: false })).toBe(true)
    expect(isPaletteShortcut({ key: 'k', metaKey: false, ctrlKey: false, altKey: false })).toBe(false)
    expect(isPaletteShortcut({ key: 'k', metaKey: true, ctrlKey: false, altKey: true })).toBe(false)
  })

  it('recognises Cmd/Ctrl+J for MENTAT in both layouts', () => {
    expect(isMentatShortcut({ key: 'j', metaKey: true, ctrlKey: false, altKey: false })).toBe(true)
    expect(isMentatShortcut({ key: 'о', metaKey: false, ctrlKey: true, altKey: false })).toBe(true)
    expect(isMentatShortcut({ key: 'j', metaKey: false, ctrlKey: false, altKey: false })).toBe(false)
    expect(isMentatShortcut({ key: 'k', metaKey: true, ctrlKey: false, altKey: false })).toBe(false)
  })
})
