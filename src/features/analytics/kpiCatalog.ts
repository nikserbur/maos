import type { KpiBundle } from '../../lib/api'

/** Направление «лучше»: up — больше лучше, down — меньше лучше, neutral — контекст. */
export type KpiDir = 'up' | 'down' | 'neutral'
export type KpiStatus = 'good' | 'warn' | 'bad' | ''

export type KpiCategory = 'Сроки' | 'Ресурсы' | 'Поток' | 'Труд' | 'Надёжность' | 'Экономика'

export interface KpiDef {
  code: string
  name: string
  nameEn: string
  category: KpiCategory
  unit: string
  dir: KpiDir
  formula: string
  /** Значение из сохранённого KPI-блока плана. */
  value: (b: KpiBundle) => number
  fmt?: (v: number) => string
  /** Светофор по значению (условное форматирование как у Palantir). */
  status?: (v: number, b: KpiBundle) => KpiStatus
}

const pct = (v: number) => `${Math.round(v * 100)}%`
const num0 = (v: number) => Math.round(v).toLocaleString('ru')
const num1 = (v: number) => v.toFixed(1)
const rubM = (v: number) => Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(2)} млн` : Math.round(v).toLocaleString('ru')
const K = (b: KpiBundle, f: string) => Number(b.kpi?.[f] ?? 0)
const mk = (b: KpiBundle) => Math.max(1e-6, K(b, 'makespan'))

export const KPI_CATEGORIES: KpiCategory[] = ['Сроки', 'Ресурсы', 'Поток', 'Труд', 'Надёжность', 'Экономика']

/**
 * Реестр KPI в стиле метрик-определений Palantir: показатель объявлен один раз
 * (имя, категория, единица, направление, формула, светофор). Значения — из
 * сохранённого блока `plans.kpi_json` (что считает планировщик), /api/analytics/kpi.
 */
export const KPI_CATALOG: KpiDef[] = [
  // ── Сроки / исполнение ──
  { code: 'MAKESPAN', name: 'Длительность плана', nameEn: 'Makespan', category: 'Сроки', unit: 'ч', dir: 'down',
    formula: 'max(конец операции) по всем работам', value: (b) => K(b, 'makespan'), fmt: num0 },
  { code: 'MK_CVAR', name: 'Срок в худших α% (CVaR)', nameEn: 'Makespan CVaR', category: 'Сроки', unit: 'ч', dir: 'down',
    formula: 'средний makespan в α·100% худших прогонов Монте-Карло', value: (b) => K(b, 'makespan_cvar'), fmt: num0,
    status: (v, b) => v > mk(b) * 1.3 ? 'warn' : 'good' },
  { code: 'MK_WORST', name: 'Худший срок', nameEn: 'Makespan worst', category: 'Сроки', unit: 'ч', dir: 'down',
    formula: 'максимальный makespan по прогонам (риск срыва)', value: (b) => K(b, 'makespan_worst'), fmt: num0 },
  { code: 'OTD', name: 'В срок (OTD)', nameEn: 'On-time delivery', category: 'Сроки', unit: '%', dir: 'up',
    formula: '(заказов − просроченных) / заказов', value: (b) => K(b, 'otd'), fmt: pct,
    status: (v) => v >= 0.95 ? 'good' : v >= 0.8 ? 'warn' : 'bad' },
  { code: 'TARD', name: 'Суммарная просрочка', nameEn: 'Tardiness', category: 'Сроки', unit: 'ч', dir: 'down',
    formula: 'Σ max(0, факт_конец − срок) по заказам', value: (b) => K(b, 'tardiness'), fmt: num0,
    status: (v, b) => v <= 0 ? 'good' : v < mk(b) * 0.1 ? 'warn' : 'bad' },
  { code: 'N_LATE', name: 'Просроченных заказов', nameEn: 'Late orders', category: 'Сроки', unit: 'шт', dir: 'down',
    formula: 'число заказов с конец > срок', value: (b) => K(b, 'n_late'), fmt: num0,
    status: (v) => v <= 0 ? 'good' : 'warn' },
  { code: 'FLOW', name: 'Цикл заказа (flow time)', nameEn: 'Flow time', category: 'Сроки', unit: 'ч', dir: 'down',
    formula: 'ср. (выпуск − запуск) по заказам', value: (b) => K(b, 'flow_time_mean_h'), fmt: num0 },

  // ── Ресурсы ──
  { code: 'UTIL', name: 'Загрузка оборудования', nameEn: 'Utilization', category: 'Ресурсы', unit: '%', dir: 'up',
    formula: 'занятое время / фонд времени станков', value: (b) => K(b, 'utilization'), fmt: pct,
    status: (v) => v >= 0.55 ? 'good' : v >= 0.3 ? 'warn' : 'bad' },
  { code: 'BN_UTIL', name: 'Загрузка узкого места', nameEn: 'Bottleneck utilization', category: 'Ресурсы', unit: '%', dir: 'neutral',
    formula: 'max загрузка по типам РЦ (ограничение системы)', value: (b) => Number(b.bottleneck?.utilization ?? 0), fmt: pct,
    status: (v) => v >= 0.95 ? 'bad' : v >= 0.8 ? 'warn' : 'good' },

  // ── Поток ──
  { code: 'THRU', name: 'Проходка', nameEn: 'Throughput', category: 'Поток', unit: 'парт/дн', dir: 'up',
    formula: 'выпущено партий / (makespan в днях)', value: (b) => K(b, 'throughput_per_day'), fmt: num1 },
  { code: 'WIP', name: 'НЗП (WIP, среднее)', nameEn: 'Work-in-process', category: 'Поток', unit: 'шт', dir: 'down',
    formula: 'ср. число одновременно запущенных партий', value: (b) => K(b, 'wip_avg'), fmt: num1 },
  { code: 'WAIT', name: 'Доля ожидания в очередях', nameEn: 'Wait share', category: 'Поток', unit: '%', dir: 'down',
    formula: '(цикл − обработка) / цикл заказа', value: (b) => K(b, 'wait_share'), fmt: pct,
    status: (v) => v < 0.35 ? 'good' : v < 0.6 ? 'warn' : 'bad' },

  // ── Труд ──
  { code: 'LABOR_COST', name: 'Затраты на труд', nameEn: 'Labor cost', category: 'Труд', unit: '₽', dir: 'down',
    formula: 'Σ (часы рабочего × ставка) по плану', value: (b) => K(b, 'labor_cost'), fmt: rubM },

  // ── Надёжность (компоненты OEE-availability) ──
  { code: 'N_SETUP', name: 'Переналадок', nameEn: 'Setups', category: 'Надёжность', unit: 'шт', dir: 'down',
    formula: 'число смен изделия на станке', value: (b) => K(b, 'n_setups'), fmt: num0 },
  { code: 'SETUP_SHARE', name: 'Доля наладок', nameEn: 'Setup ratio', category: 'Надёжность', unit: '%', dir: 'down',
    formula: 'часы наладок / makespan', value: (b) => K(b, 'setup_hours') / mk(b), fmt: pct,
    status: (v) => v < 0.1 ? 'good' : v < 0.25 ? 'warn' : 'bad' },
  { code: 'MAINT', name: 'Часы ТО', nameEn: 'Maintenance hours', category: 'Надёжность', unit: 'ч', dir: 'down',
    formula: 'плановое ТО по наработке (MTBM)', value: (b) => K(b, 'maintenance_hours'), fmt: num0 },
  { code: 'BREAK', name: 'Часы поломок (ср.)', nameEn: 'Breakdown hours', category: 'Надёжность', unit: 'ч', dir: 'down',
    formula: 'ремонт по отказам (λ растёт с загрузкой)', value: (b) => K(b, 'breakdown_hours_mean'), fmt: num0 },
  { code: 'AVAIL', name: 'Готовность (availability)', nameEn: 'Availability', category: 'Надёжность', unit: '%', dir: 'up',
    formula: '1 − (ТО + поломки) / makespan', value: (b) => Math.max(0, 1 - (K(b, 'maintenance_hours') + K(b, 'breakdown_hours_mean')) / mk(b)), fmt: pct,
    status: (v) => v >= 0.9 ? 'good' : v >= 0.75 ? 'warn' : 'bad' },

  // ── Экономика ──
  { code: 'COST', name: 'Себестоимость работ', nameEn: 'Work cost', category: 'Экономика', unit: '₽', dir: 'down',
    formula: 'Σ стоимости операций плана (без материалов)', value: (b) => K(b, 'cost'), fmt: rubM },
]
