import { useEffect, useMemo, useState } from 'react'
import { api, type KpiBundle, type SimResults } from '../../lib/api'
import { KPI_CATALOG, KPI_CATEGORIES } from './kpiCatalog'
import { kpiParts, kpiText } from './kpiFormat'
import {
  loadDashboard, saveDashboard, SERIES_COLORS, TIMELINE_METRICS,
  type DashboardConfig, type ChartConfig, type ChartType, type AxisMode,
} from './dashboardConfig'
import { TimeChart, type ChartSeries } from './TimeChart'

const pctFmt = (v: number) => `${Math.round(v * 100)}%`
const roundFmt = (v: number) => Math.round(v).toLocaleString('ru')
const kpiDef = (code: string) => KPI_CATALOG.find((k) => k.code === code)
const shortDate = (s?: string) => (s || '').slice(5, 16).replace('T', ' ') || '—'

interface KpiDashboardProps {
  /** KPI-блок выбранного плана (для значений закреплённых карточек). */
  bundle: KpiBundle | null
  /** Результаты выбранного плана (для оси «внутри плана по часам»). */
  res: SimResults | null
}

/**
 * Настраиваемый дашборд «Аналитики»: закреплённые KPI-карточки (набор хранится в
 * БД проекта) + два конфигурируемых графика «во времени» (KPI по построениям плана
 * ИЛИ ряды загрузки/операторов внутри плана; тип — линия/область/столбики).
 */
export function KpiDashboard({ bundle, res }: KpiDashboardProps) {
  const [cfg, setCfg] = useState<DashboardConfig | null>(null)
  const [series, setSeries] = useState<KpiBundle[]>([])
  const [editPins, setEditPins] = useState(false)

  useEffect(() => { loadDashboard().then((r) => setCfg(r.config)) }, [])
  useEffect(() => { api.analytics.kpiSeries().then(setSeries).catch(() => setSeries([])) }, [bundle?.plan_id])

  // Значение закреплённого KPI: из выбранного плана, иначе из последнего в ряду.
  const valueBundle = bundle ?? (series.length ? series[series.length - 1] : null)

  const apply = (next: DashboardConfig) => { setCfg(next); void saveDashboard(next) }
  const setChart = (i: number, patch: Partial<ChartConfig>) => {
    if (!cfg) return
    const charts = cfg.charts.map((c, j) => (j === i ? { ...c, ...patch } : c)) as [ChartConfig, ChartConfig]
    apply({ ...cfg, charts })
  }
  const togglePin = (code: string) => {
    if (!cfg) return
    const has = cfg.pinned.includes(code)
    apply({ ...cfg, pinned: has ? cfg.pinned.filter((c) => c !== code) : [...cfg.pinned, code] })
  }
  // Клик по карточке KPI → показать его во времени в первом графике.
  const pinToChart = (code: string) => {
    if (!cfg) return
    setChart(0, { axis: 'plans', metrics: [code] })
  }

  if (!cfg) return <div className="an__panel"><p className="an__muted" style={{ margin: 0 }}>Загрузка дашборда…</p></div>

  return (
    <section className="an__dash">
      <div className="an__dash-head">
        <div>
          <p className="an__panel-t" style={{ margin: 0 }}>Закреплённые показатели</p>
          <p className="an__muted" style={{ margin: '2px 0 0', fontSize: 12 }}>
            Набор сохраняется в БД проекта. Клик по карточке — вывести KPI во времени в графике №1.
          </p>
        </div>
        <button className="btn" onClick={() => setEditPins((v) => !v)}>
          {editPins ? '✓ Готово' : '⚙ Настроить набор'}
        </button>
      </div>

      {editPins && <PinEditor pinned={cfg.pinned} onToggle={togglePin} />}

      <div className="an__pins">
        {cfg.pinned.length === 0 && <p className="an__muted" style={{ margin: 0 }}>Нет закреплённых KPI — нажмите «Настроить набор».</p>}
        {cfg.pinned.map((code) => {
          const def = kpiDef(code); if (!def) return null
          const v = valueBundle ? def.value(valueBundle) : NaN
          const st = valueBundle && def.status ? def.status(v, valueBundle) : ''
          return (
            <button key={code} className={`an__pin${st ? ` an__pin--${st}` : ''}`} onClick={() => pinToChart(code)} title="Показать во времени">
              <div className="an__pin-k">{def.name}
                <span className={`an__dir an__dir--${def.dir}`}>{def.dir === 'up' ? '↑' : def.dir === 'down' ? '↓' : '·'}</span>
              </div>
              <div className="an__pin-v">{kpiParts(v, def.unit).value}<small> {kpiParts(v, def.unit).unit}</small></div>
            </button>
          )
        })}
      </div>

      <div className="an__charts2">
        {cfg.charts.map((chart, i) => (
          <ChartPanel key={i} idx={i} chart={chart} series={series} res={res}
                      onChange={(patch) => setChart(i, patch)} />
        ))}
      </div>
    </section>
  )
}

/* ── Редактор набора закреплённых KPI (чипы по категориям) ──────────────────── */
function PinEditor({ pinned, onToggle }: { pinned: string[]; onToggle: (code: string) => void }) {
  return (
    <div className="an__pin-editor">
      {KPI_CATEGORIES.map((cat) => {
        const items = KPI_CATALOG.filter((k) => k.category === cat)
        if (!items.length) return null
        return (
          <div key={cat} className="an__pin-cat">
            <span className="an__pin-cat-t">{cat}</span>
            <div className="an__pin-chips">
              {items.map((k) => {
                const on = pinned.includes(k.code)
                return (
                  <button key={k.code} className={`an__chip${on ? ' an__chip--on' : ''}`} onClick={() => onToggle(k.code)}>
                    {on ? '✓ ' : '+ '}{k.name}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ── Панель одного настраиваемого графика ──────────────────────────────────── */
function ChartPanel({ idx, chart, series, res, onChange }: {
  idx: number; chart: ChartConfig; series: KpiBundle[]; res: SimResults | null
  onChange: (patch: Partial<ChartConfig>) => void
}) {
  const { labels, chartSeries } = useMemo(
    () => buildChartData(chart, series, res),
    [chart, series, res],
  )

  // Доступные для добавления метрики (в зависимости от оси).
  const available = chart.axis === 'plans'
    ? KPI_CATALOG.filter((k) => !chart.metrics.includes(k.code)).map((k) => ({ key: k.code, name: k.name }))
    : TIMELINE_METRICS.filter((m) => !chart.metrics.includes(m.key)).map((m) => ({ key: m.key, name: m.name }))

  const metricName = (key: string) =>
    chart.axis === 'plans' ? (kpiDef(key)?.name ?? key) : (TIMELINE_METRICS.find((m) => m.key === key)?.name ?? key)

  const setAxis = (axis: AxisMode) => {
    if (axis === chart.axis) return
    // При смене оси метрики несовместимы → берём разумный дефолт.
    onChange({ axis, metrics: axis === 'timeline' ? ['util'] : ['MAKESPAN'] })
  }
  const addMetric = (key: string) => { if (key) onChange({ metrics: [...chart.metrics, key] }) }
  const removeMetric = (key: string) =>
    onChange({ metrics: chart.metrics.length > 1 ? chart.metrics.filter((m) => m !== key) : chart.metrics })

  const TYPES: Array<{ t: ChartType; label: string }> = [
    { t: 'line', label: '📈 Линия' }, { t: 'area', label: '📉 Область' }, { t: 'bar', label: '📊 Столбики' },
  ]

  return (
    <div className="an__panel an__chart-panel">
      <div className="an__chart-toolbar">
        <span className="an__chart-title">График №{idx + 1}</span>
        <div className="an__seg">
          {(['plans', 'timeline'] as AxisMode[]).map((a) => (
            <button key={a} className={`an__seg-b${chart.axis === a ? ' an__seg-b--on' : ''}`} onClick={() => setAxis(a)}>
              {a === 'plans' ? 'По планам' : 'По часам'}
            </button>
          ))}
        </div>
        <div className="an__seg">
          {TYPES.map(({ t, label }) => (
            <button key={t} className={`an__seg-b${chart.type === t ? ' an__seg-b--on' : ''}`} onClick={() => onChange({ type: t })} title={label}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="an__chart-metrics">
        {chart.metrics.map((key, mi) => (
          <span key={key} className="an__mchip" style={{ borderColor: SERIES_COLORS[mi % SERIES_COLORS.length] }}>
            <span className="an__chart-dot" style={{ background: SERIES_COLORS[mi % SERIES_COLORS.length] }} />
            {metricName(key)}
            {chart.metrics.length > 1 && <button className="an__mchip-x" onClick={() => removeMetric(key)} title="Убрать">×</button>}
          </span>
        ))}
        {available.length > 0 && (
          <select className="an__select an__mchip-add" value="" onChange={(e) => addMetric(e.target.value)}>
            <option value="">+ метрика</option>
            {available.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
          </select>
        )}
      </div>

      <TimeChart labels={labels} series={chartSeries} type={chart.type} />
    </div>
  )
}

/** Построение данных графика из конфига: ось «по планам» или «по часам». */
function buildChartData(chart: ChartConfig, series: KpiBundle[], res: SimResults | null): { labels: string[]; chartSeries: ChartSeries[] } {
  if (chart.axis === 'plans') {
    const labels = series.map((b, i) => (b.created_at ? shortDate(b.created_at) : `#${i + 1}`))
    const chartSeries: ChartSeries[] = chart.metrics
      .map((code, mi): ChartSeries | null => {
        const def = kpiDef(code); if (!def) return null
        return {
          key: code, name: def.name, color: SERIES_COLORS[mi % SERIES_COLORS.length],
          fmtY: (x: number) => kpiText(x, def.unit), points: series.map((b) => def.value(b)),
        }
      })
      .filter((s): s is ChartSeries => s !== null)
    return { labels, chartSeries }
  }

  // axis === 'timeline': ряды внутри выбранного плана (0..makespan часов).
  const utilS = res?.util_series ?? []
  const workS = res?.workers_series ?? []
  const srcFor = (key: string): number[] =>
    key === 'util' ? utilS.map((p) => p.util) : key === 'workers' ? workS.map((p) => p.workers) : []
  const built: ChartSeries[] = chart.metrics
    .map((key, mi): ChartSeries | null => {
      const tm = TIMELINE_METRICS.find((m) => m.key === key); if (!tm) return null
      return {
        key, name: tm.name, color: SERIES_COLORS[mi % SERIES_COLORS.length],
        fmtY: tm.pct ? pctFmt : roundFmt, points: srcFor(key),
      }
    })
    .filter((s): s is ChartSeries => s !== null)
  // Выравнивание по минимальной длине (ряды сэмплированы синхронно, но подстрахуемся).
  const len = built.length ? Math.min(...built.map((s) => s.points.length)) : 0
  const tSrc = (utilS.length ? utilS : workS).slice(0, len)
  const labels = tSrc.map((p) => `${Math.round(p.t)}ч`)
  const chartSeries = built.map((s) => ({ ...s, points: s.points.slice(0, len) }))
  return { labels, chartSeries }
}
