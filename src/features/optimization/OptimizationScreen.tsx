import { useEffect, useMemo, useState } from 'react'
import {
  api,
  type PriceScenario, type Product, type WorkCenterType,
  type OptResult, type OptPortfolio,
} from '../../lib/api'
import { ProfitDistribution } from './ProfitDistribution'
import './optimization.css'

const OBJECTIVES: Array<{ id: string; label: string; hint: string }> = [
  { id: 'cvar',         label: 'CVaR (ожидаемые потери в хвосте)', hint: 'Максимизировать средний результат в худшие α·100% исходов' },
  { id: 'worstcase',    label: 'Худший случай (maximin)',          hint: 'Максимизировать гарантированный минимум прибыли' },
  { id: 'meanvariance', label: 'Mean–Variance (E − λ·σ)',          hint: 'Баланс ожидаемой прибыли и волатильности' },
  { id: 'minregret',    label: 'Min-Regret (мин. сожаление)',      hint: 'Минимизировать макс. отставание от пооборотного оптимума' },
]

function money(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e9) return (v / 1e9).toFixed(2) + ' млрд ₽'
  if (a >= 1e6) return (v / 1e6).toFixed(1) + ' млн ₽'
  if (a >= 1e3) return (v / 1e3).toFixed(0) + ' тыс ₽'
  return v.toFixed(0) + ' ₽'
}
const pct = (v: number) => (v * 100).toFixed(1) + '%'

interface PortfolioCardProps {
  kind: 'robust' | 'expected'
  title: string
  hint: string
  pf: OptPortfolio
  nameOf: (id: string) => string
}

function PortfolioCard({ kind, title, hint, pf, nameOf }: PortfolioCardProps) {
  const m = pf.metrics
  return (
    <div className={`pf-card pf-card--${kind}`}>
      <div className="pf-card__eyebrow">
        {kind === 'robust' ? 'Решение системы' : 'Для сравнения'}
        {kind === 'robust' && <span className="pf-card__badge">ВЫБРАНО</span>}
      </div>
      <h3 className="pf-card__title">{title}</h3>
      <p className="pf-card__hint">{hint}</p>

      <div className="pf-metrics">
        <Metric k="E[прибыль]" v={money(m.expected)} />
        <Metric k="CVaR" v={money(m.cvar)} tone={m.cvar < 0 ? 'bad' : 'good'} />
        <Metric k="худший" v={money(m.worst_case)} tone={m.worst_case < 0 ? 'bad' : undefined} />
        <Metric k="σ (разброс)" v={money(m.std)} />
        <Metric k="P(убыток)" v={pct(m.p_loss)} tone={m.p_loss > 0.02 ? 'bad' : 'good'} />
        <Metric k="макс. сожаление" v={money(m.max_regret)} />
      </div>

      <div className="pf-items">
        {pf.items.length === 0 && <span className="pf-card__hint">Пустой портфель.</span>}
        {pf.items.map((it) => (
          <div className="pf-item" key={it.product_id}>
            <span>{nameOf(it.product_id)}</span>
            <span className="pf-item__qty">{it.qty.toLocaleString('ru')} ед · {money(it.unit_margin)}/ед</span>
            <span className="pf-item__contrib">{money(it.contribution)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Metric({ k, v, tone }: { k: string; v: string; tone?: 'good' | 'bad' }) {
  const cls = tone === 'good' ? ' pf-metric__v--good' : tone === 'bad' ? ' pf-metric__v--bad' : ''
  return (
    <div className="pf-metric">
      <div className="pf-metric__k">{k}</div>
      <div className={`pf-metric__v${cls}`}>{v}</div>
    </div>
  )
}

function ResourceLoad({ pf, nameOf }: { pf: OptPortfolio; nameOf: (id: string) => string }) {
  const rows = [...pf.resource_load].sort((a, b) => b.utilization - a.utilization)
  return (
    <div>
      {rows.map((l) => {
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
      {rows.length === 0 && <span className="pf-card__hint">Нет загрузки.</span>}
    </div>
  )
}

export function OptimizationScreen() {
  const [scenarios, setScenarios] = useState<PriceScenario[]>([])
  const [products, setProducts]   = useState<Product[]>([])
  const [wcTypes, setWcTypes]     = useState<WorkCenterType[]>([])

  const [scenarioId, setScenarioId] = useState('')
  const [objective, setObjective]   = useState('cvar')
  const [samples, setSamples]       = useState('3000')
  const [alpha, setAlpha]           = useState('0.10')

  const [result, setResult]   = useState<OptResult | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      api.scenarios.list().catch(() => [] as PriceScenario[]),
      api.products.list().catch(() => [] as Product[]),
      api.workCenterTypes.list().catch(() => [] as WorkCenterType[]),
    ]).then(([sc, pr, wc]) => {
      setScenarios(sc)
      setProducts(pr)
      setWcTypes(wc)
      if (sc.length && !scenarioId) setScenarioId(sc[0].id)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const nameOf = useMemo(() => {
    const map = new Map<string, string>()
    products.forEach((p) => map.set(p.id, `${p.name}`))
    wcTypes.forEach((t) => map.set(t.id, t.name))
    return (id: string) => map.get(id) ?? id
  }, [products, wcTypes])

  const run = async () => {
    setRunning(true)
    setError(null)
    try {
      const r = await api.optimize.run({
        scenario_id: scenarioId || undefined,
        objective,
        samples: Number(samples) || 3000,
        alpha: Number(alpha) || 0.1,
      })
      setResult(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка оптимизации')
    } finally {
      setRunning(false)
    }
  }

  const objHint = OBJECTIVES.find((o) => o.id === objective)?.hint ?? ''
  // Мягкая ошибка (нет товарных изделий) приходит без полей robust/expected —
  // обращаемся к ним только при наличии валидного результата.
  const soft = result?.error_soft || (result != null && result.robust == null)
  const robustE = result?.robust?.metrics?.expected ?? 0

  return (
    <div className="opt">
      <div className="opt__head">
        <div>
          <h1 className="opt__title">Устойчивая оптимизация производства</h1>
          <p className="opt__subtitle">
            Цена продукции — внешнее условие, заданное распределениями в сценарии.
            Методом Монте-Карло строится распределение прибыли каждого портфеля и
            выбирается <strong>самое устойчивое</strong> решение к внешним условиям,
            а не самое прибыльное в среднем.
          </p>
        </div>
      </div>

      <div className="opt__controls">
        <div className="opt__ctl">
          <span className="opt__ctl-label">Сценарий внешних условий</span>
          <select className="opt__select" value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
            {scenarios.length === 0 && <option value="">— базовые цены НСИ —</option>}
            {scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="opt__ctl">
          <span className="opt__ctl-label">Критерий устойчивости</span>
          <select className="opt__select" value={objective} onChange={(e) => setObjective(e.target.value)}>
            {OBJECTIVES.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </div>
        <div className="opt__ctl">
          <span className="opt__ctl-label">Прогонов (Монте-Карло)</span>
          <input className="opt__input" type="number" min="200" step="500" value={samples}
                 onChange={(e) => setSamples(e.target.value)} />
        </div>
        <div className="opt__ctl">
          <span className="opt__ctl-label">α (хвост риска)</span>
          <input className="opt__input" type="number" min="0.01" max="0.5" step="0.05" value={alpha}
                 onChange={(e) => setAlpha(e.target.value)} />
        </div>
        <button className="btn btn--primary opt__run" onClick={run} disabled={running}>
          {running ? 'Моделируем…' : 'Найти устойчивое решение'}
        </button>
      </div>
      <p className="opt__subtitle" style={{ marginTop: -6 }}>{objHint}</p>

      {error && <div className="opt__empty opt__warn">{error}</div>}

      {!result && !error && (
        <div className="opt__empty">
          Выберите сценарий и критерий, затем запустите моделирование.
        </div>
      )}

      {soft && (
        <div className="opt__empty opt__warn">
          {result?.warnings?.join(' ') || 'Нет товарных изделий для оптимизации. Отметьте изделия как товарные и задайте цену в реестре «Изделия».'}
        </div>
      )}

      {result && !soft && (
        <>
          <div className="opt__compare">
            <PortfolioCard
              kind="robust" title="Устойчивый портфель"
              hint="Держится в неблагоприятных сценариях: лучший CVaR / худший случай при меньшем разбросе."
              pf={result.robust} nameOf={nameOf} />
            <PortfolioCard
              kind="expected" title="Максимум ожидаемой прибыли"
              hint="«Наивно лучшее» по матожиданию — выше средняя прибыль, но хрупкое к падению цен."
              pf={result.expected} nameOf={nameOf} />
          </div>

          <div className="opt__por">
            <span className="opt__por-val">{money(result.price_of_robustness)}</span>
            <span className="opt__por-text">
              <strong>Цена устойчивости.</strong> Столько ожидаемой прибыли система осознанно
              уступает (E={money(result.expected.metrics.expected)} → {money(robustE)}), чтобы
              получить лучший худший случай ({money(result.robust.metrics.worst_case)} против{' '}
              {money(result.expected.metrics.worst_case)}) и ниже риск убытка
              ({pct(result.robust.metrics.p_loss)} против {pct(result.expected.metrics.p_loss)}).
            </span>
          </div>

          <div className="opt__grid2">
            <div className="opt__section">
              <p className="opt__section-title">Распределение прибыли устойчивого портфеля · {result.samples} прогонов</p>
              <div className="opt__panel">
                <ProfitDistribution histogram={result.histogram} metrics={result.robust.metrics} />
                <div className="opt__legend">
                  <span><i style={{ background: 'var(--accent)' }} /> прибыль</span>
                  <span><i style={{ background: 'var(--intent-danger)' }} /> убыток</span>
                  <span><i style={{ background: 'var(--intent-warning)' }} /> CVaR</span>
                  <span><i style={{ background: 'var(--intent-success)' }} /> матожидание</span>
                </div>
              </div>
            </div>
            <div className="opt__section">
              <p className="opt__section-title">Загрузка оборудования (план из портфеля)</p>
              <div className="opt__panel">
                <ResourceLoad pf={result.robust} nameOf={nameOf} />
              </div>
            </div>
          </div>

          {result.warnings?.length > 0 && (
            <div className="opt__warn">⚠ {result.warnings.join(' · ')}</div>
          )}
        </>
      )}
    </div>
  )
}
