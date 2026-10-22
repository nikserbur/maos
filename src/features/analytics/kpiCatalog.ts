import type { KpiBundle } from '../../lib/api'
import type { InfoTipValues } from '../../ui/InfoTip'

/** Направление «лучше»: up — больше лучше, down — меньше лучше, neutral — контекст. */
export type KpiDir = 'up' | 'down' | 'neutral'
export type KpiStatus = 'good' | 'warn' | 'bad' | ''

export type KpiCategory = 'Сроки' | 'Ресурсы' | 'Поток' | 'Труд' | 'Надёжность' | 'Экономика' | 'Деньги'

/** Единица KPI (подмножество единиц реестра «i», src/explain/format.ts). */
export type KpiUnit = 'ч' | '%' | 'шт' | 'заказов' | 'ед./сут' | 'заказ/сут' | '₽' | 'нед' | '—'

/** Контекст, которого нет в KPI-блоке плана (для оценок по старым планам). */
export interface KpiContext {
  /** Число станков в НСИ — оценка Σ фонда как N·Cmax (24×7) для планов до B1. */
  machines?: number
}

export interface KpiDef {
  /** Стабильный код — по нему сохранены дашборды (не переименовывать). */
  code: string
  name: string
  nameEn: string
  category: KpiCategory
  unit: KpiUnit
  dir: KpiDir
  /** Краткая формула для реестра (полная — в «i»). */
  formula: string
  /** Значение из сохранённого KPI-блока плана; NaN — нет данных. */
  value: (b: KpiBundle, ctx?: KpiContext) => number
  /** true — значение оценено по старому набору полей (план до унификации KPI). */
  estimate?: (b: KpiBundle) => boolean
  /** Id объяснения «i» (src/explain) и живые значения для подстановки. */
  info: string
  infoValues?: (b: KpiBundle, ctx?: KpiContext) => InfoTipValues
  /** Светофор по значению (условное форматирование). */
  status?: (v: number, b: KpiBundle) => KpiStatus
}

/** Поле KPI-блока: NaN, если его нет (старый план) — отличаем «нет данных» от нуля. */
export const kpiField = (b: KpiBundle, f: string): number => {
  const v = b.kpi?.[f]
  return typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN
}
const has = (b: KpiBundle, f: string) => Number.isFinite(kpiField(b, f))
const or0 = (v: number) => (Number.isFinite(v) ? v : 0)
const K = (b: KpiBundle, f: string) => or0(kpiField(b, f))

/** E[Cmax] на итоговом расписании; для старых планов — детерминированная длина. */
const makespanMain = (b: KpiBundle) => (has(b, 'makespan_mean') && K(b, 'makespan_mean') > 0 ? K(b, 'makespan_mean') : kpiField(b, 'makespan'))
const mkRef = (b: KpiBundle) => Math.max(1e-6, or0(makespanMain(b)))

/**
 * Σ календарного фонда станков: из KPI (после B1) или оценка N·Cmax (24×7) —
 * верхняя граница фонда, поэтому доли по ней — нижние оценки.
 */
export function machineFund(b: KpiBundle, ctx?: KpiContext): number {
  if (has(b, 'machine_fund_hours') && K(b, 'machine_fund_hours') > 0) return K(b, 'machine_fund_hours')
  const n = ctx?.machines ?? 0
  const mk = K(b, 'makespan')
  return n > 0 && mk > 0 ? n * mk : Number.NaN
}

/** Доля переналадок: Σ τ_нал / Σ фонда станков (B8). */
const setupShare = (b: KpiBundle, ctx?: KpiContext) => {
  if (has(b, 'setup_share')) return K(b, 'setup_share')
  const fund = machineFund(b, ctx)
  return Number.isFinite(fund) ? K(b, 'setup_hours') / fund : Number.NaN
}
/** Коэффициент готовности (оценка): 1 − Σ(ТО + ремонт) / Σ фонда (ГОСТ 27.002). */
const availability = (b: KpiBundle, ctx?: KpiContext) => {
  if (has(b, 'availability')) return K(b, 'availability')
  const fund = machineFund(b, ctx)
  if (!Number.isFinite(fund)) return Number.NaN
  return Math.max(0, 1 - (K(b, 'maintenance_hours') + K(b, 'breakdown_hours_mean')) / fund)
}

export const KPI_CATEGORIES: KpiCategory[] = ['Сроки', 'Ресурсы', 'Поток', 'Труд', 'Надёжность', 'Экономика', 'Деньги']

/**
 * Реестр KPI: показатель объявлен один раз (имя по ГОСТ, категория, единица,
 * направление, формула, «i», светофор). Определения — docs/AUDIT-2026-10.md §4.2;
 * значения — сохранённый блок `plans.kpi_json` (/api/analytics/kpi).
 */
export const KPI_CATALOG: KpiDef[] = [
  // ── Сроки / исполнение ──
  { code: 'MAKESPAN', name: 'Длина расписания', nameEn: 'Makespan, E[Cmax]', category: 'Сроки', unit: 'ч', dir: 'down',
    formula: 'E[Cmax] по Монте-Карло на итоговом расписании',
    value: makespanMain, estimate: (b) => !has(b, 'makespan_mean'),
    info: 'plan.makespan', infoValues: (b) => ({ mean: kpiField(b, 'makespan_mean'), det: kpiField(b, 'makespan') }) },
  { code: 'MK_DET', name: 'Длина детерминированного расписания', nameEn: 'Makespan, deterministic', category: 'Сроки', unit: 'ч', dir: 'down',
    formula: 'maxⱼ Cⱼ при средних длительностях (диаграмма Ганта)',
    value: (b) => kpiField(b, 'makespan'),
    info: 'plan.makespan', infoValues: (b) => ({ mean: kpiField(b, 'makespan_mean'), det: kpiField(b, 'makespan') }) },
  { code: 'MK_CVAR', name: 'CVaR длины расписания', nameEn: 'Makespan CVaR', category: 'Сроки', unit: 'ч', dir: 'down',
    formula: 'среднее худших ⌊α·N⌋ прогонов (верхний хвост)', value: (b) => kpiField(b, 'makespan_cvar'),
    info: 'plan.makespan_cvar', infoValues: (b) => ({ cvar: kpiField(b, 'makespan_cvar'), worst: kpiField(b, 'makespan_worst') }),
    status: (v, b) => (v > mkRef(b) * 1.3 ? 'warn' : 'good') },
  { code: 'MK_WORST', name: 'Худший прогон', nameEn: 'Makespan worst', category: 'Сроки', unit: 'ч', dir: 'down',
    formula: 'maxᵢ Cmax,i по прогонам Монте-Карло', value: (b) => kpiField(b, 'makespan_worst'),
    info: 'plan.makespan_cvar', infoValues: (b) => ({ cvar: kpiField(b, 'makespan_cvar'), worst: kpiField(b, 'makespan_worst') }) },
  { code: 'OTD', name: 'Доля заказов в срок (OTD)', nameEn: 'On-time delivery', category: 'Сроки', unit: '%', dir: 'up',
    formula: '(n − n_просроч) / n', value: (b) => kpiField(b, 'otd'),
    info: 'plan.otd', infoValues: (b) => ({ otd: kpiField(b, 'otd'), n_late: kpiField(b, 'n_late') }),
    status: (v) => (v >= 0.95 ? 'good' : v >= 0.8 ? 'warn' : 'bad') },
  { code: 'TARD', name: 'Суммарная просрочка', nameEn: 'Total tardiness', category: 'Сроки', unit: 'ч', dir: 'down',
    formula: 'Σₖ max(0, Cₖ − dₖ)', value: (b) => kpiField(b, 'tardiness'),
    info: 'plan.tardiness', infoValues: (b) => ({ tard: kpiField(b, 'tardiness'), tard_cvar: kpiField(b, 'tardiness_cvar'), n_late: kpiField(b, 'n_late') }),
    status: (v, b) => (v <= 0 ? 'good' : v < mkRef(b) * 0.1 ? 'warn' : 'bad') },
  { code: 'N_LATE', name: 'Просроченных заказов', nameEn: 'Late orders', category: 'Сроки', unit: 'заказов', dir: 'down',
    formula: 'число заказов с Cₖ > dₖ', value: (b) => kpiField(b, 'n_late'),
    info: 'plan.otd', infoValues: (b) => ({ otd: kpiField(b, 'otd'), n_late: kpiField(b, 'n_late') }),
    status: (v) => (v <= 0 ? 'good' : 'warn') },
  { code: 'FLOW', name: 'Время потока заказа', nameEn: 'Flow time', category: 'Сроки', unit: 'ч', dir: 'down',
    formula: 'W̄ = (1/n)·Σₖ (Cₖ − Sₖ)', value: (b) => kpiField(b, 'flow_time_mean_h'),
    info: 'plan.flow_time', infoValues: (b) => ({ flow: kpiField(b, 'flow_time_mean_h') }) },

  // ── Ресурсы ──
  { code: 'UTIL', name: 'Загрузка оборудования', nameEn: 'Utilization (APT/PBT)', category: 'Ресурсы', unit: '%', dir: 'up',
    formula: 'Σ продуктивного времени / Σ календарного фонда станков', value: (b) => kpiField(b, 'utilization'),
    info: 'plan.utilization',
    infoValues: (b, ctx) => {
      const fund = machineFund(b, ctx), u = kpiField(b, 'utilization')
      return { util: u, fund, busy: Number.isFinite(fund) ? u * fund : Number.NaN }
    },
    status: (v) => (v >= 0.55 ? 'good' : v >= 0.3 ? 'warn' : 'bad') },
  { code: 'BN_UTIL', name: 'Загрузка узкого места', nameEn: 'Bottleneck utilization', category: 'Ресурсы', unit: '%', dir: 'neutral',
    formula: 'maxₜ Uₜ по типам РЦ — ограничение системы',
    value: (b) => (typeof b.bottleneck?.utilization === 'number' ? b.bottleneck.utilization : Number.NaN),
    info: 'plan.bottleneck', infoValues: (b) => ({ name: b.bottleneck?.wc_name ?? null, util: b.bottleneck?.utilization ?? null }),
    status: (v) => (v >= 0.95 ? 'bad' : v >= 0.8 ? 'warn' : 'good') },

  // ── Поток ──
  { code: 'THRU', name: 'Темп выпуска', nameEn: 'Throughput', category: 'Поток', unit: 'ед./сут', dir: 'up',
    formula: 'Σ выпущенных единиц / (Cmax / 24)', value: (b) => kpiField(b, 'throughput_per_day'),
    info: 'plan.throughput',
    infoValues: (b) => {
      const th = kpiField(b, 'throughput_per_day'), cmax = kpiField(b, 'makespan')
      return { th, cmax, qty: th * cmax / 24 }
    } },
  { code: 'ORDERS_DAY', name: 'Заказов в сутки', nameEn: 'Orders per day', category: 'Поток', unit: 'заказ/сут', dir: 'up',
    formula: 'n / (Cmax / 24) — не путать с темпом выпуска', value: (b) => kpiField(b, 'orders_per_day'),
    info: 'sim.orders_per_day', infoValues: (b) => ({ opd: kpiField(b, 'orders_per_day'), cmax: kpiField(b, 'makespan') }) },
  { code: 'WIP', name: 'Задел (НЗП в натуральном выражении)', nameEn: 'Work-in-process', category: 'Поток', unit: 'заказов', dir: 'down',
    formula: 'L = λ·W = Σ времени потока / Cmax (закон Литтла)', value: (b) => kpiField(b, 'wip_avg'),
    info: 'plan.wip', infoValues: (b) => ({ wip: kpiField(b, 'wip_avg'), cmax: kpiField(b, 'makespan'), flow: kpiField(b, 'flow_time_mean_h') }) },
  { code: 'WAIT', name: 'Доля ожидания', nameEn: 'Wait share', category: 'Поток', unit: '%', dir: 'down',
    formula: 'ожидание / (ожидание + обработка) на уровне операций', value: (b) => kpiField(b, 'wait_share'),
    info: 'plan.wait_share', infoValues: (b) => ({ share: kpiField(b, 'wait_share') }),
    status: (v) => (v < 0.35 ? 'good' : v < 0.6 ? 'warn' : 'bad') },

  // ── Труд ──
  { code: 'LABOR_COST', name: 'Затраты на труд', nameEn: 'Labor cost', category: 'Труд', unit: '₽', dir: 'down',
    formula: 'Σ_w B_w·r_w по назначениям рабочих', value: (b) => kpiField(b, 'labor_cost'),
    info: 'plan.labor_cost', infoValues: (b) => ({ labor: kpiField(b, 'labor_cost') }) },

  // ── Надёжность и переналадки ──
  { code: 'N_SETUP', name: 'Число переналадок', nameEn: 'Setups', category: 'Надёжность', unit: 'шт', dir: 'down',
    formula: 'смен изделия на станке в расписании', value: (b) => kpiField(b, 'n_setups'),
    info: 'plan.setup_share',
    infoValues: (b, ctx) => ({ share: setupShare(b, ctx), setup: kpiField(b, 'setup_hours'), fund: machineFund(b, ctx), n_setups: kpiField(b, 'n_setups') }) },
  { code: 'SETUP_SHARE', name: 'Доля переналадок', nameEn: 'Setup share', category: 'Надёжность', unit: '%', dir: 'down',
    formula: 'Σ τ_нал / Σ календарного фонда станков', value: setupShare, estimate: (b) => !has(b, 'setup_share'),
    info: 'plan.setup_share',
    infoValues: (b, ctx) => ({ share: setupShare(b, ctx), setup: kpiField(b, 'setup_hours'), fund: machineFund(b, ctx), n_setups: kpiField(b, 'n_setups') }),
    status: (v) => (v < 0.1 ? 'good' : v < 0.2 ? 'warn' : 'bad') },
  { code: 'MAINT', name: 'Плановое ТО', nameEn: 'Maintenance hours', category: 'Надёжность', unit: 'ч', dir: 'down',
    formula: 'Σₘ ⌊Hₘ / MTBM⌋·t_ТО', value: (b) => kpiField(b, 'maintenance_hours'),
    info: 'plan.maintenance', infoValues: (b) => ({ maint: kpiField(b, 'maintenance_hours'), repair: kpiField(b, 'breakdown_hours_mean') }) },
  { code: 'BREAK', name: 'Ремонты после отказов (среднее)', nameEn: 'Repair hours', category: 'Надёжность', unit: 'ч', dir: 'down',
    formula: 'E[T_рем] по прогонам Монте-Карло', value: (b) => kpiField(b, 'breakdown_hours_mean'),
    info: 'plan.maintenance', infoValues: (b) => ({ maint: kpiField(b, 'maintenance_hours'), repair: kpiField(b, 'breakdown_hours_mean') }) },
  { code: 'AVAIL', name: 'Коэффициент готовности (оценка)', nameEn: 'Availability', category: 'Надёжность', unit: '%', dir: 'up',
    formula: '1 − Σ(ТО + ремонт) / Σ календарного фонда станков', value: availability, estimate: (b) => !has(b, 'availability'),
    info: 'plan.availability',
    infoValues: (b, ctx) => ({ avail: availability(b, ctx), maint: kpiField(b, 'maintenance_hours'), repair: kpiField(b, 'breakdown_hours_mean'), fund: machineFund(b, ctx) }),
    status: (v) => (v >= 0.9 ? 'good' : v >= 0.75 ? 'warn' : 'bad') },

  // ── Экономика ──
  { code: 'COST', name: 'Себестоимость работ', nameEn: 'Work cost', category: 'Экономика', unit: '₽', dir: 'down',
    formula: 'Σ машинного времени, труда и переналадок (без материалов)', value: (b) => kpiField(b, 'cost'),
    info: 'plan.cost', infoValues: (b) => ({ cost: kpiField(b, 'cost') }) },

  // ── Деньги (METHODOLOGY-V2 §6.0; значения — водопад кассы на решении CVaR-LP, см. withCashKpis) ──
  { code: 'CASH_MIN_P50', name: 'Минимум кассы (медиана)', nameEn: 'Cash minimum, median', category: 'Деньги', unit: '₽', dir: 'up',
    formula: 'medᵢ minₜ C_i,t по сценариям водопада', value: (b) => kpiField(b, 'cash_min_p50'),
    info: 'cash.cash_min_p50', infoValues: (b) => ({ cash_min: kpiField(b, 'cash_min_p50'), n: kpiField(b, 'cash_n'), weeks: kpiField(b, 'cash_weeks') }) },
  { code: 'CFAR', name: 'CFaR — CVaR минимума кассы', nameEn: 'Cash-flow-at-risk', category: 'Деньги', unit: '₽', dir: 'up',
    formula: '(1/k′)·Σ худшие k′ сценариев minₜ C_i,t, β [К]', value: (b) => kpiField(b, 'cash_cfar'),
    info: 'cash.cfar', infoValues: (b) => ({ cfar: kpiField(b, 'cash_cfar'), beta: kpiField(b, 'cash_beta'), n: kpiField(b, 'cash_n'), ci_lo: kpiField(b, 'cash_cfar_lo'), ci_hi: kpiField(b, 'cash_cfar_hi') }),
    status: (v) => (v >= 0 ? 'good' : 'bad') },
  { code: 'P_BREACH', name: 'Вероятность кассового разрыва', nameEn: 'P(cash breach)', category: 'Деньги', unit: '%', dir: 'down',
    formula: '(1/N)·Σᵢ 𝟙[∃t: C_i,t < 0 ∧ лимит исчерпан]', value: (b) => kpiField(b, 'cash_p_breach'),
    info: 'cash.p_breach', infoValues: (b) => ({ p: kpiField(b, 'cash_p_breach'), ci_lo: kpiField(b, 'cash_p_breach_lo'), ci_hi: kpiField(b, 'cash_p_breach_hi'), warn: kpiField(b, 'cash_thr_breach_warn'), bad: kpiField(b, 'cash_thr_breach_bad') }),
    status: (v, b) => (v < or0(kpiField(b, 'cash_thr_breach_warn')) ? 'good' : v < or0(kpiField(b, 'cash_thr_breach_bad')) ? 'warn' : 'bad') },
  { code: 'T_BREACH_P10', name: 'Момент разрыва (10 % квантиль)', nameEn: 'Breach week, P10', category: 'Деньги', unit: 'нед', dir: 'up',
    formula: 'q₀.₁₀(t*ᵢ) среди сценариев с разрывом', value: (b) => kpiField(b, 'cash_t_breach_p10'),
    info: 'cash.t_breach_p10', infoValues: (b) => ({ t: kpiField(b, 'cash_t_breach_p10') }) },
  { code: 'DSCR_MIN_P05', name: 'DSCR, 5 % квантиль минимума', nameEn: 'DSCR min, P05', category: 'Деньги', unit: '—', dir: 'up',
    formula: 'q₀.₀₅(minₜ CFADS / (Int + PR)); ковенант 1,2 [НОРМ]', value: (b) => kpiField(b, 'cash_dscr_min_p05'),
    info: 'cash.dscr_min_p05', infoValues: (b) => ({ dscr: kpiField(b, 'cash_dscr_min_p05'), covenant: kpiField(b, 'cash_dscr_covenant'), p_cov: kpiField(b, 'cash_p_covenant') }),
    status: (v, b) => (v >= or0(kpiField(b, 'cash_dscr_covenant')) ? 'good' : v >= 1 ? 'warn' : 'bad') },
  { code: 'P_COVENANT', name: 'Вероятность нарушения ковенанта', nameEn: 'P(covenant breach)', category: 'Деньги', unit: '%', dir: 'down',
    formula: '(1/N)·Σᵢ 𝟙[minₜ DSCR_i,t < 1,2]', value: (b) => kpiField(b, 'cash_p_covenant'),
    info: 'cash.dscr_min_p05', infoValues: (b) => ({ dscr: kpiField(b, 'cash_dscr_min_p05'), covenant: kpiField(b, 'cash_dscr_covenant'), p_cov: kpiField(b, 'cash_p_covenant') }),
    status: (v) => (v <= 0 ? 'good' : v < 0.05 ? 'warn' : 'bad') },
  { code: 'DEBT_PEAK', name: 'Пик выбранного кредита', nameEn: 'Debt peak', category: 'Деньги', unit: '₽', dir: 'down',
    formula: 'medᵢ maxₜ D_i,t; доля лимита [К]', value: (b) => kpiField(b, 'cash_debt_peak'),
    info: 'cash.debt_peak', infoValues: (b) => ({ peak: kpiField(b, 'cash_debt_peak'), share: kpiField(b, 'cash_debt_peak_share'), limit: kpiField(b, 'cash_credit_limit') }),
    status: (_v, b) => { const s = kpiField(b, 'cash_debt_peak_share'); return !Number.isFinite(s) ? '' : s < or0(kpiField(b, 'cash_thr_debt_warn')) ? 'good' : s < or0(kpiField(b, 'cash_thr_debt_bad')) ? 'warn' : 'bad' } },
  { code: 'INT_COST', name: 'Проценты за горизонт', nameEn: 'Interest cost', category: 'Деньги', unit: '₽', dir: 'down',
    formula: 'Eᵢ Σₜ r_i,t·D_i,t−1; r = ключевая + спред', value: (b) => kpiField(b, 'cash_int_cost'),
    info: 'cash.int_cost', infoValues: (b) => ({ int: kpiField(b, 'cash_int_cost'), rate: kpiField(b, 'cash_rate') }) },
  { code: 'WC_AVG', name: 'Средний оборотный капитал', nameEn: 'Working capital, avg', category: 'Деньги', unit: '₽', dir: 'down',
    formula: 'Eᵢ (1/T)·Σₜ (AR + запасы + в пути − AP)', value: (b) => kpiField(b, 'cash_wc_avg'),
    info: 'cash.wc_avg', infoValues: (b) => ({ wc: kpiField(b, 'cash_wc_avg') }) },
  { code: 'POL', name: 'Цена ликвидности', nameEn: 'Price of liquidity', category: 'Деньги', unit: '₽', dir: 'neutral',
    formula: 'E[Π]без − E[Π]с L_min; парный бутстреп-ДИ', value: (b) => kpiField(b, 'cash_pol'),
    info: 'cash.pol', infoValues: (b) => ({ pol: kpiField(b, 'cash_pol'), ci_lo: kpiField(b, 'cash_pol_lo'), ci_hi: kpiField(b, 'cash_pol_hi'), pol_obj: kpiField(b, 'cash_pol_obj'), dual: kpiField(b, 'cash_pol_dual') }) },
  { code: 'NPV_O', name: 'ЧДД собственника', nameEn: 'NPV, owner', category: 'Деньги', unit: '₽', dir: 'up',
    formula: 'Σₜ DFₜ(r_O)·CF^O по сценариям; r_O [НОРМ]', value: (b) => kpiField(b, 'cash_npv_owner'),
    info: 'cash.npv', infoValues: (b) => ({ npv_o: kpiField(b, 'cash_npv_owner'), p_neg: kpiField(b, 'cash_p_npv_neg'), npv_b: kpiField(b, 'cash_npv_bank') }) },
  { code: 'NPV_B', name: 'ЧДД банка', nameEn: 'NPV, bank', category: 'Деньги', unit: '₽', dir: 'up',
    formula: 'Σₜ DFₜ(r_B)·(Int + PR − d); участие при E ≥ 0', value: (b) => kpiField(b, 'cash_npv_bank'),
    info: 'cash.npv', infoValues: (b) => ({ npv_o: kpiField(b, 'cash_npv_owner'), p_neg: kpiField(b, 'cash_p_npv_neg'), npv_b: kpiField(b, 'cash_npv_bank') }),
    status: (v) => (v >= 0 ? 'good' : 'bad') },
  { code: 'TAX_PAID', name: 'Налоги за горизонт', nameEn: 'Taxes paid', category: 'Деньги', unit: '₽', dir: 'neutral',
    formula: 'Eᵢ Σₜ (T_i,t + НДС к уплате_i,t)', value: (b) => kpiField(b, 'cash_tax_paid'),
    info: 'cash.tax_paid', infoValues: (b) => ({ tax: kpiField(b, 'cash_tax_paid'), tau_v: kpiField(b, 'cash_tau_v'), tau_p: kpiField(b, 'cash_tau_p') }) },
]

const BY_CODE = new Map(KPI_CATALOG.map((k) => [k.code, k]))

export function kpiDef(code: string): KpiDef | undefined {
  return BY_CODE.get(code)
}

/** Значение KPI и признак «оценка» (план построен до унификации определений). */
export function readKpi(def: KpiDef, b: KpiBundle, ctx?: KpiContext): { value: number; estimate: boolean } {
  return { value: def.value(b, ctx), estimate: def.estimate ? def.estimate(b) : false }
}
