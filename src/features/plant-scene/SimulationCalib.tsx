/**
 * Вкладка «В НСИ»: наблюдаемая в прогоне длительность операции против норматива,
 * таблица худших отклонений и запись в t_norm (t_opt/t_pess — пропорционально).
 */
import { Chip, DataTable, EmptyState, IconButton, SkeletonRows, type DataColumn } from '../../ui/kit'
import { num, signed } from '../../explain/format'
import type { CalibRow } from '../../lib/api'

const WORST = 15
/** Отклонение, с которого норматив считается заметно неверным (чип предупреждения). */
const ALERT_PCT = 25
/** Отклонение, с которого запись в НСИ имеет смысл. */
const APPLY_PCT = 10

const COLUMNS: ReadonlyArray<DataColumn<CalibRow>> = [
  { key: 'op_name', title: 'Операция', rowHeader: true, get: (r) => r.op_name,
    render: (r) => <span className="sim__op" title={r.product_name}>{r.op_name}</span> },
  { key: 't_norm', title: 'Норматив', num: true, get: (r) => r.t_norm, render: (r) => `${num(r.t_norm, 0)} мин` },
  { key: 'realized_mean', title: 'Факт (ср.)', num: true, get: (r) => r.realized_mean, render: (r) => `${num(r.realized_mean, 0)} мин` },
  { key: 'delta_pct', title: 'Δ', num: true, get: (r) => r.delta_pct,
    render: (r) => (Math.abs(r.delta_pct) > ALERT_PCT
      ? <Chip size="sm" tone="setup">{signed(r.delta_pct / 100, '%')}</Chip>
      : <span className="sim__muted">{signed(r.delta_pct / 100, '%')}</span>) },
]

/** Худшие по |Δ| строки калибровки. */
export function worstRows(rows: ReadonlyArray<CalibRow>): CalibRow[] {
  return rows.slice().sort((a, b) => Math.abs(b.delta_pct) - Math.abs(a.delta_pct)).slice(0, WORST)
}

interface SimulationCalibProps {
  rows: CalibRow[] | null
  applying: boolean
  onApply: (items: CalibRow[]) => void
}

export function SimulationCalib({ rows, applying, onApply }: SimulationCalibProps) {
  const worst = worstRows(rows ?? [])
  const toApply = worst.filter((r) => Math.abs(r.delta_pct) > APPLY_PCT)
  return (
    <div className="dk-stack sim__stack">
      <p className="sim__note">
        Наблюдаемая в прогоне длительность (обработка + наладки + ТО) против норматива НСИ.
        Применение обновит t_norm; t_opt/t_pess — пропорционально.
      </p>
      {rows === null && <SkeletonRows rows={5} cols={4} label="Загрузка калибровки" />}
      {rows !== null && worst.length === 0 && (
        <EmptyState size="sm" variant="table" title="Нет данных для калибровки">Проиграйте план до конца — отклонения появятся здесь.</EmptyState>
      )}
      {worst.length > 0 && (
        <>
          <DataTable columns={COLUMNS} rows={worst} rowKey={(r) => r.op_id} tight framed caption="Отклонения норм" />
          <IconButton icon="check" variant="primary" size="sm" disabled={applying || toApply.length === 0} onClick={() => onApply(toApply)}>
            {applying ? 'Применяем…' : `Записать в НСИ (Δ > ${num(APPLY_PCT, 0)} %: ${num(toApply.length, 0)} операций)`}
          </IconButton>
        </>
      )}
    </div>
  )
}
