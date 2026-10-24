/**
 * Графики раздела «Касса» на chart-системе (X2 «честная неопределённость»): недельный остаток кассы
 * веером P5–P50–P95 (разброс исходов, не ДИ), медианный долг кредитной линии с полосой до P95 и
 * кривая цены ликвидности PoL(L_min) с ДИ бутстрепа. Подписи — словами; числа — через format.ts.
 */
import type { CashLpResult } from '../../lib/api'
import { money } from '../../explain/format'
import { LineChart, axisMoney } from '../../ui/charts'

const weekLabels = (n: number): string[] => Array.from({ length: n }, (_, t) => `нед. ${t + 1}`)

/** Недельный остаток кассы: медиана (P50) и полоса P5–P95 — 9 из 10 сценариев внутри полосы. */
export function CashFan({ q, lMin, n }: { q: NonNullable<CashLpResult['tranches']>['cash']; lMin: number; n: number }) {
  const weeks = q.p50.length
  if (weeks < 2) return <p className="pl-note">Недельный остаток кассы не возвращён сервером.</p>
  const minIdx = q.p05.reduce((a, v, i) => (v < q.p05[a] ? i : a), 0)
  return (
    <LineChart labels={weekLabels(weeks)} height={168} compact xHeader="неделя" fmtY={axisMoney} unit="₽"
      series={[{ key: 'p50', name: 'медиана (P50)', values: q.p50, fmt: money, band: { lo: q.p05, hi: q.p95, label: `P5–P95 · 9 из 10 исходов (N = ${n})` } }]}
      annotations={[{ key: 'min', index: minIdx, seriesKey: 'p50', label: `минимум P5 ${money(q.p05[minIdx])}` }]}
      tipRows={(t) => [{ key: 'p05', label: 'P5', value: money(q.p05[t]) }, { key: 'p95', label: 'P95', value: money(q.p95[t]) }, { key: 'lmin', label: 'порог L_min', value: money(lMin) }]}
      ariaLabel={`Остаток кассы по ${weeks} неделям: медиана от ${money(q.p50[0])} до ${money(q.p50[weeks - 1])}, худшая неделя P5 ${money(q.p05[minIdx])}`} />
  )
}

/** Мини-кривая PoL(L_min): ось L_min → цена ликвидности, полоса ДИ, отметка текущего L_min и первой неразрешимой точки. */
export function PolCurve({ points, current }: { points: NonNullable<CashLpResult['pol_curve']>; current: number }) {
  const sorted = points.slice().sort((a, b) => a.l_min - b.l_min)
  const ok = sorted.filter((p) => p.status === 'optimal' && typeof p.pol === 'number')
  if (ok.length < 2) return <p className="pl-note">Кривая цены ликвидности не построена: решений меньше двух.</p>
  const labels = sorted.map((p) => money(p.l_min))
  const values = sorted.map((p) => (p.status === 'optimal' && typeof p.pol === 'number' ? p.pol : Number.NaN))
  const hasCi = ok.some((p) => p.pol_ci)
  const band = hasCi
    ? { lo: sorted.map((p) => (p.pol_ci ? p.pol_ci[0] : Number.NaN)), hi: sorted.map((p) => (p.pol_ci ? p.pol_ci[1] : Number.NaN)), label: 'ДИ оценки 95 %' }
    : undefined
  const curIdx = sorted.reduce((a, p, i) => (Math.abs(p.l_min - current) < Math.abs(sorted[a].l_min - current) ? i : a), 0)
  const infIdx = sorted.findIndex((p) => p.status !== 'optimal')
  return (
    <LineChart labels={labels} height={132} compact xHeader="порог L_min" fmtY={axisMoney} unit="₽"
      series={[{ key: 'pol', name: 'цена ликвидности', values, fmt: money, band }]}
      annotations={[
        { key: 'cur', index: curIdx, kind: 'line', label: `L_min ${money(current)}` },
        ...(infIdx >= 0 ? [{ key: 'inf', index: infIdx, kind: 'line' as const, label: 'решения нет' }] : []),
      ]}
      ariaLabel={`Цена ликвидности по L_min: от ${money(ok[0].pol as number)} при ${money(ok[0].l_min)} до ${money(ok[ok.length - 1].pol as number)} при ${money(ok[ok.length - 1].l_min)}`} />
  )
}

/** Транши: медианный долг по неделям — линия с полосой до P95, первый транш — точка с подписью. */
export function TrancheChart({ tr, firstDraw }: { tr: NonNullable<CashLpResult['tranches']>; firstDraw: number }) {
  const weeks = tr.debt.p50.length
  return (
    <LineChart labels={weekLabels(weeks)} height={140} compact xHeader="неделя" fmtY={axisMoney} unit="₽"
      series={[{ key: 'p50', name: 'долг · медиана', values: tr.debt.p50, fmt: money, band: { lo: tr.debt.p50, hi: tr.debt.p95, label: 'до P95' } }]}
      annotations={firstDraw >= 0 ? [{ key: 'first', index: firstDraw, seriesKey: 'p50', label: `транш ${money(tr.drawdown.p50[firstDraw])}` }] : []}
      tipRows={(t) => [{ key: 'p95', label: 'долг P95', value: money(tr.debt.p95[t]) }, { key: 'dd', label: 'транш P50', value: money(tr.drawdown.p50[t]) }]}
      ariaLabel={`Медианный долг по ${weeks} неделям: ${tr.debt.p50.map((v) => money(v)).join(', ')}`} />
  )
}
