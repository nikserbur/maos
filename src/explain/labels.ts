/**
 * Общий словарь предметных имён (X2: «одно имя — одна вещь»): идентификаторы API (meanvariance,
 * key_pp, time_limit, empirical_blocks…) никогда не доходят до пользователя — экраны, карта,
 * MENTAT и палитра берут подписи только отсюда. Две формы: `short` — для чипов, таблиц и
 * заголовков колонок; `long` — для подсказок, «i» и мастера. Неизвестный id — очеловеченная
 * подпись (без «_») и предупреждение в dev-сборке. Чистые функции — проверяются тестом.
 */
import { num } from './format'

export type LabelForm = 'short' | 'long'

interface Entry { short: string; long: string }

const warned = new Set<string>()

function devWarn(kind: string, id: string): void {
  const env = (import.meta as { env?: { DEV?: boolean; MODE?: string } }).env
  if (!env?.DEV || env.MODE === 'test') return
  const key = `${kind}:${id}`
  if (warned.has(key)) return
  warned.add(key)
  console.warn(`[labels] нет подписи для ${kind} «${id}» — добавьте её в src/explain/labels.ts`)
}

/** «time_limit» → «time limit»; «SAMPLE» → «sample»: хотя бы без подчёркиваний и капса. */
export function humanize(id: string): string {
  const s = String(id ?? '').trim().replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ')
  return s === s.toUpperCase() && /[A-ZА-Я]{3,}/.test(s) ? s.toLowerCase() : s
}

function pick(dict: Readonly<Record<string, Entry>>, kind: string, id: string | null | undefined, form: LabelForm, fallback?: string): string {
  const key = String(id ?? '').trim()
  const hit = dict[key] ?? dict[key.toLowerCase()]
  if (hit) return hit[form]
  devWarn(kind, key)
  return fallback ?? (humanize(key) || '—')
}

/* ── Цели оптимизации (критерий портфеля) ─────────────────────────────────── */
const OBJECTIVES: Readonly<Record<string, Entry>> = {
  meanvariance: { short: 'E − λ·σ', long: 'среднее − риск (E − λ·σ)' },
  cvar: { short: 'CVaR', long: 'CVaR — среднее по худшим α исходам' },
  worstcase: { short: 'худший случай', long: 'худший случай (максимин)' },
  minregret: { short: 'мин. сожаление', long: 'минимум максимального сожаления' },
  expected: { short: 'среднее', long: 'среднее значение (E)' },
}

export function objectiveLabel(id: string | null | undefined, form: LabelForm = 'short'): string {
  return pick(OBJECTIVES, 'цели', id, form)
}

/* ── Правила диспетчеризации (Стадия 1) ───────────────────────────────────── */
const RULES: Readonly<Record<string, Entry>> = {
  auto: { short: 'авто', long: 'авто (лучшее правило)' },
  edd: { short: 'EDD', long: 'EDD — по ближайшему сроку' },
  spt: { short: 'SPT', long: 'SPT — короткие операции вперёд' },
  lpt: { short: 'LPT', long: 'LPT — длинные операции вперёд' },
  cr: { short: 'CR', long: 'CR — критическое отношение' },
  mwkr: { short: 'MWKR', long: 'MWKR — больше остаточной работы' },
  ms: { short: 'MS', long: 'MS — минимальный запас времени' },
  fifo: { short: 'FIFO', long: 'FIFO — в порядке поступления' },
  custom: { short: 'своя эвристика', long: 'конструктор эвристики (взвешенные критерии)' },
  rl: { short: 'RL', long: 'RL-политика (обучена, проверена гейтом)' },
  ga: { short: 'ГА', long: 'генетический алгоритм поверх правил' },
  cpsat: { short: 'CP-SAT', long: 'точный решатель CP-SAT' },
  'cp-sat': { short: 'CP-SAT', long: 'точный решатель CP-SAT' },
}

export function ruleLabel(id: string | null | undefined, form: LabelForm = 'short'): string {
  return pick(RULES, 'правила', id, form)
}

/* ── Макропеременные внешних условий ──────────────────────────────────────── */
const MACRO: Readonly<Record<string, Entry>> = {
  key_pp: { short: 'ключевая ставка', long: 'ключевая ставка ЦБ, % годовых' },
  cpi_yoy_pp: { short: 'инфляция', long: 'инфляция год к году, %' },
  cpi_pp: { short: 'инфляция м/м', long: 'инфляция месяц к месяцу, %' },
  usd_rub: { short: 'курс $/₽', long: 'курс доллара, ₽ за $' },
  eur_rub: { short: 'курс €/₽', long: 'курс евро, ₽ за €' },
  cny_rub: { short: 'курс ¥/₽', long: 'курс юаня, ₽ за ¥' },
}

export function macroVarLabel(id: string | null | undefined, form: LabelForm = 'short'): string {
  return pick(MACRO, 'макропеременной', id, form)
}

/* ── Финансирование кассы ─────────────────────────────────────────────────── */
const FINANCING: Readonly<Record<string, Entry>> = {
  recourse: { short: 'по факту', long: 'кредит по факту: решение после того, как исход известен' },
  first: { short: 'график заранее', long: 'график займов заранее, до того как исход известен' },
  lp_recourse: { short: 'ЛП по факту', long: 'линейная программа кассы по факту исхода' },
  rule: { short: 'по правилу', long: 'по казначейскому правилу (без оптимизации)' },
}

export function financingLabel(id: string | null | undefined, form: LabelForm = 'short'): string {
  return pick(FINANCING, 'финансирования', id, form)
}

/* ── Подобранные распределения ────────────────────────────────────────────── */
const FITS: Readonly<Record<string, Entry>> = {
  normal: { short: 'нормальное', long: 'нормальное распределение' },
  t: { short: 't-Стьюдента', long: 't-распределение Стьюдента (тяжёлые хвосты)' },
  student_t: { short: 't-Стьюдента', long: 't-распределение Стьюдента (тяжёлые хвосты)' },
  laplace: { short: 'Лапласа', long: 'распределение Лапласа (тяжёлые хвосты)' },
  stable: { short: 'α-устойчивое', long: 'α-устойчивое распределение (тяжёлые хвосты)' },
  lognormal: { short: 'логнормальное', long: 'логнормальное распределение' },
  pareto: { short: 'Парето', long: 'хвост Парето' },
  beta: { short: 'бета', long: 'бета-распределение' },
  pert: { short: 'PERT', long: 'PERT (оценка «мин · вероятно · макс»)' },
  triangular: { short: 'треугольное', long: 'треугольное распределение' },
  uniform: { short: 'равномерное', long: 'равномерное распределение' },
  empirical: { short: 'эмпирическое', long: 'эмпирическое распределение по данным' },
  empirical_blocks: { short: 'эмпирическое (блочный бутстреп)', long: 'эмпирическое распределение: блочный бутстреп остатков' },
}

/** Имя распределения; ν/α добавляются только там, где параметр есть у семейства (у нормального — никогда). */
export function fitLabel(id: string | null | undefined, form: LabelForm = 'short', params: { nu?: number | null; alpha?: number | null } = {}): string {
  const base = pick(FITS, 'распределения', id, form, 'другое распределение')
  const key = String(id ?? '').trim()
  if ((key === 't' || key === 'student_t') && typeof params.nu === 'number' && Number.isFinite(params.nu)) return `${base}, ν = ${num(params.nu, 0)}`
  if (key === 'stable' && typeof params.alpha === 'number' && Number.isFinite(params.alpha)) return `${base}, α = ${num(params.alpha, 2)}`
  return base
}

/* ── Статус решателя (ЛП кассы, CP-SAT) ───────────────────────────────────── */
const LP_STATUS: Readonly<Record<string, Entry>> = {
  optimal: { short: 'оптимум', long: 'найден оптимум' },
  feasible: { short: 'допустимое', long: 'допустимое решение, оптимальность не доказана' },
  infeasible: { short: 'нет решения', long: 'допустимого решения нет — ограничения противоречат друг другу' },
  unbounded: { short: 'не ограничена', long: 'задача не ограничена — проверьте лимиты кредита и цены' },
  time_limit: { short: 'лимит времени', long: 'остановлено по лимиту времени — решение может быть неоптимальным' },
  error: { short: 'ошибка', long: 'решатель завершился с ошибкой' },
  unknown: { short: 'нет ответа', long: 'решатель не дал ответа' },
  model_invalid: { short: 'модель неверна', long: 'модель не прошла проверку решателя' },
}

export function lpStatusLabel(id: string | null | undefined, form: LabelForm = 'short'): string {
  return pick(LP_STATUS, 'статуса решателя', id, form)
}

/** Все известные id словарей — для теста «сырой id не возвращается». */
export const KNOWN_IDS = {
  objective: Object.keys(OBJECTIVES),
  rule: Object.keys(RULES),
  macro: Object.keys(MACRO),
  financing: Object.keys(FINANCING),
  fit: Object.keys(FITS),
  lpStatus: Object.keys(LP_STATUS),
} as const
