/**
 * Дымовой тест экрана «План» (серверный рендер, без DOM): результат, история, адрес прогона, шесть шагов
 * мастера и «только KPI» рисуются без исключений; пример ходов не попадает в оглавление, подписи дорожек —
 * отличающая часть. Эффекты (наблюдатели, прокрутка) на сервере не выполняются — проверяется разметка.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import type { ScheduleResult } from '../../lib/api'
import { PlanResult } from './PlanResult'
import { PlanHistory } from './PlanHistory'
import { RunView } from './RunView'
import { PlanWizard } from './wizard/PlanWizard'
import { KpiOnlyRun } from './KpiOnlyRun'

// useLayoutEffect кита на сервере предупреждает — к проверке разметки отношения не имеет.
const realError = console.error
beforeAll(() => {
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (String(args[0]).includes('useLayoutEffect does nothing on the server')) return
    realError(...args)
  })
})
afterAll(() => { vi.restoreAllMocks() })

const bar = (i: number, m: string, wc: string, o: number) => ({
  job_idx: i, order_idx: o, product_id: `p${o % 3}`, product_name: `Изделие ${o % 3}`, op_id: `op${i}`, op_name: `Операция ${i}`,
  wc_type_id: wc, wc_name: wc === 'w1' ? 'Ленточнопильный станок' : 'Фрезерный ЦЧПУ', machine_id: m,
  machine_name: (wc === 'w1' ? 'Ленточнопильный станок' : 'Фрезерный ЦЧПУ') + ' №' + m.slice(1), worker: 1,
  start: i * 5, end: i * 5 + 8, due: 200, late: i === 3, setup_hours: 1, downtime_hours: 0.5,
})
const result = {
  rule: 'CR', samples: 500, alpha: 0.1, weights: { time: 1, cost: 0, risk: 0.5 }, n_orders: 6, n_jobs: 12, n_machines: 4, n_workers: 3,
  program: [0, 1, 2].map((k) => ({ product_id: `p${k}`, product_name: `Изделие ${k}`, qty: 10, due_hours: 200 })),
  gantt: Array.from({ length: 12 }, (_, i) => bar(i, `m${i % 4}`, i % 2 ? 'w1' : 'w2', i % 6)),
  machine_load: [{ machine_id: 'm1', machine_name: 'Станок №1', wc_type_id: 'w1', busy_hours: 10, idle_hours: 5, utilization: 0.9 }],
  wc_load: [{ wc_type_id: 'w1', wc_name: 'Ленточнопильный станок', busy_hours: 10, idle_hours: 5, utilization: 0.63 }, { wc_type_id: 'w3', wc_name: 'Склад', busy_hours: 0, idle_hours: 5, utilization: 0 }],
  worker_plan: [{ worker_id: 'u1', name: '123', job_count: 3, busy_hours: 10, idle_hours: 2, utilization: 0.8, jobs: [] }],
  queue_timeline: Array.from({ length: 30 }, (_, i) => ({ t: i * 4, queued: i % 7, top_wc: 'Фрезерный ЦЧПУ', top_wc_n: 3 })),
  queue_by_wc: [{ wc_type_id: 'w2', wc_name: 'Фрезерный ЦЧПУ', peak: 102, points: [{ t: 0, queued: 1 }, { t: 4, queued: 3 }] }],
  bottleneck: { wc_type_id: 'w1', wc_name: 'Ленточнопильный станок', utilization: 0.63 },
  idle: { machine_idle_hours: 10, machine_utilization: 0.5 }, calendar: { enabled: true, work_fond_hours: 100 },
  kpi: { makespan: 397, makespan_mean: 418.6, makespan_cvar: 507, makespan_worst: 684, tardiness: 0, tardiness_cvar: 0, n_late: 0, otd: 1, utilization: 0.5, cost: 1 },
  rules: [{ rule: 'CR', makespan: 400, makespan_cvar: 500, makespan_worst: 600, tardiness: 0, score: 27800, chosen: true }, { rule: 'EDD', makespan: 410, makespan_cvar: 510, makespan_worst: 610, tardiness: 0, score: 27800, chosen: false }],
  warnings: [], portfolio_horizon_hours: 720, plan_id: 'abc',
} as unknown as ScheduleResult

describe('plan screen — server render smoke', () => {
  it('renders the plan result without throwing', () => {
    const html = renderToString(
      <PlanResult result={result} pins={new Map()} onPin={() => {}} onClearPins={() => {}} onRerun={() => {}} running={false} startDate="2026-11-02"
        cash={{ result: null, running: false, error: null, refId: null, onRun: () => {}, financing: 'recourse' }} />,
    )
    expect(html).toContain('Узкое место')
    expect(html).toContain('Ходов агента нет')
    expect(html).not.toContain('>Ходы агента<')
    expect(html).toContain('№1')
  })
  it('renders history, run view, wizard and KPI-only', () => {
    expect(renderToString(<PlanHistory />)).toContain('План')
    expect(renderToString(<RunView runKey="zzz" section={null} />)).toContain('Мониторинг')
    for (const s of ['program', 'conditions', 'distributions', 'constraints', 'objective', 'launch']) {
      expect(renderToString(<PlanWizard routeStep={s} />)).toContain('Шаг')
    }
    expect(renderToString(<KpiOnlyRun row={undefined} loading={false} runKey="x" />)).toContain('Прогон не найден')
  })
})
