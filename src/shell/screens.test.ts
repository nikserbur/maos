import { describe, expect, it } from 'vitest'
import { SCREENS, SHORT_ALLOW, buildCrumbs, screenTitle } from './screens'
import { setCrumbTitle } from './crumbs'

const last = (c: ReadonlyArray<{ label: string }>): string | undefined => c[c.length - 1]?.label

describe('screen names — одно имя на экран', () => {
  it('подпись рельсы — сокращение (префикс) имени или из списка допустимых', () => {
    for (const s of SCREENS) {
      const short = s.short ?? s.label
      const ok = s.label.startsWith(short) || SHORT_ALLOW[s.id] === short
      expect(ok, `${s.id}: «${short}» не сокращение «${s.label}»`).toBe(true)
    }
  })

  it('канонические имена', () => {
    expect(screenTitle('optimization')).toBe('Портфель')
    expect(screenTitle('aiflow')).toBe('AI-воркфлоу')
    expect(screenTitle('nsi')).toBe('Справочники')
    expect(SCREENS.find((s) => s.id === 'nsi')?.short).toBe('НСИ')
  })

  it('имена уникальны, полоса методологии — на 7 экранах', () => {
    expect(new Set(SCREENS.map((s) => s.label)).size).toBe(SCREENS.length)
    expect(SCREENS.filter((s) => s.pipeline)).toHaveLength(7)
  })

  it('палитра находит «Портфель» по прежнему имени', () => {
    expect(SCREENS.find((s) => s.id === 'optimization')?.keywords).toContain('оптимизация')
  })
})

describe('крошки', () => {
  it('корень без якоря — одно имя экрана', () => {
    expect(buildCrumbs('plan', null)).toEqual([{ label: 'План' }])
  })

  it('«Справочники › Техкарты › ТК …» с именем, которое сообщил экран', () => {
    setCrumbTitle('nsi', 'routing/42', 'ТК-12 Вал')
    expect(buildCrumbs('nsi', 'routing/42')).toEqual([
      { label: 'Справочники', href: '#/nsi' },
      { label: 'Техкарты', href: '#/nsi/routing' },
      { label: 'ТК-12 Вал' },
    ])
    setCrumbTitle('nsi', 'routing/42', null)
    expect(last(buildCrumbs('nsi', 'routing/42'))).toBe('Техкарта')
  })

  it('мастер плана и прогон без хэша', () => {
    expect(buildCrumbs('plan', 'new/objective').map((c) => c.label)).toEqual(['План', 'Новый план', 'Цель и риск'])
    expect(last(buildCrumbs('plan', 'run/28'))).toBe('План №28')
    expect(last(buildCrumbs('plan', 'run/a3f9c2'))).toBe('Прогон')
  })
})
