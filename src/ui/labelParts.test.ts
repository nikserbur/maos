import { describe, expect, it } from 'vitest'
import { hasGreek, splitGreek } from './labelParts'

describe('splitGreek — греческие буквы в caps-подписях', () => {
  it('выделяет α в начале подписи отдельным фрагментом', () => {
    expect(splitGreek('α хвоста')).toEqual([
      { text: 'α', greek: true },
      { text: ' хвоста', greek: false },
    ])
  })

  it('оставляет подпись без греческих букв одним фрагментом', () => {
    expect(splitGreek('Инфляция')).toEqual([{ text: 'Инфляция', greek: false }])
    expect(hasGreek('Инфляция')).toBe(false)
  })

  it('разбивает несколько греческих фрагментов, включая конец строки', () => {
    expect(splitGreek('Корреляция ρ и σ')).toEqual([
      { text: 'Корреляция ', greek: false },
      { text: 'ρ', greek: true },
      { text: ' и ', greek: false },
      { text: 'σ', greek: true },
    ])
    expect(hasGreek('β')).toBe(true)
  })

  it('пустая строка → пустой список', () => {
    expect(splitGreek('')).toEqual([])
  })
})
