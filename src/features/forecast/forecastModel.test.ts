import { describe, expect, it } from 'vitest'
import type { ForecastProduct } from '../../lib/api'
import { MINUS, NBSP } from '../../explain/format'
import {
  attentionSet, baseRefLine, forecastDelta, indexTo100, qualityOf, qualitySummary, sharedDomain, signedPct, timesText, verdictText,
} from './forecastModel'

const bt = (skill: number, coverage80: number, k = 6) => ({ k, mape: 10, mape_naive: 10 / skill, skill, pinball10: 1, pinball90: 1, coverage80 })
const prod = (over: Partial<ForecastProduct> = {}): ForecastProduct => ({
  id: 'p', name: 'Вал', role: 'product', base: 100,
  p10: [100, 90, 95], p50: [100, 110, 125], p90: [100, 130, 150], mean: [100, 110, 125], history: [90, 95, 100], ...over,
})

describe('forecastDelta — от «сейчас», а не от базы справочника', () => {
  it('знак совпадает с видимой медианой: база выше, но медиана растёт от последней точки истории', () => {
    const d = forecastDelta(prod({ base: 140 }))!
    expect(d.value).toBeCloseTo(0.25)
    expect(d.text).toBe(`+25${NBSP}%`)
    expect(d.label).toBe(`к горизонту +25${NBSP}% от текущей`)
  })

  it('малые Δ — один знак после запятой; падение — U+2212', () => {
    expect(forecastDelta(prod({ p50: [100, 101, 104.3] }))!.text).toBe(`+4,3${NBSP}%`)
    expect(forecastDelta(prod({ p50: [100, 90, 80] }))!.text).toBe(`${MINUS}20${NBSP}%`)
  })

  it('без истории — от стартовой медианы; ставка — в п. п.', () => {
    expect(forecastDelta(prod({ history: [], p50: [200, 210, 220] }))!.value).toBeCloseTo(0.1)
    const r = forecastDelta(prod({ role: 'rate', history: [16, 15, 14], p50: [14, 13.5, 12.5] }))!
    expect(r.text).toBe(`${MINUS}1,5${NBSP}п.${NBSP}п.`)
  })

  it('signedPct: ноль без знака', () => {
    expect(signedPct(0, 0)).toBe(`0${NBSP}%`)
    expect(signedPct(0.004, 1)).toBe(`+0,4${NBSP}%`)
  })
})

describe('qualityOf — один на весь код', () => {
  it('покрытие 50 % — не «●»: веер не откалиброван', () => {
    expect(qualityOf(prod({ backtest: bt(0.6, 0.5) })).level).toBe('warn')
    expect(qualityOf(prod({ backtest: bt(0.6, 0.4) })).level).toBe('bad')
    expect(qualityOf(prod({ backtest: bt(1.6, 0.9) })).level).toBe('bad')
    expect(qualityOf(prod({ backtest: bt(1.2, 0.9) })).level).toBe('warn')
    expect(qualityOf(prod({ backtest: bt(0.61, 0.83) })).level).toBe('ok')
    expect(qualityOf(prod()).level).toBe('none')
  })

  it('фраза — частотами и разами, без «−328,8 %»', () => {
    const bad = qualityOf(prod({ backtest: bt(3, 0) }))
    expect(bad.sentence).toBe('веер не откалиброван: в бэктесте внутри полосы 0 из 6 мес (ожидалось ≈ 5 из 6); хуже прогноза «как вчера» в 3 раза')
    const ok = qualityOf(prod({ backtest: bt(0.61, 5 / 6) }))
    expect(ok.sentence).toBe(`попадание 5 из 6 мес · лучше «как вчера» на 39${NBSP}%`)
    expect(timesText(1.4)).toBe('в 1,4 раза')
    expect(timesText(5)).toBe('в 5 раз')
  })
})

describe('малые кратные и отбор', () => {
  it('индекс «сейчас = 100» и общая шкала', () => {
    const s = indexTo100(prod({ history: [40, 50], p10: [50, 45], p50: [50, 60], p90: [50, 80] }))
    expect(s.p50).toEqual([100, 120])
    const [lo, hi] = sharedDomain([s])
    expect(lo).toBeLessThan(80)
    expect(hi).toBeGreaterThan(160)
  })

  it('«требуют внимания»: худшие по качеству, затем самые широкие', () => {
    const ps = [
      prod({ id: 'ok', backtest: bt(0.5, 0.9) }),
      prod({ id: 'bad', backtest: bt(2, 0.3) }),
      prod({ id: 'wide', backtest: bt(0.5, 0.9), p10: [100, 50, 20], p90: [100, 200, 400] }),
    ]
    expect(attentionSet(ps, 2).map((p) => p.id)).toEqual(['bad', 'wide'])
  })

  it('база НСИ пунктиром — только если заметно отличается от «сейчас»', () => {
    expect(baseRefLine(prod({ base: 100 }))).toBeNull()
    expect(baseRefLine(prod({ base: 108_000, history: [100_000], p50: [100_000] }))?.label).toBe(`база НСИ 108${NBSP}тыс.${NBSP}₽`)
  })

  it('сводка и вердикт мониторинга', () => {
    const res = {
      months: 6,
      products: [prod({ id: 'a', backtest: bt(2, 0.3) }), prod({ id: 'b', backtest: bt(0.5, 0.9), p50: [100, 102, 104] })],
      rate: prod({ role: 'rate', history: [14], p10: [14, 11.4], p50: [14, 13.5], p90: [14, 18.1] }),
    }
    const s = qualitySummary(res.products)
    expect(s).toMatchObject({ total: 2, worse: 1, outside: 1 })
    expect(verdictText(res)).toContain('1 из 2 рядов вне P10–P90 бэктеста')
    expect(verdictText(res)).toContain(`ставка ЦБ 13,5${NBSP}% [11,4; 18,1]`)
  })
})
