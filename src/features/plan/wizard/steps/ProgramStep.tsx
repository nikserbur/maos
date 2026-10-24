/**
 * Шаг 1 «Программа» (UX-V2 §4.2): три источника сегментами — «Портфель Стадии 2» (компактная таблица,
 * последний выбран), «Реестр заказов» (производственный план → заказы), «Вручную». Таблица заказов:
 * изделие, количество, срок датой, приоритет. Итог: N изделий, Σ штук, горизонт и старт — датами по-русски.
 * Запись в реестр заказов — явная; ошибка сервера показывается словами, а не глотается.
 */
import { useState } from 'react'
import { api, type DemandOrder } from '../../../../lib/api'
import { money, num } from '../../../../explain/format'
import { PromptDialog } from '../../../../ui/PromptDialog'
import { Chip, InlineError, Segmented } from '../../../../ui/kit'
import { fmtDay, programHorizon } from '../dates'
import type { WizardData } from '../useWizardData'
import { getWizardState, useWizard, wizardActions, type ProgramSource, type WizardOrder } from '../wizardStore'
import { OrdersTable } from './OrdersTable'
import { PortfolioPicker } from './PortfolioPicker'

export const scenarioTitle = (name: string | null | undefined): string => (name && name.trim() ? name : 'сценарий без имени')

export function ProgramStep({ data }: { data: WizardData }) {
  const w = useWizard()
  const [planNameOpen, setPlanNameOpen] = useState(false)
  const [writeError, setWriteError] = useState<unknown>(null)
  const horizon = programHorizon(data.program, data.start.date)
  const qty = data.program.reduce((a, o) => a + o.qty, 0)
  const scName = (id: string) => scenarioTitle(data.scenarios.find((s) => s.id === id)?.name)

  // Запись в реестр: ошибка — словами под таблицей, с «Подробнее» (не глотаем).
  const write = async (op: () => Promise<unknown>) => {
    try { await op(); setWriteError(null) } catch (e) { setWriteError(e) }
    await data.reloadOrders()
  }
  const addOrder = async (order: WizardOrder) => {
    if (w.source === 'manual') { wizardActions.setManualOrders([...w.manualOrders, order]); return }
    if (!w.planId) return
    await write(() => api.demandOrders.create({ plan_id: w.planId, product_id: order.product_id, quantity: String(order.qty), due_hours: String(order.due_hours), priority: String(order.priority) }))
  }
  const updateOrder = async (o: WizardOrder, patch: Partial<WizardOrder>) => {
    if (w.source === 'manual') { wizardActions.setManualOrders(w.manualOrders.map((x) => (x === o ? { ...x, ...patch } : x))); return }
    if (!o.id) return
    const body: Partial<DemandOrder> = {}
    if (patch.qty !== undefined) body.quantity = String(patch.qty)
    if (patch.due_hours !== undefined) body.due_hours = String(patch.due_hours)
    if (patch.priority !== undefined) body.priority = String(patch.priority)
    await write(() => api.demandOrders.update(o.id as string, body))
  }
  const delOrder = async (o: WizardOrder) => {
    if (w.source === 'manual') { wizardActions.setManualOrders(w.manualOrders.filter((x) => x !== o)); return }
    if (!o.id) return
    await write(() => api.demandOrders.delete(o.id as string))
  }
  const restoreManual = (o: WizardOrder) => wizardActions.setManualOrders([...getWizardState().manualOrders, o])
  const createPlan = async (name: string, description: string) => {
    setPlanNameOpen(false)
    try {
      const p = await api.plans.create({ name, description: description || undefined })
      setWriteError(null)
      await data.reloadPlans()
      wizardActions.setPlanId(p.id)
    } catch (e) {
      setWriteError(e)
    }
  }

  const editable = w.source !== 'portfolio'
  const emptyText = w.source === 'orders' && data.plans.length === 0
    ? 'Планов ещё нет — нажмите «+ План», затем добавьте заказы'
    : 'Заказов нет — добавьте ниже: изделие, количество и срок'
  return (
    <div className="wz-step">
      <Segmented label="Источник программы" size="lg" value={w.source} onChange={(id: ProgramSource) => wizardActions.setSource(id)}
        options={[
          { id: 'portfolio', label: 'Портфель Стадии 2', count: data.runs.length },
          { id: 'orders', label: 'Реестр заказов', count: data.orders.length },
          { id: 'manual', label: 'Вручную' },
        ]} />

      {w.source === 'portfolio' && (
        <div className="wz-card">
          <p className="wz-card__t">Портфели робастной оптимизации · что выпускать</p>
          <PortfolioPicker runs={data.runs} selected={w.runId} onSelect={wizardActions.setRunId} scenarioName={scName} />
          {data.runLoading && <p className="pl-note">Загружаем портфель…</p>}
          {data.run && (
            <p className="pl-note">
              Выбран: <b>{num(data.run.robust.items.length, 0)}</b> изделий · E[Π] <b className="num">{money(data.run.robust.metrics.expected)}</b> ·
              горизонт <b className="num">{num(data.run.horizon_hours / 720, 1)} мес</b>. Сроки заказов = горизонт портфеля; сценарий наследуется.
            </p>
          )}
        </div>
      )}

      {w.source === 'orders' && (
        <div className="wz-row">
          <label className="wz-inline">План:
            <select className="plan__select" value={w.planId} onChange={(e) => wizardActions.setPlanId(e.target.value)}>
              {data.plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <button type="button" className="btn" onClick={() => setPlanNameOpen(true)}>+ План</button>
        </div>
      )}

      {(w.source !== 'portfolio' || data.run) && (
        <div className="wz-card">
          <OrdersTable orders={data.program} products={data.products} start={data.start.date} editable={editable} manual={w.source === 'manual'}
            canAdd={w.source === 'manual' || Boolean(w.planId)} emptyText={emptyText}
            onUpdate={(o, p) => void updateOrder(o, p)} onDelete={(o) => void delOrder(o)} onRestore={restoreManual} onAdd={(o) => void addOrder(o)} />
          {Boolean(writeError) && <InlineError error={writeError} title="Реестр заказов не обновлён" message="Изменение не сохранилось на сервере — повторите." onDismiss={() => setWriteError(null)} />}
        </div>
      )}

      <div className="wz-summary">
        <span><b className="num">{num(data.program.length, 0)}</b> изделий</span>
        <span>Σ <b className="num">{num(qty, 0)}</b> шт</span>
        <span title={`${num(horizon.hours, 0)} ч от начала горизонта`}>горизонт до <b className="num">{fmtDay(horizon.end)}</b></span>
        <span>старт <b className="num">{fmtDay(data.start.date)}</b>
          {data.start.source === 'fallback'
            ? <Chip tone="warn" title="В сценарии нет даты начала — используется сегодняшняя; задайте её в сценарии">дата сценария не задана</Chip>
            : <Chip>из сценария</Chip>}
        </span>
      </div>

      {planNameOpen && (
        <PromptDialog title="Новый производственный план" label="Название" defaultValue={'План ' + (data.plans.length + 1)} withDescription onSubmit={createPlan} onCancel={() => setPlanNameOpen(false)} />
      )}
    </div>
  )
}
