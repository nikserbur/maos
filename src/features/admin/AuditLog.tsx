/**
 * Журнал действий (X2 P-133, P-134, P-140, P-141, P-145): «кто что изменил» по-русски — Когда · Кто ·
 * Действие · Объект (подпись + ссылка) · Подробности; группы по дням «Сегодня · 24 записи»; фильтр
 * видов со счётчиками («Отказы и ошибки» — на виду), поиск по тому, что видно; вид и поиск — в адресе
 * (#/admin?type=problems&q=…), F5 сохраняет фильтр. Цвет — только у исключений.
 */
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import type { AuditAction } from '../../lib/api'
import { countText, num, time } from '../../explain/format'
import { useHashParams } from '../../shell/router'
import { Chip, DataTable, EmptyState, ErrorBanner, Segmented, type DataColumn, type SegOption, type SortState } from '../../ui/kit'
import {
  LOG_KINDS, RECORD_FORMS, actionLabel, actionTone, actorName, dayGroupLabel, dayKey, isLogKind, kindCounts, matchesKind,
  objectRef, parsePayload, payloadSummary, searchText, type LogKind, type NameIndex, type ObjectRef, type Payload,
} from './auditVocabulary'
import { LOG_PAGE, type Resource } from './useAdminData'

/** Строка журнала с уже вычисленными подписями (одна сборка на загрузку, а не на каждую отрисовку). */
export interface LogRow {
  a: AuditAction
  p: Payload
  obj: ObjectRef
  who: string
  summary: string
  search: string
}

export function buildLogRows(actions: ReadonlyArray<AuditAction>, names: NameIndex): LogRow[] {
  return actions.map((a) => {
    const p = parsePayload(a.payload)
    return { a, p, obj: objectRef(a, p, names), who: actorName(a, names), summary: payloadSummary(a, p, names), search: searchText(a, names) }
  })
}

const stop = (e: MouseEvent) => e.stopPropagation()

/** Объект: подпись сущности и имя-ссылка (клик по ссылке не открывает панель строки). */
export function ObjectCell({ obj }: { obj: ObjectRef }) {
  return (
    <span className="adm__obj">
      <span className="adm__obj-type">{obj.label}</span>
      {obj.name && (obj.href
        ? <a className="adm__obj-link" href={obj.href} onClick={stop}>{obj.name}</a>
        : <span className="adm__obj-name">{obj.name}</span>)}
      {!obj.name && obj.href && <a className="adm__obj-link" href={obj.href} onClick={stop} aria-label={`Открыть: ${obj.label}`}>↗</a>}
    </span>
  )
}

/** Действие: обычное — текстом; исключение — чип с глифом (■ удаление, отказ, блокировка, ошибка; ▲ неудачный вход). */
export function ActionCell({ code }: { code: string }) {
  const tone = actionTone(code)
  return tone ? <Chip tone={tone} size="sm">{actionLabel(code)}</Chip> : <span className="adm__act">{actionLabel(code)}</span>
}

const COLUMNS: DataColumn<LogRow>[] = [
  { key: 'ts', title: 'Когда', get: (r) => r.a.ts, render: (r) => time(r.a.ts), className: 'adm__ts', hint: 'Местное время; дата — в подзаголовке дня' },
  { key: 'who', title: 'Кто', get: (r) => r.who, className: 'adm__who' },
  { key: 'action', title: 'Действие', get: (r) => actionLabel(r.a.action_type), render: (r) => <ActionCell code={r.a.action_type} /> },
  { key: 'object', title: 'Объект', rowHeader: true, get: (r) => `${r.obj.label} ${r.obj.name}`, render: (r) => <ObjectCell obj={r.obj} /> },
  { key: 'summary', title: 'Подробности', get: (r) => r.summary, clip: true, sortable: false },
]

const DEFAULT_SORT: SortState = { key: 'ts', dir: 'desc' }
const SEARCH_DEBOUNCE_MS = 250

interface AuditLogProps {
  log: Resource<AuditAction[]>
  names: NameIndex
  limit: number
  onMore: () => void
  openId: string | null
  onOpen: (row: LogRow) => void
}

export function AuditLog({ log, names, limit, onMore, openId, onOpen }: AuditLogProps) {
  const [params, setParams] = useHashParams()
  const kind: LogKind = isLogKind(params.type) ? params.type : 'all'
  const urlQuery = params.q ?? ''
  const [query, setQuery] = useState(urlQuery)
  const [sort, setSort] = useState<SortState | null>(DEFAULT_SORT)
  const written = useRef(urlQuery)

  // Поиск — в адресе (с задержкой, без записи истории); адрес, изменённый извне («Назад», вставка), возвращает поле.
  useEffect(() => {
    if (urlQuery !== written.current) { written.current = urlQuery; setQuery(urlQuery) }
  }, [urlQuery])
  useEffect(() => {
    const next = query.trim() ? query : ''
    if (next === written.current) return undefined
    const t = window.setTimeout(() => { written.current = next; setParams({ q: next || null }) }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [query, setParams])

  const rows = useMemo(() => buildLogRows(log.data, names), [log.data, names])
  const counts = useMemo(() => kindCounts(log.data), [log.data])
  const needle = query.trim().toLowerCase()
  const shown = useMemo(() => rows.filter((r) => matchesKind(r.a, kind) && (!needle || r.search.includes(needle))), [rows, kind, needle])
  const filtered = kind !== 'all' || needle !== ''
  const reset = () => { setQuery(''); written.current = ''; setParams({ type: null, q: null }) }

  const options: SegOption<LogKind>[] = LOG_KINDS.map((k) => ({
    id: k.id,
    title: k.hint,
    count: counts[k.id],
    label: k.id === 'problems' && counts.problems > 0
      ? <>{k.label}<span className="glyph-setup adm__flag" role="img" aria-label="есть записи" /></>
      : k.label,
  }))
  const more = log.data.length >= limit
  const meta = more ? `последние ${num(limit, 0)}` : countText(log.data.length, RECORD_FORMS)
  const byDay = sort?.key === 'ts'

  return (
    <section className="dk-card dk-card--flush adm__panel adm__log" aria-labelledby="adm-log-t">
      <div className="adm__panel-head">
        <h2 className="adm__panel-title" id="adm-log-t">
          Журнал действий <span className="adm__panel-meta">· {meta}</span>
        </h2>
        <input className="form__input adm__search" type="search" placeholder="Поиск: объект, пользователь…" aria-label="Поиск по журналу"
               value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="adm__panel-tools">
        <Segmented size="sm" fit label="Вид записей" options={options} value={kind}
                   onChange={(id) => setParams({ type: id === 'all' ? null : id })} />
        {filtered && (
          <span className="adm__active" aria-live="polite">
            {kind !== 'all' && <Chip size="sm">{LOG_KINDS.find((k) => k.id === kind)?.label}</Chip>}
            {needle && <Chip size="sm">«{query.trim()}»</Chip>}
            <button type="button" className="btn btn--ghost btn--sm" onClick={reset}>Сбросить</button>
          </span>
        )}
      </div>
      {log.status === 'error' && (
        <div className="adm__banner"><ErrorBanner error={log.error} onRetry={log.reload} /></div>
      )}
      {log.status === 'ok' && log.data.length === 0 ? (
        <EmptyState quiet size="sm" kind="first-use" variant="log" title="Журнал пуст — записи появятся после первого изменения справочников или прогона" />
      ) : log.status === 'error' && log.data.length === 0 ? null : (
        <DataTable
          className="adm__log-table"
          columns={COLUMNS}
          rows={shown}
          rowKey={(r) => r.a.id}
          sort={sort}
          onSortChange={setSort}
          groupBy={byDay ? (r) => dayKey(r.a) : undefined}
          groupLabel={(key, n) => dayGroupLabel(key, n)}
          onRowClick={onOpen}
          rowClassName={(r) => (r.a.id === openId ? 'is-open' : undefined)}
          loading={log.status === 'loading'}
          countSlot={filtered}
          total={rows.length}
          tight
          framed
          caption="Журнал действий"
          empty="Ничего не найдено"
          emptyKind="no-results"
          onResetFilters={reset}
        />
      )}
      {more && log.status !== 'error' && (
        <div className="adm__more">
          <button type="button" className="btn btn--ghost btn--sm" onClick={onMore} disabled={log.status === 'loading'}>
            {log.status === 'loading' ? 'Загружаем…' : `Загрузить ещё ${num(LOG_PAGE, 0)}`}
          </button>
        </div>
      )}
    </section>
  )
}
