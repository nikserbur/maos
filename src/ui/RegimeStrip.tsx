/**
 * Полоса режимов обученного макро-генератора (UX-V2 §5.4, §6.2 `RegimeStrip`): по месяцам
 * горизонта — доля путей в каждом режиме (цветные сегменты: спокойный — вердигрис, кризис —
 * киноварь), сколько режим в среднем держится (мес). Подпись — обычным регистром; ось — календарные
 * месяцы (начало, середина, конец), если передан `monthLabel`. Данные — `POST /api/macro/sample`
 * (`paths[].regime`) и `GET /api/macro/regimes`. Слово «прогноз» — только для базового режима.
 */
import type { MacroRegime } from '../lib/api'
import { NBSP, num } from '../explain/format'
import './fields.css'

interface RegimeStripProps {
  regimes: readonly MacroRegime[]
  /** Режим по месяцам для каждого пути (`paths[].regime`). */
  paths: ReadonlyArray<readonly number[]>
  /** Доля режимов по всем путям и месяцам (`regime_share`). */
  share?: readonly number[]
  isForecast: boolean
  label?: string
  /** Индекс навязанного режима (стресс) — подсветка. */
  forced?: number | null
  /** Подпись месяца горизонта по индексу (0 — первый месяц): «окт. 2026». */
  monthLabel?: (i: number) => string
}

const COLORS = ['var(--verdigris)', 'var(--cinnabar)', 'var(--ochre)', 'var(--chart-6)']

/** Доля путей в каждом режиме по месяцам: [месяц][режим]. */
export function regimeSharesByMonth(paths: ReadonlyArray<readonly number[]>, k: number): number[][] {
  const months = paths.reduce((m, p) => Math.max(m, p.length), 0)
  const out: number[][] = []
  for (let t = 0; t < months; t++) {
    const counts = new Array<number>(k).fill(0)
    let n = 0
    for (const p of paths) if (t < p.length && p[t] >= 0 && p[t] < k) { counts[p[t]] += 1; n += 1 }
    out.push(counts.map((c) => (n ? c / n : 0)))
  }
  return out
}

/** Подписи оси: первый, средний и последний месяц (без повторов). */
function axisIndices(n: number): number[] {
  return [...new Set([0, Math.floor((n - 1) / 2), n - 1])].filter((i) => i >= 0)
}

export function RegimeStrip({ regimes, paths, share, isForecast, label, forced = null, monthLabel }: RegimeStripProps) {
  const k = regimes.length
  const byMonth = regimeSharesByMonth(paths, k)
  if (k === 0) return null
  return (
    <div className={`pf-regimes${isForecast ? '' : ' is-stress'}`} role="img" aria-label={`Режимы генератора по месяцам: ${regimes.map((r, i) => `${r.label} ${Math.round((share?.[i] ?? 0) * 100)} %`).join(', ')}`}>
      <div className="pf-regimes__head">
        <span className="pf-regimes__title">{label ?? (isForecast ? 'Режимы генератора — прогноз' : 'Режимы генератора — проверка «что если», не прогноз')}</span>
        <span className="pf-regimes__legend">
          {regimes.map((r, i) => (
            <span key={r.index} className={`pf-regimes__key${forced === i ? ' is-forced' : ''}`}>
              <i style={{ background: COLORS[i % COLORS.length] }} />
              {r.label} <b className="num">{Math.round((share?.[i] ?? r.share_of_history) * 100)} %</b>
              {r.mean_duration_months > 0 && (
                <span className="pf-regimes__stay" title={`вероятность остаться в режиме за блок — ${Math.round(r.stay_prob_block * 100)} %`}>
                  · держится в среднем {num(r.mean_duration_months, 0)}{NBSP}мес
                </span>
              )}
            </span>
          ))}
        </span>
      </div>
      {byMonth.length > 0 ? (
        <div className="pf-regimes__track" aria-hidden="true">
          {byMonth.map((m, t) => (
            <span key={t} className="pf-regimes__month" title={`месяц +${t + 1}: ${m.map((v, i) => `${regimes[i]?.label ?? i} ${Math.round(v * 100)} %`).join(' · ')}`}>
              {m.map((v, i) => v > 0 && <i key={i} style={{ flexGrow: v, background: COLORS[i % COLORS.length] }} />)}
            </span>
          ))}
        </div>
      ) : (
        <div className="pf-regimes__track pf-regimes__track--flat" aria-hidden="true">
          {regimes.map((r, i) => (share?.[i] ?? r.share_of_history) > 0 && <i key={r.index} style={{ flexGrow: share?.[i] ?? r.share_of_history, background: COLORS[i % COLORS.length] }} />)}
        </div>
      )}
      {byMonth.length > 0 && (
        <div className="pf-regimes__axis" aria-hidden="true">
          {axisIndices(byMonth.length).map((i) => <span key={i}>{monthLabel ? monthLabel(i) : `+${num(i + 1, 0)}${NBSP}мес`}</span>)}
        </div>
      )}
    </div>
  )
}
