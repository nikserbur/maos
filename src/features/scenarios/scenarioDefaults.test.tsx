/**
 * Умолчания сценария (P-56): показанное = посчитанное движком; 0 переживает сохранение; незаданные
 * условия не записываются в PUT (NULL → умолчание движка); инфляция по умолчанию — последнее
 * наблюдение ЦБ РФ из генератора; разброс 0,06 = ×1 к истории; изменённое поле — «■ вручную».
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PriceScenario } from '../../lib/api'
import { ParamField } from '../../ui/ParamField'
import { SCENARIO_DEFAULTS, changedKeys, defaultsFor, effectiveScenario, endDateOf, fieldBadge, inflationFromYoy, isDefaultValue, numOr, resetPatch, yoyFromMonthly } from './scenarioDefaults'
import { payloadOf } from './scenarioPayload'

const sc = (over: Partial<PriceScenario> = {}): PriceScenario => ({ id: 's1', name: 'Базовый', description: '', horizon_hours: '720', created_at: '', ...over })

describe('numOr', () => {
  it('сохраняет 0 и берёт умолчание только для пустого/мусора', () => {
    expect(numOr('0', 0.5)).toBe(0)
    expect(numOr(0, 0.5)).toBe(0)
    expect(numOr('', 0.5)).toBe(0.5)
    expect(numOr(undefined, 0.5)).toBe(0.5)
    expect(numOr('abc', 0.5)).toBe(0.5)
    expect(numOr('0.25', 0.5)).toBe(0.25)
  })
})

describe('payloadOf', () => {
  it('ρ = 0 уходит в PUT как 0, а не как умолчание 0,5', () => {
    expect(payloadOf(sc({ market_corr: '0' })).market_corr).toBe(0)
    expect(payloadOf(sc({ inflation: '0', demand: '0.85' })).inflation).toBe(0)
  })

  it('умолчания шапки и тела PUT совпадают (незаданная доля изделия — 60 %, как в движке)', () => {
    const eff = effectiveScenario(sc())
    const body = payloadOf(sc())
    expect(eff.max_share).toBe(0.6)
    expect(body.max_share).toBe(eff.max_share)
    expect(body.alpha).toBe(eff.alpha)
    expect(body.market_corr).toBe(eff.market_corr)
    expect(body.objective).toBe(eff.objective)
  })

  it('незаданные условия не уходят числом, а уходят в `reset` (NULL в БД) — правка α не замораживает умолчание', () => {
    const body = payloadOf(sc({ alpha: '0.15' }))
    for (const k of ['inflation', 'fx', 'demand', 'volatility', 'months'] as const) expect(body[k]).toBeUndefined()
    expect(body.reset).toEqual(['inflation', 'fx', 'demand', 'volatility'])
    expect(payloadOf(sc({ volatility: '0.12', months: '12' }))).toMatchObject({ volatility: 0.12, months: 12 })
    expect(payloadOf(sc({ volatility: '0.12', inflation: '0.01' })).reset).toEqual(['fx', 'demand'])
  })

  it('возвращает все поля, включая устаревшие (сохранение «туда и обратно»)', () => {
    const body = payloadOf(sc({ sanctions: '0.3', key_rate: '12', macro_mode: '{"mode":"regime","stress":{"regime":1}}' }))
    expect(body.sanctions).toBe(0.3)
    expect(body.key_rate).toBe(12)
    expect(body.macro_mode).toEqual({ mode: 'regime', stress: { regime: 1 } })
  })
})

describe('эффективные значения и изменённые поля', () => {
  it('явное значение, равное умолчанию, — тоже умолчание', () => {
    const eff = effectiveScenario(sc({ alpha: '0.1', max_share: '0.6' }))
    expect(eff.isDefault.alpha).toBe(true)
    expect(eff.isDefault.max_share).toBe(true)
    expect(isDefaultValue('market_corr', 0.25)).toBe(false)
  })

  it('считает изменённые поля и строит патч «вернуть все» (инфляция — из генератора)', () => {
    const lastObs = { month: '2026-09', cpi_yoy_pp: 6.35, key_pp: 14, usd_rub: 84.43 }
    const s = sc({ inflation: '0', volatility: '0.06', fx: '1.2' })
    expect(changedKeys(s, undefined, { lastObs })).toEqual(['inflation', 'fx'])
    // «Вернуть» условие — пустое поле (NULL), а не число умолчания: умолчание дальше следует за данными ЦБ РФ.
    expect(resetPatch(['inflation', 'fx'], { lastObs })).toEqual({ inflation: '', fx: '' })
    expect(resetPatch(['alpha', 'market_corr'])).toEqual({ alpha: String(SCENARIO_DEFAULTS.alpha), market_corr: String(SCENARIO_DEFAULTS.market_corr) })
    expect(changedKeys(sc({ inflation: String(inflationFromYoy(6.35)) }), undefined, { lastObs })).toEqual([])
  })

  it('инфляция по умолчанию — 6,35 % г/г ЦБ РФ ≈ 0,51 %/мес; незаданная — умолчание, а не 0', () => {
    const lastObs = { month: '2026-09', cpi_yoy_pp: 6.35, key_pp: 14, usd_rub: 84.43 }
    const d = defaultsFor({ lastObs }).inflation
    expect(d).toBeCloseTo(0.005143, 5)
    expect(yoyFromMonthly(d)).toBeCloseTo(0.0635, 10)
    const eff = effectiveScenario(sc(), { lastObs })
    expect(eff.inflation).toBe(d)
    expect(eff.isDefault.inflation).toBe(true)
    expect(effectiveScenario(sc()).inflation).toBe(SCENARIO_DEFAULTS.inflation)   // без генератора — как бэкенд: 1 %/мес
    expect(effectiveScenario(sc()).volatility).toBe(0.06)                          // ×1 к истории, нейтраль движка
  })

  it('конец горизонта выводится из начала и числа месяцев', () => {
    expect(endDateOf('2026-10-01', 6)).toBe('2027-04-01')
    expect(endDateOf('', 6)).toBe('')
  })
})

describe('бейдж поля', () => {
  it('изменённое поле — «■ вручную», умолчание — статус паспорта', () => {
    expect(fieldBadge('market_corr', 0.25, 'НОРМ')).toEqual({ provenance: 'manual' })
    expect(fieldBadge('market_corr', 0.5, 'НОРМ')).toEqual({ provenance: 'default', status: 'НОРМ' })
  })

  it('ParamField «Корреляция цен ρ 0,25» рисует data-key="manual"', () => {
    const html = renderToStaticMarkup(<ParamField label="Корреляция цен ρ" value={0.25} {...fieldBadge('market_corr', 0.25, 'НОРМ')} />)
    expect(html).toContain('data-key="manual"')
    const dflt = renderToStaticMarkup(<ParamField label="Корреляция цен ρ" value={0.5} {...fieldBadge('market_corr', 0.5, 'НОРМ')} />)
    expect(dflt).toContain('data-key="normative"')
  })
})
