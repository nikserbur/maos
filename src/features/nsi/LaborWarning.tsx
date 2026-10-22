import { useEffect, useState } from 'react'
import { api, type Machine, type Worker, type WorkCenterType } from '../../lib/api'
import { num } from '../../explain/format'
import { DataTable, ErrorBanner, type DataColumn } from '../../ui/kit'
import { laborBottlenecks, type LaborLoad } from './labor'

const COLUMNS: DataColumn<LaborLoad>[] = [
  { key: 'typeName', title: 'Тип оборудования', rowHeader: true },
  { key: 'machines', title: 'Станков', num: true, render: (l) => num(l.machines, 0) },
  { key: 'operators', title: 'Операторов', num: true, render: (l) => num(l.operators, 0) },
  { key: 'cap', title: 'Параллельно', num: true, render: (l) => `${num(l.cap, 0)} из ${num(l.machines, 0)}` },
]

/**
 * Предупреждение «не хватает операторов»: по каждому типу РЦ сравнивает число
 * станков с числом допущенных рабочих. Если рабочих меньше — лишние станки
 * простаивают в ожидании оператора (параллелизм ограничен числом операторов).
 * Тихо ничего не рисует, если узких мест по труду нет. Баннер и таблица — из кита.
 */
export function LaborWarning({ compact = false }: { compact?: boolean }) {
  const [rows, setRows] = useState<LaborLoad[] | null>(null)

  useEffect(() => {
    Promise.all([
      api.machines.list().catch(() => [] as Machine[]),
      api.workers.list().catch(() => [] as Worker[]),
      api.workCenterTypes.list().catch(() => [] as WorkCenterType[]),
    ]).then(([m, w, t]) => setRows(laborBottlenecks(m, w, t)))
  }, [])

  if (!rows || rows.length === 0) return null

  return (
    <ErrorBanner
      tone="setup"
      title="Не хватает операторов"
      message="Станки этих типов не смогут работать все сразу — параллелизм ограничен числом допущенных рабочих. Добавьте операторам допуск (реестр «Рабочие» → галочки допусков) или введите новых."
    >
      <DataTable columns={COLUMNS} rows={rows} rowKey={(l) => l.typeId} tight={compact} caption="Нехватка операторов по типам оборудования" />
    </ErrorBanner>
  )
}
