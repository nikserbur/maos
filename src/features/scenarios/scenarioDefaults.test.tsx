/**
 * Умолчания сценария (P-56): показанное = посчитанное движком; 0 переживает сохранение; изменённое
 * поле подписывается «■ вручную», умолчание — статусом паспорта.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PriceScenario } from '../../lib/api'
import { ParamField } from '../../ui/ParamField'
import { SCENARIO_DEFAULTS, changedKeys, effectiveScenario, endDateOf, fieldBadge, isDefaultValue, numOr, resetPatch } from './scenarioDefaults'
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
    expect(body.volatility).toBe(eff.volatility)
    expect(body.months).toBe(eff.months)
    expect(body.objective).toBe(eff.objective)
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

  it('считает изменённые поля и строит патч «вернуть все»', () => {
    const s = sc({ inflation: '0.01', volatility: '0.05', fx: '1.2' })
    expect(changedKeys(s)).toEqual(['inflation', 'fx'])
    expect(resetPatch(['inflation', 'fx'])).toEqual({ inflation: String(SCENARIO_DEFAULTS.inflation), fx: String(SCENARIO_DEFAULTS.fx) })
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
