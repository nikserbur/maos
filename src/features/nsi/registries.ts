/**
 * Реестры Справочников и общий словарь подписей НСИ (X2 «одно имя — одна вещь»): названия реестров,
 * подзаголовки (одна строка ≤ 90 символов), типы операций, роли изделий, статусы оборудования.
 * Колонки таблиц — в registryColumns.tsx; здесь только то, что нужно и оболочке (крошки, палитра).
 */
import { humanize } from '../../explain/labels'

export interface RegistryDef {
  id: string
  title: string
  /** Подзаголовок реестра: одна строка ≤ 90 символов, без формул (объяснения — в «i» и «Методике»). */
  description: string
}

export const REGISTRIES: RegistryDef[] = [
  { id: 'workcentertype', title: 'Типы оборудования', description: 'Классы взаимозаменяемых станков: ставка, надёжность, ТО и допущенные операторы' },
  { id: 'machine', title: 'Оборудование', description: 'Станки по цехам: тип, расписание и статус — на чём выполняется план' },
  { id: 'product', title: 'Изделия', description: 'Сырьё, полуфабрикаты и товары: состав, запасы, цены' },
  { id: 'routing', title: 'Техкарты', description: 'Как производится каждое изделие: операции, станки, нормы времени' },
  { id: 'operation', title: 'Операции', description: 'Шаги техкарт: тип станка, время, наладка' },
  { id: 'worker', title: 'Рабочие', description: 'Персонал цехов и допуски к типам станков — второй ресурс плана' },
]

export const registryTitle = (id: string): string => REGISTRIES.find((r) => r.id === id)?.title ?? id

/** Тип операции: код API → подпись (общая для таблицы, формы и конструктора). */
export const OP_TYPE_LABELS: Readonly<Record<string, string>> = {
  machining: 'Механообработка',
  welding: 'Сварка',
  assembly: 'Сборка',
  coating: 'Покрытие',
  heat: 'Термообработка',
  control: 'Контроль качества',
  transport: 'Транспортировка',
}

export function opTypeLabel(id: string | null | undefined): string {
  const key = (id ?? '').trim()
  if (!key) return ''
  return OP_TYPE_LABELS[key] ?? humanize(key)
}

/** Статус единицы оборудования. Норма («в работе») в таблице не показывается — только отклонения. */
export const MACHINE_STATUS_LABELS: Readonly<Record<string, string>> = {
  active: 'В работе',
  maintenance: 'На ТО',
  decommissioned: 'Выведено',
}

/** Расписание оборудования: код → подпись; пусто — работает по графику цеха. */
export const SCHEDULE_LABELS: Readonly<Record<string, string>> = {
  '8x5': '8 ч × 5 дней',
  '12x2': '12 ч × 2 смены',
  '24x7': 'Круглосуточно',
}

/* ── Изделия: роль по флагам ─────────────────────────────────────────────── */

export type ProductRole = 'raw' | 'semi' | 'product'

export const ROLE_LABELS: Readonly<Record<ProductRole, string>> = { raw: 'Сырьё', semi: 'Полуфабрикаты', product: 'Товары' }
export const ROLE_ORDER: Readonly<Record<ProductRole, number>> = { raw: 0, semi: 1, product: 2 }

export function productRole(row: { purchased?: unknown; sellable?: unknown }): ProductRole {
  if (String(row.purchased ?? '') === '1') return 'raw'
  if (String(row.sellable ?? '') === '1') return 'product'
  return 'semi'
}

/* ── Имена ───────────────────────────────────────────────────────────────── */

/** «Цех №1 — Заготовительно-литейный (корпус …)» → «Цех №1 — Заготовительно-литейный»: пояснение в скобках — в подсказку. */
export function shopShort(name: string | null | undefined): string {
  const s = (name ?? '').trim()
  if (!s) return ''
  return s.replace(/\s*\([^)]*\)\s*$/, '').trim() || s
}

/** «Цех №1 — Заготовительно-литейный» → «Цех №1» (короткая подпись группы допусков). */
export function shopCode(name: string | null | undefined): string {
  const s = shopShort(name)
  const dash = s.indexOf(' — ')
  return dash > 0 ? s.slice(0, dash) : s
}

/** Имя «Насос — для химпрома» → ['Насос', 'для химпрома']; без « — » — [имя, '']. */
export function splitName(name: string | null | undefined): [string, string] {
  const s = (name ?? '').trim()
  const at = s.indexOf(' — ')
  return at > 0 ? [s.slice(0, at), s.slice(at + 3)] : [s, '']
}

/** Короткое имя типа станка для чипов: без пояснения в скобках. */
export function typeShort(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, '').trim() || name
}

/** Альтернативная техкарта демо: «Альтернативная техкарта (взаимозаменяемые станки): ТК …» → короткое имя. */
export function routingVariantName(name: string, isDefault: boolean): string {
  const m = /^Альтернативная техкарта\s*\(([^)]+)\)\s*:/i.exec(name.trim())
  if (m) return `Альтернатива: ${m[1]}`
  return isDefault ? name : `Альтернатива: ${name}`
}

/** Действующая ли техкарта: пусто/NULL — действующая (как COALESCE(is_default,1) на сервере). */
export function isDefaultRouting(row: { is_default?: unknown }): boolean {
  const v = String(row.is_default ?? '').trim()
  return v !== '0' && v !== 'false'
}
