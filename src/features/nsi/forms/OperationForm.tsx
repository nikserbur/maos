import { useMemo, useState } from 'react'
import { api } from '../../../lib/api'
import { fmtValue } from '../../../explain/format'
import { Icon } from '../../../shell/icons'
import { OP_TYPE_LABELS, shopShort } from '../registries'
import { parseInputs, typesFromNames } from '../routing/routingModel'
import { useProducts, useWorkCenterTypes } from '../useNsi'
import { changedFields, fieldOf, useFormBridge, type NsiFormProps } from './formBridge'
import { FormError, FormNote, NO_CHANGES } from './FormError'

type InputRow = { product_id: string; qty: string }

/**
 * Операция НСИ (P-43). Правка отправляет только изменённые поля; связи (типы оборудования и входы)
 * уходят, только если их меняли, и всегда вместе — сервер пересвязывает оба набора разом. Если связи
 * сервер не отдал (операции демо-загрузки), они показываются только для чтения: так их нельзя стереть.
 */
export function OperationForm({ onSuccess, edit, bridge }: NsiFormProps) {
  const wcTypes  = useWorkCenterTypes()
  const products = useProducts()
  const r = useMemo(() => edit?.row ?? {}, [edit])
  const sv = fieldOf(r)

  const serverTypeIds = Array.isArray(r.wc_type_ids) ? (r.wc_type_ids as string[]) : null
  const serverInputs = Array.isArray(r.input_products) ? (r.input_products as Array<{ product_id: string; qty: number | string }>) : null
  const jsonInputs = parseInputs(sv('inputs'))
  // Связи можно править, только когда известны оба набора (новая запись, записанная интерфейсом или отданная сервером).
  const linksKnown = !edit || (serverTypeIds !== null && serverInputs !== null) || jsonInputs !== null
  const initialTypeIds = serverTypeIds ?? typesFromNames(sv('wc_types'), wcTypes).map((t) => t.id)
  const initialInputs: InputRow[] = serverInputs
    ? serverInputs.map((x) => ({ product_id: x.product_id, qty: String(x.qty) }))
    : (jsonInputs ?? []).map((x) => ({ product_id: x.productId, qty: String(x.qty) }))

  const [code, setCode]       = useState(sv('code'))
  const [name, setName]       = useState(sv('name'))
  const [opType, setOpType]   = useState(sv('op_type'))
  const [typeIds, setTypeIds] = useState<string[] | null>(null)   // null — не трогали
  const [inputs, setInputs]   = useState<InputRow[] | null>(null) // null — не трогали
  const [order, setOrder]     = useState(sv('order_no', '10'))
  const [setup, setSetup]     = useState(sv('setup_required') === '1')
  const [tNorm, setTNorm]     = useState(sv('t_norm'))
  const [tOpt, setTOpt]       = useState(sv('t_opt'))
  const [tPess, setTPess]     = useState(sv('t_pess'))
  const [cost, setCost]       = useState(sv('cost'))
  const [risk, setRisk]       = useState(sv('risk_coef', '0.05'))
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<unknown>(null)
  const [note, setNote]       = useState<string | null>(null)

  const curTypes = typeIds ?? initialTypeIds
  const curInputs = inputs ?? initialInputs
  const linksTouched = typeIds !== null || inputs !== null

  const fields = { code, name, op_type: opType, order_no: order, setup_required: setup ? '1' : '0', t_norm: tNorm, t_opt: tOpt, t_pess: tPess, cost, risk_coef: risk }
  const [initial] = useState(() => ({ ...fields }))
  const dirty = linksTouched || Object.keys(changedFields(fields, initial)).length > 0

  const linkPayload = () => {
    const names = curTypes.map((id) => wcTypes.find((t) => t.id === id)?.name).filter((x): x is string => Boolean(x))
    const rows = curInputs.filter((x) => x.product_id)
    return {
      wc_types: names.join(', '),
      wc_type_ids: curTypes,
      input_products: rows.map((x) => ({ product_id: x.product_id, qty: Number(x.qty) || 1 })),
      // Зеркало входов в записи: в следующий раз их увидят форма и конструктор техкарт.
      inputs: JSON.stringify(rows.map((x) => {
        const p = products.find((pp) => pp.id === x.product_id)
        return { productId: x.product_id, name: p?.name ?? x.product_id, qty: Number(x.qty) || 1, unit: p?.unit || 'шт' }
      })),
    }
  }

  const validate = (): string | null => {
    if (!name.trim()) return 'Укажите наименование операции'
    const [a, m, b] = [Number(tOpt), Number(tNorm), Number(tPess)]
    if (tOpt && tNorm && a > m) return 'Оптимистичное время не может быть больше нормы'
    if (tPess && tNorm && b < m) return 'Пессимистичное время не может быть меньше нормы'
    return null
  }

  const handleSubmit = async () => {
    setNote(null)
    const problem = validate()
    if (problem) { setError(problem); return }
    const changed = edit ? changedFields(fields, initial) : fields
    const body = linksTouched || !edit ? { ...changed, ...linkPayload() } : changed
    if (edit && Object.keys(body).length === 0) { setNote(NO_CHANGES); return }
    setLoading(true)
    setError(null)
    try {
      if (edit) await api.operations.update(edit.id, body)
      else await api.operations.create({ ...body, name })
      onSuccess(edit ? `Сохранено: ${name}` : `Создано: ${name}`)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }
  useFormBridge(bridge, () => void handleSubmit(), dirty, loading)

  const groups = useMemo(() => {
    const g = new Map<string, typeof wcTypes>()
    for (const t of wcTypes) {
      const key = shopShort(t.group_name) || 'Прочие'
      g.set(key, [...(g.get(key) ?? []), t])
    }
    return [...g.entries()]
  }, [wcTypes])
  const setRow = (i: number, patch: Partial<InputRow>) => setInputs(curInputs.map((x, k) => (k === i ? { ...x, ...patch } : x)))

  return (
    <div className="form">
      <FormError error={error} />
      <FormNote text={note} />

      <label className="form__field">
        <span className="form__label">Наименование *</span>
        <input className="form__input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Токарная обработка вала" />
      </label>
      <div className="form__row">
        <label className="form__field">
          <span className="form__label">Тип операции</span>
          <select className="form__select" value={opType} onChange={(e) => setOpType(e.target.value)}>
            <option value="">— не задан —</option>
            {Object.entries(OP_TYPE_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <label className="form__field">
          <span className="form__label">Код · шаг</span>
          <span className="nsi-pair">
            <input className="form__input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="OP-020" aria-label="Код операции" />
            <input className="form__input" type="number" min="1" step="10" value={order} onChange={(e) => setOrder(e.target.value)} aria-label="Шаг в маршруте" />
          </span>
        </label>
      </div>

      <div className="form__section">Оборудование и входы</div>
      {linksKnown ? (
        <>
          <div className="form__field">
            <span className="form__label">Допустимые типы оборудования</span>
            <ul className="nsi-tags">
              {curTypes.map((id) => (
                <li key={id} className="nsi-tag">
                  <span className="nsi-tag__t">{wcTypes.find((t) => t.id === id)?.name ?? id}</span>
                  <button type="button" className="nsi-tag__x" aria-label="Убрать тип" onClick={() => setTypeIds(curTypes.filter((x) => x !== id))}><Icon name="close" size={12} /></button>
                </li>
              ))}
              {curTypes.length === 0 && <li className="form__hint">не заданы — операцию не на чем выполнять</li>}
            </ul>
            <select className="form__select" value="" aria-label="Добавить тип оборудования"
                    onChange={(e) => { if (e.target.value) setTypeIds([...curTypes, e.target.value]) }}>
              <option value="">+ добавить тип…</option>
              {groups.map(([g, ts]) => (
                <optgroup key={g} label={g}>
                  {ts.filter((t) => !curTypes.includes(t.id)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="form__field">
            <span className="form__label">Входные изделия</span>
            {curInputs.map((x, i) => (
              <div key={i} className="form__inputs-row">
                <select className="form__select form__select--grow" value={x.product_id} aria-label="Изделие" onChange={(e) => setRow(i, { product_id: e.target.value })}>
                  <option value="">— изделие —</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
                </select>
                <input className="form__input form__input--qty" type="number" min="0" step="0.001" value={x.qty} aria-label="Количество"
                       onChange={(e) => setRow(i, { qty: e.target.value })} />
                <button type="button" className="btn btn--ghost btn--icon" aria-label="Убрать вход" onClick={() => setInputs(curInputs.filter((_, k) => k !== i))}>
                  <Icon name="close" size={14} />
                </button>
              </div>
            ))}
            <button type="button" className="btn btn--sm form__add" onClick={() => setInputs([...curInputs, { product_id: '', qty: '1' }])}>+ Добавить вход</button>
          </div>
        </>
      ) : (
        <div className="nsi-readonly" role="note">
          <p><span className="form__label">Типы оборудования</span> {sv('wc_types') || '—'}</p>
          <p className="form__hint">
            Связи этой операции (станки и входы) хранятся на сервере и сюда не загружаются — чтобы не стереть их,
            здесь они не редактируются. Название, время и остальные поля сохраняются, связи не меняются.
          </p>
        </div>
      )}

      <div className="form__section">Время, мин (PERT)</div>
      <div className="form__row form__row--3">
        <label className="form__field">
          <span className="form__label">Норма</span>
          <input className="form__input" type="number" min="0" value={tNorm} onChange={(e) => setTNorm(e.target.value)} placeholder="60" />
        </label>
        <label className="form__field">
          <span className="form__label">Оптимист.</span>
          <input className="form__input" type="number" min="0" value={tOpt} onChange={(e) => setTOpt(e.target.value)} placeholder="45" />
        </label>
        <label className="form__field">
          <span className="form__label">Пессимист.</span>
          <input className="form__input" type="number" min="0" value={tPess} onChange={(e) => setTPess(e.target.value)} placeholder="90" />
        </label>
      </div>
      {edit && Number(sv('setup_time')) > 0 && (
        <p className="form__hint">Наладка {fmtValue(Number(sv('setup_time')), 'мин')} — задаётся при загрузке НСИ, здесь не редактируется.</p>
      )}
      <label className="form__check">
        <input type="checkbox" checked={setup} onChange={(e) => setSetup(e.target.checked)} />
        Требует наладки оборудования
      </label>

      <div className="form__row">
        <label className="form__field">
          <span className="form__label">Стоимость, ₽</span>
          <input className="form__input" type="number" min="0" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="не задана" />
        </label>
        <label className="form__field">
          <span className="form__label">Коэф. риска (0–1)</span>
          <input className="form__input" type="number" min="0" max="1" step="0.01" value={risk} onChange={(e) => setRisk(e.target.value)} />
        </label>
      </div>
    </div>
  )
}
