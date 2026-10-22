/**
 * Сравнение N сценариев (UX-V2 §5.1 «Сравнить» как режим списка, §5.3): прогон робастной оптимизации
 * для каждого (один и тот же критерий — из сценария), дифф условий сверху (только отличающиеся поля,
 * включая режим генератора), дифф результатов снизу с направлением «лучше».
 */
import { useState } from 'react'
import { api, type OptResult, type PriceScenario } from '../../lib/api'
import { money, num, pct } from '../../explain/format'
import { DiffTable, type DiffTableRow } from '../../ui/DiffList'
import { InlineError } from '../plan/ui'
import { fromMacroMode, regimeLabel } from './regimeMenu'
import './scenarios-v2.css'

interface Props { scenarios: PriceScenario[]; selected: string[] }

const n = (v: string | undefined) => { const x = Number(v); return v === undefined || v === '' || !Number.isFinite(x) ? null : x }

const CONDITION_ROWS: ReadonlyArray<DiffTableRow<PriceScenario>> = [
  { key: 'mode', label: 'Режим генератора', get: (s) => regimeLabel(fromMacroMode(s.macro_mode)).text, always: true },
  { key: 'objective', label: 'Критерий', get: (s) => s.objective || 'cvar' },
  { key: 'alpha', label: 'α хвоста', get: (s) => n(s.alpha), fmt: (v) => pct(v, 0) },
  { key: 'max_share', label: 'Макс. доля изделия', get: (s) => n(s.max_share), fmt: (v) => pct(v, 0) },
  { key: 'months', label: 'Горизонт, мес', get: (s) => n(s.months), fmt: (v) => num(v, 0) },
  { key: 'inflation', label: 'Инфляция, %/мес', get: (s) => n(s.inflation), fmt: (v) => pct(v, 2) },
  { key: 'volatility', label: 'Волатильность, %/мес', get: (s) => n(s.volatility), fmt: (v) => pct(v, 1) },
  { key: 'market_corr', label: 'Корреляция рынка', get: (s) => n(s.market_corr), fmt: (v) => num(v, 2) },
  { key: 'fx', label: 'Курс ×', get: (s) => n(s.fx), fmt: (v) => num(v, 2) },
  { key: 'demand', label: 'Спрос ×', get: (s) => n(s.demand), fmt: (v) => num(v, 2) },
  { key: 'dists', label: 'Распределений цен', get: (s) => s.distributions?.length ?? 0, fmt: (v) => num(v, 0) },
  { key: 'overrides', label: 'Оверрайдов цен', get: (s) => s.overrides?.length ?? 0, fmt: (v) => num(v, 0) },
]

const RESULT_ROWS: ReadonlyArray<DiffTableRow<OptResult>> = [
  { key: 'e', label: 'E[Π] робастного', get: (r) => r.robust.metrics.expected, fmt: (v) => money(v), better: 'high', always: true },
  { key: 'cvar', label: 'CVaR (худшие α)', get: (r) => r.robust.metrics.cvar, fmt: (v) => money(v), better: 'high', always: true },
  { key: 'worst', label: 'Худший случай', get: (r) => r.robust.metrics.worst_case, fmt: (v) => money(v), better: 'high' },
  { key: 'ploss', label: 'Вероятность убытка', get: (r) => r.robust.metrics.p_loss, fmt: (v) => pct(v, 1), better: 'low', always: true },
  { key: 'por', label: 'Цена робастности', get: (r) => r.price_of_robustness, fmt: (v) => money(v), better: 'low' },
  { key: 'effn', label: 'Эфф. число изделий', get: (r) => r.robust.diversification.effective_n, fmt: (v) => num(v, 1), better: 'high' },
  { key: 'hhi', label: 'Концентрация (HHI)', get: (r) => r.robust.diversification.concentration, fmt: (v) => pct(v, 0), better: 'low' },
  { key: 'items', label: 'Изделий в портфеле', get: (r) => r.robust.items.length, fmt: (v) => num(v, 0) },
  { key: 'regime', label: 'Доля режима «кризис»', get: (r) => r.macro?.regime_share?.[1] ?? null, fmt: (v) => pct(v, 0) },
  { key: 'top', label: 'Топ-изделие', get: (r) => [...r.robust.items].sort((a, b) => b.contribution - a.contribution)[0]?.product_id ?? '—' },
]

export function ScenarioCompare({ scenarios, selected }: Props) {
  const [results, setResults] = useState<Record<string, OptResult>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cols = selected.map((id) => scenarios.find((s) => s.id === id)).filter((s): s is PriceScenario => Boolean(s))

  const run = async () => {
    setBusy(true); setError(null)
    try {
      const out: Record<string, OptResult> = { ...results }
      for (const sc of cols) if (!out[sc.id]) out[sc.id] = await api.optimize.run({ scenario_id: sc.id })
      setResults(out)
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка оптимизации') }
    finally { setBusy(false) }
  }
  const ready = cols.filter((c) => results[c.id])

  return (
    <div className="sc2-compare">
      <div className="sc2-compare__head">
        <h2 className="scn__h">Сравнение сценариев · {cols.length}</h2>
        <button className="btn btn--primary" disabled={cols.length < 2 || busy} onClick={run}>{busy ? 'Оптимизируем…' : `Рассчитать портфели (${cols.length})`}</button>
      </div>
      <p className="scn__hint">Отметьте слева два и более сценариев. Критерий и α берутся из каждого сценария — так «Портфель» и «Сравнить» считают одинаково.</p>
      {error && <InlineError title="Сравнение не удалось" message={error} onRetry={run} />}
      {cols.length >= 2 && (
        <DiffTable caption="Условия — только отличающиеся" columns={cols.map((s) => ({ id: s.id, title: s.name, item: s }))} rows={CONDITION_ROWS} emptyText="Условия сценариев совпадают" />
      )}
      {ready.length >= 2 && (
        <DiffTable caption="Результаты робастной оптимизации — лучше зелёным" columns={ready.map((s) => ({ id: s.id, title: s.name, item: results[s.id] }))} rows={RESULT_ROWS} />
      )}
    </div>
  )
}
