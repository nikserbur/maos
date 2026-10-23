/**
 * Статические паспорта параметров (UX-V2 §3.9 `ParameterPassport`, §5.2):
 * что за величина, кому принадлежит (проект / сценарий / прогон), где её менять,
 * разумный диапазон и честное происхождение, пока пользователь ничего не задал.
 * Живые значения подставляет `deriveState.ts`; статус, источник и note — серверный
 * паспорт (`GET /api/passport`) по `passportCode`, когда он доступен (волна G2).
 */
import type { ParamDef } from './types'

const SCN = (field: string) => ({ id: 'scenarios', field })
const OPT = (field: string) => ({ id: 'optimization', field })
const PLAN = (field: string) => ({ id: 'plan', field })
const FIN = (field: string) => ({ id: 'plan', anchor: 'new/constraints', field })

/** Волна M: ползунки приняты API и возвращаются как deprecated_fields, в расчёте не участвуют (паспорт r1.51–r1.53). */
const DEPRECATED_NOTE = 'Не используется в расчёте с волны M: внешние условия задаёт обученный макро-генератор (меню режимов и стрессов, METHODOLOGY-V2 §2.6б).'

export const PARAM_LIST: readonly ParamDef[] = [
  /* ── [1] Внешние условия — владелец: сценарий ─────────────────────────── */
  { id: 'scenario.inflation', label: 'Инфляция (прогноз цен)', unit: '%/мес', owner: 'scenario', range: [0, 2], step: 0.1,
    editable: true, screen: SCN('inflation'), provenance: 'default', defaultValue: 0,
    note: 'Месячная величина: 8,5 %/мес за 13 месяцев даёт +188 % — проверьте, что это не годовая.' },
  { id: 'scenario.volatility', label: 'Волатильность цен', unit: '%/мес', owner: 'scenario', range: [0, 20], step: 0.5,
    editable: true, screen: SCN('volatility'), provenance: 'default', defaultValue: 5 },
  { id: 'scenario.market_corr', label: 'Корреляция рынка', unit: '—', owner: 'scenario', range: [0, 1], step: 0.05,
    editable: true, screen: SCN('market_corr'), provenance: 'default', defaultValue: 0.5, passportCode: 'r1.30' },
  { id: 'scenario.fx', label: 'Курс (множитель прогноза цен)', unit: '×', owner: 'scenario', range: [0.5, 2], step: 0.05,
    editable: true, screen: SCN('fx'), provenance: 'default', defaultValue: 1 },
  { id: 'scenario.demand', label: 'Спрос (множитель)', unit: '×', owner: 'scenario', range: [0.5, 2], step: 0.05,
    editable: true, screen: SCN('demand'), provenance: 'default', defaultValue: 1 },
  { id: 'scenario.months', label: 'Горизонт', unit: 'мес', owner: 'scenario', range: [1, 36], step: 1,
    editable: true, screen: SCN('months'), provenance: 'default', defaultValue: 6 },
  { id: 'scenario.key_rate', label: 'Ключевая ставка (ползунок)', unit: '%/год', owner: 'scenario', range: [0, 30], step: 0.25,
    editable: true, screen: SCN('key_rate'), provenance: 'ui', defaultValue: 8, deprecated: true, passportCode: 'r1.51', note: DEPRECATED_NOTE },
  { id: 'scenario.energy', label: 'Цена энергии (ползунок)', unit: '×', owner: 'scenario', range: [0.5, 3], step: 0.05,
    editable: true, screen: SCN('energy'), provenance: 'ui', defaultValue: 1, deprecated: true, passportCode: 'r1.53', note: DEPRECATED_NOTE },
  { id: 'scenario.logistics', label: 'Логистика (ползунок)', unit: '×', owner: 'scenario', range: [0.5, 3], step: 0.05,
    editable: true, screen: SCN('logistics'), provenance: 'ui', defaultValue: 1, deprecated: true, passportCode: 'r1.53', note: DEPRECATED_NOTE },
  { id: 'scenario.sanctions', label: 'Санкции (ползунок)', unit: '—', owner: 'scenario', range: [0, 1], step: 0.05,
    editable: true, screen: SCN('sanctions'), provenance: 'ui', defaultValue: 0, deprecated: true, passportCode: 'r1.51', note: DEPRECATED_NOTE },
  { id: 'scenario.tax_change', label: 'Изменение налогов (ползунок)', unit: 'п.п.', owner: 'scenario', range: [-10, 15], step: 0.5,
    editable: true, screen: SCN('tax_change'), provenance: 'ui', defaultValue: 0, deprecated: true, passportCode: 'r1.53', note: DEPRECATED_NOTE },

  /* ── [1] Обученный макро-генератор (волна M) — владелец: проект / сценарий ── */
  { id: 'macro.mode', label: 'Режим генератора', unit: '—', owner: 'scenario', editable: true,
    screen: SCN('macro_mode'), provenance: 'normative', defaultValue: 'base', passportCode: 'macro.mode_default',
    note: 'Базовый — прогноз; режим навязан / квантиль / эпизод — стресс, не прогноз (§2.6б).' },
  { id: 'macro.generator', label: 'Генератор VAR → SVD → HMM', unit: '—', owner: 'project', editable: false,
    provenance: 'estimated', defaultValue: null, passportCode: 'macro.generator', screen: SCN('macro_mode') },
  { id: 'macro.selection_crps', label: 'CRPS выбора (модель / персистентность)', unit: '—', owner: 'project', editable: false,
    provenance: 'estimated', defaultValue: null, passportCode: 'macro.selection_crps', screen: SCN('macro_mode') },
  { id: 'macro.holdout_coverage80', label: 'Покрытие 80 % на отложенных данных', unit: '—', owner: 'project', editable: false,
    provenance: 'estimated', defaultValue: null, passportCode: 'macro.holdout_coverage80', screen: SCN('macro_mode'),
    note: 'Ставка недопокрыта (0,40) — для неё используйте квантильный стресс.' },
  { id: 'macro.ref_key', label: 'Опора ключевой ставки', unit: '%/год', owner: 'scenario', editable: true,
    screen: SCN('macro_mode'), provenance: 'normative', defaultValue: null, passportCode: 'macro.ref_key' },
  { id: 'macro.pt_cpi', label: 'Индексация цен на инфляцию b^π', unit: '—', owner: 'project', range: [0, 1.5], step: 0.05,
    editable: false, provenance: 'calibrated', defaultValue: 1, passportCode: 'macro.pt_cpi' },
  { id: 'macro.pt_fx_product', label: 'Курсовая эластичность цен b^FX', unit: '—', owner: 'project', range: [0, 1], step: 0.05,
    editable: false, provenance: 'calibrated', defaultValue: 0.1, passportCode: 'macro.pt_fx_product' },
  { id: 'macro.pt_fx_raw', label: 'Курсовая эластичность сырья', unit: '—', owner: 'project', range: [0, 1], step: 0.05,
    editable: false, provenance: 'calibrated', defaultValue: 0.3, passportCode: 'macro.pt_fx_raw' },

  /* ── [2] Распределения ─────────────────────────────────────────────────── */
  { id: 'dist.sigma_default', label: 'σ цены по умолчанию', unit: '%', owner: 'project',
    editable: false, provenance: 'ui', defaultValue: 0.12, passportCode: 'r1.33',
    note: '12 % от базовой цены, когда распределение изделия не задано.' },
  { id: 'dist.beta_default', label: 'β к рыночному фактору', unit: '—', owner: 'project', range: [0, 1.5], step: 0.05,
    editable: true, screen: SCN('beta'), provenance: 'normative', defaultValue: 0.7, passportCode: 'r1.31' },
  { id: 'op.tail_weight', label: 'Вес хвоста Парето', unit: '—', owner: 'run', range: [0, 0.5], step: 0.01,
    editable: true, screen: PLAN('tail_weight'), provenance: 'ui', defaultValue: 0.08, passportCode: 'r1.03',
    note: 'Доля операций с тяжёлым хвостом длительности; цель — оценка POT по план-факту (R20).' },
  { id: 'op.tail_index', label: 'Индекс хвоста α', unit: '—', owner: 'project', range: [1.1, 3], step: 0.1,
    editable: true, screen: { id: 'nsi', anchor: 'operations' }, provenance: 'ui', defaultValue: 2.5, passportCode: 'r1.04' },

  /* ── [3] Внутренние условия ────────────────────────────────────────────── */
  { id: 'cal.enabled', label: 'Календарь смен', unit: '—', owner: 'run', editable: true,
    screen: PLAN('useCalendar'), provenance: 'manual', defaultValue: 'вкл', passportCode: 'r1.15' },
  { id: 'cal.work_fond', label: 'Фонд рабочего времени', unit: 'ч', owner: 'project', editable: false,
    screen: PLAN('calendar'), provenance: 'estimated', defaultValue: null },
  /* Слой F (волна F): fin_params + паспорт; все внутренние параметры денег — [К] или [НОРМ], данных предприятия нет (Р8). */
  { id: 'fin.cash0', label: 'Касса на старте C₀', unit: '₽', owner: 'project', editable: true,
    screen: FIN('c0'), provenance: 'calibrated', defaultValue: 0, passportCode: 'fin.c0' },
  { id: 'fin.credit_limit', label: 'Лимит кредитной линии', unit: '₽', owner: 'project', editable: true,
    screen: FIN('credit_limit'), provenance: 'calibrated', defaultValue: 20_000_000, passportCode: 'fin.credit_limit' },
  { id: 'fin.credit_rate', label: 'Ставка по кредиту', unit: '%/год', owner: 'scenario', editable: false,
    screen: FIN('spread'), provenance: 'normative', defaultValue: null, passportCode: 'fin.spread',
    note: 'r = ключевая ставка (из генератора по сценарию) + спред (METHODOLOGY-V2 §2.3).' },
  { id: 'fin.spread', label: 'Спред линии над ключевой', unit: '%/год', owner: 'project', range: [0, 15], step: 0.25,
    editable: true, screen: FIN('spread'), provenance: 'normative', defaultValue: 3, passportCode: 'fin.spread' },
  { id: 'fin.dso', label: 'Ядро инкассации (DSO)', unit: '—', owner: 'project', editable: true,
    screen: FIN('dso_kernel'), provenance: 'calibrated', defaultValue: '0 / 0,5 / 0,5', passportCode: 'fin.dso_kernel',
    note: 'Доли выручки по неделям после отгрузки; DSO в неделях = Σ k·w_k.' },
  { id: 'fin.dpo', label: 'Отсрочка поставщикам (DPO)', unit: '—', owner: 'project', range: [0, 12], step: 1,
    editable: true, screen: FIN('dpo_weeks'), provenance: 'normative', defaultValue: 2, passportCode: 'fin.dpo_weeks' },
  { id: 'fin.pd', label: 'Вероятность дефолта покупателя', unit: '%', owner: 'project', range: [0, 0.3], step: 0.01,
    editable: true, screen: FIN('pd'), provenance: 'calibrated', defaultValue: 0.02, passportCode: 'fin.pd' },
  { id: 'fin.beta', label: 'β хвоста кассы (CFaR)', unit: '%', owner: 'scenario', range: [0.01, 0.25], step: 0.01,
    editable: true, screen: FIN('beta'), provenance: 'calibrated', defaultValue: 0.05, passportCode: 'fin.beta',
    note: 'Отдельный от α уровень для минимума кассы (худшие β сценариев).' },
  { id: 'fin.l_min', label: 'Порог ликвидности L_min', unit: '₽', owner: 'run', editable: true,
    screen: FIN('l_min'), provenance: 'calibrated', defaultValue: 0, passportCode: 'fin.l_min',
    note: '«Касса ≥ L_min в каждую неделю худших β сценариев» — ограничение CVaR-LP; цена — PoL.' },
  { id: 'fin.repair_budget', label: 'Бюджет ремонтов в неделю', unit: '₽', owner: 'project', editable: true,
    screen: FIN('repair_budget_weekly'), provenance: 'normative', defaultValue: 0, passportCode: 'fin.repair_budget_weekly' },
  { id: 'fin.tau_v', label: 'НДС', unit: '%', owner: 'project', editable: true,
    screen: FIN('tau_v'), provenance: 'normative', defaultValue: 0.22, passportCode: 'fin.tau_v' },
  { id: 'fin.tau_p', label: 'Налог на прибыль', unit: '%', owner: 'project', editable: true,
    screen: FIN('tau_p'), provenance: 'normative', defaultValue: 0.25, passportCode: 'fin.tau_p' },
  { id: 'fin.dscr_covenant', label: 'Ковенант DSCR', unit: '—', owner: 'project', range: [1, 2], step: 0.1,
    editable: true, screen: FIN('dscr_covenant'), provenance: 'normative', defaultValue: 1.2, passportCode: 'fin.dscr_covenant' },

  /* ── [4]/[5] Решения и критерии ───────────────────────────────────────── */
  { id: 'scenario.objective', label: 'Критерий', unit: '—', owner: 'scenario', editable: true,
    screen: SCN('objective'), provenance: 'default', defaultValue: 'cvar',
    note: 'Живёт в сценарии; «Портфель»/«План» переопределяют только на прогон (решение владельца, UX-V2 §8).' },
  { id: 'scenario.alpha', label: 'α хвоста', unit: '%', owner: 'scenario', range: [0.01, 0.5], step: 0.01,
    editable: true, screen: SCN('alpha'), provenance: 'calibrated', defaultValue: 0.1, passportCode: 'r1.19',
    note: 'Один α на портфель, план, кассу и агента: «худшие α·100 % сценариев».' },
  { id: 'scenario.max_share', label: 'Максимальная доля изделия', unit: '%', owner: 'scenario', range: [0.1, 1], step: 0.05,
    editable: true, screen: SCN('max_share'), provenance: 'normative', defaultValue: 0.35, passportCode: 'r1.40' },
  { id: 'opt.samples', label: 'Сценариев Монте-Карло', unit: 'прогонов', owner: 'run', range: [500, 20000], step: 500,
    editable: true, screen: OPT('samples'), provenance: 'default', defaultValue: 3000, passportCode: 'r1.43' },
  { id: 'opt.horizon_months', label: 'Горизонт портфеля', unit: 'мес', owner: 'run', range: [1, 36], step: 1,
    editable: true, screen: OPT('horizonMonths'), provenance: 'default', defaultValue: 12 },
  { id: 'plan.rule', label: 'Диспетчерское правило', unit: '—', owner: 'run', editable: true,
    screen: PLAN('rule'), provenance: 'default', defaultValue: 'auto' },
  { id: 'plan.samples', label: 'Прогонов хвоста (Стадия 1)', unit: 'прогонов', owner: 'run', range: [100, 5000], step: 100,
    editable: true, screen: PLAN('samples'), provenance: 'default', defaultValue: 500, passportCode: 'r1.20' },
  { id: 'plan.w_risk', label: 'Вес риска w_risk', unit: '—', owner: 'run', range: [0, 3], step: 0.5,
    editable: true, screen: PLAN('wRisk'), provenance: 'normative', defaultValue: 0.5, passportCode: 'r1.18',
    note: 'F = w_time·E[Cmax] + w_risk·(CVaR − E) + w_cost·стоимость — см. «i» plan.rule_score.' },
  { id: 'plan.w_time', label: 'Вес срока w_time', unit: '—', owner: 'run', range: [0, 3], step: 0.5, editable: true,
    screen: PLAN('wTime'), provenance: 'normative', defaultValue: 1, passportCode: 'r1.18' },
  { id: 'plan.w_cost', label: 'Вес стоимости w_cost', unit: '—', owner: 'run', range: [0, 3], step: 0.5, editable: true,
    screen: PLAN('wCost'), provenance: 'normative', defaultValue: 0, passportCode: 'r1.18' },
  { id: 'plan.improve_iters', label: 'Поколений ГА', unit: '—', owner: 'run', editable: false,
    screen: PLAN('rule'), provenance: 'normative', defaultValue: null, passportCode: 'r1.23', note: 'Задаёт планировщик при правиле «Авто».' },

  /* ── [6] Агенты — волна A: статус политики (GET /api/rl/status) и полномочия (prefs agent_guardrails) ── */
  { id: 'agent.policy_version', label: 'Версия политики RL', unit: '—', owner: 'project', editable: false,
    provenance: 'default', defaultValue: null, note: 'SHA256 опубликованной политики L0; «не опубликована» — ни одна политика не прошла гейт §7.4 (A1 §5).' },
  { id: 'agent.max_moves', label: 'Лимит ходов пакета', unit: 'шт', owner: 'project', range: [1, 50], step: 1,
    editable: false, provenance: 'normative', defaultValue: 12, note: 'Полномочия агента (UX-V2 §4.10), меняются на экране «Агенты».' },
]

export const PARAMS: Readonly<Record<string, ParamDef>> = Object.freeze(
  Object.fromEntries(PARAM_LIST.map((p) => [p.id, p])),
)

export function getParamDef(id: string): ParamDef | undefined {
  return Object.prototype.hasOwnProperty.call(PARAMS, id) ? PARAMS[id] : undefined
}

/** Датасеты карты с синтетическим происхождением (паспорт r1.59–r1.61): бейдж «синтетика» на узле. */
export const DATASET_PASSPORT: Readonly<Record<string, string>> = Object.freeze({
  'ext.prices.ds': 'r1.59',
  'ext.generator.ds': 'macro.generator',
})
