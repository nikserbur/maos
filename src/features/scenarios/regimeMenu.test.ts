import { describe, expect, it } from 'vitest'
import { NBSP } from '../../explain/format'
import { DEFAULT_MENU, fromMacroMode, isForecastMode, passportValueLabel, quantileText, regimeChip, regimeLabel, regimeMenuReducer, regimeName, toMacroMode } from './regimeMenu'

describe('режим генератора — редьюсер (§2.6б)', () => {
  it('базовый без опор и пресета сериализуется именем режима', () => {
    expect(toMacroMode(DEFAULT_MENU)).toBe('base')
    expect(regimeLabel(DEFAULT_MENU).isForecast).toBe(true)
  })

  it('режим, квантиль (в пределах сетки 0,01–0,99) и свой период — по порядку', () => {
    const r = regimeMenuReducer(DEFAULT_MENU, { type: 'regime', regime: 1 })
    expect(toMacroMode(r)).toEqual({ mode: 'regime', stress: { regime: 1 } })
    const q = regimeMenuReducer(r, { type: 'quantile', quantile: 1.7 })
    expect(toMacroMode(q)).toEqual({ mode: 'quantile', stress: { quantile_t: 0.99 } })
    const e = regimeMenuReducer(q, { type: 'episode', episode: '2014-12', months: 4 })
    expect(toMacroMode(e)).toEqual({ mode: 'episode', stress: { episode: '2014-12', months: 4, order: 'replay' } })
    expect(regimeLabel(e).isForecast).toBe(false)
  })

  it('ручная правка снимает пресет; опора — только нестандартная', () => {
    const preset = fromMacroMode('{"mode":"episode","stress":{"episode":"2022-02","months":7,"order":"replay"},"preset":"sanctions-2022"}')
    expect(preset.preset).toBe('sanctions-2022')
    expect(regimeMenuReducer(preset, { type: 'refCpi', refCpi: 'nodes' }).preset).toBeNull()
    const s = regimeMenuReducer(regimeMenuReducer(DEFAULT_MENU, { type: 'refCpi', refCpi: 'nodes' }), { type: 'refKey', refKey: 'custom', customKey: 12 })
    expect(toMacroMode(s, 3)).toEqual({ mode: 'base', ref: { cpi: 'nodes', key: [12, 12, 12] } })
    expect(isForecastMode(s)).toBe(false)
    const back = regimeMenuReducer(s, { type: 'refKey', refKey: 'flat' })
    expect(back.customKey).toBeNull()
    expect(toMacroMode(back)).toEqual({ mode: 'base', ref: { cpi: 'nodes' } })
  })

  it('туда и обратно через JSON сценария; прежние эпизоды без order — тоже по порядку (миграция бэкенда); мусор → базовый', () => {
    const s = regimeMenuReducer(regimeMenuReducer(DEFAULT_MENU, { type: 'quantile', quantile: 0.05 }), { type: 'refCpi', refCpi: 'nodes' })
    expect(fromMacroMode(JSON.stringify(toMacroMode(s)))).toMatchObject({ kind: 'quantile', quantile: 0.05, refCpi: 'nodes' })
    const legacy = fromMacroMode('{"mode":"episode","stress":{"episode":"2022-02","months":6}}')
    expect(legacy).toMatchObject({ kind: 'episode', episodeMonths: 6 })
    expect(toMacroMode(legacy)).toEqual({ mode: 'episode', stress: { episode: '2022-02', months: 6, order: 'replay' } })
    expect(fromMacroMode('{"mode":"base","preset":"base"}')).toMatchObject({ kind: 'base', preset: 'base' })
    expect(fromMacroMode('')).toEqual(DEFAULT_MENU)
    expect(fromMacroMode('base')).toEqual(DEFAULT_MENU)
    expect(fromMacroMode('{broken')).toEqual(DEFAULT_MENU)
    expect(fromMacroMode('iid_v063')).toEqual(DEFAULT_MENU)
    expect(fromMacroMode({ mode: 'regime' })).toMatchObject({ kind: 'regime' })
  })

  it('сдвиг курса (ref.fx, стресс «Слабый рубль») — не прогноз; туда и обратно через JSON', () => {
    const fx = fromMacroMode('{"mode":"base","ref":{"fx":1.3},"preset":"weak-ruble"}')
    expect(fx).toMatchObject({ kind: 'base', refFx: 1.3, preset: 'weak-ruble' })
    expect(isForecastMode(fx)).toBe(false)
    expect(regimeLabel(fx).text).toBe(`базовый, доллар +30${NBSP}% к прогнозу`)
    expect(toMacroMode(fx)).toEqual({ mode: 'base', ref: { fx: 1.3 }, preset: 'weak-ruble' })
    expect(regimeMenuReducer(fx, { type: 'refFx', refFx: 1 }).refFx).toBe(1)
  })

  it('сброс возвращает умолчание; одинаковое действие не создаёт новый объект', () => {
    const r = regimeMenuReducer(DEFAULT_MENU, { type: 'regime', regime: 0 })
    expect(regimeMenuReducer(r, { type: 'reset' })).toBe(DEFAULT_MENU)
    expect(regimeMenuReducer(DEFAULT_MENU, { type: 'kind', kind: 'base' })).toBe(DEFAULT_MENU)
  })
})

describe('подписи режима — словами, без внутренностей движка', () => {
  it('эпизод — месяцами словами; режим — по имени; крайний путь — без «квантиля»', () => {
    const e = regimeMenuReducer(DEFAULT_MENU, { type: 'episode', episode: '2022-02', months: 7 })
    expect(regimeLabel(e, [], 12).text).toBe('повтор февр.–авг. 2022 по порядку')
    expect(regimeLabel({ ...e, episodeMonths: 17, episode: '2023-08' }, [], 12).text).toBe('повтор авг. 2023 – дек. 2024 по порядку, первые 12 мес')
    const forced = regimeMenuReducer(DEFAULT_MENU, { type: 'regime', regime: 1 })
    expect(regimeLabel(forced, ['спокойный', 'кризис (макс. дисперсия)']).text).toBe('навязан кризисный режим на весь горизонт')
    const q = regimeMenuReducer(DEFAULT_MENU, { type: 'quantile', quantile: 0.95 })
    expect(regimeLabel(q).text).toBe(`крайний путь: каждый месяц шок сильнее, чем в 95${NBSP}% месяцев истории`)
    expect(quantileText(0.05)).toBe(`каждый месяц шок слабее, чем в 95${NBSP}% месяцев истории`)
    for (const s of [e, forced, q]) expect(regimeLabel(s, ['спокойный', 'кризис (макс. дисперсия)'], 12).text).not.toMatch(/\d{4}-\d{2}|квантил|q =|режим 1|дисперси/)
  })

  it('чип: «прогноз» — только базовый; остальное — «что если»', () => {
    expect(regimeChip(DEFAULT_MENU)).toEqual({ glyph: '●', word: 'прогноз' })
    expect(regimeChip(regimeMenuReducer(DEFAULT_MENU, { type: 'episode', episode: '2022-02' }))).toEqual({ glyph: '◆', word: 'что если' })
    expect(regimeName('кризис (макс. дисперсия)')).toBe('кризисный')
    expect(regimeName('спокойный')).toBe('спокойный')
  })

  it('значение паспорта — словами; реальный текст паспорта не искажается в «(14 0)»', () => {
    expect(passportValueLabel('flat')).toBe('последнее наблюдение')
    expect(passportValueLabel('flat = последнее наблюдение (14.0)')).toBe(`последнее наблюдение — 14${NBSP}%`)
    expect(passportValueLabel('flat = последнее наблюдение; nodes = узлы прогноза ЦБ от 24.07.2026')).toBe('последнее наблюдение')
    expect(passportValueLabel('nodes')).toBe('узлы прогноза ЦБ РФ')
    expect(passportValueLabel('14.0')).toBe(`14${NBSP}%`)
    expect(passportValueLabel(undefined)).toBe('последнее наблюдение')
    expect(passportValueLabel('что-то_непонятное.1')).toBe('—')
    for (const v of ['flat = последнее наблюдение (14.0)', 'nodes = узлы', 'x_y.z']) expect(passportValueLabel(v)).not.toMatch(/flat|nodes|=|\(14 0\)|_/)
  })
})
