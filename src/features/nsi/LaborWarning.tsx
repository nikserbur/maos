import { useEffect, useMemo, useState } from 'react'
import { api, type Machine, type Worker, type WorkCenterType } from '../../lib/api'
import { countText, num } from '../../explain/format'
import { DataTable, ErrorBanner, type DataColumn } from '../../ui/kit'
import { laborBottlenecks, type LaborLoad } from './labor'

/** «3 из 5 станков», «1 из 1 станка». */
const OF_MACHINES = ['станка', 'станков', 'станков'] as const

const COLUMNS: DataColumn<LaborLoad>[] = [
  { key: 'typeName', title: 'Тип оборудования', rowHeader: true, primary: true },
  { key: 'machines', title: 'Станков', num: true, render: (l) => num(l.machines, 0) },
  { key: 'operators', title: 'Операторов с допуском', num: true, render: (l) => num(l.operators, 0) },
  {
    key: 'cap', title: 'Работают одновременно', num: true, hint: 'Сколько станков типа может работать сразу — столько, сколько допущенных операторов',
    render: (l) => `${num(l.cap, 0)} из ${countText(l.machines, OF_MACHINES)}`,
  },
]

const TYPE_FORMS = ['типа', 'типов', 'типов'] as const

export interface LaborData {
  machines: ReadonlyArray<Machine>
  workers: ReadonlyArray<Worker>
  wcTypes: ReadonlyArray<WorkCenterType>
}

/**
 * Предупреждение «не хватает операторов»: по каждому типу оборудования сравнивает число станков
 * с числом допущенных рабочих; если рабочих меньше — лишние станки ждут оператора. Ничего не рисует,
 * если узких мест по труду нет или данных нет. `compact` — одна строка, таблица — под «Показать типы».
 * `data` — уже загруженные справочники (Справочники); без него компонент загружает их сам.
 */
export function LaborWarning({ compact = false, data }: { compact?: boolean; data?: LaborData }) {
  const [own, setOwn] = useState<LaborLoad[] | null>(null)

  useEffect(() => {
    if (data) return undefined
    let alive = true
    // Сбой загрузки здесь — не ошибка экрана: предупреждение просто не показывается (данных для него нет).
    Promise.all([
      api.machines.list().catch(() => [] as Machine[]),
      api.workers.list().catch(() => [] as Worker[]),
      api.workCenterTypes.list().catch(() => [] as WorkCenterType[]),
    ]).then(([m, w, t]) => { if (alive) setOwn(laborBottlenecks(m, w, t)) })
    return () => { alive = false }
  }, [data])

  const fromData = useMemo(() => (data ? laborBottlenecks([...data.machines], [...data.workers], [...data.wcTypes]) : null), [data])
  const rows = fromData ?? own
  if (!rows || rows.length === 0) return null

  const table = <DataTable columns={COLUMNS} rows={rows} rowKey={(l) => l.typeId} tight caption="Нехватка операторов по типам оборудования" />
  if (compact) {
    return (
      <ErrorBanner
        tone="setup"
        title={`Не хватает операторов у ${countText(rows.length, TYPE_FORMS)} оборудования`}
        message="Станки этих типов не смогут работать все сразу. Дайте рабочим допуск или наймите операторов."
      >
        <details className="nsi-labor">
          <summary>Показать типы</summary>
          {table}
        </details>
      </ErrorBanner>
    )
  }
  return (
    <ErrorBanner
      tone="setup"
      title="Не хватает операторов"
      message="Станки этих типов не смогут работать все сразу — параллелизм ограничен числом допущенных рабочих. Добавьте операторам допуск (реестр «Рабочие») или наймите новых."
    >
      {table}
    </ErrorBanner>
  )
}
