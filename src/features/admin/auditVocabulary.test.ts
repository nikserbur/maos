import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { AuditAction } from '../../lib/api'
import {
  ACTION_LABEL, ENTITY_META, PERM_CODES, PERM_LABEL, actionLabel, actionTone, actorName, dayGroupLabel, dayLabel,
  entityLabel, kindCounts, matchesKind, objectRef, parsePayload, parsePerms, payloadEntries, payloadSummary, searchText,
  type NameIndex,
} from './auditVocabulary'

const BACKEND = ['main.cpp', 'MentatRoutes.cpp'].map((f) =>
  readFileSync(fileURLToPath(new URL(`../../../backend/src/${f}`, import.meta.url)), 'utf8')).join('\n')

/** Коды из вызовов audit(…) бэкенда: действия — строковые литералы капсом, сущности — первый строковый аргумент. */
const AUDIT_CALLS = [...BACKEND.matchAll(/\baudit\(([^;]*);/g)].map((m) => m[1])
const BACKEND_ACTIONS = new Set(AUDIT_CALLS.flatMap((c) => [...c.matchAll(/"([A-Z_]{3,})"/g)].map((m) => m[1])))
const BACKEND_ENTITIES = new Set([
  ...[...BACKEND.matchAll(/audit\((?:db,\s*)?"([a-z_]+)"/g)].map((m) => m[1]),
  ...[...BACKEND.matchAll(/register_crud\(svr, db, \{\s*"[a-z_]+",\s*"([a-z_]+)"/g)].map((m) => m[1]),
])

/** Пробелы форматтера (NBSP, узкий NBSP) → обычный пробел: сравниваем текст, а не типографику. */
const sp = (s: string): string => s.replace(/\s/g, ' ')

const row = (over: Partial<AuditAction>): AuditAction => ({
  id: '1', ts: '2026-10-24 11:42:00', actor: 'admin', entity_type: 'scenario', entity_id: 'scen-base', action_type: 'UPDATE', payload: '', ...over,
})

const NAMES: NameIndex = {
  users: new Map([['user-admin', 'admin'], ['u-7', 'petrov.ceh1']]),
  scenarios: new Map([['scen-base', 'Базовый']]),
  roles: new Map([['role-admin', 'Администратор']]),
  orgUnits: new Map([['ou-1', 'Цех 1']]),
}

describe('auditVocabulary: словарь покрывает бэкенд', () => {
  it('у каждого кода действия бэкенда есть русская подпись', () => {
    expect(BACKEND_ACTIONS.size).toBeGreaterThanOrEqual(13)
    for (const code of BACKEND_ACTIONS) expect(ACTION_LABEL[code], code).toBeTruthy()
  })
  it('у каждой сущности бэкенда есть подпись (без латиницы в нижнем регистре)', () => {
    expect(BACKEND_ENTITIES.size).toBeGreaterThanOrEqual(15)
    for (const code of BACKEND_ENTITIES) {
      expect(ENTITY_META[code], code).toBeDefined()
      expect(entityLabel(code)).not.toMatch(/^[a-z_]+$/)
    }
  })
  it('права ролей — по-русски, все шесть', () => {
    expect(PERM_CODES).toEqual(['READ', 'EDIT_NSI', 'WRITE_PLAN', 'RUN_OPTIMIZE', 'MANAGE_USERS', 'HIRE_WORKERS'])
    for (const c of PERM_CODES) expect(PERM_LABEL[c]).toMatch(/[а-яё]/i)
    expect(parsePerms('["READ","EDIT_NSI"]')).toEqual(['READ', 'EDIT_NSI'])
    expect(parsePerms('мусор')).toEqual([])
  })
})

describe('auditVocabulary: строка журнала', () => {
  it('сценарий ведёт на сценарий и называется по имени', () => {
    const ref = objectRef(row({}), {}, NAMES)
    expect(ref).toEqual({ label: 'Сценарий', name: 'Базовый', href: '#/scenarios/scen-base' })
  })
  it('техкарта ведёт в конструктор, паспорт — на узел карты', () => {
    expect(objectRef(row({ entity_type: 'routing', entity_id: 'r1' }), { name: 'ТК-12 Вал' }).href).toBe('#/nsi/routing/r1')
    expect(objectRef(row({ entity_type: 'passport', entity_id: 'fin.tax_rate' }), {}).href).toBe('#/map/fin.tax_rate')
  })
  it('сводки: цель, правило, отказ в доступе, выборка, копия', () => {
    expect(payloadSummary(row({ entity_type: 'optimization', action_type: 'RUN' }), { objective: 'cvar' })).toBe('цель: CVaR')
    expect(payloadSummary(row({ entity_type: 'schedule', action_type: 'RUN' }), { rule: 'edd' })).toBe('правило: EDD')
    expect(payloadSummary(row({ entity_type: 'auth', action_type: 'REJECTED' }), { path: '/api/optimize', need: 'RUN_OPTIMIZE' }))
      .toBe('нет права «Запуск оптимизации» · /api/optimize')
    expect(sp(payloadSummary(row({ entity_type: 'macro', action_type: 'SAMPLE' }), { n: 1000, seed: 42 }))).toBe('1 000 сценариев · зерно 42')
    expect(payloadSummary(row({ action_type: 'CLONE' }), { from: 'scen-base' }, NAMES)).toBe('из «Базовый»')
  })
  it('правка пользователя: роль по имени, пустой снимок — смена пароля', () => {
    const a = row({ entity_type: 'user', entity_id: 'u-7' })
    expect(payloadSummary(a, { role_id: 'role-admin' }, NAMES)).toBe('роль: Администратор')
    expect(payloadSummary(a, {}, NAMES)).toBe('пароль изменён')
    expect(payloadSummary(a, { status: 'blocked' }, NAMES)).toBe('статус: заблокирован')
  })
  it('кто: у входа — пользователь записи, system — «система»', () => {
    expect(actorName(row({ entity_type: 'auth', entity_id: 'u-7', action_type: 'LOGIN_FAILED', actor: 'admin' }), NAMES)).toBe('petrov.ceh1')
    expect(actorName(row({ actor: 'system' }))).toBe('система')
  })
  it('цвет — только у исключений', () => {
    expect(actionTone('UPDATE')).toBeNull()
    expect(actionTone('RUN')).toBeNull()
    expect(actionTone('DELETE')).toBe('down')
    expect(actionTone('REJECTED')).toBe('down')
    expect(actionTone('LOGIN_FAILED')).toBe('setup')
    expect(actionLabel('SOMETHING_NEW')).toBe('something new')
  })
  it('снимок «ключ — значение» по-русски, без JSON для простых полей', () => {
    const entries = payloadEntries({ role_id: 'role-admin', need: 'MANAGE_USERS', ms: 3200 }, NAMES)
    expect(entries.map((e) => ({ ...e, value: sp(e.value) }))).toEqual([
      { key: 'role_id', label: 'Роль', value: 'Администратор' },
      { key: 'need', label: 'Нужное право', value: 'Пользователи и роли' },
      { key: 'ms', label: 'Время ответа', value: '3,2 с' },
    ])
    expect(parsePayload('[1,2]')).toEqual({})
    expect(parsePayload('{"a":1}')).toEqual({ a: 1 })
  })
})

describe('auditVocabulary: фильтры, дни, поиск', () => {
  const rows = ['CREATE', 'RUN', 'LOGIN', 'LOGIN_FAILED', 'REJECTED', 'DELETE', 'ASK_FAILED'].map((c, i) => row({ id: String(i), action_type: c }))
  it('счётчики видов: «Отказы и ошибки» включают входы, отказы, ошибки MENTAT и удаления', () => {
    expect(kindCounts(rows)).toEqual({ all: 7, changes: 2, runs: 2, logins: 2, problems: 4 })
    expect(matchesKind(rows[4], 'problems')).toBe(true)
  })
  it('подписи дней: сегодня, вчера, дата месяцем словом', () => {
    const now = new Date(2026, 9, 24, 12, 0)
    expect(dayLabel('24.10.2026', now)).toBe('Сегодня')
    expect(dayLabel('23.10.2026', now)).toBe('Вчера')
    expect(dayLabel('03.09.2026', now)).toBe('3 сентября')
    expect(dayLabel('31.12.2025', now)).toBe('31 декабря 2025')
    expect(sp(dayGroupLabel('24.10.2026', 24, now))).toBe('Сегодня · 24 записи')
    expect(sp(dayGroupLabel('21.10.2026', 31, now))).toBe('21 октября · 31 запись')
  })
  it('поиск по русской подписи, объекту и сводке', () => {
    const text = searchText(row({ entity_type: 'schedule', action_type: 'RUN', payload: '{"rule":"edd"}' }), NAMES)
    expect(text).toContain('прогон')
    expect(text).toContain('план')
    expect(text).toContain('правило: edd')
  })
})
