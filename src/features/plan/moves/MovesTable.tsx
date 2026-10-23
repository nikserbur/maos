/**
 * Режим «Таблица ходов» дифа плана (UX-V2 §4.8): те же ходы списком — вид, цели, что меняется,
 * CVaR прибыли и кассы «до → после», доля выигрышных сценариев, статус; выгрузка CSV (Excel: BOM + «;»).
 * Диф Ганта и эта таблица строятся из одного набора решений — совпадение проверяется тестом fixtures.
 */
import type { GanttJob, StructuralMove } from '../../../lib/api'
import { money, pct, signed } from '../../../explain/format'
import { DataTable, type DataColumn } from '../../../ui/kit'
import { STATUS_LABEL } from './MoveRow'
import { moveLabel } from './moveKinds'
import { statusOf, type DecisionState } from './movesStore'
import { changeText, profitDelta, targetText } from './moveText'

interface Props {
  moves: readonly StructuralMove[]
  decisions: DecisionState
  gantt: readonly GanttJob[]
  rule: string
  demo: boolean
}

export function MovesTable({ moves, decisions, gantt, rule, demo }: Props) {
  const columns: ReadonlyArray<DataColumn<StructuralMove>> = [
    { key: 'kind', title: 'Ход', rowHeader: true, get: (m) => moveLabel(m.kind), render: (m) => moveLabel(m.kind) },
    { key: 'targets', title: 'Цели', get: (m) => targetText(m, gantt) },
    { key: 'change', title: 'Что меняется', get: (m) => changeText(m, gantt) },
    { key: 'gain', title: 'Δ CVaR прибыли', num: true, get: (m) => profitDelta(m.impact), render: (m) => signed(profitDelta(m.impact), '₽') },
    { key: 'cash', title: 'CVaR кассы', num: true, get: (m) => m.impact.cash.min_cash_cvar_after, render: (m) => `${money(m.impact.cash.min_cash_cvar_before)} → ${money(m.impact.cash.min_cash_cvar_after)}` },
    { key: 'win', title: 'Выигрыш', num: true, get: (m) => m.impact.win_share, render: (m) => pct(m.impact.win_share, 0) },
    { key: 'status', title: 'Статус', get: (m) => statusOf(m, decisions), render: (m) => STATUS_LABEL[statusOf(m, decisions)] },
  ]
  const exportCsv = () => {
    const esc = (c: unknown) => `"${String(c ?? '').replace(/"/g, '""')}"`
    const head = ['Ход', 'Цели', 'Что меняется', 'ΔCVaR прибыли, ₽', 'CVaR кассы до, ₽', 'CVaR кассы после, ₽', 'Доля выигрыша', 'Статус', 'Режим', 'Пример']
    const lines = moves.map((m) => [moveLabel(m.kind), targetText(m, gantt), changeText(m, gantt), String(Math.round(profitDelta(m.impact))),
      String(Math.round(m.impact.cash.min_cash_cvar_before)), String(Math.round(m.impact.cash.min_cash_cvar_after)), pct(m.impact.win_share, 0),
      STATUS_LABEL[statusOf(m, decisions)], m.justification.regime.label, demo ? 'да' : ''])
    const csv = '﻿' + [head, ...lines].map((r) => r.map(esc).join(';')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url; a.download = `ходы_агента_${rule}${demo ? '_пример' : ''}.csv`; a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <div className="mv-table">
      <div className="mv-table__bar">
        <span className="pl-note">{moves.length} ходов{demo ? ' · пример на фикстурах' : ''}</span>
        <button type="button" className="btn btn--sm" onClick={exportCsv}>CSV</button>
      </div>
      <DataTable columns={columns} rows={moves} rowKey={(m) => m.id} tight caption="Таблица структурных ходов" defaultSort={{ key: 'gain', dir: 'desc' }} />
    </div>
  )
}
