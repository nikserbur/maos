import { useState, useEffect } from 'react'
import { api } from '../../../lib/api'
import { useWorkCenterTypes, useProducts } from '../useNsi'
import type { EditCtx } from '../CreateDialog'

interface Props {
  onSuccess: () => void
  edit?: EditCtx
}

export function OperationForm({ onSuccess, edit }: Props) {
  const wcTypes  = useWorkCenterTypes()
  const products = useProducts()
  const r = edit?.row ?? {}
  const sv = (k: string, d = '') => (r[k] == null ? d : String(r[k]))

  const [code, setCode]       = useState(sv('code'))
  const [name, setName]       = useState(sv('name'))
  const [opType, setOpType]   = useState(sv('op_type'))
  // Связи по ID (не по имени): типы оборудования (множ.) и входные изделия (таблица).
  const [wcTypeIds, setWcTypeIds] = useState<string[]>([])
  const [inputRows, setInputRows] = useState<Array<{ product_id: string; qty: string }>>([])
  const [order, setOrder]     = useState(sv('order_no', '10'))
  const [setup, setSetup]     = useState(sv('setup_required') === '1')
  const [tNorm, setTNorm]     = useState(sv('t_norm'))
  const [tOpt, setTOpt]       = useState(sv('t_opt'))
  const [tPess, setTPess]     = useState(sv('t_pess'))
  const [cost, setCost]       = useState(sv('cost'))
  const [risk, setRisk]       = useState(sv('risk_coef', '0.05'))
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  // При редактировании: предвыбор типов оборудования по именам из wc_types (когда типы загрузятся).
  useEffect(() => {
    if (!edit) return
    const names = sv('wc_types').split(',').map((s) => s.trim()).filter(Boolean)
    if (names.length && wcTypes.length) setWcTypeIds(wcTypes.filter((t) => names.includes(t.name)).map((t) => t.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wcTypes.length])

  const toggleWcType = (id: string) =>
    setWcTypeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  const addInput    = () => setInputRows((p) => [...p, { product_id: '', qty: '1' }])
  const setInput    = (i: number, patch: Partial<{ product_id: string; qty: string }>) =>
    setInputRows((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const delInput    = (i: number) => setInputRows((p) => p.filter((_, idx) => idx !== i))

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Укажите наименование операции'); return }
    setLoading(true)
    setError(null)
    try {
      // Дублируем имена типов в wc_types (для совместимости отображения),
      // но истинная связь — по ID через wc_type_ids / input_products.
      const wcNames = wcTypeIds
        .map((id) => wcTypes.find((t) => t.id === id)?.name)
        .filter(Boolean)
        .join(',')
      const payload = {
        code, name, op_type: opType,
        wc_types: wcNames,
        wc_type_ids: wcTypeIds,
        input_products: inputRows
          .filter((row) => row.product_id)
          .map((row) => ({ product_id: row.product_id, qty: Number(row.qty) || 1 })),
        order_no: order,
        setup_required: setup ? '1' : '0',
        t_norm: tNorm, t_opt: tOpt, t_pess: tPess,
        cost, risk_coef: risk,
        controls: '', mechanisms: '', outputs: '',
      }
      if (edit) await api.operations.update(edit.id, payload)
      else await api.operations.create(payload)
      onSuccess()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="form">
      {error && <div className="form__error">{error}</div>}

      <div className="form__section">Идентификация</div>
      <div className="form__row">
        <div className="form__field">
          <label className="form__label">Код операции</label>
          <input className="form__input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="OP-020" />
        </div>
        <div className="form__field">
          <label className="form__label">Тип операции</label>
          <select className="form__select" value={opType} onChange={(e) => setOpType(e.target.value)}>
            <option value="">— выберите —</option>
            <option value="machining">Механообработка</option>
            <option value="welding">Сварка</option>
            <option value="assembly">Сборка</option>
            <option value="coating">Покрытие</option>
            <option value="heat">Термообработка</option>
            <option value="control">Контроль качества</option>
            <option value="transport">Транспортировка</option>
          </select>
        </div>
      </div>

      <div className="form__field">
        <label className="form__label">Наименование операции *</label>
        <input className="form__input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Токарная обработка вала" />
      </div>

      <div className="form__row">
        <div className="form__field">
          <label className="form__label">Допустимые типы оборудования (связь по ID)</label>
          {wcTypes.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.25rem' }}>
              {wcTypes.map((t) => (
                <label key={t.id} className="form__check" style={{ margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={wcTypeIds.includes(t.id)}
                    onChange={() => toggleWcType(t.id)}
                  />
                  {t.name}
                </label>
              ))}
            </div>
          ) : (
            <span className="form__hint">Нет типов оборудования — создайте их в реестре.</span>
          )}
        </div>
        <div className="form__field">
          <label className="form__label">Порядок в маршруте (шаг)</label>
          <input className="form__input" type="number" min="1" step="10" value={order} onChange={(e) => setOrder(e.target.value)} />
        </div>
      </div>

      <div className="form__section">Нормирование (PERT)</div>
      <div className="form__row form__row--3">
        <div className="form__field">
          <label className="form__label">Норм. время, мин</label>
          <input className="form__input" type="number" min="0" value={tNorm} onChange={(e) => setTNorm(e.target.value)} placeholder="60" />
        </div>
        <div className="form__field">
          <label className="form__label">Опт. время, мин</label>
          <input className="form__input" type="number" min="0" value={tOpt} onChange={(e) => setTOpt(e.target.value)} placeholder="45" />
        </div>
        <div className="form__field">
          <label className="form__label">Пессим. время, мин</label>
          <input className="form__input" type="number" min="0" value={tPess} onChange={(e) => setTPess(e.target.value)} placeholder="90" />
        </div>
      </div>

      <div className="form__row">
        <div className="form__field">
          <label className="form__label">Стоимость, ₽</label>
          <input className="form__input" type="number" min="0" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="1200" />
        </div>
        <div className="form__field">
          <label className="form__label">Коэф. риска (0–1)</label>
          <input className="form__input" type="number" min="0" max="1" step="0.01" value={risk} onChange={(e) => setRisk(e.target.value)} />
        </div>
      </div>

      <div className="form__field">
        <label className="form__label">Входные изделия (таблица — может быть несколько)</label>
        {products.length === 0 ? (
          <span className="form__hint">Нет изделий — создайте их в реестре «Изделия».</span>
        ) : (
          <>
            {inputRows.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 4, alignItems: 'center' }}>
                <select className="form__select" style={{ flex: 1 }} value={r.product_id}
                        onChange={(e) => setInput(i, { product_id: e.target.value })}>
                  <option value="">— изделие —</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
                </select>
                <input className="form__input" type="number" min="0" step="0.001" style={{ width: 90 }}
                       value={r.qty} onChange={(e) => setInput(i, { qty: e.target.value })} placeholder="кол-во" />
                <button type="button" className="btn btn--danger" style={{ height: 28, padding: '0 8px' }}
                        onClick={() => delInput(i)}>✕</button>
              </div>
            ))}
            <button type="button" className="btn" style={{ marginTop: 2 }} onClick={addInput}>+ Добавить вход</button>
          </>
        )}
        <span className="form__hint">Изделия и их количество, потребляемые операцией (для расчёта себестоимости).</span>
      </div>

      <label className="form__check">
        <input type="checkbox" checked={setup} onChange={(e) => setSetup(e.target.checked)} />
        Требует наладки оборудования перед выполнением
      </label>

      <div className="form__actions">
        <button className="btn btn--primary" onClick={handleSubmit} disabled={loading}>
          {loading ? 'Сохраняем…' : 'Создать'}
        </button>
      </div>
    </div>
  )
}
