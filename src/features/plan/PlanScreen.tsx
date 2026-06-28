import { useEffect, useState } from 'react'
import { api, type OptResult, type Product, type WorkCenterType } from '../../lib/api'
import '../optimization/optimization.css'

function money(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e9) return (v / 1e9).toFixed(2) + ' млрд ₽'
  if (a >= 1e6) return (v / 1e6).toFixed(1) + ' млн ₽'
  if (a >= 1e3) return (v / 1e3).toFixed(0) + ' тыс ₽'
  return v.toFixed(0) + ' ₽'
}
const pct = (v: number) => (v * 100).toFixed(1) + '%'

/**
 * Производственный план = устойчивый портфель последнего прогона оптимизации:
 * сколько каждого изделия выпускать и какая загрузка оборудования. План следует
 * из себестоимости при внешних условиях (см. экран «Оптимизация»).
 */
export function PlanScreen() {
  const [result, setResult] = useState<OptResult | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [wcTypes, setWcTypes] = useState<WorkCenterType[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.optimize.runs().catch(() => []),
      api.products.list().catch(() => [] as Product[]),
      api.workCenterTypes.list().catch(() => [] as WorkCenterType[]),
    ]).then(async ([runs, pr, wc]) => {
      setProducts(pr); setWcTypes(wc)
      if (runs.length) {
        try { setResult(await api.optimize.run_get(runs[0].id)) } catch { /* ignore */ }
      }
      setLoading(false)
    })
  }, [])

  const nameOf = (id: string) =>
    products.find((p) => p.id === id)?.name ?? wcTypes.find((t) => t.id === id)?.name ?? id

  if (loading) return <div className="opt"><div className="opt__empty">Загрузка плана…</div></div>

  if (!result || result.error_soft) {
    return (
      <div className="opt">
        <h1 className="opt__title">Производственный план</h1>
        <div className="opt__empty">
          Плана пока нет. Перейдите в «Оптимизация» и запустите моделирование —
          устойчивый портфель станет производственным планом.
        </div>
      </div>
    )
  }

  const pf = result.robust
  return (
    <div className="opt">
      <div className="opt__head">
        <div>
          <h1 className="opt__title">Производственный план</h1>
          <p className="opt__subtitle">
            Устойчивый портфель сценария «{result.scenario_name}» (критерий {result.objective.toUpperCase()}).
            Ожидаемая прибыль {money(pf.metrics.expected)} · риск убытка {pct(pf.metrics.p_loss)}.
          </p>
        </div>
      </div>

      <div className="opt__grid2">
        <div className="opt__section">
          <p className="opt__section-title">Производственная программа</p>
          <div className="opt__panel">
            <div className="pf-items">
              {pf.items.map((it) => (
                <div className="pf-item" key={it.product_id}>
                  <span>{nameOf(it.product_id)}</span>
                  <span className="pf-item__qty">{it.qty.toLocaleString('ru')} ед</span>
                  <span className="pf-item__contrib">маржа {money(it.contribution)}</span>
                </div>
              ))}
              {pf.items.length === 0 && <span className="pf-card__hint">Портфель пуст.</span>}
            </div>
          </div>
        </div>
        <div className="opt__section">
          <p className="opt__section-title">Загрузка оборудования</p>
          <div className="opt__panel">
            {[...pf.resource_load].sort((a, b) => b.utilization - a.utilization).map((l) => {
              const u = Math.min(1, l.utilization)
              const cls = u >= 0.98 ? ' load-bar__fill--full' : u >= 0.8 ? ' load-bar__fill--hot' : ''
              return (
                <div className="load-row" key={l.wc_type_id}>
                  <span className="load-row__name" title={nameOf(l.wc_type_id)}>{nameOf(l.wc_type_id)}</span>
                  <span className="load-bar"><span className={`load-bar__fill${cls}`} style={{ width: `${u * 100}%` }} /></span>
                  <span className="load-row__pct">{pct(l.utilization)}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
