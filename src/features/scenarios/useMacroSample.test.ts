/**
 * Пути генератора для карточки пресета: только помесячно (`horizon_weeks: 0`) — 6-месячный сценарий
 * больше не падает «недостаточно месяцев для недельной сетки»; ошибка — фразой с горизонтом, кэш ошибки
 * снимается (повтор запрашивает снова).
 */
import { describe, expect, it, vi } from 'vitest'
import { NBSP } from '../../explain/format'

const sample = vi.fn()
vi.mock('../../lib/api', () => ({ api: { macro: { sample: (p: unknown) => sample(p) } } }))

const { fetchMacroSample, sampleFailText } = await import('./useMacroSample')

describe('пути генератора сценария', () => {
  it('6 мес — только помесячно, без недельной сетки', async () => {
    sample.mockResolvedValueOnce({ months: 6 })
    await fetchMacroSample({ mode: 'base', preset: 'base' }, 6)
    expect(sample).toHaveBeenCalledWith(expect.objectContaining({ horizon_months: 6, horizon_weeks: 0 }))
  })

  it('ошибка — фразой с горизонтом; повтор идёт на сервер заново', async () => {
    sample.mockReset()
    sample.mockRejectedValueOnce(new Error('macro: недостаточно месяцев')).mockResolvedValueOnce({ months: 7 })
    await expect(fetchMacroSample('base', 7)).rejects.toThrow()
    await expect(fetchMacroSample('base', 7)).resolves.toEqual({ months: 7 })
    expect(sample).toHaveBeenCalledTimes(2)
    expect(sampleFailText(6)).toBe(`Не удалось посчитать пути генератора на 6${NBSP}мес`)
  })
})
