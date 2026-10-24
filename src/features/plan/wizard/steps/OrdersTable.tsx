/**
 * Таблица заказов программы (шаг «Программа»): изделие, количество, срок датой (часы — в подсказке),
 * приоритет. Правка реестра заказов — явная запись с понятной ошибкой; удаление из реестра —
 * с подтверждением, называющим заказ и последствие; ручной заказ удаляется сразу с «Отменить».
 * Добавление — вторичная кнопка (primary мастера — только «Запустить»).
 */
import { useState } from 'react'
import type { Product } from '../../../../lib/api'
import { num } from '../../../../explain/format'
import { Icon } from '../../../../shell/icons'
import { ConfirmDialog } from '../../../../ui/ConfirmDialog'
import { DateHoursInput } from '../../../../ui/DateHoursInput'
import { DataTable, showUndo, type DataColumn } from '../../../../ui/kit'
import { dueDateFromHours, fmtDay } from '../dates'
import type { WizardOrder } from '../wizardStore'

interface Props {
  orders: readonly WizardOrder[]
  products: readonly Product[]
  start: Date
  editable: boolean
  /** Ручной ввод: удаление без подтверждения (с «Отменить»). */
  manual: boolean
  canAdd: boolean
  emptyText: string
  onUpdate: (o: WizardOrder, patch: Partial<WizardOrder>) => void
  onDelete: (o: WizardOrder) => void
  onRestore: (o: WizardOrder) => void
  onAdd: (o: WizardOrder) => void
}

const DEFAULT_DUE_H = 720

export function OrdersTable({ orders, products, start, editable, manual, canAdd, emptyText, onUpdate, onDelete, onRestore, onAdd }: Props) {
  const [newProd, setNewProd] = useState('')
  const [newQty, setNewQty] = useState('100')
  const [newDue, setNewDue] = useState(DEFAULT_DUE_H)
  const [hint, setHint] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<WizardOrder | null>(null)
  const prodName = (id: string) => products.find((p) => p.id === id)?.name ?? 'изделие не найдено в справочнике'

  const remove = (o: WizardOrder) => {
    if (!manual) { setConfirm(o); return }
    onDelete(o)
    showUndo({ message: `Заказ «${prodName(o.product_id)}» убран из программы`, onUndo: () => onRestore(o) })
  }
  // Не выключаем кнопку заранее: объясняем при нажатии, чего не хватает.
  const add = () => {
    if (!newProd) { setHint('Выберите изделие — затем количество и срок.'); return }
    if (!canAdd) { setHint('Сначала выберите или создайте производственный план (кнопка «+ План»).'); return }
    setHint(null)
    onAdd({ product_id: newProd, qty: Math.max(1, Number(newQty) || 1), due_hours: newDue, priority: 5 })
    setNewProd('')
  }

  const cols: DataColumn<WizardOrder>[] = [
    { key: 'prod', title: 'Изделие', rowHeader: true, get: (o) => prodName(o.product_id), clip: true, render: (o) => prodName(o.product_id) },
    { key: 'qty', title: 'Кол-во', num: true, sortable: false,
      render: (o) => (editable
        ? <input className="plan__cell" type="number" min="1" defaultValue={Math.round(o.qty)} aria-label="Количество"
            onBlur={(e) => Number(e.target.value) !== o.qty && onUpdate(o, { qty: Number(e.target.value) || 1 })} />
        : num(o.qty, 0)) },
    { key: 'due', title: 'Срок', sortable: false, hint: 'Срок исполнения датой; часы от начала горизонта — в подсказке',
      render: (o) => (editable
        ? <DateHoursInput start={start} dueHours={o.due_hours} onChange={(h) => onUpdate(o, { due_hours: h })} compact />
        : <span title={`${num(o.due_hours, 0)} ч от начала горизонта`}>{fmtDay(dueDateFromHours(start, o.due_hours))}</span>) },
    { key: 'prio', title: 'Приоритет', num: true, sortable: false, hint: '1 — высший, 9 — низший; влияет на очерёдность при конкуренции за станки',
      render: (o) => (editable
        ? <input className="plan__cell" type="number" min="1" max="9" defaultValue={o.priority} aria-label="Приоритет"
            onBlur={(e) => Number(e.target.value) !== o.priority && onUpdate(o, { priority: Number(e.target.value) || 5 })} />
        : num(o.priority, 0)) },
    ...(editable ? [{ key: 'del', title: <span className="dk-vh">Удалить</span>, sortable: false,
      render: (o: WizardOrder) => (
        <button type="button" className="btn btn--ghost btn--sm btn--icon" onClick={() => remove(o)} aria-label={`Удалить заказ «${prodName(o.product_id)}»`} title="Удалить заказ">
          <Icon name="close" size={12} />
        </button>
      ) } as DataColumn<WizardOrder>] : []),
  ]

  return (
    <>
      <DataTable columns={cols} rows={orders} rowKey={(o, i) => o.id ?? `m${i}`} tight caption="Заказы программы" empty={emptyText} emptyKind="first-use" />
      {editable && (products.length === 0 ? (
        <p className="pl-note">Нет товарных изделий — откройте <b>Справочники → Изделия</b> и отметьте «Товарная позиция».</p>
      ) : (
        <div className="wz-row">
          <select className="plan__select" value={newProd} onChange={(e) => setNewProd(e.target.value)} aria-label="Изделие нового заказа">
            <option value="">— изделие —</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input className="plan__input" type="number" min="1" value={newQty} onChange={(e) => setNewQty(e.target.value)} aria-label="Количество" />
          <DateHoursInput start={start} dueHours={newDue} onChange={setNewDue} label="Срок нового заказа" />
          <button type="button" className="btn" onClick={add}>+ Добавить заказ</button>
          {hint && <span className="pl-note" role="status"><span className="glyph-setup" aria-hidden="true" />{hint}</span>}
        </div>
      ))}
      {confirm && (
        <ConfirmDialog title="Удалить заказ из реестра?" danger confirmLabel="Удалить заказ"
          objectName={`${prodName(confirm.product_id)} × ${num(confirm.qty, 0)} · срок ${fmtDay(dueDateFromHours(start, confirm.due_hours))}`}
          consequence="Заказ исчезнет из производственного плана в реестре — для всех следующих прогонов. Уже построенные прогоны не меняются."
          onConfirm={() => { onDelete(confirm); setConfirm(null) }} onCancel={() => setConfirm(null)} />
      )}
    </>
  )
}
