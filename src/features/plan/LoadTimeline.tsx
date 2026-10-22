/**
 * Профиль загрузки оборудования ВО ВРЕМЕНИ: тепловая карта «станок × интервал» на `Heatmap`
 * chart-системы — последовательная шкала одного тона (магнитуда не статусным цветом, X1 §8),
 * подписи станков без обрезки, таблица-двойник. Загрузка в интервале = доля времени интервала,
 * занятая операциями на этом станке (из Ганта).
 */
import { memo, useMemo } from 'react'
import type { ScheduleResult } from '../../lib/api'
import { hours } from '../../explain/format'
import { Heatmap, type HeatRow } from '../../ui/charts'

const BINS = 24

export const LoadTimeline = memo(function LoadTimeline(
  { gantt, makespan }: { gantt: ScheduleResult['gantt']; makespan: number },
) {
  const span = Math.max(1, makespan)
  const binH = span / BINS

  // Матрица «станок × интервал» O(|gantt|·24) — считаем только при смене расписания,
  // а не на каждый ререндер родителя (для больших планов это сотни тысяч итераций).
  const rows = useMemo<HeatRow[]>(() => {
    const names: { id: string; name: string }[] = []
    const index = new Map<string, number>()
    for (const j of gantt) {
      const id = j.machine_id || 'supply'
      if (!index.has(id)) { index.set(id, names.length); names.push({ id, name: j.machine_name || j.wc_name || 'Снабжение' }) }
    }
    const util = names.map(() => new Array<number>(BINS).fill(0))
    for (const j of gantt) {
      const r = index.get(j.machine_id || 'supply')!
      for (let b = 0; b < BINS; b++) {
        const a = b * binH, c = (b + 1) * binH
        util[r][b] += Math.max(0, Math.min(j.end, c) - Math.max(j.start, a))
      }
    }
    return names.map((m, r) => ({ key: m.id, label: m.name, values: util[r].map((busy) => busy / binH) }))
  }, [gantt, binH])

  const columns = useMemo(() => Array.from({ length: BINS }, (_, b) => `${hours(b * binH, 0)}–${hours((b + 1) * binH, 0)}`), [binH])
  const axis = [hours(0, 0), hours(span / 2, 0), hours(span, 0)]

  return (
    <Heatmap rows={rows} columns={columns} axis={axis} compact
      ariaLabel={`Загрузка ${rows.length} станков по ${BINS} интервалам горизонта ${hours(span, 0)}`} />
  )
})
