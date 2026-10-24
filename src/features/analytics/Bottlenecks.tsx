/**
 * Узкие места: ранжир типов РЦ по загрузке таблицей кита. Бар — величина (`--chart-1`) с отметкой
 * порога «внимание»; глиф и слово — только от порога (LOAD_THRESHOLDS), норма — без цвета. Первая
 * строка — нейтральный чип «узкое место». Каждая строка ведёт к объектам: «Инвестпроект» на виду,
 * в ⋯ — «На Ганте», «В Схеме», «Ходы для узкого места». Теория ограничений — в «i».
 */
import { useMemo } from 'react'
import type { Machine } from '../../lib/api'
import { InfoTip } from '../../ui/InfoTip'
import { Meter } from '../../ui/charts'
import { Chip, DataTable, EmptyState, IconButton, Menu, Section, SkeletonRows, type DataColumn, type MenuItem } from '../../ui/kit'
import { navigateTo } from '../../shell/router'
import { num, pct } from '../../explain/format'
import { LOAD_MARK, LOAD_THRESHOLDS, loadLevel, type TypeLoad } from './analyticsModel'

interface BottlenecksProps {
  loads: ReadonlyArray<TypeLoad>
  /** Построение, к Ганту и ходам которого ведут переходы. */
  planId: string
  machines: ReadonlyArray<Machine>
  loading: boolean
  onInvest: (wcTypeId: string) => void
}

/** Переходы строки ранжира к объектам других экранов (адреса — router.buildHash). */
function rowMenu(l: TypeLoad, planId: string, machines: ReadonlyArray<Machine>): MenuItem[] {
  const firstMachine = machines.find((m) => m.wc_type_id === l.typeId)
  const items: MenuItem[] = [
    { id: 'gantt', label: 'На Ганте', icon: 'calendar', hint: 'операции этого типа в расписании',
      onSelect: () => navigateTo('plan', `run/${planId}/gantt`, { wc: l.typeId }) },
    { id: 'moves', label: 'Ходы для узкого места', icon: 'swap', hint: 'что поменять в расписании, чтобы разгрузить тип',
      onSelect: () => navigateTo('plan', `run/${planId}/moves`, { wc: l.typeId }) },
  ]
  if (firstMachine) {
    items.splice(1, 0, { id: 'scheme', label: 'В Схеме', icon: 'scheme', hint: `станок «${firstMachine.name}» на схеме предприятия`,
      onSelect: () => navigateTo('scheme', null, { sel: firstMachine.id }) })
  }
  return items
}

export function Bottlenecks({ loads, planId, machines, loading, onInvest }: BottlenecksProps) {
  const top = loads[0]
  const columns = useMemo<DataColumn<TypeLoad>[]>(() => [
    { key: 'rank', title: '№', num: true, sortable: false, className: 'an-td-rank',
      render: (l) => <span className="an-rank">{num(loads.indexOf(l) + 1, 0)}</span> },
    { key: 'name', title: 'Тип РЦ', rowHeader: true, get: (l) => l.name,
      render: (l) => (
        <span className="an-bname">
          {l.name}
          {l === top && <Chip size="sm" title="наибольшая загрузка — ограничение системы">узкое место</Chip>}
          {l.laborBound && (
            <Chip size="sm" tone="setup" title="операторов меньше станков — параллелизм ограничен трудом">
              упор в труд · {num(l.operators, 0)} опер. на {num(l.machines, 0)} станк.
            </Chip>
          )}
        </span>
      ) },
    { key: 'bar', title: 'Загрузка', sortable: false, className: 'an-td-bar',
      render: (l) => <Meter value={l.utilization} tone="accent" mark={LOAD_THRESHOLDS.warn} label={`загрузка ${pct(l.utilization, 0)}, порог «внимание» ${pct(LOAD_THRESHOLDS.warn, 0)}`} /> },
    { key: 'util', title: 'Значение', num: true, get: (l) => l.utilization,
      render: (l) => {
        const level = loadLevel(l.utilization)
        if (level === 'ok') return pct(l.utilization, 0)
        const m = LOAD_MARK[level]
        return <span className="an-loadmark"><span className={m.glyph} aria-hidden="true" />{m.word} · {pct(l.utilization, 0)}</span>
      } },
    { key: 'machines', title: 'Станков', num: true, get: (l) => l.machines, render: (l) => num(l.machines, 0) },
    { key: 'operators', title: 'Операторов', num: true, get: (l) => l.operators, render: (l) => num(l.operators, 0) },
    { key: 'act', title: <span className="dk-vh">Действия</span>, sortable: false, className: 'an-td-act',
      render: (l) => (
        <span className="an-rowacts">
          <span className={l === top ? undefined : 'dk-table__hover'}>
            <IconButton icon="money" size="sm" title={`Оценить докупку оборудования «${l.name}»`} onClick={() => onInvest(l.typeId)}>Инвестпроект</IconButton>
          </span>
          {planId && <Menu items={rowMenu(l, planId, machines)} label={`Ещё: ${l.name}`} size="sm" />}
        </span>
      ) },
  ], [loads, top, onInvest, planId, machines])

  if (loading) return <SkeletonRows rows={5} cols={6} label="Загрузка ранжира…" />
  if (!loads.length) {
    return (
      <EmptyState title="Загрузки по типам нет" kind="unavailable" variant="chart" size="sm">
        У этого построения нет сохранённых результатов симуляции по станкам — перестройте план, и ранжир появится.
      </EmptyState>
    )
  }
  const info = (
    <InfoTip id="analytics.bottleneck_rank" values={{ name: top.name, util: top.utilization, machines: top.machines }}
      note={`Наращивать выпуск имеет смысл только на узком месте. Пороги: от ${pct(LOAD_THRESHOLDS.warn, 0)} — близко к пределу, от ${pct(LOAD_THRESHOLDS.bad, 0)} — перегрузка.`} />
  )
  return (
    <Section id="an-bottleneck" title={<>Ранжир по загрузке {info}<InfoTip id="analytics.labor_constraint" values={{ machines: top.machines, operators: top.operators, parallel: Math.min(top.machines, top.operators) }} /></>}>
      <div className="an-bn">
        <DataTable<TypeLoad> columns={columns} rows={loads} rowKey={(l) => l.typeId} framed
          rowClassName={(l) => (loadLevel(l.utilization) === 'bad' ? 'is-alert' : undefined)}
          caption="Типы рабочих центров по средней загрузке станков" />
      </div>
    </Section>
  )
}
