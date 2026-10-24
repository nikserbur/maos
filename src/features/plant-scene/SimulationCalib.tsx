/**
 * Вкладка «В справочники» (X2 P-30, P-41): наблюдаемая в прогоне длительность операции против
 * норматива, худшие отклонения таблицей. Запись — только после подтверждения со списком
 * «операция · было → станет, мин», затем тост «Отменить» возвращает прежние нормативы. Нечего
 * записывать — так и сказано, кнопки нет. Ошибка — баннер с «Повторить».
 */
import { useState } from 'react'
import { DataTable, EmptyState, ErrorBanner, IconButton, SkeletonRows, showUndo, type DataColumn } from '../../ui/kit'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { NoteTip } from '../../ui/NoteTip'
import { countText, num, signed } from '../../explain/format'
import { api, type CalibRow } from '../../lib/api'
import { invalidateNsi } from '../nsi/useNsi'

const WORST = 15
/** Отклонение, с которого норматив считается заметно неверным (▲). */
const ALERT_PCT = 25
/** Отклонение, с которого запись в справочники имеет смысл. */
const APPLY_PCT = 10
const OP_FORMS = ['операция', 'операции', 'операций'] as const

const minutes = (v: number): string => `${num(v, 0)} мин`

const COLUMNS: ReadonlyArray<DataColumn<CalibRow>> = [
  { key: 'op_name', title: 'Операция', rowHeader: true, clip: true, get: (r) => r.op_name },
  { key: 't_norm', title: 'Норматив', num: true, get: (r) => r.t_norm, render: (r) => minutes(r.t_norm) },
  { key: 'realized_mean', title: 'Факт', num: true, get: (r) => r.realized_mean, render: (r) => minutes(r.realized_mean) },
  { key: 'delta_pct', title: 'Δ', num: true, get: (r) => r.delta_pct,
    render: (r) => (Math.abs(r.delta_pct) > ALERT_PCT
      ? <span className="glyph-setup">{signed(r.delta_pct / 100, '%')}</span>
      : <span className="sim__muted">{signed(r.delta_pct / 100, '%')}</span>) },
]

/** Худшие по |Δ| строки калибровки. */
export function worstRows(rows: ReadonlyArray<CalibRow>): CalibRow[] {
  return rows.slice().sort((a, b) => Math.abs(b.delta_pct) - Math.abs(a.delta_pct)).slice(0, WORST)
}

interface SimulationCalibProps {
  rows: CalibRow[] | null
  loadError: unknown
  onReload: () => void
}

export function SimulationCalib({ rows, loadError, onReload }: SimulationCalibProps) {
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const worst = worstRows(rows ?? [])
  const toApply = worst.filter((r) => Math.abs(r.delta_pct) > APPLY_PCT)

  const write = async (items: ReadonlyArray<{ op_id: string; t_norm: number }>) => {
    await api.simulation.calibrate(items.map((i) => ({ ...i })))
    invalidateNsi()
    onReload()
  }
  const apply = async () => {
    setBusy(true)
    setError(null)
    const before = toApply.map((r) => ({ op_id: r.op_id, t_norm: Math.round(r.t_norm) }))
    try {
      await write(toApply.map((r) => ({ op_id: r.op_id, t_norm: Math.round(r.realized_mean) })))
      setConfirm(false)
      showUndo({
        message: `Нормативы ${countText(toApply.length, OP_FORMS)} записаны в справочники`,
        onUndo: () => { write(before).catch((e: unknown) => setError(e)) },
      })
    } catch (e) {
      setError(e)
      setConfirm(false)
    } finally {
      setBusy(false)
    }
  }

  if (loadError) return <ErrorBanner title="Отклонения норм не загрузились" error={loadError} onRetry={onReload} />
  if (rows === null) return <SkeletonRows rows={5} cols={4} label="Загрузка калибровки" />
  if (worst.length === 0) {
    return <EmptyState size="sm" variant="table" kind="first-use" title="Нет данных для калибровки">Проиграйте план до конца — отклонения появятся здесь.</EmptyState>
  }
  return (
    <div className="dk-stack sim__stack">
      <div className="sim__label text-caps">
        Отклонения от нормативов
        <NoteTip title="Калибровка нормативов">
          Наблюдаемая в прогоне длительность (обработка + наладки + ТО) против норматива справочника. Запись
          обновит t_norm; t_opt и t_pess изменятся пропорционально.
        </NoteTip>
      </div>
      {error !== null && <ErrorBanner title="Не удалось записать нормативы" error={error} onRetry={() => setConfirm(true)} onDismiss={() => setError(null)} />}
      <DataTable columns={COLUMNS} rows={worst} rowKey={(r) => r.op_id} tight caption="Отклонения норм"
                 rowTitle={(r) => r.product_name} />
      {toApply.length === 0 ? (
        <p className="sim__note">Отклонений больше {num(APPLY_PCT, 0)} % нет — записывать нечего.</p>
      ) : (
        <IconButton icon="check" variant="primary" size="sm" disabled={busy} onClick={() => setConfirm(true)}>
          {busy ? 'Записываем…' : `Записать в справочники (${countText(toApply.length, OP_FORMS)})`}
        </IconButton>
      )}
      {confirm && (
        <ConfirmDialog title="Записать нормативы в справочники?" objectName={`Операции — ${countText(toApply.length, OP_FORMS)}`}
                       consequence="Нормативы t_norm будут заменены наблюдаемыми; сразу после записи их можно вернуть кнопкой «Отменить»."
                       confirmLabel="Записать" busy={busy} onCancel={() => setConfirm(false)} onConfirm={() => { void apply() }}>
          <ul className="sim__calib-list">
            {toApply.map((r) => (
              <li key={r.op_id}><span>{r.op_name}</span> <span className="num">{num(r.t_norm, 0)} → {minutes(Math.round(r.realized_mean))}</span></li>
            ))}
          </ul>
        </ConfirmDialog>
      )}
    </div>
  )
}
