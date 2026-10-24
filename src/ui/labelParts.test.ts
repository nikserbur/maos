import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { hasGreek, splitGreek } from './labelParts'
import { CapsLabel } from './kit/CapsLabel'

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

describe('CapsLabel кита — σ в капителях не становится Σ', () => {
  it('греческий фрагмент получает no-caps', () => {
    const html = renderToStaticMarkup(createElement('span', { className: 'text-caps' }, createElement(CapsLabel, { text: 'σ прибыли' })))
    expect(html).toBe('<span class="text-caps"><span class="no-caps">σ</span> прибыли</span>')
  })
})
