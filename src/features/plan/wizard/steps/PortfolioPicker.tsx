/**
 * Портфели Стадии 2 как источник программы (X2 «таблицы, а не стены карточек»): компактная таблица
 * «Когда · Сценарий · Критерий · E[Π] · CVaR · Изделий», последний прогон выбран сразу, видно 3 строки
 * + «все N», без вложенной прокрутки. Критерий — словами (labels.ts), без id API.
 */
import { useEffect } from 'react'
import type { OptRunSummary } from '../../../../lib/api'
import { dateTimeShort, money, num } from '../../../../explain/format'
import { objectiveLabel } from '../../../../explain/labels'
import { Chip, DataTable, type DataColumn } from '../../../../ui/kit'
import { useRunSummaries } from '../useRunSummaries'

const SHOWN = 3
const LOAD = 12

interface Props {
  runs: readonly OptRunSummary[]
  selected: string
  onSelect: (id: string) => void
  scenarioName: (id: string) => string
}

export function PortfolioPicker({ runs, selected, onSelect, scenarioName }: Props) {
  const list = runs.slice(0, LOAD)
  const sums = useRunSummaries(list.map((r) => r.id))
  // Последний прогон — выбран сразу (быстрый путь «Портфель → План»).
  useEffect(() => { if (!selected && runs[0]) onSelect(runs[0].id) }, [selected, runs, onSelect])
  const kpi = (id: string, f: (s: NonNullable<ReturnType<typeof sums.get>>) => string) => {
    const s = sums.get(id)
    return s === undefined ? '…' : s === null ? '—' : f(s)
  }
  const cols: DataColumn<OptRunSummary>[] = [
    { key: 'when', title: 'Когда', rowHeader: true, get: (r) => r.created_at,
      render: (r) => <>{dateTimeShort(r.created_at)}{r.id === selected && <Chip size="sm"><span aria-hidden="true">●</span> выбран</Chip>}</> },
    { key: 'sc', title: 'Сценарий', clip: true, get: (r) => scenarioName(r.scenario_id), render: (r) => scenarioName(r.scenario_id) },
    { key: 'obj', title: 'Критерий', get: (r) => objectiveLabel(r.objective), render: (r) => `${objectiveLabel(r.objective)} · α ${num(Number(r.alpha) * 100, 0)} %` },
    { key: 'e', title: 'E[Π]', num: true, sortable: false, render: (r) => kpi(r.id, (s) => money(s.expected)) },
    { key: 'cvar', title: 'CVaR', num: true, sortable: false, render: (r) => kpi(r.id, (s) => money(s.cvar)) },
    { key: 'items', title: 'Изделий', num: true, sortable: false, render: (r) => kpi(r.id, (s) => num(s.items, 0)) },
  ]
  return (
    <DataTable columns={cols} rows={list} rowKey={(r) => r.id} tight limit={SHOWN} caption="Портфели Стадии 2"
      onRowClick={(r) => onSelect(r.id)} rowClassName={(r) => (r.id === selected ? 'is-chosen' : undefined)} rowTitle={() => 'Выбрать портфель'}
      empty="Портфелей ещё нет — рассчитайте его на экране «Портфель» или выберите реестр заказов" emptyKind="first-use" />
  )
}
