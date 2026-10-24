import { beforeEach, describe, expect, it, vi } from 'vitest'

const forecast = vi.fn()
vi.mock('../../lib/api', () => ({ api: { forecast: (p: unknown) => forecast(p) } }))

const { fetchForecast, forecastKey, getForecastResult, publishForecast, resetForecastStore } = await import('./forecastStore')

const res = (months: number) => ({ months, products: [], inflation_index: [100], synthetic: false, demo: false, deprecated_fields: [] }) as never

describe('кэш прогноза', () => {
  beforeEach(() => { resetForecastStore(); forecast.mockReset() })

  it('повторный вход с тем же ключом не пересчитывает; «Обновить» — пересчитывает', async () => {
    forecast.mockResolvedValueOnce(res(6)).mockResolvedValueOnce(res(7))
    const key = forecastKey('s1', undefined, 6)
    expect(key).toBe('s1|base|6')
    const a = await fetchForecast(key, { scenario_id: 's1' })
    const b = await fetchForecast(key, { scenario_id: 's1' })
    expect(b).toBe(a)
    expect(forecast).toHaveBeenCalledTimes(1)
    const c = await fetchForecast(key, { scenario_id: 's1' }, true)
    expect(c.result.months).toBe(7)
    expect(forecast).toHaveBeenCalledTimes(2)
  })

  it('одновременные запросы одного ключа — один запрос', async () => {
    forecast.mockResolvedValue(res(6))
    const key = forecastKey('s2', 'base', 6)
    await Promise.all([fetchForecast(key, {}), fetchForecast(key, {})])
    expect(forecast).toHaveBeenCalledTimes(1)
  })

  it('публикует прогноз с родословной', () => {
    publishForecast(res(6), { scenarioId: 's1', scenarioName: 'Базовый', source: 'scenario', runs: 3000, at: 1 })
    expect(getForecastResult()?.meta.scenarioName).toBe('Базовый')
  })
})
