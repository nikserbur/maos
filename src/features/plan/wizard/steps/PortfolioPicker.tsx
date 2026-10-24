/**
 * Портфели Стадии 2 как источник программы (X2 «таблицы, а не стены карточек»): компактная таблица
 * «Когда · Сценарий · Критерий · E[Π] · CVaR · Изделий», последний прогон выбран сразу, видно 3 строки
 * + «все N», без вложенной прокрутки. Критерий — словами (labels.ts), без id API.
 */
import { useEffect } from 'react'
import type { OptRunSummary } from '../../../../lib/api'
import { NBSP, dateTimeShort, money, num } from '../../../../explain/format'
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

/** Критерий словами: «прибыль в худших 10 % сценариев» вместо «CVaR · α 10 %» (аббревиатура — в подсказке). */
function criterionWords(objective: string, alpha: number): string {
  if (objective === 'cvar') return `прибыль в худших ${num(alpha * 100, 0)}${NBSP}% сценариев`
  const long = objectiveLabel(objective, 'long')
  const dash = long.indexOf(' — ')
  return dash > 0 ? long.slice(dash + 3) : long
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
    { key: 'when', title: 'Когда', rowHeader: true, width: 'fit', get: (r) => r.created_at,
      render: (r) => <>{dateTimeShort(r.created_at)}{r.id === selected && <Chip size="sm"><span aria-hidden="true">●</span> выбран</Chip>}</> },
    { key: 'sc', title: 'Сценарий', primary: true, get: (r) => scenarioName(r.scenario_id), render: (r) => scenarioName(r.scenario_id) },
    { key: 'obj', title: 'Критерий', minWidth: 16, get: (r) => objectiveLabel(r.objective),
      render: (r) => <span title={objectiveLabel(r.objective, 'long')}>{criterionWords(r.objective, Number(r.alpha))}</span> },
    { key: 'e', title: 'Ожидаемая прибыль', num: true, sortable: false, hint: 'E[Π] — средняя прибыль по сценариям, ₽',
      render: (r) => kpi(r.id, (s) => money(s.expected)) },
    { key: 'cvar', title: 'Прибыль в худших сценариях', num: true, sortable: false, hint: 'CVaR — средняя прибыль в худших α сценариях, ₽',
      render: (r) => kpi(r.id, (s) => money(s.cvar)) },
    { key: 'items', title: 'Изделий в портфеле', num: true, sortable: false, render: (r) => kpi(r.id, (s) => num(s.items, 0)) },
  ]
  return (
    <DataTable columns={cols} rows={list} rowKey={(r) => r.id} tight limit={SHOWN} caption="Портфели Стадии 2"
      onRowClick={(r) => onSelect(r.id)} rowClassName={(r) => (r.id === selected ? 'is-chosen' : undefined)} rowTitle={() => 'Выбрать портфель'}
      empty="Портфелей ещё нет — рассчитайте его на экране «Портфель» или выберите реестр заказов" emptyKind="first-use" />
  )
}
