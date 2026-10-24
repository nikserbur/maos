/**
 * Профиль загрузки оборудования по календарным суткам: тепловая карта «станок × сутки» на `Heatmap`
 * chart-системы — последовательная шкала одного тона (магнитуда не статусным цветом), подписи станков
 * без обрезки, таблица-двойник. Загрузка за сутки = доля 24 ч, занятая операциями на станке (из Ганта);
 * столбцы — даты от начала горизонта (или «сутки N» без даты сценария).
 */
import { memo, useMemo } from 'react'
import type { ScheduleResult } from '../../lib/api'
import { num } from '../../explain/format'
import { Heatmap, type HeatRow } from '../../ui/charts'
import { dayLabel } from './ganttTime'
import { parseIsoDate } from './wizard/dates'

const DAY_H = 24
/** Больше столбцов тепловая карта не читается — длинный горизонт сворачивается в недели. */
const MAX_COLS = 60

export const LoadTimeline = memo(function LoadTimeline(
  { gantt, makespan, startDate = null }: { gantt: ScheduleResult['gantt']; makespan: number; startDate?: string | null },
) {
  const start = useMemo(() => parseIsoDate(startDate), [startDate])
  const days = Math.max(1, Math.ceil(Math.max(1, makespan) / DAY_H))
  const binDays = days > MAX_COLS ? 7 : 1
  const bins = Math.ceil(days / binDays)
  const binH = binDays * DAY_H

  // Матрица «станок × сутки» O(|gantt|·bins) — только при смене расписания.
  const rows = useMemo<HeatRow[]>(() => {
    const names: { id: string; name: string }[] = []
    const index = new Map<string, number>()
    for (const j of gantt) {
      const id = j.machine_id || 'supply'
      if (!index.has(id)) { index.set(id, names.length); names.push({ id, name: j.machine_name || j.wc_name || 'Снабжение' }) }
    }
    const util = names.map(() => new Array<number>(bins).fill(0))
    for (const j of gantt) {
      const r = index.get(j.machine_id || 'supply')!
      const b0 = Math.max(0, Math.floor(j.start / binH))
      const b1 = Math.min(bins - 1, Math.floor(Math.max(j.start, j.end - 1e-9) / binH))
      for (let b = b0; b <= b1; b++) {
        const a = b * binH, c = (b + 1) * binH
        util[r][b] += Math.max(0, Math.min(j.end, c) - Math.max(j.start, a))
      }
    }
    return names.map((m, r) => ({ key: m.id, label: m.name, values: util[r].map((busy) => Math.min(1, busy / binH)) }))
  }, [gantt, bins, binH])

  const columns = useMemo(() => Array.from({ length: bins }, (_, b) => (binDays === 1 ? dayLabel(b, start) : `нед. ${num(b + 1, 0)} · с ${dayLabel(b * binDays, start)}`)), [bins, binDays, start])
  const axis = [columns[0], columns[Math.floor((bins - 1) / 2)], columns[bins - 1]]

  return (
    <Heatmap rows={rows} columns={columns} axis={axis} compact
      ariaLabel={`Загрузка ${rows.length} станков по ${bins} ${binDays === 1 ? 'суткам' : 'неделям'} горизонта`} />
  )
})
