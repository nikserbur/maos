/**
 * «Виды ходов агента» — единственный список ходов на экране (X2 «таблицы, а не стены карточек»):
 * Ход · Уровень хода (словами, не L0/L2) · Что меняется · Жёсткая маска · Разрешить · Доступность. Переключатель заблокирован
 * с причиной (запланировано / нет данных Справочников) — через `fieldset disabled`, без правки кита.
 * Нормальное «доступно» — простой текст, без чипа; отклонения — глиф + слово из AVAILABILITY.
 */
import { Switch, DataTable, type DataColumn } from '../../ui/kit'
import { AVAILABILITY, type GuardrailRow } from './guardrails'

interface Props {
  rows: readonly GuardrailRow[]
  onToggle: (row: GuardrailRow, on: boolean) => void
}

/** Уровень хода словами: L0 — порядок внутри плана, L2 — структура плана (код — в подсказке). */
const LEVEL_WORDS: Readonly<Record<string, string>> = { L0: 'порядок операций', L2: 'структура плана' }

function Availability({ r }: { r: GuardrailRow }) {
  const a = AVAILABILITY[r.availability]
  if (!a.glyph) return <span className="ag-muted">{a.word}</span>
  const body = <span className={a.glyph}>{a.word}</span>
  return a.href ? <a className="ag-link ag-nowrap" href={a.href} title={r.reason}>{body} →</a> : <span className="ag-nowrap ag-muted" title={r.reason}>{body}</span>
}

export function MoveKindsTable({ rows, onToggle }: Props) {
  const cols: ReadonlyArray<DataColumn<GuardrailRow>> = [
    { key: 'label', title: 'Ход', rowHeader: true, primary: true, sortable: false, get: (r) => r.meta.label },
    { key: 'level', title: 'Уровень хода', sortable: false, width: 'fit', get: (r) => r.meta.level,
      render: (r) => <span title={`Уровень ${r.meta.level}`}>{LEVEL_WORDS[r.meta.level] ?? r.meta.level}</span> },
    { key: 'what', title: 'Что меняется', sortable: false, minWidth: 16, get: (r) => r.meta.what, className: 'ag-muted' },
    { key: 'mask', title: 'Жёсткая маска', hint: 'ограничение, которое агент не может нарушить: недопустимый ход ему даже не показывается', sortable: false, minWidth: 16, get: (r) => r.meta.mask, className: 'ag-muted' },
    {
      key: 'on', title: 'Разрешить', sortable: false, width: 'fit',
      render: (r) => (
        <fieldset className="ag-fs" disabled={r.locked} title={r.reason}>
          <legend className="dk-vh">Разрешить ход «{r.meta.label}»</legend>
          <Switch checked={r.on} onChange={(on) => onToggle(r, on)} hint={r.locked ? r.reason : r.meta.what}>
            <span className="dk-vh">{r.meta.label}</span>
          </Switch>
        </fieldset>
      ),
    },
    { key: 'avail', title: 'Доступность', sortable: false, width: 'fit', render: (r) => <Availability r={r} /> },
  ]
  return <DataTable columns={cols} rows={rows} rowKey={(r) => r.meta.kind} tight caption="Виды ходов агента: что меняется, жёсткая маска, разрешение и доступность" />
}
