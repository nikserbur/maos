import { describe, expect, it } from 'vitest'
import { NBSP } from '../../explain/format'
import type { KpiBundle, SimResults } from '../../lib/api'
import { buildChartData, chartKind, chartTitle, defaultPeriod, periodOptions, sliceByPeriod } from './chartData'

const bundle = (i: number, makespan: number, otd: number): KpiBundle => ({
  plan_id: `p${i}`, created_at: `2026-10-${String(10 + i).padStart(2, '0')}T12:0${i}:00`,
  kpi: { makespan, makespan_mean: makespan, otd },
})

const res: SimResults = {
  plan_id: 'p1', makespan: 100, n_machines: 2, n_workers: 2, required_operators: 1, avg_operators: 1,
  avg_utilization: 0.5, throughput_per_day: 1, n_orders: 3,
  util_series: [{ t: 0, util: 0.1, busy: 0 }, { t: 24, util: 0.5, busy: 1 }, { t: 48, util: 0.9, busy: 2 }, { t: 96, util: 0.3, busy: 1 }],
  workers_series: [{ t: 0, workers: 1 }, { t: 24, workers: 2 }, { t: 48, workers: 2 }, { t: 96, workers: 1 }],
  per_machine: [],
}

describe('chartTitle / chartKind / periods', () => {
  it('заголовок = имена метрик', () => {
    expect(chartTitle([])).toBe('Метрика не выбрана')
    expect(chartTitle(['OTD'])).toBe('OTD')
    expect(chartTitle(['OTD', 'Загрузка'])).toBe('OTD и Загрузка')
    expect(chartTitle(['A', 'B', 'C'])).toBe('A, B и C')
  })

  it('тип графика по форме данных', () => {
    expect(chartKind('plans')).toBe('bar')
    expect(chartKind('timeline')).toBe('line')
  })

  it('периоды зависят от оси', () => {
    expect(periodOptions('plans').map((p) => p.id)).toEqual(['10', '30', 'all'])
    expect(periodOptions('timeline').map((p) => p.id)).toEqual(['24', '72', 'all'])
    expect(defaultPeriod('plans')).toBe('10')
    expect(defaultPeriod('timeline')).toBe('all')
  })

  it('sliceByPeriod берёт последние N, «all» — всё', () => {
    expect(sliceByPeriod([1, 2, 3, 4], '2')).toEqual([3, 4])
    expect(sliceByPeriod([1, 2], '10')).toEqual([1, 2])
    expect(sliceByPeriod([1, 2, 3], 'all')).toEqual([1, 2, 3])
  })
})

describe('buildChartData', () => {
  const series = [bundle(1, 900, 0.9), bundle(2, 1000, 0.95), bundle(3, 800, 1)]

  it('по построениям: подписи-даты, значения из каталога, окно периода', () => {
    const d = buildChartData('plans', ['MAKESPAN', 'OTD'], series, null, '2')
    expect(d.labels).toEqual(['10-12 12:02', '10-13 12:03'])
    expect(d.series.map((s) => s.name)).toEqual(['Длина расписания', 'Доля заказов в срок (OTD)'])
    expect(d.series[0].points).toEqual([1000, 800])
    expect(d.series[1].fmtY(0.95)).toContain('95')
  })

  it('неизвестный код метрики пропускается', () => {
    const d = buildChartData('plans', ['NOPE', 'OTD'], series, null)
    expect(d.series).toHaveLength(1)
  })

  it('по часам: окно «первые N ч» и подписи в часах', () => {
    const d = buildChartData('timeline', ['util', 'workers'], [], res, '72')
    expect(d.labels).toHaveLength(3)
    expect(d.labels[1]).toBe(`24${NBSP}ч`)
    expect(d.series[0].points).toEqual([0.1, 0.5, 0.9])
    expect(d.series[1].points).toEqual([1, 2, 2])
    const all = buildChartData('timeline', ['util'], [], res, 'all')
    expect(all.labels).toHaveLength(4)
  })

  it('по часам без результатов — пусто', () => {
    const d = buildChartData('timeline', ['util'], [], null)
    expect(d.labels).toEqual([])
    expect(d.series[0].points).toEqual([])
  })
})
