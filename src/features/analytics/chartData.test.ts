import { describe, expect, it } from 'vitest'
import { NBSP } from '../../explain/format'
import type { KpiBundle, SimResults } from '../../lib/api'
import {
  buildChartData, chartKind, chartTitle, defaultPeriod, flatInfo, flatSuggestion, normalizePeriod, periodOptions,
  sliceByPeriod, statementTitle,
} from './chartData'

const bundle = (i: number, makespan: number, otd: number, cvar = makespan + 100): KpiBundle => ({
  plan_id: `p${i}`, created_at: `2026-10-${String(10 + i).padStart(2, '0')} 12:0${i}:00`,
  kpi: { makespan, makespan_mean: makespan, makespan_cvar: cvar, otd },
})

const res: SimResults = {
  plan_id: 'p1', makespan: 100, n_machines: 2, n_workers: 2, required_operators: 1, avg_operators: 1,
  avg_utilization: 0.5, throughput_per_day: 1, n_orders: 3,
  util_series: [{ t: 0, util: 0.1, busy: 0 }, { t: 24, util: 0.5, busy: 1 }, { t: 48, util: 0.9, busy: 2 }, { t: 96, util: 0.3, busy: 1 }],
  workers_series: [{ t: 0, workers: 1 }, { t: 24, workers: 2 }, { t: 48, workers: 2 }, { t: 96, workers: 1 }],
  per_machine: [],
}

describe('chartTitle / chartKind / periods', () => {
  it('перечень имён метрик', () => {
    expect(chartTitle([])).toBe('Метрика не выбрана')
    expect(chartTitle(['OTD'])).toBe('OTD')
    expect(chartTitle(['OTD', 'Загрузка'])).toBe('OTD и Загрузка')
    expect(chartTitle(['A', 'B', 'C'])).toBe('A, B и C')
  })

  it('хронология — всегда линия', () => {
    expect(chartKind('plans')).toBe('line')
    expect(chartKind('timeline')).toBe('line')
  })

  it('периоды зависят от оси; мусор из адреса — период по умолчанию', () => {
    expect(periodOptions('plans').map((p) => p.id)).toEqual(['10', '30', 'all'])
    expect(periodOptions('timeline').map((p) => p.id)).toEqual(['24', '72', 'all'])
    expect(defaultPeriod('plans')).toBe('10')
    expect(defaultPeriod('timeline')).toBe('all')
    expect(normalizePeriod('plans', '30')).toBe('30')
    expect(normalizePeriod('plans', '72')).toBe('10')
    expect(normalizePeriod('timeline', null)).toBe('all')
  })

  it('sliceByPeriod берёт последние N, «all» — всё', () => {
    expect(sliceByPeriod([1, 2, 3, 4], '2')).toEqual([3, 4])
    expect(sliceByPeriod([1, 2], '10')).toEqual([1, 2])
    expect(sliceByPeriod([1, 2, 3], 'all')).toEqual([1, 2, 3])
  })
})

describe('buildChartData — по построениям', () => {
  const series = [bundle(1, 900, 0.9), bundle(2, 1000, 0.95), bundle(3, 800, 1)]
  const seq = new Map([['p1', 17], ['p2', 18], ['p3', 19]])

  it('подписи X — номера построений, дата — в подсказке, окно периода', () => {
    const d = buildChartData('plans', ['OTD'], series, null, '2', seq)
    expect(d.labels).toEqual(['№18', '№19'])
    expect(d.tips).toHaveLength(2)
    expect(d.tips[0]).not.toContain('T')
    expect(d.series[0].points).toEqual([0.95, 1])
    expect(d.series[0].fmtY(0.95)).toContain('95')
  })

  it('без карты номеров — позиция в полном ряду (не в окне)', () => {
    const d = buildChartData('plans', ['OTD'], series, null, '2')
    expect(d.labels).toEqual(['№2', '№3'])
  })

  it('показатель и его хвост — одна серия с полосой, без второго цвета', () => {
    const d = buildChartData('plans', ['MAKESPAN', 'MK_CVAR'], series, null, 'all', seq)
    expect(d.series).toHaveLength(1)
    expect(d.series[0].color).toBe('var(--chart-1)')
    expect(d.series[0].band?.label).toBe('хвост CVaR')
    expect(d.series[0].band?.hi).toEqual([1000, 1100, 900])
    expect(d.series[0].band?.lo).toEqual([900, 1000, 800])
  })

  it('хвост без своего показателя — обычная серия', () => {
    const d = buildChartData('plans', ['MK_CVAR'], series, null)
    expect(d.series).toHaveLength(1)
    expect(d.series[0].band).toBeUndefined()
  })

  it('неизвестный код метрики пропускается', () => {
    const d = buildChartData('plans', ['NOPE', 'OTD'], series, null)
    expect(d.series).toHaveLength(1)
  })
})

describe('buildChartData — по часам', () => {
  it('окно «первые N ч» и подписи в часах', () => {
    const d = buildChartData('timeline', ['util', 'workers'], [], res, '72')
    expect(d.labels).toHaveLength(3)
    expect(d.labels[1]).toBe(`24${NBSP}ч`)
    expect(d.series[0].points).toEqual([0.1, 0.5, 0.9])
    expect(d.series[1].points).toEqual([1, 2, 2])
    const all = buildChartData('timeline', ['util'], [], res, 'all')
    expect(all.labels).toHaveLength(4)
  })

  it('без результатов — пусто', () => {
    const d = buildChartData('timeline', ['util'], [], null)
    expect(d.labels).toEqual([])
    expect(d.series[0].points).toEqual([])
  })
})

describe('ровный ряд и заголовок-утверждение', () => {
  it('одинаковые значения схлопываются в строку-итог', () => {
    const flat = [bundle(1, 900, 1), bundle(2, 1000, 1), bundle(3, 800, 1)]
    const d = buildChartData('plans', ['OTD'], flat, null)
    const info = flatInfo('plans', d)
    expect(info?.text).toBe(`Доля заказов в срок 100${NBSP}% во всех 3 построениях`)
    expect(flatInfo('plans', buildChartData('plans', ['MAKESPAN'], flat, null))).toBeNull()
  })

  it('одна точка — не «ровный ряд»', () => {
    expect(flatInfo('plans', buildChartData('plans', ['OTD'], [bundle(1, 900, 1)], null))).toBeNull()
  })

  it('подсказка замены ровной метрики не повторяет выбранные', () => {
    expect(flatSuggestion(['OTD'])).toBe('FLOW')
    expect(flatSuggestion(['OTD'], ['FLOW'])).toBe('MAKESPAN')
  })

  it('утверждение: диапазон последних построений', () => {
    const series = [bundle(1, 900, 0.9), bundle(2, 1000, 0.95), bundle(3, 800, 1)]
    const d = buildChartData('plans', ['MAKESPAN', 'MK_CVAR'], series, null)
    expect(statementTitle('plans', d, [])).toBe(`Длина расписания (среднее) по построениям: все 3 — в пределах 800–1${NBSP}000${NBSP}ч`)
    const t = buildChartData('timeline', ['util'], [], res, 'all')
    expect(statementTitle('timeline', t, [])).toBe(`Загрузка оборудования по часам: пик 90${NBSP}% на 48${NBSP}ч`)
  })
})
