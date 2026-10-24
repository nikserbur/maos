/**
 * Пресеты сценариев: окна эпизодов — внутри настоящей истории генератора (rl/macro/params/macro_params.json,
 * cbr.ru 2013-09…2026-09) и не дальше её конца; факты в фразах пресетов («ставка до 20 %», «доллар
 * выше 100 ₽») сверены с историей; в видимом тексте нет «YYYY-MM», «квантиль», кодов паспорта.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { MacroRegimes, OptResult } from '../../lib/api'
import { NBSP } from '../../explain/format'
import { crisisShare } from './compareModel'
import { presetDiffRows } from './PresetGallery'
import { monthsBetween } from './monthText'
import { fromMacroMode, regimeMenuReducer } from './regimeMenu'
import { effectLine, pathExtreme, statCells } from './presetStats'
import {
  PRESETS, PRESET_MONTHS, crisisMonthsText, forecastTabTitle, getPreset, historyThen, presetEdits, presetMacroMode, presetOf, presetPatch,
  presetPayload, presetPeriod, presetValuesText, scenarioMacroMode, scenarioView, scenarioViewOf, viewTitle,
} from './scenarioPresets'

const params = JSON.parse(readFileSync(fileURLToPath(new URL('../../../rl/macro/params/macro_params.json', import.meta.url)), 'utf8')) as {
  history: NonNullable<MacroRegimes['history']>
  regime_stats: { crisis_index: number; regimes: MacroRegimes['regimes'] }
}
const H = params.history
const at = (ym: string) => H.month.indexOf(ym)
const span = (from: string, months: number, k: 'key_pp' | 'cpi_yoy_pp' | 'usd_rub') => H[k].slice(at(from), at(from) + months)

describe('окна пресетов — внутри истории', () => {
  it('каждое окно начинается не раньше второго месяца, кончается не позже последнего (2026-09) и не длиннее горизонта', () => {
    const last = H.month[H.month.length - 1]
    for (const p of PRESETS.filter((x) => x.window)) {
      const w = p.window!
      expect(at(w.from), p.id).toBeGreaterThanOrEqual(1)
      expect(monthsBetween(w.from, last) + 1, p.id).toBeGreaterThanOrEqual(w.months)
      expect(w.months, p.id).toBeLessThanOrEqual(PRESET_MONTHS)   // иначе повтор молча обрезается горизонтом
    }
  })

  it('изменения в фразах пресетов сверены с историей ЦБ РФ', () => {
    const before = (ym: string, k: 'key_pp' | 'cpi_yoy_pp' | 'usd_rub') => H[k][at(ym) - 1]
    // 2014–15: доллар за 4 мес +75 %, ставка +9 п. п.; рубль отыграл больше половины к весне.
    expect(Math.max(...span('2014-10', 9, 'usd_rub')) / before('2014-10', 'usd_rub') - 1).toBeCloseTo(0.75, 1)
    expect(Math.max(...span('2014-10', 9, 'key_pp')) - before('2014-10', 'key_pp')).toBe(9)
    expect(Math.max(...span('2014-10', 9, 'cpi_yoy_pp')) / before('2014-10', 'cpi_yoy_pp')).toBeGreaterThan(1.9)
    // 2022: ставка +11,5 п. п. за месяц; доллар потом −39 %.
    expect(Math.max(...span('2022-02', 7, 'key_pp')) - before('2022-02', 'key_pp')).toBe(11.5)
    expect(Math.min(...span('2022-02', 7, 'usd_rub')) / Math.max(...span('2022-02', 7, 'usd_rub')) - 1).toBeLessThan(-0.38)
    // 2023: ставка +8,5 п. п. за полгода; 2024: ещё +5 п. п. до 21 %, доллар к ноябрю +20 %.
    expect(Math.max(...span('2023-07', 6, 'key_pp')) - before('2023-07', 'key_pp')).toBe(8.5)
    expect(Math.max(...span('2024-06', 7, 'key_pp'))).toBe(21)
    expect(Math.max(...span('2024-06', 7, 'key_pp')) - before('2024-06', 'key_pp')).toBe(5)
    expect(Math.max(...span('2024-06', 7, 'usd_rub')) / before('2024-06', 'usd_rub') - 1).toBeCloseTo(0.2, 1)
    expect(H.usd_rub[at('2020-03')] / H.usd_rub[at('2020-02')] - 1).toBeCloseTo(0.16, 2)
    expect(before('2020-03', 'key_pp') - Math.min(...span('2020-03', 7, 'key_pp'))).toBe(1.75)
    expect(before('2017-01', 'key_pp') - Math.min(...span('2017-01', 12, 'key_pp'))).toBe(2.25)
    const fx2018 = span('2018-04', 6, 'usd_rub').map((v, i, a) => (i === 0 ? v / H.usd_rub[at('2018-03')] : v / a[i - 1]) - 1)
    expect(fx2018.filter((r) => r > 0.075).length).toBe(2)
    const peak2425 = Math.max(...H.key_pp.slice(at('2024-01'), at('2025-12') + 1))
    expect(getPreset('high-rate')?.keyRef).toBe(peak2425)
  })

  it('«тогда» — из истории словами; кризисные месяцы — окнами', () => {
    expect(historyThen(H, getPreset('sanctions-2022')?.window)).toBe(`тогда: ставка 8,5 → 20${NBSP}%, инфляция 8,7 → 17,8${NBSP}%, доллар 78 → 51${NBSP}₽`)
    expect(historyThen(H, undefined)).toBe('')
    const regimes = { crisis_index: params.regime_stats.crisis_index, regimes: params.regime_stats.regimes } as MacroRegimes
    expect(crisisMonthsText(regimes)).toBe('дек. 2014 – февр. 2015, дек. 2015 – янв. 2016, февр.–июль 2022, март 2023')
  })
})

describe('пресет ↔ режим сценария', () => {
  it('новый сценарий: горизонт 12 мес, эпизод по порядку, id пресета; экспертные значения', () => {
    const body = presetPayload(getPreset('sanctions-2022')!)
    expect(body.months).toBe(PRESET_MONTHS)
    expect(body.macro_mode).toEqual({ mode: 'episode', stress: { episode: '2022-02', months: 7, order: 'replay' }, preset: 'sanctions-2022' })
    expect(body).toMatchObject({ volatility: 0.12, market_corr: 0.75, demand: 0.9 })
    expect(presetPayload(getPreset('base')!)).toEqual({ months: 12, macro_mode: { mode: 'base', preset: 'base' } })
    // «Сменить пресет»: незаданные значения — пустые (NULL в БД, умолчание из данных); ручные инфляция и курс — тоже к данным.
    expect(presetPatch(getPreset('base')!, 12)).toEqual({ macro_mode: '{"mode":"base","preset":"base"}', volatility: '', market_corr: '0.5', demand: '', inflation: '', fx: '' })
    expect(presetPatch(getPreset('base')!, 12, true)).not.toHaveProperty('inflation')
    expect(presetMacroMode(getPreset('weak-ruble')!)).toEqual({ mode: 'base', ref: { fx: 1.3 }, preset: 'weak-ruble' })
  })

  it('распознаётся по id и по самому режиму; ручная правка — «своя настройка»', () => {
    for (const p of PRESETS) expect(presetOf(JSON.stringify(presetMacroMode(p)))?.id).toBe(p.id)
    expect(presetOf('base')?.id).toBe('base')
    expect(presetOf(undefined)?.id).toBe('base')
    expect(presetOf('{"mode":"episode","stress":{"episode":"2020-03","months":7,"order":"replay"}}')?.id).toBe('covid-2020')
    expect(presetOf('{"mode":"episode","stress":{"episode":"2022-02","months":6}}')).toBeNull()
    expect(presetOf('{"mode":"base","ref":{"fx":1.3}}')?.id).toBe('weak-ruble')
    const edited = regimeMenuReducer(fromMacroMode(JSON.stringify(presetMacroMode(getPreset('sanctions-2022')!))), { type: 'episode', episode: '2022-03', months: 7 })
    expect(presetOf(edited)).toBeNull()
  })

  it('вид в шапке и списке: «прогноз» — только Базовый без правок; вкладка — всегда «Прогноз цен»', () => {
    expect(scenarioView(JSON.stringify(presetMacroMode(getPreset('base')!)))).toMatchObject({ short: 'Базовый', kind: 'прогноз', glyph: '●' })
    expect(scenarioView(JSON.stringify(presetMacroMode(getPreset('covid-2020')!)))).toMatchObject({ short: 'Как COVID-2020', kind: 'что если' })
    expect(scenarioView(JSON.stringify(presetMacroMode(getPreset('high-rate')!)))).toMatchObject({ short: 'Высокая ставка', kind: 'что если' })
    expect(scenarioView(JSON.stringify(presetMacroMode(getPreset('price-crisis')!)))).toMatchObject({ short: 'Ценовой кризис', kind: 'что если', glyph: '◆' })
    expect(scenarioView('{"mode":"regime","stress":{"regime":1}}', ['спокойный', 'кризис (макс. дисперсия)'])).toMatchObject({ preset: null, short: 'Кризисный режим весь срок' })
    expect(forecastTabTitle(undefined)).toBe('Прогноз цен')
    expect(forecastTabTitle('{"mode":"episode","stress":{"episode":"2022-02","months":7,"order":"replay"}}')).toBe('Прогноз цен')
  })

  it('правки условий поверх пресета: Базовый + правка — «что если»; значения пресета правками не считаются', () => {
    const lastObs = { month: '2026-09', cpi_yoy_pp: 6.35, key_pp: 14, usd_rub: 84.43 }
    const base = { macro_mode: JSON.stringify(presetMacroMode(getPreset('base')!)) }
    expect(scenarioViewOf(base, [], { lastObs })).toMatchObject({ kind: 'прогноз', edits: 0 })
    const edited = { ...base, market_corr: '0.05' }
    expect(presetEdits(edited, { lastObs })).toEqual(['market_corr'])
    expect(scenarioViewOf(edited, [], { lastObs })).toMatchObject({ kind: 'что если', glyph: '◆', edits: 1 })
    expect(viewTitle(scenarioViewOf(edited, [], { lastObs }))).toBe('Базовый + 1 правка')
    const crisis = { macro_mode: JSON.stringify(presetMacroMode(getPreset('price-crisis')!)), volatility: '0.12', market_corr: '0.75', demand: '0.85' }
    expect(presetEdits(crisis, { lastObs })).toEqual([])
    expect(presetValuesText(getPreset('price-crisis')!)).toBe(`разброс цен ×2 · связь цен 0,75 · спрос −15${NBSP}%`)
  })

  it('ручные инфляция и сдвиг курса — опора путей генератора (как у бэкенда), остальное — режим сценария', () => {
    expect(scenarioMacroMode({ macro_mode: '{"mode":"base","preset":"base"}' }, 12)).toEqual({ mode: 'base', preset: 'base' })
    const m = scenarioMacroMode({ macro_mode: '{"mode":"regime","stress":{"regime":1}}', inflation: '0.01', fx: '1.1' }, 12)
    expect(m).toMatchObject({ mode: 'regime', stress: { regime: 1 }, ref: { fx: 1.1 } })
    expect(typeof m === 'object' && Array.isArray(m.ref?.cpi) ? m.ref.cpi[0] : NaN).toBeCloseTo(12.68, 2)
    expect(scenarioMacroMode({ fx: '1' }, 12)).toBe('base')
  })

  it('видимый текст пресетов — без «YYYY-MM», квантилей, кодов паспорта и «норматива» у экспертных значений', () => {
    for (const p of PRESETS) {
      const text = [p.name, p.short, p.oneLine, presetPeriod(p), presetValuesText(p), ...presetDiffRows(p).flatMap((r) => [r.what, r.value, r.origin])].join(' | ')
      expect(text, p.id).not.toMatch(/\d{4}-\d{2}|квантил|quantile|flat|r1\.|macro\.|норматив|режим \d/)
    }
  })

  it('доля кризисных месяцев: у прежнего «вперемешку» и крайнего пути — нет числа (не «0 %»)', () => {
    const res = (stress: unknown, share: number[]) => ({ macro: { stress, regime_share: share } }) as unknown as OptResult
    expect(crisisShare(res({ episode: '2022-02', months: 6 }, [0, 0]), 1)).toBeNull()
    expect(crisisShare(res({ quantile_t: 0.95 }, [0, 0]), 1)).toBeNull()
    expect(crisisShare(res({ episode: '2022-02', months: 7, order: 'replay' }, [0.48, 0.52]), 1)).toBe(0.52)
    expect(crisisShare(res(null, [0.92, 0.08]), 1)).toBe(0.08)
  })
})

describe('исход пресета: старт → исход, пик и дно только всерьёз', () => {
  it('пик — только выше сегодняшней точки и конца; у падающего ряда «пик» = старт не называется', () => {
    const st = {
      key: { start: 14, end: 10.7, lo: 8.5, hi: 17.7, peak: 25.4, trough: 10.6 },
      fx: { start: 84.4, end: 75.1, lo: 65, hi: 94, peak: 98.1, trough: 59 },
      cpi: { start: 6.35, end: 6, lo: 1, hi: 14, peak: 6.3, trough: 5.9 },
    }
    expect(effectLine(st, 12)).toBe(`типичный исход через 12${NBSP}мес: ставка 14 → 10,7${NBSP}% (пик 25,4${NBSP}%), доллар 84 → 75${NBSP}₽ (пик 98${NBSP}₽), инфляция 6,4 → 6${NBSP}%`)
    // COVID: ставка 14 → 10,4, «пик» 13,6 ниже старта — не пик; дно у курса 59 < 75 — называется.
    expect(pathExtreme('key', { start: 14, end: 10.4, lo: 8, hi: 13, peak: 13.6, trough: 10.4 })).toBeNull()
    expect(pathExtreme('fx', st.fx)).toEqual({ word: 'пик', value: 98.1 })
    expect(pathExtreme('cpi', { start: 6.35, end: 6, lo: 1, hi: 9, peak: 6.4, trough: 3.2 })).toEqual({ word: 'дно', value: 3.2 })
    expect(statCells(st).map((c) => c.title)).toEqual(['Ставка', 'Доллар', 'Инфляция'])
  })
})
