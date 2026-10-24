import { describe, expect, it } from 'vitest'
import { KNOWN_IDS, financingLabel, fitLabel, humanize, lpStatusLabel, macroVarLabel, objectiveLabel, ruleLabel } from './labels'

const RAW = /meanvariance|minregret|worstcase|key_pp|cpi_yoy_pp|usd_rub|empirical_blocks|time_limit|recourse|_/

describe('labels — сырой id никогда не возвращается', () => {
  const cases: Array<[string, readonly string[], (id: string, f: 'short' | 'long') => string]> = [
    ['objective', KNOWN_IDS.objective, objectiveLabel],
    ['rule', KNOWN_IDS.rule, ruleLabel],
    ['macro', KNOWN_IDS.macro, macroVarLabel],
    ['financing', KNOWN_IDS.financing, financingLabel],
    ['fit', KNOWN_IDS.fit, (id, f) => fitLabel(id, f)],
    ['lpStatus', KNOWN_IDS.lpStatus, lpStatusLabel],
  ]
  it.each(cases)('%s: короткая и длинная формы — человеческие', (_, ids, fn) => {
    for (const id of ids) {
      for (const form of ['short', 'long'] as const) {
        const text = fn(id, form)
        expect(text.length).toBeGreaterThan(0)
        expect(text).not.toMatch(RAW)
        if (id.length > 4 && id === id.toLowerCase()) expect(text).not.toBe(id)
      }
    }
  })

  it('канонические подписи', () => {
    expect(objectiveLabel('meanvariance')).toBe('E − λ·σ')
    expect(objectiveLabel('meanvariance', 'long')).toBe('среднее − риск (E − λ·σ)')
    expect(objectiveLabel('worstcase')).toBe('худший случай')
    expect(objectiveLabel('minregret')).toBe('мин. сожаление')
    expect(ruleLabel('auto', 'long')).toBe('авто (лучшее правило)')
    expect(ruleLabel('CR')).toBe('CR')
    expect(macroVarLabel('key_pp')).toBe('ключевая ставка')
    expect(macroVarLabel('cpi_yoy_pp')).toBe('инфляция')
    expect(macroVarLabel('usd_rub')).toBe('курс $/₽')
    expect(financingLabel('recourse')).toBe('по факту')
    expect(financingLabel('first')).toBe('график заранее')
    expect(fitLabel('empirical_blocks')).toBe('эмпирическое (блочный бутстреп)')
    expect(lpStatusLabel('time_limit')).toBe('лимит времени')
  })

  it('нормальное — без ν; t — с ν; неизвестное семейство — «другое распределение»', () => {
    expect(fitLabel('normal', 'short', { nu: 5 })).toBe('нормальное')
    expect(fitLabel('t', 'short', { nu: 4.2 })).toBe('t-Стьюдента, ν = 4')
    expect(fitLabel('weird_family')).toBe('другое распределение')
  })

  it('неизвестный id — очеловеченный запасной вариант без «_» и капса', () => {
    expect(objectiveLabel('some_new_goal')).toBe('some new goal')
    expect(humanize('SAMPLE')).toBe('sample')
    expect(lpStatusLabel('OPTIMAL')).toBe('оптимум')
  })
})
