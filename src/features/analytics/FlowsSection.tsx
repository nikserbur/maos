/**
 * Потоки между типами РЦ (X2 «форма по задаче»): по умолчанию «Главные переходы» — список-бары
 * топ-10 «откуда → куда» по числу партий (кнопка «Все N» и таблица-двойник) и тепловая карта
 * «откуда × куда» одной последовательной шкалой. Sankey — по выбору, с выделением лент узкого
 * места. Заголовок — утверждение о доле партий через узкое место.
 */
import { useMemo, useState } from 'react'
import type { Machine, SimPlan } from '../../lib/api'
import { InfoTip } from '../../ui/InfoTip'
import { BarList, Heatmap, Sankey, type BarRow } from '../../ui/charts'
import { EmptyState, Segmented, SkeletonRows, type SegOption } from '../../ui/kit'
import { countText, num, pct } from '../../explain/format'
import { bottleneckShare, buildFlows, flowMatrix, topTransitions } from './flowModel'

type FlowView = 'top' | 'sankey'

const VIEWS: ReadonlyArray<SegOption<FlowView>> = [
  { id: 'top', label: 'Главные переходы' },
  { id: 'sankey', label: 'Схема потока' },
]
const TOP_N = 10
const BATCHES = ['партия', 'партии', 'партий'] as const

interface FlowsSectionProps {
  plan: SimPlan | null
  machines: ReadonlyArray<Machine>
  nameOfType: (id: string) => string
  bottleneck: { typeId: string; name: string } | null
  loading: boolean
}

export function FlowsSection({ plan, machines, nameOfType, bottleneck, loading }: FlowsSectionProps) {
  const [view, setView] = useState<FlowView>('top')
  const model = useMemo(() => buildFlows(plan?.tasks, new Map(machines.map((m) => [m.id, m.wc_type_id]))), [plan, machines])

  if (loading && !plan) return <SkeletonRows rows={6} cols={3} label="Загрузка ленты операций…" />
  if (!model || model.links.length === 0) {
    return (
      <EmptyState title="Переходов между типами нет" kind="unavailable" variant="flow" size="sm">
        В этом построении операции заказов не переходят между станками разных типов — потоку нечего показать.
      </EmptyState>
    )
  }
  const share = bottleneckShare(model, bottleneck?.typeId)
  const title = bottleneck && Number.isFinite(share)
    ? `Через узкое место «${bottleneck.name}» идут ${pct(share, 0)} партий между переделами`
    : 'Партии между переделами'
  const total = model.links.reduce((s, l) => s + l.v, 0)
  const info = <InfoTip id="analytics.sankey" values={{ flow: model.links.length, max: model.links.reduce((m, l) => Math.max(m, l.v), 0) }} />

  return (
    <section className="dk-card an-flows" aria-label={title}>
      <div className="an-flows__head">
        <div>
          <h2 className="an-flows__title">{title} {info}</h2>
          <p className="an-muted">{countText(total, BATCHES)} · {countText(model.links.length, ['переход', 'перехода', 'переходов'])} между {num(model.types.length, 0)} типами РЦ</p>
        </div>
        <Segmented<FlowView> options={VIEWS} value={view} onChange={setView} label="Вид потока" size="sm" />
      </div>
      {view === 'top'
        ? <TopTransitions model={model} nameOfType={nameOfType} bnType={bottleneck?.typeId ?? null} />
        : (
          <Sankey nodes={model.types.map((t) => ({ id: t, label: nameOfType(t) }))}
            links={model.links.map((l) => ({ from: l.from, to: l.to, value: l.v }))} unit="партий"
            emphasis={bottleneck ? [bottleneck.typeId] : undefined}
            subtitle={bottleneck ? `ленты узкого места «${bottleneck.name}» — цветом, остальные приглушены` : 'толщина ленты ∝ числу партий'}
            ariaLabel={`${title}. Схема потока партий между типами рабочих центров`} />
        )}
    </section>
  )
}

function TopTransitions({ model, nameOfType, bnType }: { model: NonNullable<ReturnType<typeof buildFlows>>; nameOfType: (id: string) => string; bnType: string | null }) {
  const all = topTransitions(model)
  const rows: BarRow[] = all.map((l) => {
    const text = `${nameOfType(l.from)} → ${nameOfType(l.to)}`
    return { key: `${l.from}>${l.to}`, label: text, labelText: text, value: l.v, marked: Boolean(bnType) && (l.from === bnType || l.to === bnType) }
  })
  const m = flowMatrix(model)
  const heatRows = m.from.map((f, i) => ({ key: f, label: nameOfType(f), values: m.values[i].map((v) => (m.max > 0 ? v / m.max : 0)) }))
  const cols = m.to.map((t) => nameOfType(t))
  const fmtCell = (x: number) => countText(Math.round(x * m.max), BATCHES)
  return (
    <div className="an-flows__grid">
      <BarList rows={rows} fmt={(v) => num(v, 0)} limit={TOP_N} valueHeader="Партий" compact
        title={`Главные переходы: топ-${num(Math.min(TOP_N, rows.length), 0)} из ${num(rows.length, 0)}`}
        ariaLabel={`Переходы партий между типами РЦ по убыванию: ${rows.length}`} />
      <Heatmap rows={heatRows} columns={cols} axis={cols} fmt={fmtCell} legendLow="нет переходов" legendHigh={`${num(m.max, 0)} партий`}
        title="Откуда × куда" subtitle="строка — откуда, столбец — куда" className="an-flowheat"
        ariaLabel={`Матрица переходов: ${m.from.length} источников × ${m.to.length} приёмников`} />
    </div>
  )
}
