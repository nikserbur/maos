import { useEffect, useState } from 'react'
import {
  api,
  type PriceScenario, type PriceDistribution, type Product, type DistType,
} from '../../lib/api'
import './scenarios.css'

const DIST_TYPES: Array<{ id: DistType; label: string }> = [
  { id: 'normal',     label: 'Нормальное' },
  { id: 'lognormal',  label: 'Логнормальное' },
  { id: 'triangular', label: 'Треугольное' },
  { id: 'uniform',    label: 'Равномерное' },
]

const numStr = (v: number | string | undefined) => (v === undefined || v === null ? '' : String(v))

export function ScenariosScreen() {
  const [scenarios, setScenarios] = useState<PriceScenario[]>([])
  const [products, setProducts]   = useState<Product[]>([])
  const [activeId, setActiveId]   = useState<string>('')
  const [draft, setDraft]         = useState<PriceScenario | null>(null)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState<string | null>(null)

  const sellable = products.filter((p) => p.sellable === '1' || p.sellable === 'true')

  const loadList = async () => {
    const [sc, pr] = await Promise.all([
      api.scenarios.list().catch(() => [] as PriceScenario[]),
      api.products.list().catch(() => [] as Product[]),
    ])
    setScenarios(sc)
    setProducts(pr)
    if (sc.length && !activeId) setActiveId(sc[0].id)
  }
  useEffect(() => { loadList() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Загрузить выбранный сценарий c распределениями в черновик.
  useEffect(() => {
    if (!activeId) { setDraft(null); return }
    api.scenarios.get(activeId).then((s) => setDraft(s)).catch(() => setDraft(null))
  }, [activeId])

  /** Гарантировать строку распределения для каждого товарного изделия. */
  const distFor = (productId: string): PriceDistribution => {
    const found = draft?.distributions?.find((d) => d.product_id === productId)
    if (found) return found
    const p = products.find((x) => x.id === productId)
    const base = Number(p?.base_price || 0)
    return { product_id: productId, dist_type: 'normal', mean: base, stddev: Math.round(base * 0.12) }
  }

  const setDist = (productId: string, patch: Partial<PriceDistribution>) => {
    setDraft((prev) => {
      if (!prev) return prev
      const rows = sellable.map((p) => {
        const cur = (p.id === productId) ? { ...distFor(p.id), ...patch } : distFor(p.id)
        return cur
      })
      return { ...prev, distributions: rows }
    })
  }

  const createScenario = async () => {
    try {
      const created = await api.scenarios.create({
        name: 'Новый сценарий', description: '',
        distributions: sellable.map((p) => ({
          product_id: p.id, dist_type: 'normal',
          mean: Number(p.base_price || 0), stddev: Math.round(Number(p.base_price || 0) * 0.12),
        })),
      })
      await loadList()
      setActiveId(created.id)
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка создания') }
  }

  const save = async () => {
    if (!draft) return
    const rows = sellable.map((p) => distFor(p.id))
    // Пустая/нулевая средняя цена молча обнулила бы продукт в оптимизации —
    // валидируем до сохранения.
    const bad = rows.find((d) => !(Number(d.mean) > 0))
    if (bad) {
      const p = products.find((x) => x.id === bad.product_id)
      setError(`Укажите среднюю цену (> 0) для «${p?.name ?? bad.product_id}».`)
      return
    }
    setSaving(true); setError(null)
    try {
      await api.scenarios.update(draft.id, {
        name: draft.name, description: draft.description,
        horizon_hours: Number(draft.horizon_hours) || 720,
        distributions: rows,
      })
      await loadList()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally { setSaving(false) }
  }

  const remove = async (id: string) => {
    await api.scenarios.delete(id).catch(() => {})
    setActiveId('')
    await loadList()
  }

  return (
    <div className="scn">
      <div className="scn__list">
        <div className="scn__list-head">
          <span className="scn__list-title">Сценарии</span>
          <button className="btn btn--primary" style={{ height: 24, padding: '0 8px' }} onClick={createScenario}>
            + Новый
          </button>
        </div>
        {scenarios.map((s) => (
          <button key={s.id}
            className={`scn__item${s.id === activeId ? ' scn__item--active' : ''}`}
            onClick={() => setActiveId(s.id)}>
            <div className="scn__item-name">{s.name}</div>
            {s.description && <div className="scn__item-desc">{s.description}</div>}
          </button>
        ))}
        {scenarios.length === 0 && <div className="scn__empty">Сценариев пока нет.</div>}
      </div>

      <div className="scn__editor">
        {!draft ? (
          <div className="scn__empty">Выберите или создайте сценарий внешних условий.</div>
        ) : (
          <>
            <div className="scn__editor-head">
              <div style={{ flex: 1 }}>
                <input className="scn__name-input" value={draft.name}
                       onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
              <div className="scn__actions">
                <button className="btn btn--primary" onClick={save} disabled={saving}>
                  {saving ? 'Сохраняем…' : 'Сохранить'}
                </button>
                <button className="btn btn--danger" onClick={() => remove(draft.id)}>Удалить</button>
              </div>
            </div>

            <input className="scn__desc-input" placeholder="Описание сценария (например, рыночные условия)"
                   value={draft.description || ''}
                   onChange={(e) => setDraft({ ...draft, description: e.target.value })} />

            <p className="scn__hint">
              Цена реализации товарной продукции — стохастическое внешнее условие. Задайте распределение
              для каждого изделия: оптимизатор сэмплирует цены и ищет устойчивый портфель.
            </p>

            {sellable.length === 0 ? (
              <div className="scn__empty">
                Нет товарных изделий. Отметьте изделия как «товарные» и задайте цену в реестре «Изделия».
              </div>
            ) : (
              <table className="scn__table">
                <thead>
                  <tr>
                    <th>Изделие</th><th>Распределение</th><th>Средняя цена, ₽</th>
                    <th>СКО (σ), ₽</th><th>Мин</th><th>Макс</th><th>CV</th>
                  </tr>
                </thead>
                <tbody>
                  {sellable.map((p) => {
                    const d = distFor(p.id)
                    const mean = Number(d.mean) || 0
                    const sd = Number(d.stddev) || 0
                    const cv = mean > 0 ? sd / mean : 0
                    const needsMinMax = d.dist_type === 'uniform' || d.dist_type === 'triangular'
                    return (
                      <tr key={p.id}>
                        <td className="scn__prod">{p.name}<small>{p.code}</small></td>
                        <td>
                          <select className="scn__cell-select" value={d.dist_type}
                                  onChange={(e) => setDist(p.id, { dist_type: e.target.value as DistType })}>
                            {DIST_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                          </select>
                        </td>
                        <td>
                          <input className="scn__cell-input" type="number" value={numStr(d.mean)}
                                 onChange={(e) => setDist(p.id, { mean: e.target.value })} />
                        </td>
                        <td>
                          <input className="scn__cell-input" type="number" value={numStr(d.stddev)}
                                 onChange={(e) => setDist(p.id, { stddev: e.target.value })} />
                        </td>
                        <td>
                          <input className="scn__cell-input" type="number" value={numStr(d.min_val)}
                                 placeholder={needsMinMax ? '' : 'авто'}
                                 onChange={(e) => setDist(p.id, { min_val: e.target.value })} />
                        </td>
                        <td>
                          <input className="scn__cell-input" type="number" value={numStr(d.max_val)}
                                 placeholder={needsMinMax ? '' : 'авто'}
                                 onChange={(e) => setDist(p.id, { max_val: e.target.value })} />
                        </td>
                        <td className={`scn__cv${cv > 0.2 ? ' scn__cv--high' : ''}`}>{(cv * 100).toFixed(0)}%</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </>
        )}
        {error && <div className="scn__hint" style={{ color: 'var(--intent-danger)' }}>{error}</div>}
      </div>
    </div>
  )
}
