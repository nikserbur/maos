/**
 * Срок заказа в датах (решение владельца, UX-V2 §8 п. 2): `due_hours` остаётся техническим
 * полем контракта (`demand_orders.due_hours` — календарные часы от начала горизонта, 24 ч = сутки),
 * пользователь видит и правит дату. Начало горизонта — `start_date` сценария; без него —
 * дата по умолчанию (создание плана / сегодня), и это честно подписывается в интерфейсе.
 * Чистые функции без DOM — проверяются тестом.
 */

export const HOURS_PER_DAY = 24
const MS_PER_HOUR = 3_600_000

/** ISO-дата `YYYY-MM-DD` → полночь UTC (сдвиг зоны не влияет на разность дат). */
export function parseIsoDate(s: string | null | undefined): Date | null {
  if (!s) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim())
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return Number.isNaN(d.getTime()) ? null : d
}

/** Date → `YYYY-MM-DD` (UTC-компоненты, парные `parseIsoDate`). */
export function toIsoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/** Начало горизонта: дата сценария, иначе запасная (создание плана / сегодня). */
export function horizonStart(scenarioStart: string | null | undefined, fallback: Date): { date: Date; source: 'scenario' | 'fallback' } {
  const parsed = parseIsoDate(scenarioStart)
  return parsed ? { date: parsed, source: 'scenario' } : { date: new Date(Date.UTC(fallback.getUTCFullYear(), fallback.getUTCMonth(), fallback.getUTCDate())), source: 'fallback' }
}

/** Срок в часах → дата (с округлением вниз до суток: 23 ч от старта — тот же день, 24 ч — следующий). */
export function dueDateFromHours(start: Date, dueHours: number): Date {
  const h = Number.isFinite(dueHours) ? Math.max(0, dueHours) : 0
  return new Date(start.getTime() + Math.floor(h / HOURS_PER_DAY) * HOURS_PER_DAY * MS_PER_HOUR)
}

/** Дата → срок в часах от начала горизонта (конец выбранных суток не берём: срок = начало дня). Раньше старта → 0. */
export function hoursFromDueDate(start: Date, due: Date): number {
  const diff = (due.getTime() - start.getTime()) / MS_PER_HOUR
  return Math.max(0, Math.round(diff / HOURS_PER_DAY) * HOURS_PER_DAY)
}

/** «через 12 дн» / «через 3 нед» / «сегодня» — подпись рядом с датой. */
export function dueRelativeText(dueHours: number): string {
  const days = Math.floor(Math.max(0, dueHours) / HOURS_PER_DAY)
  if (days === 0) return 'в день старта'
  if (days < 14) return `через ${days} ${plural(days, 'день', 'дня', 'дней')}`
  const weeks = Math.round(days / 7)
  if (days < 60) return `через ${weeks} ${plural(weeks, 'неделю', 'недели', 'недель')}`
  const months = Math.round(days / 30)
  return `через ${months} ${plural(months, 'месяц', 'месяца', 'месяцев')}`
}

function plural(n: number, one: string, few: string, many: string): string {
  const n10 = n % 10, n100 = n % 100
  if (n10 === 1 && n100 !== 11) return one
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few
  return many
}

/** Горизонт программы: максимальный срок среди заказов, в часах и в датах. */
export function programHorizon(orders: ReadonlyArray<{ due_hours: number }>, start: Date): { hours: number; end: Date } {
  const hours = orders.reduce((m, o) => Math.max(m, Number.isFinite(o.due_hours) ? o.due_hours : 0), 0)
  return { hours, end: dueDateFromHours(start, hours) }
}
