/**
 * Колонки реестров «Типы оборудования», «Оборудование», «Рабочие» (P-45, P-48, P-49) и общий контракт
 * представления реестра: колонки с текстом для поиска (поиск совпадает с тем, что видно в ячейке),
 * подготовка порядка строк, группы. Числа — только через format.ts; норма нейтральна, отклонения —
 * глиф + слово. Изделия, техкарты и операции — в registryColumnsGoods.tsx.
 */
import type { ReactNode } from 'react'
import { buildHash } from '../../shell/router'
import { getDecisionContext } from '../../shell/context'
import { countText, num } from '../../explain/format'
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
  /** Пояснение к счётчику над таблицей («все 120 в работе»), когда колонка скрыта как пустая. */
  note?: (rows: AnyRow[]) => string
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

/** Ячейка без своей отрисовки показывает тот же текст, что ищет поиск (числа — через format.ts, не сырое значение). */
export function withTextCells(columns: NsiColumn[]): NsiColumn[] {
  return columns.map((c) => (c.render ? c : { ...c, render: (r: AnyRow) => c.text(r) || <Muted>—</Muted> }))
}

/** Имя записи и пометка под ним второй строкой (пометка не отнимает ширину у имени). */
export const NameWithNote = ({ name, note }: { name: ReactNode; note?: ReactNode }) => (
  <span className="nsi-cell-stack">
    <span className="nsi-cell-name">{name}</span>
    {note}
  </span>
)

export function menuColumn(items: (row: AnyRow) => MenuItem[], label: (row: AnyRow) => string): NsiColumn {
  return {
    key: 'menu', title: <span className="dk-vh">Действия</span>, sortable: false, width: 'fit', className: 'nsi-td-menu', text: () => '',
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
  // Каждое число — своей колонкой (владелец: «400 / 6» — непонятно, где какое).
  const hoursCol = (key: string, field: string, title: string, hint: string): NsiColumn => ({
    key, title, num: true, hint, get: (r) => posOf(r, field),
    text: (r) => (posOf(r, field) === null ? '' : num(posOf(r, field), 0)),
    render: (r) => (posOf(r, field) === null ? <Muted>—</Muted> : num(posOf(r, field), 0)),
  })
  const columns: NsiColumn[] = [
    { key: 'name', title: 'Наименование', rowHeader: true, primary: true, text: (r) => str(r, 'name') },
    { key: 'machines', title: 'Станков', num: true, get: machines, text: (r) => num(machines(r), 0) },
    {
      key: 'operators', title: 'Операторов с допуском', num: true, get: operators,
      text: (r) => num(operators(r), 0) + (operators(r) < machines(r) ? ' меньше станков' : ''),
      render: (r) => (
        <span className="nsi-num-stack">
          {num(operators(r), 0)}
          {operators(r) < machines(r) && <Flag title="Станки этого типа не смогут работать все сразу">меньше станков</Flag>}
        </span>
      ),
    },
    {
      key: 'hour_rate', title: 'Ставка, ₽/ч', num: true, get: (r) => posOf(r, 'hour_rate'),
      text: (r) => (posOf(r, 'hour_rate') === null ? 'не задана' : num(posOf(r, 'hour_rate'), 0)),
      render: (r) => (posOf(r, 'hour_rate') === null ? <Muted>не задана</Muted> : num(posOf(r, 'hour_rate'), 0)),
    },
    hoursCol('mtbf', 'mtbf_hours', 'Наработка на отказ, ч', 'Средняя наработка на отказ (MTBF), часов'),
    hoursCol('repair', 'repair_hours', 'Ремонт, ч', 'Среднее время ремонта после отказа, часов'),
    hoursCol('mtbm', 'mtbm_hours', 'Техобслуживание: интервал, ч', 'Наработка между плановыми техобслуживаниями, часов'),
    hoursCol('maint', 'maintenance_hours', 'Техобслуживание: длительность, ч', 'Длительность одного планового техобслуживания, часов'),
    {
      key: 'ops', title: 'Операций', num: true, get: (r) => lk.opsByType.get(str(r, 'id')) ?? 0, hint: 'Операций действующих техкарт, которые можно выполнить на этом типе',
      text: (r) => num(lk.opsByType.get(str(r, 'id')) ?? 0, 0),
    },
    menuColumn((r) => wcTypeMenu(r, ctx), (r) => `Действия: ${str(r, 'name')}`),
  ]
  return { columns: withTextCells(columns), groupBy: (r) => shopShort(str(r, 'group_name')) || 'Без группы' }
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
      key: 'name', title: 'Наименование', rowHeader: true, primary: true,
      text: (r) => str(r, 'name') + (unused(r) ? ' ни одна операция не использует' : ''),
      render: (r) => (
        <NameWithNote name={str(r, 'name')}
          note={unused(r) && <Flag title="Тип станка не встречается ни в одной действующей техкарте">ни одна операция не использует</Flag>} />
      ),
    },
    {
      key: 'wc_type_id', title: 'Тип оборудования', minWidth: 12, get: typeName, text: typeCell,
      render: (r) => (str(r, 'wc_type_id') && !typeName(r) && data.wcTypes.length > 0 ? <Chip tone="setup" size="sm">тип не найден</Chip> : typeCell(r)),
    },
    {
      key: 'schedule', title: 'Расписание', minWidth: 12,
      text: (r) => SCHEDULE_LABELS[str(r, 'schedule')] ?? (str(r, 'schedule') || 'по графику цеха'),
      render: (r) => (str(r, 'schedule') ? SCHEDULE_LABELS[str(r, 'schedule')] ?? str(r, 'schedule') : <Muted>по графику цеха</Muted>),
    },
    {
      key: 'status', title: 'Статус', width: 'fit', get: status,
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
  // «Тип» и «Статус» пусты во всех строках (тип — в начале имени, все в работе) — таблица скрывает их
  // (hideEmptyColumns), а над таблицей — «все 120 в работе», чтобы пустота не выглядела поломкой.
  const note = (rows: AnyRow[]) => (rows.length > 0 && rows.every((r) => status(r) === 'active') ? `все ${num(rows.length, 0)} в работе` : '')
  return { columns: withTextCells(columns), groupBy: (r) => shopOf(r, data), note }
}

/* ── Рабочие ─────────────────────────────────────────────────────────────── */

const TYPE_FORMS = ['тип станков', 'типа станков', 'типов станков'] as const

export function workerView(ctx: ViewCtx): RegistryView {
  const { data } = ctx
  const fio = (r: AnyRow) => [str(r, 'last_name'), str(r, 'first_name'), str(r, 'middle_name')].filter(Boolean).join(' ')
  const unit = (r: AnyRow) => shopShort(str(r, 'org_unit')) || (data.wcTypes.length ? '' : str(r, 'org_unit_id'))
  const types = (r: AnyRow) => workerTypes({ skills: str(r, 'skills') }, data.wcTypes)
  const permText = (r: AnyRow) => {
    const t = types(r)
    return t === null ? 'универсал' : t.map((x) => typeShort(x.name)).join(', ') || 'нет допусков'
  }
  /** Одной строкой: «Индукционная печь» или «24 типа станков: Индукционная печь и ещё 23»; полный список — в подсказке. */
  const permLine = (t: ReadonlyArray<{ name: string }>): string =>
    (t.length === 1 ? typeShort(t[0].name) : `${countText(t.length, TYPE_FORMS)}: ${typeShort(t[0].name)} и ещё ${num(t.length - 1, 0)}`)
  const incomplete = (r: AnyRow) => workerIncomplete({
    org_unit: str(r, 'org_unit'), org_unit_id: str(r, 'org_unit_id'), last_name: str(r, 'last_name'), first_name: str(r, 'first_name'),
  })
  const columns: NsiColumn[] = [
    {
      key: 'fio', title: 'Сотрудник', rowHeader: true, primary: true, get: fio,
      text: (r) => fio(r) + (incomplete(r) === 'имя без букв' ? ' имя без букв' : ''),
      render: (r) => (
        <NameWithNote name={fio(r) || '—'}
          note={incomplete(r) === 'имя без букв' && <Flag title="Похоже на тестовую запись">имя без букв</Flag>} />
      ),
    },
    { key: 'tab_no', title: 'Табельный номер', width: 'fit', get: (r) => tabSortKey(str(r, 'tab_no')), text: (r) => str(r, 'tab_no'), render: (r) => <span className="mono">{str(r, 'tab_no')}</span> },
    {
      key: 'org_unit', title: 'Подразделение', minWidth: 12, get: unit,
      text: (r) => unit(r) || 'нет подразделения',
      render: (r) => unit(r) || <Chip tone="setup" size="sm">нет подразделения</Chip>,
    },
    { key: 'position', title: 'Должность', minWidth: 12, text: (r) => str(r, 'position') },
    { key: 'grade', title: 'Разряд', num: true, get: (r) => numOf(r, 'grade'), text: (r) => num(numOf(r, 'grade'), 0) },
    {
      // Одна строка вместо трёх плашек и «+21»: реестр остаётся плотным (строка 32 px).
      key: 'skills', title: 'Допуски', sortable: false, minWidth: 20, wrap: 1, text: permText,
      render: (r) => {
        const t = types(r)
        if (t === null) return <Muted>универсал</Muted>
        if (t.length === 0) return <Flag title="Не встанет ни на один станок">нет допусков</Flag>
        return <span className="nsi-perms-line" title={permText(r)}>{permLine(t)}</span>
      },
    },
  ]
  const prepare = (rows: AnyRow[]) => [...rows].sort((a, b) => tabSortKey(str(a, 'tab_no')).localeCompare(tabSortKey(str(b, 'tab_no'))))
  return { columns: withTextCells(columns), prepare }
}
