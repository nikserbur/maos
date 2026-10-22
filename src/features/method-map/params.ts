/**
 * Статические паспорта параметров (UX-V2 §3.9 `ParameterPassport`, §5.2):
 * что за величина, кому принадлежит (проект / сценарий / прогон), где её менять,
 * разумный диапазон и честное происхождение, пока пользователь ничего не задал.
 * Живые значения подставляет `deriveState.ts`.
 */
import type { ParamDef } from './types'

const SCN = (field: string) => ({ id: 'scenarios', field })
const OPT = (field: string) => ({ id: 'optimization', field })
const PLAN = (field: string) => ({ id: 'plan', field })

/** Коэффициенты макро-ползунков подобраны «для заметности» (A2 §21) — это калибровка, не оценка. */
const VISIBILITY_NOTE = 'Коэффициент влияния подобран «для заметности» (A2 §21) — норматив сценария, не оценка по данным.'

export const PARAM_LIST: readonly ParamDef[] = [
  /* ── [1] Внешние условия — владелец: сценарий ─────────────────────────── */
  { id: 'scenario.key_rate', label: 'Ключевая ставка', unit: '%/год', owner: 'scenario', range: [0, 30], step: 0.25,
    editable: true, screen: SCN('key_rate'), provenance: 'default', defaultValue: 8 },
  { id: 'scenario.fx', label: 'Курс (множитель)', unit: '×', owner: 'scenario', range: [0.5, 2], step: 0.05,
    editable: true, screen: SCN('fx'), provenance: 'default', defaultValue: 1 },
  { id: 'scenario.inflation', label: 'Инфляция', unit: '%/мес', owner: 'scenario', range: [0, 2], step: 0.1,
    editable: true, screen: SCN('inflation'), provenance: 'default', defaultValue: 0,
    note: 'Месячная величина: 8,5 %/мес за 13 месяцев даёт +188 % — проверьте, что это не годовая.' },
  { id: 'scenario.demand', label: 'Спрос (множитель)', unit: '×', owner: 'scenario', range: [0.5, 2], step: 0.05,
    editable: true, screen: SCN('demand'), provenance: 'default', defaultValue: 1 },
  { id: 'scenario.volatility', label: 'Волатильность цен', unit: '%/мес', owner: 'scenario', range: [0, 20], step: 0.5,
    editable: true, screen: SCN('volatility'), provenance: 'default', defaultValue: 5 },
  { id: 'scenario.market_corr', label: 'Корреляция рынка', unit: '—', owner: 'scenario', range: [0, 1], step: 0.05,
    editable: true, screen: SCN('market_corr'), provenance: 'default', defaultValue: 0.5 },
  { id: 'scenario.months', label: 'Горизонт', unit: 'мес', owner: 'scenario', range: [1, 36], step: 1,
    editable: true, screen: SCN('months'), provenance: 'default', defaultValue: 6 },
  { id: 'scenario.energy', label: 'Цена энергии', unit: '×', owner: 'scenario', range: [0.5, 3], step: 0.05,
    editable: true, screen: SCN('energy'), provenance: 'normative', defaultValue: 1, note: VISIBILITY_NOTE },
  { id: 'scenario.logistics', label: 'Логистика', unit: '×', owner: 'scenario', range: [0.5, 3], step: 0.05,
    editable: true, screen: SCN('logistics'), provenance: 'normative', defaultValue: 1, note: VISIBILITY_NOTE },
  { id: 'scenario.sanctions', label: 'Санкции (интенсивность)', unit: '—', owner: 'scenario', range: [0, 1], step: 0.05,
    editable: true, screen: SCN('sanctions'), provenance: 'normative', defaultValue: 0, note: VISIBILITY_NOTE },
  { id: 'scenario.tax_change', label: 'Изменение налогов', unit: 'п.п.', owner: 'scenario', range: [-10, 15], step: 0.5,
    editable: true, screen: SCN('tax_change'), provenance: 'normative', defaultValue: 0, note: VISIBILITY_NOTE },

  /* ── [2] Распределения ─────────────────────────────────────────────────── */
  { id: 'dist.sigma_default', label: 'σ цены по умолчанию', unit: '%', owner: 'project',
    editable: false, provenance: 'default', defaultValue: 0.12,
    note: '12 % от базовой цены, когда распределение изделия не задано.' },
  { id: 'dist.beta_default', label: 'β к рыночному фактору', unit: '—', owner: 'project', range: [0, 1.5], step: 0.05,
    editable: true, screen: SCN('beta'), provenance: 'default', defaultValue: 0.7 },
  { id: 'op.tail_weight', label: 'Вес хвоста Парето', unit: '—', owner: 'run', range: [0, 0.5], step: 0.01,
    editable: false, screen: PLAN('tail_weight'), provenance: 'default', defaultValue: null,
    note: 'Доля операций с тяжёлым хвостом длительности; значение по умолчанию задаёт планировщик.' },
  { id: 'op.tail_index', label: 'Индекс хвоста α', unit: '—', owner: 'project', range: [1.1, 3], step: 0.1,
    editable: true, screen: { id: 'nsi', anchor: 'operations' }, provenance: 'default', defaultValue: null },

  /* ── [3] Внутренние условия ────────────────────────────────────────────── */
  { id: 'cal.enabled', label: 'Календарь смен', unit: '—', owner: 'run', editable: true,
    screen: PLAN('useCalendar'), provenance: 'manual', defaultValue: 'вкл' },
  { id: 'cal.work_fond', label: 'Фонд рабочего времени', unit: 'ч', owner: 'project', editable: false,
    screen: PLAN('calendar'), provenance: 'estimated', defaultValue: null },
  { id: 'fin.cash0', label: 'Касса на старте', unit: '₽', owner: 'scenario', editable: false,
    provenance: 'default', defaultValue: null, stage: 'w1', note: 'Слой F (METHODOLOGY-V2 §4): появится с таблицами кассы.' },
  { id: 'fin.credit_limit', label: 'Лимит кредитной линии', unit: '₽', owner: 'project', editable: false,
    provenance: 'default', defaultValue: null, stage: 'w1', note: 'Слой F.' },
  { id: 'fin.credit_rate', label: 'Ставка по кредиту', unit: '%/год', owner: 'scenario', editable: false,
    provenance: 'default', defaultValue: null, stage: 'w1', note: 'r = ключевая ставка + спред (METHODOLOGY-V2 §2.3).' },
  { id: 'fin.dso', label: 'Отсрочка покупателей (DSO)', unit: 'дн', owner: 'project', editable: false,
    provenance: 'default', defaultValue: null, stage: 'w1', note: 'Слой F.' },
  { id: 'fin.dpo', label: 'Отсрочка поставщикам (DPO)', unit: 'дн', owner: 'project', editable: false,
    provenance: 'default', defaultValue: null, stage: 'w1', note: 'Слой F.' },

  /* ── [4]/[5] Решения и критерии ───────────────────────────────────────── */
  { id: 'scenario.objective', label: 'Критерий', unit: '—', owner: 'scenario', editable: true,
    screen: OPT('objective'), provenance: 'default', defaultValue: 'cvar',
    note: 'Живёт в сценарии; «Портфель»/«План» переопределяют только на прогон (решение владельца, UX-V2 §8).' },
  { id: 'scenario.alpha', label: 'α хвоста', unit: '%', owner: 'scenario', range: [0.01, 0.5], step: 0.01,
    editable: true, screen: OPT('alpha'), provenance: 'default', defaultValue: 0.1,
    note: 'Один α на портфель, план, кассу и агента: «худшие α·100 % сценариев».' },
  { id: 'scenario.max_share', label: 'Максимальная доля изделия', unit: '%', owner: 'scenario', range: [0.1, 1], step: 0.05,
    editable: true, screen: OPT('maxShare'), provenance: 'default', defaultValue: 0.35 },
  { id: 'opt.samples', label: 'Сценариев Монте-Карло', unit: 'прогонов', owner: 'run', range: [500, 20000], step: 500,
    editable: true, screen: OPT('samples'), provenance: 'default', defaultValue: 3000 },
  { id: 'opt.horizon_months', label: 'Горизонт портфеля', unit: 'мес', owner: 'run', range: [1, 36], step: 1,
    editable: true, screen: OPT('horizonMonths'), provenance: 'default', defaultValue: 12 },
  { id: 'plan.rule', label: 'Диспетчерское правило', unit: '—', owner: 'run', editable: true,
    screen: PLAN('rule'), provenance: 'default', defaultValue: 'auto' },
  { id: 'plan.samples', label: 'Прогонов хвоста (Стадия 1)', unit: 'прогонов', owner: 'run', range: [100, 5000], step: 100,
    editable: true, screen: PLAN('samples'), provenance: 'default', defaultValue: 500 },
  { id: 'plan.w_risk', label: 'Вес риска w_risk', unit: '—', owner: 'run', range: [0, 3], step: 0.5,
    editable: true, screen: PLAN('wRisk'), provenance: 'default', defaultValue: 0.5,
    note: 'F = w_time·E[Cmax] + w_risk·(CVaR − E) + w_cost·стоимость — см. «i» plan.rule_score.' },
  { id: 'plan.w_time', label: 'Вес срока w_time', unit: '—', owner: 'run', editable: false,
    screen: PLAN('wRisk'), provenance: 'default', defaultValue: 1, note: 'Есть в API (ScheduleParams.w_time), на экране пока не показан — G2.' },
  { id: 'plan.w_cost', label: 'Вес стоимости w_cost', unit: '—', owner: 'run', editable: false,
    screen: PLAN('wRisk'), provenance: 'default', defaultValue: 0, note: 'Есть в API (ScheduleParams.w_cost), на экране пока не показан — G2.' },
  { id: 'plan.improve_iters', label: 'Поколений ГА', unit: '—', owner: 'run', editable: false,
    screen: PLAN('rule'), provenance: 'default', defaultValue: null, note: 'Задаёт планировщик при правиле «Авто».' },

  /* ── [6] Агенты — волна 3 ──────────────────────────────────────────────── */
  { id: 'agent.policy_version', label: 'Версия политики RL', unit: '—', owner: 'project', editable: false,
    provenance: 'default', defaultValue: null, stage: 'w3', note: 'Появится после обучения на симуляторе (волна A).' },
  { id: 'agent.max_moves', label: 'Лимит ходов пакета', unit: 'шт', owner: 'project', range: [1, 50], step: 1,
    editable: false, provenance: 'normative', defaultValue: 12, stage: 'w3', note: 'Guardrails (UX-V2 §4.10).' },
]

export const PARAMS: Readonly<Record<string, ParamDef>> = Object.freeze(
  Object.fromEntries(PARAM_LIST.map((p) => [p.id, p])),
)

export function getParamDef(id: string): ParamDef | undefined {
  return Object.prototype.hasOwnProperty.call(PARAMS, id) ? PARAMS[id] : undefined
}
