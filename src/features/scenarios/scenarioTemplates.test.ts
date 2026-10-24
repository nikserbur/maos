import { describe, expect, it } from 'vitest'
import { SCENARIO_TEMPLATES, isDuplicateName, uniqueName } from './scenarioTemplates'
import { SCENARIO_DEFAULTS } from './scenarioDefaults'

describe('шаблоны и имена сценариев', () => {
  it('занятое имя получает номер; повтор распознаётся без учёта регистра', () => {
    expect(uniqueName('Базовый', ['Базовый'])).toBe('Базовый 2')
    expect(uniqueName('Базовый', ['базовый', 'Базовый 2'])).toBe('Базовый 3')
    expect(uniqueName('Новый', [])).toBe('Новый')
    expect(isDuplicateName(' базовый ', ['Базовый'])).toBe(true)
    expect(isDuplicateName('Другой', ['Базовый'])).toBe(false)
  })

  it('шаблоны берут общие значения из умолчаний движка; источник — без кодов паспорта', () => {
    for (const t of SCENARIO_TEMPLATES) {
      expect(t.values.alpha).toBe(SCENARIO_DEFAULTS.alpha)
      expect(t.values.max_share).toBe(SCENARIO_DEFAULTS.max_share)
      for (const r of t.passport) expect(r.source).not.toMatch(/r1\.|§|\/api|macro\./)
    }
  })
})
