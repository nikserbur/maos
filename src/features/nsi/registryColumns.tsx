/**
 * Колонки реестров «Типы оборудования», «Оборудование», «Рабочие» (P-45, P-48, P-49) и общий контракт
 * представления реестра: колонки с текстом для поиска (поиск совпадает с тем, что видно в ячейке),
 * подготовка порядка строк, группы. Числа — только через format.ts; норма нейтральна, отклонения —
 * глиф + слово. Изделия, техкарты и операции — в registryColumnsGoods.tsx.
 */
import type { ReactNode } from 'react'
import { buildHash } from '../../shell/router'
import { getDecisionContext } from '../../shell/context'
import { num } from '../../explain/format'
import { Chip, Menu, type DataColumn, type MenuItem } from '../../ui/kit'
import { workerIncomplete, workerTypes, tabSortKey, type NsiData, type NsiLookups } from './nsiLookups'
import { MACHINE_STATUS_LABELS, SCHEDULE_LABELS, shopShort, typeShort } from './registries'

export type AnyRow = Record<string, unknown>

/** Колонка реестра: `text` — то, что видит пользователь (по нему же ищет поиск). */
export interface NsiColumn extends DataColumn<AnyRow> { text: (row: AnyRow) => string }

export interface RegistryView {
  columns: NsiColumn[]
  /** Порядок строк по умолчанию (роль → код, техкарта → шаг…). */
  prepare?: (rows: AnyRow[]) => AnyRow[]
  groupBy?: (row: AnyRow) => string
  groupLabel?: (key: string, count: number) => ReactNode
  /** Текст группы для поиска (имя техкарты у операции). */
  groupText?: (row: AnyRow) => string
}

export interface ViewCtx { data: NsiData; lk: NsiLookups }

/* ── Общие помощники ─────────────────────────────────────────────────────── */

export const str = (row: AnyRow, key: string): string => {
  const v = row[key]
  return v === null || v === undefined ? '' : String(v).trim()
}
export const numOf = (row: AnyRow, key: string): number | null => {
  const raw = str(row, key)
  if (!raw) return null
  const v = Number(raw)
  return Number.isFinite(v) ? v : null
}
/** Положительное число или null («не задано» вместо нуля). */
export const posOf = (row: AnyRow, key: string): number | null => {
  const v = numOf(row, key)
  return v !== null && v > 0 ? v : null
}

export const Muted = ({ children, title }: { children: ReactNode; title?: string }) => <span className="nsi-muted" title={title}>{children}</span>
/** Отклонение: ▲ + слово (цвет — только у глифа). */
export const Flag = ({ children, title }: { children: ReactNode; title?: string }) => <span className="nsi-flag glyph-setup" title={title}>{children}</span>

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()

/** «⋯» в строке: действия не открывают редактор строки. */
export function RowMenu({ items, label }: { items: MenuItem[]; label: string }) {
  return (
    <span className="nsi-rowmenu" onClick={stop} onKeyDown={stop}>
      <Menu items={items} label={label} size="sm" />
    </span>
  )
}

const go = (href: string) => () => { window.location.hash = href }

/** Ссылка на объект на схеме (до общего schemeHref — выбор станка параметром `sel`). */
export const schemeHref = (machineId: string): string => buildHash('scheme', null, { sel: machineId })

export function menuColumn(items: (row: AnyRow) => MenuItem[], label: (row: AnyRow) => string): NsiColumn {
  return {
    key: 'menu', title: <span className="dk-vh">Действия</span>, sortable: false, className: 'nsi-td-menu', text: () => '',
    render: (row) => <RowMenu items={items(row)} label={label(row)} />,
  }
}

const shopOf = (row: AnyRow, data: NsiData, field = 'org_unit'): string => {
  const name = str(row, field)
  if (name) return shopShort(name)
  const unitId = str(row, 'org_unit_id')
  const typeShop = data.wcTypes.find((t) => t.id === str(row, 'wc_type_id'))?.group_name
  return unitId ? `Подразделение ${unitId}` : shopShort(typeShop) || 'Без цеха'
}

/* ── Типы оборудования ───────────────────────────────────────────────────── */

function wcTypeMenu(row: AnyRow, ctx: ViewCtx): MenuItem[] {
  const id = str(row, 'id')
  const name = str(row, 'name')
  const first = ctx.data.machines.find((m) => m.wc_type_id === id)
  const run = getDecisionContext().scheduleRunId
  return [
    { id: 'scheme', label: 'Показать на схеме', icon: 'scheme', disabled: !first, hint: first ? undefined : 'станков этого типа нет', onSelect: go(first ? schemeHref(first.id) : '#/scheme') },
    { id: 'load', label: 'Загрузка в последнем плане', disabled: !run, hint: run ? undefined : 'план ещё не строили', onSelect: go(run ? buildHash('plan', `run/${run}/load`, { wc: id }) : '#/plan') },
    { id: 'routings', label: 'Техкарты с этим типом', onSelect: go(buildHash('nsi', 'operation', { q: name })) },
  ]
}

export function wcTypeView(ctx: ViewCtx): RegistryView {
  const { lk } = ctx
  const machines = (row: AnyRow) => lk.machinesByType.get(str(row, 'id')) ?? 0
  const operators = (row: AnyRow) => lk.operatorsByType.get(str(row, 'id')) ?? 0
  const pair = (row: AnyRow, a: string, b: string) => {
    const x = posOf(row, a)
    const y = posOf(row, b)
    return x === null && y === null ? '' : `${num(x, 0)} / ${num(y, 0)}`
  }
  const columns: NsiColumn[] = [
    { key: 'name', title: 'Наименование', rowHeader: true, clip: true, text: (r) => str(r, 'name') },
    { key: 'machines', title: 'Станков', num: true, get: machines, text: (r) => num(machines(r), 0) },
    {
      key: 'operators', title: 'Операторов с допуском', num: true, get: operators,
      text: (r) => num(operators(r), 0) + (operators(r) < machines(r) ? ' меньше станков' : ''),
      render: (r) => (
        <>{operators(r) < machines(r) && <Flag title="Станки этого типа не смогут работать все сразу">меньше станков</Flag>} {num(operators(r), 0)}</>
      ),
    },
    {
      key: 'hour_rate', title: 'Ставка, ₽/ч', num: true, get: (r) => posOf(r, 'hour_rate'),
      text: (r) => (posOf(r, 'hour_rate') === null ? 'не задана' : num(posOf(r, 'hour_rate'), 0)),
      render: (r) => (posOf(r, 'hour_rate') === null ? <Muted>не задана</Muted> : num(posOf(r, 'hour_rate'), 0)),
    },
    {
      key: 'mtbf', title: 'MTBF / ремонт, ч', num: true, get: (r) => posOf(r, 'mtbf_hours'), hint: 'Наработка на отказ / средний ремонт',
      text: (r) => pair(r, 'mtbf_hours', 'repair_hours') || 'не задано',
      render: (r) => pair(r, 'mtbf_hours', 'repair_hours') || <Muted>не задано</Muted>,
    },
    {
      key: 'mtbm', title: 'ТО каждые / длит., ч', num: true, get: (r) => posOf(r, 'mtbm_hours'), hint: 'Наработка между ТО / длительность ТО',
      text: (r) => pair(r, 'mtbm_hours', 'maintenance_hours') || 'не задано',
      render: (r) => pair(r, 'mtbm_hours', 'maintenance_hours') || <Muted>не задано</Muted>,
    },
    {
      key: 'ops', title: 'Операций', num: true, get: (r) => lk.opsByType.get(str(r, 'id')) ?? 0, hint: 'Операций действующих техкарт, которые можно выполнить на этом типе',
      text: (r) => num(lk.opsByType.get(str(r, 'id')) ?? 0, 0),
    },
    menuColumn((r) => wcTypeMenu(r, ctx), (r) => `Действия: ${str(r, 'name')}`),
  ]
  return { columns, groupBy: (r) => shopShort(str(r, 'group_name')) || 'Без группы' }
}

/* ── Оборудование ────────────────────────────────────────────────────────── */

export function machineView(ctx: ViewCtx): RegistryView {
  const { lk, data } = ctx
  const typeName = (r: AnyRow) => lk.typeById.get(str(r, 'wc_type_id'))?.name ?? ''
  const unused = (r: AnyRow) => data.operations.length > 0 && Boolean(typeName(r)) && (lk.opsByType.get(str(r, 'wc_type_id')) ?? 0) === 0
  const typeCell = (r: AnyRow): string => {
    const t = typeName(r)
    return t && str(r, 'name').startsWith(t) ? '' : t
  }
  const status = (r: AnyRow) => str(r, 'status') || 'active'
  const columns: NsiColumn[] = [
    {
      key: 'name', title: 'Наименование', rowHeader: true, className: 'nsi-td-name',
      text: (r) => str(r, 'name') + (unused(r) ? ' ни одна операция не использует' : ''),
      render: (r) => (
        <span className="nsi-cell-line" title={str(r, 'name')}>
          <span className="nsi-cell-clip">{str(r, 'name')}</span>
          {unused(r) && <Flag title="Тип станка не встречается ни в одной действующей техкарте">ни одна операция не использует</Flag>}
        </span>
      ),
    },
    {
      key: 'wc_type_id', title: 'Тип', clip: true, get: typeName, text: typeCell,
      render: (r) => (str(r, 'wc_type_id') && !typeName(r) && data.wcTypes.length > 0 ? <Chip tone="setup" size="sm">тип не найден</Chip> : typeCell(r)),
    },
    {
      key: 'schedule', title: 'Расписание', clip: true,
      text: (r) => SCHEDULE_LABELS[str(r, 'schedule')] ?? (str(r, 'schedule') || 'по графику цеха'),
      render: (r) => (str(r, 'schedule') ? SCHEDULE_LABELS[str(r, 'schedule')] ?? str(r, 'schedule') : <Muted>по графику цеха</Muted>),
    },
    {
      key: 'status', title: 'Статус', get: status,
      text: (r) => (status(r) === 'active' ? '' : MACHINE_STATUS_LABELS[status(r)] ?? status(r)),
      render: (r) => (status(r) === 'active' ? '' : (
        <Chip tone={status(r) === 'maintenance' ? 'setup' : 'idle'} size="sm">{MACHINE_STATUS_LABELS[status(r)] ?? status(r)}</Chip>
      )),
    },
    menuColumn((r) => [
      { id: 'scheme', label: 'Показать на схеме', icon: 'scheme', onSelect: go(schemeHref(str(r, 'id'))) },
      { id: 'type', label: 'Тип в справочнике', disabled: !typeName(r), onSelect: go(buildHash('nsi', 'workcentertype', { q: typeName(r) })) },
    ], (r) => `Действия: ${str(r, 'name')}`),
  ]
  return { columns, groupBy: (r) => shopOf(r, data) }
}

/* ── Рабочие ─────────────────────────────────────────────────────────────── */

const MAX_CHIPS = 3

export function workerView(ctx: ViewCtx): RegistryView {
  const { data } = ctx
  const fio = (r: AnyRow) => [str(r, 'last_name'), str(r, 'first_name'), str(r, 'middle_name')].filter(Boolean).join(' ')
  const unit = (r: AnyRow) => shopShort(str(r, 'org_unit')) || (data.wcTypes.length ? '' : str(r, 'org_unit_id'))
  const types = (r: AnyRow) => workerTypes({ skills: str(r, 'skills') }, data.wcTypes)
  const permText = (r: AnyRow) => {
    const t = types(r)
    return t === null ? 'универсал' : t.map((x) => typeShort(x.name)).join(', ') || 'нет допусков'
  }
  const incomplete = (r: AnyRow) => workerIncomplete({
    org_unit: str(r, 'org_unit'), org_unit_id: str(r, 'org_unit_id'), last_name: str(r, 'last_name'), first_name: str(r, 'first_name'),
  })
  const columns: NsiColumn[] = [
    {
      key: 'fio', title: 'Сотрудник', rowHeader: true, get: fio,
      text: (r) => fio(r) + (incomplete(r) === 'имя без букв' ? ' имя без букв' : ''),
      render: (r) => (
        <span className="nsi-cell-line">
          <span className="nsi-cell-clip" title={fio(r)}>{fio(r) || '—'}</span>
          {incomplete(r) === 'имя без букв' && <Flag title="Похоже на тестовую запись">имя без букв</Flag>}
        </span>
      ),
    },
    { key: 'tab_no', title: 'Таб. №', get: (r) => tabSortKey(str(r, 'tab_no')), text: (r) => str(r, 'tab_no'), render: (r) => <span className="mono">{str(r, 'tab_no')}</span> },
    {
      key: 'org_unit', title: 'Подразделение', clip: true, get: unit,
      text: (r) => unit(r) || 'нет подразделения',
      render: (r) => unit(r) || <Chip tone="setup" size="sm">нет подразделения</Chip>,
    },
    { key: 'position', title: 'Должность', clip: true, text: (r) => str(r, 'position') },
    { key: 'grade', title: 'Разряд', num: true, get: (r) => numOf(r, 'grade'), text: (r) => num(numOf(r, 'grade'), 0) },
    {
      key: 'skills', title: 'Допуски', sortable: false, text: permText,
      render: (r) => {
        const t = types(r)
        if (t === null) return <Muted>универсал</Muted>
        if (t.length === 0) return <Flag title="Не встанет ни на один станок">нет допусков</Flag>
        const rest = t.length - MAX_CHIPS
        return (
          <span className="nsi-chips" title={permText(r)}>
            {t.slice(0, MAX_CHIPS).map((x) => <span key={x.id} className="nsi-chip">{typeShort(x.name)}</span>)}
            {rest > 0 && <span className="nsi-chip nsi-chip--more">+{rest}</span>}
          </span>
        )
      },
    },
  ]
  const prepare = (rows: AnyRow[]) => [...rows].sort((a, b) => tabSortKey(str(a, 'tab_no')).localeCompare(tabSortKey(str(b, 'tab_no'))))
  return { columns, prepare }
}
