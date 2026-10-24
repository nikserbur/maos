/**
 * Словарь журнала действий (X2 P-133 «кто что изменил»): коды бэкенда (entity_type, action_type,
 * payload) никогда не доходят до пользователя — экран берёт подписи, ссылки на объект и
 * однострочную сводку только отсюда. Чистые функции без DOM — проверяются vitest.
 * Источник кодов: backend/src/main.cpp (audit(…)) и backend/src/MentatRoutes.cpp.
 */
import type { AuditAction } from '../../lib/api'
import { NBSP, countText, dateTime, num, type PluralForms } from '../../explain/format'
import { humanize, objectiveLabel, ruleLabel } from '../../explain/labels'
import { CUSTOM_TEMPLATE, TEMPLATES } from '../explain/prompts'

export type Payload = Readonly<Record<string, unknown>>

/** Имена объектов, известные экрану (пользователи, сценарии, роли, цеха): id → подпись. */
export interface NameIndex {
  users: ReadonlyMap<string, string>
  scenarios: ReadonlyMap<string, string>
  roles: ReadonlyMap<string, string>
  orgUnits: ReadonlyMap<string, string>
}

export const EMPTY_NAMES: NameIndex = { users: new Map(), scenarios: new Map(), roles: new Map(), orgUnits: new Map() }

export const RECORD_FORMS: PluralForms = ['запись', 'записи', 'записей']

/* ── Права ролей ─────────────────────────────────────────────────────────── */

/** Права RBAC (backend: roles.permissions) — по-русски; код остаётся только в «i». */
export const PERM_LABEL: Readonly<Record<string, string>> = {
  READ: 'Просмотр',
  EDIT_NSI: 'Правка справочников',
  WRITE_PLAN: 'Создание и утверждение планов',
  RUN_OPTIMIZE: 'Запуск оптимизации',
  MANAGE_USERS: 'Пользователи и роли',
  HIRE_WORKERS: 'Найм в своём цехе',
}
export const PERM_CODES: readonly string[] = Object.keys(PERM_LABEL)
export const permLabel = (code: string): string => PERM_LABEL[code] ?? humanize(code)

/** Права роли из JSON-строки бэкенда; мусор → пустой список. */
export function parsePerms(raw: string | null | undefined): string[] {
  try {
    const p: unknown = JSON.parse(raw || '[]')
    return Array.isArray(p) ? p.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** Статус учётной записи: активна — нейтрально; иначе — «заблокирован». */
export const isActiveStatus = (status: string | null | undefined): boolean => (status ?? 'active') === 'active'
export const userStatusLabel = (status: string | null | undefined): string => (isActiveStatus(status) ? 'активен' : 'заблокирован')

/* ── Действия ────────────────────────────────────────────────────────────── */

/** Все коды action_type, которые пишет бэкенд. */
export const ACTION_LABEL: Readonly<Record<string, string>> = {
  CREATE: 'создание',
  UPDATE: 'изменение',
  DELETE: 'удаление',
  CLONE: 'копия',
  CALIBRATE: 'калибровка',
  SAMPLE: 'выборка сценариев',
  RUN: 'прогон',
  ASK: 'вопрос',
  ASK_FAILED: 'вопрос · ошибка',
  LOGIN: 'вход',
  LOGIN_FAILED: 'неудачный вход',
  LOGIN_LOCKED: 'блокировка',
  REJECTED: 'отказ в доступе',
}
export const actionLabel = (code: string): string => ACTION_LABEL[code] ?? humanize(code).toLowerCase()

/** Цвет — только у исключений: ■ сбой/необратимое, ▲ подозрительное; обычные действия — текст. */
export function actionTone(code: string): 'down' | 'setup' | null {
  if (code === 'LOGIN_FAILED') return 'setup'
  return code === 'DELETE' || code === 'REJECTED' || code === 'LOGIN_LOCKED' || code === 'ASK_FAILED' ? 'down' : null
}

/* ── Фильтр журнала ──────────────────────────────────────────────────────── */

export type LogKind = 'all' | 'changes' | 'runs' | 'logins' | 'problems'

interface KindDef { id: LogKind; label: string; hint: string; codes: ReadonlySet<string> | null }

export const LOG_KINDS: readonly KindDef[] = [
  { id: 'all', label: 'Все', hint: 'Все записи журнала', codes: null },
  { id: 'changes', label: 'Изменения', hint: 'Создание, изменение, удаление, копия и калибровка', codes: new Set(['CREATE', 'UPDATE', 'DELETE', 'CLONE', 'CALIBRATE']) },
  { id: 'runs', label: 'Прогоны', hint: 'Портфель, план, выборка сценариев и вопросы MENTAT', codes: new Set(['RUN', 'SAMPLE', 'ASK', 'ASK_FAILED']) },
  { id: 'logins', label: 'Входы', hint: 'Входы, неудачные входы и блокировки', codes: new Set(['LOGIN', 'LOGIN_FAILED', 'LOGIN_LOCKED']) },
  { id: 'problems', label: 'Отказы и ошибки', hint: 'Неудачные входы, блокировки, отказы в доступе, ошибки MENTAT и удаления', codes: new Set(['LOGIN_FAILED', 'LOGIN_LOCKED', 'REJECTED', 'ASK_FAILED', 'DELETE']) },
]

export const isLogKind = (v: string | undefined): v is LogKind => LOG_KINDS.some((k) => k.id === v)

export function matchesKind(a: AuditAction, kind: LogKind): boolean {
  const codes = LOG_KINDS.find((k) => k.id === kind)?.codes
  return !codes || codes.has(a.action_type)
}

export function kindCounts(rows: ReadonlyArray<AuditAction>): Record<LogKind, number> {
  const out: Record<LogKind, number> = { all: 0, changes: 0, runs: 0, logins: 0, problems: 0 }
  for (const a of rows) for (const k of LOG_KINDS) if (matchesKind(a, k.id)) out[k.id] += 1
  return out
}

/* ── Объект записи ───────────────────────────────────────────────────────── */

const enc = encodeURIComponent
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')

interface EntityMeta {
  label: string
  /** Ссылка на объект или место, где он правится; null — объекта на экране нет. */
  href: (id: string, p: Payload) => string | null
}

const none = (): null => null
const to = (hash: string) => (): string => hash

/** Сущности журнала: подпись по-русски и куда ведёт ссылка. */
export const ENTITY_META: Readonly<Record<string, EntityMeta>> = {
  scenario: { label: 'Сценарий', href: (id) => (id ? `#/scenarios/${enc(id)}` : '#/scenarios') },
  routing: { label: 'Техкарта', href: (id) => (id ? `#/nsi/routing/${enc(id)}` : '#/nsi/routing') },
  operation: { label: 'Операция', href: (_id, p) => (str(p.routing_id) ? `#/nsi/routing/${enc(str(p.routing_id))}` : '#/nsi/operation') },
  optimization: { label: 'Портфель', href: to('#/optimization') },
  schedule: { label: 'План', href: to('#/plan') },
  production_plan: { label: 'Программа выпуска', href: to('#/plan') },
  demand_order: { label: 'Заказ', href: to('#/plan') },
  macro: { label: 'Внешние условия', href: to('#/scenarios/conditions') },
  mentat: { label: 'MENTAT · ИИ', href: none },
  auth: { label: 'Вход', href: none },
  user: { label: 'Пользователь', href: none },
  passport: { label: 'Паспорт параметра', href: (id) => (id ? `#/map/${enc(id)}` : null) },
  calendar: { label: 'Календарь смен', href: to('#/plan/new/constraints') },
  fin_params: { label: 'Финансовые параметры', href: to('#/plan/new/constraints') },
  nsi: { label: 'Справочники · калибровка', href: to('#/nsi') },
  work_center_type: { label: 'Тип оборудования', href: to('#/nsi/workcentertype') },
  machine: { label: 'Станок', href: to('#/nsi/machine') },
  product: { label: 'Изделие', href: to('#/nsi/product') },
  worker: { label: 'Рабочий', href: to('#/nsi/worker') },
  flow: { label: 'Поток', href: to('#/scheme') },
  org_unit: { label: 'Подразделение', href: to('#/scheme') },
}

export const entityLabel = (code: string): string => ENTITY_META[code]?.label ?? humanize(code)

/** JSON-снимок записи; мусор и не-объект → пусто. */
export function parsePayload(raw: string | null | undefined): Payload {
  if (!raw) return {}
  try {
    const v: unknown = JSON.parse(raw)
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Payload) : {}
  } catch {
    return {}
  }
}

const shortId = (id: string): string => (id.length > 10 ? `${id.slice(0, 8)}…` : id)

export function templateLabel(id: string): string {
  if (id === 'settings') return 'настройки соединения'
  if (!id || id === CUSTOM_TEMPLATE.id) return CUSTOM_TEMPLATE.label
  return TEMPLATES.find((t) => t.id === id)?.label ?? humanize(id)
}

/** Имя объекта записи: из справочников экрана, из снимка или короткий id. */
export function objectName(a: AuditAction, p: Payload, names: NameIndex = EMPTY_NAMES): string {
  const id = a.entity_id ?? ''
  switch (a.entity_type) {
    case 'scenario': return names.scenarios.get(id) ?? (str(p.name) || shortId(id))
    case 'user': return names.users.get(id) ?? (str(p.login) || shortId(id))
    case 'auth': return names.users.get(id) ?? id
    case 'mentat': return templateLabel(id)
    case 'macro': case 'nsi': case 'fin_params': case 'calendar': case 'optimization': case 'schedule': return ''
    default: return str(p.name) || str(p.code) || str(p.last_name) || shortId(id)
  }
}

export interface ObjectRef { label: string; name: string; href: string | null }

export function objectRef(a: AuditAction, p: Payload, names: NameIndex = EMPTY_NAMES): ObjectRef {
  const meta = ENTITY_META[a.entity_type]
  return { label: entityLabel(a.entity_type), name: objectName(a, p, names), href: meta ? meta.href(a.entity_id ?? '', p) : null }
}

/** Кто: для входов — пользователь записи (сервер пишет туда id), иначе — автор; «system» → «система». */
export function actorName(a: AuditAction, names: NameIndex = EMPTY_NAMES): string {
  const who = a.entity_type === 'auth' ? names.users.get(a.entity_id) ?? (a.action_type === 'REJECTED' ? a.entity_id : a.actor) : a.actor
  return !who || who === 'system' ? 'система' : who
}

/* ── Сводка снимка в одну строку ─────────────────────────────────────────── */

const SCENARIO_FORMS: PluralForms = ['сценарий', 'сценария', 'сценариев']
const ORDER_FORMS: PluralForms = ['заказ', 'заказа', 'заказов']
const FIELD_FORMS: PluralForms = ['поле', 'поля', 'полей']
const PARAM_FORMS: PluralForms = ['параметр', 'параметра', 'параметров']
const numOf = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null)

function userPatchSummary(p: Payload, names: NameIndex): string {
  const parts: string[] = []
  if ('role_id' in p) parts.push(`роль: ${names.roles.get(str(p.role_id)) ?? (str(p.role_id) || '—')}`)
  if ('org_unit_id' in p) parts.push(`цех: ${names.orgUnits.get(str(p.org_unit_id)) ?? (str(p.org_unit_id) ? shortId(str(p.org_unit_id)) : 'не привязан')}`)
  if ('status' in p) parts.push(`статус: ${userStatusLabel(str(p.status))}`)
  return parts.length ? parts.join(' · ') : 'пароль изменён'
}

function mentatSummary(a: AuditAction, p: Payload): string {
  if (a.action_type === 'UPDATE') return 'настройки соединения с моделью'
  const q = str(p.question)
  const head = q ? `«${q.length > 60 ? `${q.slice(0, 59)}…` : q}»` : templateLabel(a.entity_id)
  if (a.action_type === 'ASK_FAILED') return `${head} · ${str(p.error) || 'модель не ответила'}`
  const ms = numOf(p.ms)
  return ms !== null ? `${head} · ${num(ms / 1000, 1)}${NBSP}с` : head
}

/** Однострочная сводка снимка: «цель: CVaR», «правило: EDD», «нет права «Запуск оптимизации» · /api/optimize». */
export function payloadSummary(a: AuditAction, p: Payload, names: NameIndex = EMPTY_NAMES): string {
  const code = a.action_type
  if (code === 'REJECTED') return `нет права «${permLabel(str(p.need))}» · ${str(p.path) || '—'}`
  if (code === 'LOGIN_LOCKED') return 'вход временно закрыт после 5 неудачных попыток'
  if (code === 'LOGIN_FAILED') return 'неверный пароль'
  if (a.entity_type === 'mentat') return mentatSummary(a, p)
  if (code === 'RUN' && a.entity_type === 'optimization') return `цель: ${objectiveLabel(str(p.objective))}`
  if (code === 'RUN' && a.entity_type === 'schedule') return `правило: ${ruleLabel(str(p.rule))}`
  if (code === 'SAMPLE') {
    const n = numOf(p.n)
    const seed = numOf(p.seed)
    return [n !== null ? countText(n, SCENARIO_FORMS) : '', seed !== null ? `зерно ${num(seed, 0)}` : ''].filter(Boolean).join(' · ')
  }
  if (code === 'CLONE') {
    const from = str(p.from)
    return `из «${names.scenarios.get(from) ?? (from ? shortId(from) : '—')}»`
  }
  if (code === 'CALIBRATE') {
    const n = numOf(p.updated)
    return n !== null ? `обновлено: ${countText(n, PARAM_FORMS)}` : ''
  }
  if (a.entity_type === 'production_plan' && 'from_run' in p) {
    const n = numOf(p.orders)
    return `из прогона портфеля${n !== null ? ` · ${countText(n, ORDER_FORMS)}` : ''}`
  }
  if (a.entity_type === 'user') {
    if (code === 'CREATE') return `роль: ${names.roles.get(str(p.role_id)) ?? (str(p.role_id) || '—')}`
    if (code === 'UPDATE') return userPatchSummary(p, names)
  }
  if (a.entity_type === 'passport') {
    const v = numOf(p.value)
    const val = v !== null ? num(v) : str(p.value)
    return val ? `значение: ${val}${str(p.unit) ? `${NBSP}${str(p.unit)}` : ''}` : ''
  }
  if (code === 'DELETE') return 'объект удалён'
  const keys = Object.keys(p).length
  return keys > 0 && (code === 'UPDATE' || code === 'CREATE') ? countText(keys, FIELD_FORMS) : ''
}

/* ── Снимок «ключ — значение» для боковой панели ─────────────────────────── */

const KEY_LABEL: Readonly<Record<string, string>> = {
  name: 'Название', code: 'Код', description: 'Описание', objective: 'Цель', rule: 'Правило', n: 'Сценариев', seed: 'Зерно',
  stress: 'Стресс-условия', from: 'Источник', from_run: 'Прогон портфеля', orders: 'Заказов', login: 'Логин', role_id: 'Роль',
  org_unit_id: 'Цех', status: 'Статус', updated: 'Обновлено параметров', path: 'Адрес запроса', need: 'Нужное право',
  template_id: 'Шаблон', prompt_version: 'Версия промпта', asked: 'Узел вопроса', question: 'Вопрос', context_nodes: 'Узлов в контексте',
  context_tokens: 'Токенов контекста', model: 'Модель', flavour: 'Сервер модели', ms: 'Время ответа', answer_chars: 'Длина ответа, символов',
  answer: 'Ответ', error: 'Ошибка', value: 'Значение', unit: 'Единица', routing_id: 'Техкарта', product_id: 'Изделие', quantity: 'Количество',
}

function valueText(key: string, v: unknown, names: NameIndex): string {
  if (v === null || v === undefined || v === '') return '—'
  if (key === 'role_id') return names.roles.get(str(v)) ?? str(v)
  if (key === 'org_unit_id') return names.orgUnits.get(str(v)) ?? str(v)
  if (key === 'objective') return objectiveLabel(str(v), 'long')
  if (key === 'rule') return ruleLabel(str(v), 'long')
  if (key === 'need') return permLabel(str(v))
  if (key === 'template_id') return templateLabel(str(v))
  if (key === 'from') return names.scenarios.get(str(v)) ?? str(v)
  if (key === 'ms' && numOf(v) !== null) return `${num((numOf(v) ?? 0) / 1000, 1)}${NBSP}с`
  if (typeof v === 'boolean') return v ? 'да' : 'нет'
  if (typeof v === 'number') return num(v)
  if (typeof v === 'string') return v
  return JSON.stringify(v)
}

export interface PayloadEntry { key: string; label: string; value: string }

export function payloadEntries(p: Payload, names: NameIndex = EMPTY_NAMES): PayloadEntry[] {
  return Object.entries(p).map(([key, v]) => ({ key, label: KEY_LABEL[key] ?? humanize(key), value: valueText(key, v, names) }))
}

/* ── Дни и поиск ─────────────────────────────────────────────────────────── */

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

/** Ключ дня записи (местная дата «24.10.2026»). */
export const dayKey = (a: Pick<AuditAction, 'ts'>): string => dateTime(a.ts, { time: false })

/** «Сегодня» · «Вчера» · «23 октября» · «23 октября 2025». */
export function dayLabel(key: string, now: Date = new Date()): string {
  if (key === dateTime(now, { time: false })) return 'Сегодня'
  if (key === dateTime(new Date(now.getTime() - 86_400_000), { time: false })) return 'Вчера'
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(key)
  if (!m) return key
  const month = MONTHS_GEN[Number(m[2]) - 1] ?? m[2]
  const year = m[3] === dateTime(now, { time: false }).slice(-4) ? '' : ` ${m[3]}`
  return `${m[1].replace(/^0/, '')} ${month}${year}`
}

/** Подзаголовок группы журнала: «Сегодня · 24 записи». */
export const dayGroupLabel = (key: string, count: number, now: Date = new Date()): string => `${dayLabel(key, now)} · ${countText(count, RECORD_FORMS)}`

/** Поиск по тому, что видит пользователь: действие, объект, сводка, автор. */
export function searchText(a: AuditAction, names: NameIndex = EMPTY_NAMES): string {
  const p = parsePayload(a.payload)
  const obj = objectRef(a, p, names)
  return [actionLabel(a.action_type), obj.label, obj.name, payloadSummary(a, p, names), actorName(a, names)].join(' ').toLowerCase()
}
