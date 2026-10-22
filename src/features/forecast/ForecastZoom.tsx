/**
 * Развёрнутый веер Мониторинга: крупный `FanChart`, вклад факторов (`BarList`, двуполярный),
 * настройка базовой цены и распределения (только здесь), таблица значений по месяцам.
 */
import { useState } from 'react'
import type { ForecastProduct, PriceDistribution, DistType } from '../../lib/api'
import { FanChart } from '../../ui/FanChart'
import { BarList, type BarRow } from '../../ui/charts'
import { Icon } from '../../shell/icons'
import { pct, signed } from '../../explain/format'
import { fmtFor, qualityOf } from './ForecastScreen'

interface ZoomProps {
  p: ForecastProduct
  onOverride?: (productId: string, price: string) => void
  onSetDist?: (productId: string, patch: Partial<PriceDistribution>) => void
  dist?: PriceDistribution
  onClose: () => void
}

export function ForecastZoom({ p, onOverride, onSetDist, dist, onClose }: ZoomProps) {
  const fmtVal = fmtFor(p)
  const N = p.p50.length
  // Настройку РАСПРЕДЕЛЕНИЯ включаем и для СЫРЬЯ (закупочные цены) — backend уже
  // применяет price_distributions к любому product_id. Оверрайд базовой цены пока
  // только для товарной продукции (raw-оверрайд идёт в base_cost — отдельная ветка).
  const canEdit = !!onOverride && p.role === 'product'
  const canDist = !!onSetDist && (p.role === 'product' || p.role === 'raw')
  const distRel = (() => {
    const sd = Number(dist?.stddev)
    return sd > 0 && p.base > 0 ? sd / p.base : 0.12
  })()
  const [base, setBase] = useState(String(Math.round(p.base)))
  const apply = () => { if (onOverride && base) { onOverride(p.id, base); onClose() } }
  return (
    <div className="forecast__modal" onClick={onClose}>
      <div className="forecast__modal-box" role="dialog" aria-modal="true" aria-label={`${p.name} — прогноз по месяцам`} onClick={(e) => e.stopPropagation()}>
        <div className="forecast__modal-head">
          <b>{p.name} — прогноз по месяцам</b>
          <button type="button" className="btn btn--ghost" onClick={onClose}><Icon name="close" size={14} /> Закрыть</button>
        </div>
        <div className="forecast__modal-chart">
          <FanChart a={p} fmt={fmtVal} quality={qualityOf(p)} height={240} />
        </div>
        {p.contrib && <Contrib c={p.contrib} />}
        {canEdit && (
          <div className="forecast__ovr">
            <span className="forecast__ovr-l">Настройка — базовая цена (ввод данных):</span>
            <input type="number" value={base} onChange={(e) => setBase(e.target.value)}
                   onKeyDown={(e) => e.key === 'Enter' && apply()} />
            <button className="btn btn--primary" disabled={!base} onClick={apply}>Применить и пересчитать</button>
            <button className="btn" onClick={() => { onOverride!(p.id, ''); onClose() }}>Сброс</button>
          </div>
        )}
        {canDist && (
          <div className="forecast__ovr forecast__distrow">
            <span className="forecast__ovr-l">Распределение цены (форма стохастики):</span>
            <select value={dist?.dist_type ?? 'normal'} onChange={(e) => onSetDist!(p.id, { dist_type: e.target.value as DistType })}>
              <option value="normal">нормаль</option>
              <option value="t">Стьюдент (тяж. хвосты)</option>
              <option value="pareto">Парето (скачки/обвалы)</option>
              <option value="lognormal">логнормаль</option>
              <option value="uniform">равномерное</option>
              <option value="triangular">треугольное</option>
            </select>
            <label className="forecast__distf">СКО
              <input type="number" value={dist?.stddev ?? ''} placeholder={String(Math.round(p.base * 0.12))}
                     onChange={(e) => onSetDist!(p.id, { stddev: e.target.value })} />
            </label>
            <label className="forecast__distf">мин
              <input type="number" value={dist?.min_val ?? ''} placeholder="—" onChange={(e) => onSetDist!(p.id, { min_val: e.target.value })} />
            </label>
            <label className="forecast__distf">макс
              <input type="number" value={dist?.max_val ?? ''} placeholder="—" onChange={(e) => onSetDist!(p.id, { max_val: e.target.value })} />
            </label>
            <div className="forecast__distprev">
              <span className="forecast__dist-note">форма плотности:</span>
              <DistPreview type={(dist?.dist_type ?? 'normal') as DistType} rel={distRel} />
            </div>
            <span className="forecast__dist-note">центр = базовая цена выше · волатильность сценария масштабирует · затем «Применить и пересчитать»</span>
          </div>
        )}
        <table className="forecast__vtable">
          <thead><tr><th scope="col">Мес</th><th scope="col">P10</th><th scope="col">Медиана (P50)</th><th scope="col">P90</th><th scope="col">Тренд</th></tr></thead>
          <tbody>
            {canEdit && (
              <tr className="forecast__vrow-base">
                <th scope="row">База</th><td>—</td>
                <td><input className="forecast__vedit" type="number" value={base} aria-label="Базовая цена"
                           onChange={(e) => setBase(e.target.value)}
                           onKeyDown={(e) => e.key === 'Enter' && apply()} /></td>
                <td>—</td><td>—</td>
              </tr>
            )}
            {Array.from({ length: N }, (_, t) => (
              <tr key={t}>
                <th scope="row">+{t}</th>
                <td>{fmtVal(p.p10[t])}</td>
                <td><b>{fmtVal(p.p50[t])}</b></td>
                <td>{fmtVal(p.p90[t])}</td>
                <td className="forecast__vtrend">{p.trend ? fmtVal(p.trend[t]) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Вклад факторов в прогноз (к горизонту): двуполярные бары от нуля; знак несёт подпись, не цвет. */
function Contrib({ c }: { c: NonNullable<ForecastProduct['contrib']> }) {
  const rows: BarRow[] = [
    { key: 'hist', label: 'История ряда', value: c.hist_trend, secondary: 'тренд цены (МНК по логарифму)' },
    { key: 'infl', label: 'Инфляция', value: c.inflation, secondary: 'накопленная за горизонт' },
    { key: 'risk', label: 'Санкции/ставка', value: c.risk_drift, secondary: 'риск-дрейф' },
    { key: 'fx', label: 'Курс', value: c.fx, secondary: 'валютный множитель' },
    { key: 'demand', label: 'Спрос', value: c.demand, secondary: 'множитель спроса' },
    { key: 'macro', label: 'Энергия/логистика', value: c.macro, secondary: 'cost-push' },
  ].filter((x) => Math.abs(x.value) > 0.0005)
  return (
    <div className="forecast__contrib">
      <BarList rows={rows} bipolar fmt={(v) => signed(v, '%')} valueHeader="Вклад"
        title={<>Вклад факторов в прогноз (к горизонту) · итог <b className="num">{signed(c.total, '%')}</b></>}
        subtitle="Вправо — толкает цену вверх, влево — вниз; множители комбинируются мультипликативно." compact />
    </div>
  )
}

/** Мини-предпросмотр плотности выбранного распределения (форма хвостов). */
function DistPreview({ type, rel }: { type: DistType; rel: number }) {
  const W = 150, H = 46
  const s = Math.max(0.05, Math.min(0.6, rel))
  const pdf = (x: number): number => {
    switch (type) {
      case 't':        return Math.pow(1 + (x * x) / (5 * s * s), -3)          // ν=5, тяжёлые хвосты
      case 'pareto':   return Math.exp(-Math.abs(x) / (s * 2.2))               // резкие хвосты
      case 'uniform':  return Math.abs(x) < 1.7 * s ? 1 : 0.02
      case 'triangular': return Math.max(0.02, 1 - Math.abs(x) / (2 * s))
      case 'lognormal': { const y = x + 2.2 * s; return y > 0 ? Math.exp(-Math.pow(Math.log(y / (2.2 * s)), 2) / (2 * s * s)) / y : 0 }
      default:         return Math.exp(-(x * x) / (2 * s * s))                 // normal
    }
  }
  const xs = Array.from({ length: 61 }, (_, i) => (i / 60 - 0.5) * 2.4)
  const ys = xs.map(pdf)
  const my = Math.max(...ys) || 1
  const pts = xs.map((x, i) => `${(x / 2.4 + 0.5) * W},${H - 3 - (ys[i] / my) * (H - 8)}`).join(' ')
  return (
    <svg className="forecast__distsvg" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img"
      aria-label={`Плотность: ${type}, относительное СКО ${pct(rel, 0)}`}>
      <polyline points={pts} fill="none" stroke="var(--chart-1)" strokeWidth={1.6} />
      <line x1={W / 2} y1={2} x2={W / 2} y2={H - 3} stroke="var(--chart-axis)" strokeWidth={1} />
    </svg>
  )
}

