/**
 * Потоки между типами РЦ: лента плана → переходы соседних операций заказа (flowModel.buildFlows)
 * → Sankey chart-системы (подписи целиком, hover-цепочка, числа, таблица-двойник).
 */
import { useMemo } from 'react'
import type { Machine, SimPlan } from '../../lib/api'
import { InfoTip } from '../../ui/InfoTip'
import { Sankey } from '../../ui/charts'
import { EmptyState } from '../../ui/kit'
import { buildFlows } from './flowModel'

interface FlowsSectionProps {
  plan: SimPlan | null
  machines: ReadonlyArray<Machine>
  nameOfType: (id: string) => string
}

export function FlowsSection({ plan, machines, nameOfType }: FlowsSectionProps) {
  const model = useMemo(() => buildFlows(plan?.tasks, new Map(machines.map((m) => [m.id, m.wc_type_id]))), [plan, machines])
  if (!model || model.links.length === 0) {
    return <EmptyState title="Потоков между типами нет" variant="flow" size="sm">Нужен план, в котором операции заказа проходят через станки разных типов.</EmptyState>
  }
  const maxFlow = model.links.reduce((m, l) => Math.max(m, l.v), 0)
  return (
    <section className="dk-card dk-rise" aria-label="Материальный поток">
      <Sankey
        nodes={model.types.map((t) => ({ id: t, label: nameOfType(t) }))}
        links={model.links.map((l) => ({ from: l.from, to: l.to, value: l.v }))}
        unit="партий"
        title={<>Материальный поток между типами РЦ <InfoTip id="analytics.sankey" values={{ flow: model.links.length, max: maxFlow }} /></>}
        subtitle="толщина ленты ∝ числу партий между переделами; наведите на тип — подсветится его цепочка"
        ariaLabel="Потоки партий между типами рабочих центров"
      />
    </section>
  )
}
