import { afterEach, describe, expect, it } from 'vitest'
import { getAnimationPaused, initialPaused, prefersReducedMotion, resetMotionForTests, setAnimationPaused } from './motion'

const store = (v: string | null) => ({ getItem: () => v })

describe('motion', () => {
  afterEach(() => resetMotionForTests())

  it('без окна «меньше движения» выключено', () => {
    expect(prefersReducedMotion()).toBe(false)
  })

  it('пауза: явный выбор вкладки важнее системной настройки', () => {
    expect(initialPaused(store('1'), false)).toBe(true)
    expect(initialPaused(store('0'), true)).toBe(false)
    expect(initialPaused(store(null), true)).toBe(true)
    expect(initialPaused(null, false)).toBe(false)
  })

  it('битое хранилище не ломает чтение', () => {
    const broken = { getItem: () => { throw new Error('denied') } }
    expect(initialPaused(broken, true)).toBe(true)
  })

  it('setAnimationPaused меняет общее состояние без sessionStorage (node)', () => {
    expect(getAnimationPaused()).toBe(false)
    setAnimationPaused(true)
    expect(getAnimationPaused()).toBe(true)
    setAnimationPaused(false)
    expect(getAnimationPaused()).toBe(false)
  })
})
