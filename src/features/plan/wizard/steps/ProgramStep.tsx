/**
 * Шаг 1 «Программа» (UX-V2 §4.2): три источника как сегменты — «Портфель Стадии 2» (прогоны: дата ·
 * сценарий · E[Π] / CVaR / изделий — X1 §5 п. 14), «Реестр заказов» (production_plan → заказы), «Вручную». Таблица заказов:
 * изделие, кол-во, срок как дата (+ часы в подписи), приоритет с пояснением. Итог: N изделий, Σ штук,
 * горизонт в датах. План создаётся в модале (PromptDialog), не через prompt.
 */
import { useState } from 'react'
import { api, type DemandOrder } from '../../../../lib/api'
import { dateTime, money, num } from '../../../../explain/format'
import { Icon } from '../../../../shell/icons'
import { DateHoursInput } from '../../../../ui/DateHoursInput'
import { PromptDialog } from '../../../../ui/PromptDialog'
import { Segmented } from '../../../../ui/kit'
import { Chip } from '../../../../ui/kit'
import { toIsoDate, dueDateFromHours, programHorizon } from '../dates'
import type { WizardData } from '../useWizardData'
import { useRunSummaries } from '../useRunSummaries'
import { useWizard, wizardActions, type ProgramSource, type WizardOrder } from '../wizardStore'

const OBJ: Record<string, string> = { cvar: 'CVaR', worstcase: 'maximin', meanvariance: 'E − λσ', minregret: 'Сэвидж' }
const RUNS_SHOWN = 12

export function ProgramStep({ data }: { data: WizardData }) {
  const w = useWizard()
  const [newProd, setNewProd] = useState('')
  const [newQty, setNewQty] = useState('100')
  const [newDue, setNewDue] = useState(720)
  const [planNameOpen, setPlanNameOpen] = useState(false)
  const prodName = (id: string) => data.products.find((p) => p.id === id)?.name ?? id
  const horizon = programHorizon(data.program, data.start.date)
  const qty = data.program.reduce((a, o) => a + o.qty, 0)
  const scName = (id: string) => data.scenarios.find((s) => s.id === id)?.name ?? id.slice(0, 8)
  const shownRuns = data.runs.slice(0, RUNS_SHOWN)
  const summaries = useRunSummaries(w.source === 'portfolio' ? shownRuns.map((r) => r.id) : [])

  const addOrder = async () => {
    if (!newProd) return
    const order: WizardOrder = { product_id: newProd, qty: Number(newQty) || 1, due_hours: newDue, priority: 5 }
    if (w.source === 'manual') { wizardActions.setManualOrders([...w.manualOrders, order]); setNewProd(''); return }
    if (!w.planId) return
    await api.demandOrders.create({ plan_id: w.planId, product_id: newProd, quantity: String(order.qty), due_hours: String(order.due_hours), priority: '5' }).catch(() => {})
    setNewProd(''); await data.reloadOrders()
  }
  const updateOrder = async (o: WizardOrder, patch: Partial<WizardOrder>) => {
    if (w.source === 'manual') { wizardActions.setManualOrders(w.manualOrders.map((x) => (x === o ? { ...x, ...patch } : x))); return }
    if (!o.id) return
    const body: Partial<DemandOrder> = {}
    if (patch.qty !== undefined) body.quantity = String(patch.qty)
    if (patch.due_hours !== undefined) body.due_hours = String(patch.due_hours)
    if (patch.priority !== undefined) body.priority = String(patch.priority)
    await api.demandOrders.update(o.id, body).catch(() => {}); await data.reloadOrders()
  }
  const delOrder = async (o: WizardOrder) => {
    if (w.source === 'manual') { wizardActions.setManualOrders(w.manualOrders.filter((x) => x !== o)); return }
    if (!o.id) return
    await api.demandOrders.delete(o.id).catch(() => {}); await data.reloadOrders()
  }
  const createPlan = async (name: string, description: string) => {
    const p = await api.plans.create({ name, description: description || undefined }).catch(() => null)
    setPlanNameOpen(false)
    await data.reloadPlans(); if (p) wizardActions.setPlanId(p.id)
  }

  const editable = w.source !== 'portfolio'
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
          <p className="wz-card__t">Прогоны робастной оптимизации · что выпускать</p>
          {data.runs.length === 0 ? (
            <p className="pl-note">Портфелей ещё нет — рассчитайте его на экране «Оптимизация» или выберите реестр заказов.</p>
          ) : (
            <ul className="wz-runs" role="listbox" aria-label="Портфели Стадии 2">
              {shownRuns.map((r) => {
                const sm = summaries.get(r.id)
                return (
                  <li key={r.id}>
                    <button type="button" role="option" aria-selected={w.runId === r.id} className={`wz-run${w.runId === r.id ? ' is-on' : ''}`} onClick={() => wizardActions.setRunId(r.id)}>
                      <span className="wz-run__date num">{dateTime(r.created_at)}</span>
                      <span className="wz-run__sc">«{scName(r.scenario_id)}»</span>
                      <span className="wz-run__kpi num">
                        {sm === undefined ? '…' : sm === null ? '—' : <>E <b>{money(sm.expected)}</b> · CVaR <b>{money(sm.cvar)}</b> · <b>{num(sm.items, 0)}</b> изд.</>}
                      </span>
                      <span className="wz-run__meta mono">{OBJ[r.objective] ?? r.objective} · α {num(Number(r.alpha) * 100, 0)} % · N {r.samples}</span>
                      {w.runId === r.id && <Chip tone="good">выбран</Chip>}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {data.runLoading && <p className="pl-note">Загружаем портфель…</p>}
          {data.run && (
            <p className="pl-note">
              Робастный портфель: <b>{data.run.robust.items.length}</b> изделий · E[Π] <b className="num">{money(data.run.robust.metrics.expected)}</b> ·
              CVaR <b className="num">{money(data.run.robust.metrics.cvar)}</b> · горизонт <b className="num">{num(data.run.horizon_hours / 720, 1)} мес</b>.
              Сроки заказов = горизонт портфеля; сценарий наследуется.
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
          <button className="btn" onClick={() => setPlanNameOpen(true)}>+ План</button>
        </div>
      )}

      {(w.source !== 'portfolio' || data.run) && (
        <div className="wz-card">
          <table className="plan__rules wz-orders">
            <thead><tr>
              <th>Изделие</th><th>Кол-во</th>
              <th title="Срок исполнения как дата; часы от начала горизонта — техническое поле контракта">Срок</th>
              <th title="1 — высший приоритет, 9 — низший; влияет на очерёдность при конкуренции за станки">Приоритет</th>
              {editable && <th />}
            </tr></thead>
            <tbody>
              {data.program.map((o, i) => (
                <tr key={o.id ?? i}>
                  <td>{prodName(o.product_id)}</td>
                  <td>{editable
                    ? <input className="plan__cell" type="number" min="1" defaultValue={Math.round(o.qty)} onBlur={(e) => Number(e.target.value) !== o.qty && updateOrder(o, { qty: Number(e.target.value) || 1 })} />
                    : <span className="num">{num(o.qty, 0)}</span>}</td>
                  <td>{editable
                    ? <DateHoursInput start={data.start.date} dueHours={o.due_hours} onChange={(h) => updateOrder(o, { due_hours: h })} compact />
                    : <span className="num">{toIsoDate(dueDateFromHours(data.start.date, o.due_hours))} <small className="mono">· {num(o.due_hours, 0)} ч</small></span>}</td>
                  <td>{editable
                    ? <input className="plan__cell" type="number" min="1" max="9" defaultValue={o.priority} onBlur={(e) => Number(e.target.value) !== o.priority && updateOrder(o, { priority: Number(e.target.value) || 5 })} />
                    : o.priority}</td>
                  {editable && <td><button className="btn btn--danger btn--sm btn--icon" onClick={() => delOrder(o)} aria-label="Удалить заказ" title="Удалить заказ"><Icon name="close" size={12} /></button></td>}
                </tr>
              ))}
              {data.program.length === 0 && <tr><td colSpan={5} className="wz-orders__empty">
                {w.source === 'orders' && data.plans.length === 0 ? 'Планов ещё нет — нажмите «+ План», затем добавьте заказы.' : 'Заказов нет — добавьте ниже: изделие, количество и срок.'}
              </td></tr>}
            </tbody>
          </table>
          {editable && (data.products.length === 0 ? (
            <p className="pl-note">Нет товарных изделий — откройте <b>Справочники → Изделия</b> и отметьте «Товарная позиция».</p>
          ) : (
            <div className="wz-row">
              <select className="plan__select" value={newProd} onChange={(e) => setNewProd(e.target.value)}>
                <option value="">— изделие —</option>
                {data.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input className="plan__input" type="number" min="1" value={newQty} onChange={(e) => setNewQty(e.target.value)} placeholder="кол-во" aria-label="Количество" />
              <DateHoursInput start={data.start.date} dueHours={newDue} onChange={setNewDue} label="Срок нового заказа" />
              <button className="btn btn--primary" onClick={addOrder} disabled={!newProd || (w.source === 'orders' && !w.planId)}>+ Добавить заказ</button>
            </div>
          ))}
        </div>
      )}

      <div className="wz-summary">
        <span><b className="num">{data.program.length}</b> изделий</span>
        <span>Σ <b className="num">{num(qty, 0)}</b> шт</span>
        <span>горизонт до <b className="num">{toIsoDate(horizon.end)}</b> <small className="mono">({num(horizon.hours, 0)} ч)</small></span>
        <span>старт <b className="num">{toIsoDate(data.start.date)}</b>
          {data.start.source === 'fallback'
            ? <Chip tone="warn" title="В сценарии нет start_date — используется сегодняшняя дата; задайте дату в сценарии">дата сценария не задана</Chip>
            : <Chip tone="good">из сценария</Chip>}
        </span>
      </div>

      {planNameOpen && (
        <PromptDialog title="Новый производственный план" label="Название" defaultValue={'План ' + (data.plans.length + 1)} withDescription onSubmit={createPlan} onCancel={() => setPlanNameOpen(false)} />
      )}
    </div>
  )
}
