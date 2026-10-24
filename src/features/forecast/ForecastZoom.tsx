/**
 * Развёрнутый веер ряда — выезжающая справа панель (SidePanel кита поверх экрана, таблица остаётся
 * видна): крупный веер с пунктиром «база НСИ», Δ от «сейчас», качество словами, подобранное
 * распределение, вклад факторов и значения по месяцам. Esc закрывает и возвращает фокус на строку.
 * Распределение цены правится только в «Сценарии › Распределения» (ссылка), не здесь.
 */
import type { ForecastProduct } from '../../lib/api'
import { signed } from '../../explain/format'
import { ErrorBoundary } from '../../shell/ErrorBoundary'
import { BarList, type BarRow } from '../../ui/charts'
import { InfoTip } from '../../ui/InfoTip'
import { SidePanel } from '../../ui/kit'
import { ForecastFan } from './ForecastGrid'
import { aicTitle, fitText, fmtFor, forecastDelta, monthLabel } from './forecastModel'
import './forecast.css'

interface ZoomProps {
  p: ForecastProduct
  /** Сценарий, по которому построен веер — для ссылки «править распределение». */
  scenarioId?: string | null
  synthetic?: boolean
  onClose: () => void
}

export function ForecastZoom({ p, scenarioId, synthetic = false, onClose }: ZoomProps) {
  return (
    <div className="fz" role="presentation">
      <ErrorBoundary variant="panel" label={p.name} onClose={onClose} message="Веер не открылся — закройте панель или повторите.">
        <SidePanel className="fz__panel" title={p.name} onClose={onClose}>
          <ZoomBody p={p} scenarioId={scenarioId} synthetic={synthetic} />
        </SidePanel>
      </ErrorBoundary>
    </div>
  )
}

function ZoomBody({ p, scenarioId, synthetic }: { p: ForecastProduct; scenarioId?: string | null; synthetic: boolean }) {
  const fmt = fmtFor(p)
  const d = forecastDelta(p)
  const n = p.p50.length
  return (
    <div className="fz__body">
      <ForecastFan p={p} height={240} showLegend caveat={synthetic ? 'История цен демонстрационная — веер ориентировочный.' : undefined} />
      <dl className="fz__facts">
        {d && <><dt>Медиана</dt><dd className="num">{d.label}</dd></>}
        {p.fit?.data_driven && (
          <><dt>Остатки</dt><dd title={aicTitle(p.fit)}>{fitText(p.fit)} <InfoTip id="forecast.aic" /></dd></>
        )}
      </dl>
      {p.contrib && <Contrib c={p.contrib} />}
      {scenarioId && p.role !== 'rate' && (
        <a className="pf-link" href={`#/scenarios/${encodeURIComponent(scenarioId)}/distributions`}>Править распределение цены → Сценарии › Распределения</a>
      )}
      <table className="dk-table dk-table--tight fz__vtable">
        <caption className="dk-vh">{p.name}: квантили по месяцам</caption>
        <thead><tr><th scope="col">Месяц</th><th scope="col" className="num">P10</th><th scope="col" className="num">Медиана</th><th scope="col" className="num">P90</th><th scope="col" className="num">Тренд</th></tr></thead>
        <tbody>
          {Array.from({ length: n }, (_, t) => (
            <tr key={t}>
              <th scope="row">{monthLabel(t)}</th>
              <td className="num">{fmt(p.p10[t])}</td>
              <td className="num"><b>{fmt(p.p50[t])}</b></td>
              <td className="num">{fmt(p.p90[t])}</td>
              <td className="num fz__trend">{p.trend ? fmt(p.trend[t]) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Вклад факторов к горизонту: двуполярные бары от нуля; знак несёт подпись, не цвет. */
function Contrib({ c }: { c: NonNullable<ForecastProduct['contrib']> }) {
  const rows: BarRow[] = [
    { key: 'hist', label: 'История ряда', value: c.hist_trend, secondary: 'тренд цены' },
    { key: 'infl', label: 'Инфляция', value: c.inflation, secondary: 'накопленная за горизонт' },
    { key: 'fx', label: 'Курс', value: c.fx, secondary: 'валютный множитель' },
    { key: 'demand', label: 'Спрос', value: c.demand, secondary: 'множитель спроса' },
  ].filter((x) => Math.abs(x.value) > 0.0005)
  if (rows.length === 0) return null
  return (
    <div className="fz__contrib">
      <BarList rows={rows} bipolar fmt={(v) => signed(v, '%')} valueHeader="Вклад" compact
        title={<>Что двигает медиану · итог <b className="num">{signed(c.total, '%')}</b> <InfoTip id="forecast.factors" values={{ hist: c.hist_trend, inflation: c.inflation, risk: c.risk_drift, macro: c.macro, fx: c.fx, demand: c.demand, total: c.total }} /></>}
        subtitle="Вправо — вверх, влево — вниз; множители перемножаются." />
    </div>
  )
}
