/**
 * Таблица V5 (претенденты RL против базовой линии на отложенных сценариях) на DataTable кита:
 * ≤ 8 колонок без мёртвых — ΔCVaR прибыли в б. п. с ДИ-полосой в ячейке (общая шкала, отметка нуля),
 * «лучше в N из 12», p, ΔCVaR кассы, ΔE[Cmax], вердикт (гейт слит с ним). ΔP(разрыв), если она нулевая
 * везде, — в сноске. У каждого заголовка — «i». Стресс и база сравнения живут в адресе.
 */
import type { ReactNode } from 'react'
import { num, signed } from '../../explain/format'
import { InfoTip } from '../../ui/InfoTip'
import { useMeasuredWidth } from '../../ui/charts'
import { Chip, DataTable, Segmented, type DataColumn } from '../../ui/kit'
import { useHashParams } from '../../shell/router'
import {
  BASELINE_LABEL, STRESS_HINT, STRESS_LABEL, V5, bpCi, bpFine, bpPoint, breachAllZero, candidateLabel, candidateRows, ciDomain, ciVerdict, snapDay, winCount,
  type V5Comparison, type V5Stress,
} from './benchData'

const P_MAX = 0.05
const STRESSES = Object.keys(STRESS_LABEL) as V5Stress[]

/** Заголовок колонки с «i» (несортируемый: кнопка «i» не может жить внутри кнопки сортировки). */
export function Head({ id, children }: { id: string; children: ReactNode }) {
  return <span className="ag-th">{children}<InfoTip id={id} /></span>
}

/** Полоса ДИ в ячейке: общая шкала строк, тонкая отметка нуля, точка IQM. */
export function CiCell({ lo, hi, mid, domain, label }: { lo: number; hi: number; mid: number; domain: readonly [number, number]; label: string }) {
  const [ref, w] = useMeasuredWidth<HTMLSpanElement>(96)
  const span = domain[1] - domain[0] || 1
  const x = (v: number) => 4 + ((Math.min(domain[1], Math.max(domain[0], v)) - domain[0]) / span) * Math.max(8, w - 8)
  return (
    <span className="ag-ci">
      <span ref={ref} className="ag-ci__track">
        <svg width={w} height={12} viewBox={`0 0 ${w} 12`} aria-hidden="true">
          <line className="ag-ci__zero" x1={x(0)} x2={x(0)} y1={0} y2={12} />
          <line className="ag-ci__band" x1={x(lo)} x2={x(hi)} y1={6} y2={6} />
          <circle className="ag-ci__dot" cx={x(mid)} cy={6} r={3} />
        </svg>
      </span>
      <span className="ag-ci__text">{label}</span>
    </span>
  )
}

function pText(p: number): string {
  return p < 0.001 ? `< ${num(0.001, 3)}` : num(p, 3)
}

function Verdict({ r }: { r: V5Comparison }) {
  const v = ciVerdict(r.ci95)
  if (v === 'below') return <span className="ag-verdict"><span className="ag-verdict__g ag-verdict__g--below" aria-hidden="true">▼</span>ДИ &lt; 0 — хуже, не опубликовано</span>
  if (v === 'above' && r.gate) return <span className="ag-verdict"><span className="ag-verdict__g" aria-hidden="true">▲</span>ДИ &gt; 0 — прошёл гейт</span>
  if (v === 'above') return <span className="ag-verdict"><span className="ag-verdict__g" aria-hidden="true">△</span>ДИ &gt; 0, p ≥ {num(P_MAX, 2)} — не опубликовано</span>
  return <span className="ag-verdict"><span className="glyph-idle" aria-hidden="true" />ДИ ∋ 0 — не опубликовано</span>
}

function columns(domain: readonly [number, number], n: number): ReadonlyArray<DataColumn<V5Comparison>> {
  return [
    { key: 'policy', title: <Head id="agent.candidate">Претендент</Head>, rowHeader: true, sortable: false, get: (r) => candidateLabel(V5, r.policy) },
    {
      key: 'iqm', title: <Head id="agent.gate_delta">ΔCVaR прибыли, б. п. [95 %-ДИ]</Head>, num: true, sortable: false, className: 'ag-col-ci',
      render: (r) => <CiCell lo={r.ci95[0]} hi={r.ci95[1]} mid={r.iqm} domain={domain} label={`${bpPoint(r.iqm)} ${bpCi(r.ci95)}`} />,
    },
    { key: 'win', title: <Head id="agent.win_share">Лучше в N из {num(n, 0)}</Head>, num: true, sortable: false, render: (r) => `${num(winCount(V5, r.win), 0)} из ${num(n, 0)}` },
    { key: 'p', title: <Head id="agent.gate_p">p</Head>, num: true, sortable: false, render: (r) => pText(r.p) },
    { key: 'cash', title: <Head id="agent.cash_delta">ΔCVaR кассы</Head>, num: true, sortable: false, render: (r) => bpFine(r.d_cash_iqm, { signed: true }) },
    { key: 'cmax', title: <Head id="agent.makespan_delta">ΔE[Cmax]</Head>, num: true, sortable: false, render: (r) => signed(r.d_makespan_h, 'ч') },
    { key: 'verdict', title: <Head id="agent.gate_ci">Вердикт</Head>, sortable: false, render: (r) => <Verdict r={r} /> },
  ]
}

export function V5Table() {
  const [params, setParams] = useHashParams()
  const stress: V5Stress = STRESSES.includes(params.stress as V5Stress) ? (params.stress as V5Stress) : 'base'
  const vs = params.vs && BASELINE_LABEL[params.vs] ? params.vs : 'best_rule'
  const rows = candidateRows(V5, stress, vs)
  const domain = ciDomain(rows)
  const n = V5.instances.length
  return (
    <div className="ag-bench">
      <div className="ag-bench__bar">
        <Segmented label="Стресс" size="sm" fit value={stress} onChange={(id) => setParams({ stress: id === 'base' ? null : id })}
          options={STRESSES.map((id) => ({ id, label: STRESS_LABEL[id], title: STRESS_HINT[id] }))} />
        <Segmented label="Против чего" size="sm" fit value={vs} onChange={(id) => setParams({ vs: id === 'best_rule' ? null : id })}
          options={Object.entries(BASELINE_LABEL).map(([id, label]) => ({ id, label: `против: ${label}` }))} />
        <span className="ag-snap">
          <Chip size="sm" title={V5.source}>снимок {snapDay(V5.snapshot_date)}</Chip>
          <span className="glyph-setup">устарело — есть A2–A4</span>
        </span>
      </div>
      <p className="ag-note">{STRESS_HINT[stress]} · N = {num(V5.n, 0)} сценариев на экземпляр · CVaR при α = {num(0.1, 1)}.</p>
      <DataTable columns={columns(domain, n)} rows={rows} rowKey={(r) => `${r.policy}-${r.vs}`} tight
        caption={`V5: претенденты RL против базовой линии «${BASELINE_LABEL[vs]}», стресс «${STRESS_LABEL[stress]}»`} />
      <p className="ag-note ag-note--foot">
        Гейт: весь 95 %-ДИ правее нуля и p &lt; {num(P_MAX, 2)} против лучшего правила.
        {breachAllZero(V5) && <> Изменение вероятности кассового разрыва — ноль у всех претендентов во всех стрессах, поэтому отдельной колонки нет.</>}
      </p>
    </div>
  )
}
