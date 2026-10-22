/**
 * Узкие места (X1 §6.3 п. 7): ранжир типов РЦ по загрузке таблицей; бар — `--chart-1`
 * (величина, не статус), статус — глиф у значения; «Инвестпроект» — только у верхней строки
 * и по hover/фокусу остальных (dk-table__hover). Теория ограничений — в мете секции и «i».
 */
import { useMemo } from 'react'
import { InfoTip } from '../../ui/InfoTip'
import { Meter } from '../../ui/charts'
import { Chip, DataTable, EmptyState, IconButton, Section, type DataColumn } from '../../ui/kit'
import { num, pct } from '../../explain/format'
import type { TypeLoad } from './analyticsModel'

const HOT = 0.9
const WARM = 0.75

interface BottlenecksProps {
  loads: ReadonlyArray<TypeLoad>
  onInvest: (wcTypeId: string) => void
}

export function Bottlenecks({ loads, onInvest }: BottlenecksProps) {
  const top = loads[0]
  const columns = useMemo<DataColumn<TypeLoad>[]>(() => [
    { key: 'rank', title: '#', num: true, sortable: false, className: 'an-td-rank',
      render: (l) => <span className={`an-rank${l === top ? ' an-rank--top' : ''}`}>{num(loads.indexOf(l) + 1, 0)}</span> },
    { key: 'name', title: 'Тип РЦ', rowHeader: true, get: (l) => l.name,
      render: (l) => (
        <span className="an-bname">
          {l.name}
          {l.laborBound && (
            <Chip size="sm" tone="setup" title="операторов меньше станков — параллелизм ограничен трудом">
              упор в труд · {num(l.operators, 0)} опер. на {num(l.machines, 0)} станк.
            </Chip>
          )}
        </span>
      ) },
    { key: 'bar', title: 'Загрузка', sortable: false, className: 'an-td-bar',
      render: (l) => <Meter value={l.utilization} tone="accent" label={`загрузка ${pct(l.utilization, 0)}`} /> },
    { key: 'util', title: 'Значение', num: true, get: (l) => l.utilization,
      render: (l) => {
        const glyph = l.utilization >= HOT ? 'glyph-down' : l.utilization >= WARM ? 'glyph-setup' : 'glyph-running'
        const label = l.utilization >= HOT ? 'узкое место' : l.utilization >= WARM ? 'близко к пределу' : 'есть запас'
        return <><span className={glyph} title={label} aria-label={label} /> {pct(l.utilization, 0)}</>
      } },
    { key: 'machines', title: 'Станков', num: true, get: (l) => l.machines, render: (l) => num(l.machines, 0) },
    { key: 'operators', title: 'Операторов', num: true, get: (l) => l.operators, render: (l) => num(l.operators, 0) },
    { key: 'act', title: <span className="dk-vh">Действие</span>, sortable: false, className: 'an-td-act',
      render: (l) => (
        <span className={l === top ? undefined : 'dk-table__hover'}>
          <IconButton icon="money" size="sm" title="Оценить докупку оборудования этого типа" onClick={() => onInvest(l.typeId)}>Инвестпроект</IconButton>
        </span>
      ) },
  ], [loads, top, onInvest])

  if (!loads.length) {
    return <EmptyState title="Нет загрузки по типам" variant="chart" size="sm">Постройте план — ранжир появится по результатам симуляции.</EmptyState>
  }
  return (
    <Section id="an-bottleneck" title={<>Ранжир по загрузке <InfoTip id="analytics.bottleneck_rank" values={{ name: top.name, util: top.utilization }} /></>}
      meta={<>наращивать выпуск имеет смысл только на узком месте; параллелизм = min(станки, операторы) <InfoTip id="analytics.labor_constraint" values={{ machines: top.machines, operators: top.operators, parallel: Math.min(top.machines, top.operators) }} /></>}>
      <div className="dk-card dk-card--flush">
        <DataTable<TypeLoad> columns={columns} rows={loads} rowKey={(l) => l.typeId}
          rowClassName={(l) => (l.utilization >= HOT ? 'is-alert' : undefined)}
          caption="Типы рабочих центров по средней загрузке станков" />
      </div>
    </Section>
  )
}
