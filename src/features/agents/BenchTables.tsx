/**
 * Таблицы стенда rl/ (A1 §3, §5) на DataTable кита из снимков JSON: V5 — претенденты RL против
 * базовой линии на отложенных сценариях по стрессам (IQM, бутстреп-ДИ, Уилкоксон, гейт); V4 —
 * расписание «правила / ГА / CP-SAT» против BKS и нижней границы по семействам экземпляров.
 */
import { useState } from 'react'
import { dateTime, num, pct, signed } from '../../explain/format'
import { Chip, DataTable, Segmented, type DataColumn } from '../../ui/kit'
import {
  FAMILY_LABEL, STRESS_HINT, STRESS_LABEL, V4, V5, ciVerdict, familyOf, gap, policyLabel, referenceOf, summarizeV4, v5Rows,
  type V4Row, type V5Comparison, type V5Stress,
} from './benchData'
import { moveLabel } from '../plan/moves/moveKinds'
import type { MoveKind } from '../../lib/api'

// Разности долей E[Π] малы (10⁻⁵…10⁻³): три знака, иначе L2 округляется в «0 %».
const share = (v: number) => pct(v, 3)
const VERDICT: Readonly<Record<ReturnType<typeof ciVerdict>, { glyph: string; text: string }>> = {
  above: { glyph: 'glyph-running', text: 'ДИ > 0' },
  below: { glyph: 'glyph-down', text: 'ДИ < 0' },
  straddles: { glyph: 'glyph-idle', text: 'ДИ ∋ 0' },
}

const V5_COLS: ReadonlyArray<DataColumn<V5Comparison>> = [
  { key: 'policy', title: 'Претендент', rowHeader: true, get: (r) => policyLabel(r.policy) },
  { key: 'iqm', title: 'IQM ΔCVaR₀.₁(Π)', num: true, hint: 'доли E[Π] базовой линии', render: (r) => share(r.iqm) },
  { key: 'ci', title: '95 %-ДИ', num: true, get: (r) => r.ci95[0], render: (r) => `[${share(r.ci95[0])}; ${share(r.ci95[1])}]` },
  { key: 'verdict', title: 'ДИ', get: (r) => ciVerdict(r.ci95), render: (r) => { const v = VERDICT[ciVerdict(r.ci95)]; return <span className="ag-nowrap"><span className={v.glyph} aria-hidden="true" /> {v.text}</span> } },
  { key: 'p', title: 'p (Уилкоксон)', num: true, render: (r) => num(r.p, 3) },
  { key: 'win', title: 'Доля побед', num: true, hint: 'доля экземпляров, где претендент лучше', render: (r) => pct(r.win, 0) },
  { key: 'd_cash_iqm', title: 'ΔCVaR кассы', num: true, render: (r) => share(r.d_cash_iqm) },
  { key: 'd_p_breach', title: 'ΔP(разрыв)', num: true, render: (r) => signed(r.d_p_breach, '%') },
  { key: 'd_makespan_h', title: 'ΔE[Cmax]', num: true, render: (r) => signed(r.d_makespan_h, 'ч') },
  { key: 'gate', title: 'Гейт', get: (r) => (r.gate ? 1 : 0), render: (r) => <Chip size="sm" tone={r.gate ? 'good' : 'idle'}>{r.gate ? 'пройден' : 'нет'}</Chip> },
]

const gapText = (x: number, ref: number | null) => { const g = gap(x, ref); return g === null ? '—' : signed(g, '%') }

const V4_COLS: ReadonlyArray<DataColumn<V4Row>> = [
  { key: 'name', title: 'Экземпляр', rowHeader: true },
  { key: 'n_jobs', title: 'Операций', num: true, render: (r) => num(r.n_jobs, 0) },
  { key: 'bks', title: 'BKS', num: true, render: (r) => (r.bks === null ? '—' : num(r.bks, 0)) },
  { key: 'best_rule', title: 'Лучшее правило', render: (r) => `${r.best_rule} ${num(r.rule_serial, 0)}` },
  { key: 'rule_event', title: 'Событийно', num: true, hint: 'non-delay режим той же среды', render: (r) => num(r.rule_event, 0) },
  { key: 'ga', title: 'ГА', num: true, render: (r) => num(r.ga, 0) },
  { key: 'cpsat', title: 'CP-SAT', num: true, render: (r) => `${num(r.cpsat, 0)} · ${r.cpsat_status === 'OPTIMAL' ? 'оптимум' : 'допустимое'}, ${num(r.cpsat_sec, 0)} с` },
  { key: 'g_rule', title: 'Разрыв правила', num: true, get: (r) => gap(r.rule_serial, referenceOf(r)), render: (r) => gapText(r.rule_serial, referenceOf(r)) },
  { key: 'g_ga', title: 'Разрыв ГА', num: true, get: (r) => gap(r.ga, referenceOf(r)), render: (r) => gapText(r.ga, referenceOf(r)) },
  { key: 'g_cp', title: 'Разрыв CP-SAT к BKS', num: true, get: (r) => gap(r.cpsat, r.bks), render: (r) => gapText(r.cpsat, r.bks) },
]

export function V5Table() {
  const [stress, setStress] = useState<V5Stress>('base')
  const [vs, setVs] = useState('best_rule')
  const rows = v5Rows(V5, stress, vs)
  const kinds = Object.entries(V5.moves).flatMap(([, m]) => Object.entries(m.kinds))
  const byKind = kinds.reduce<Record<string, number>>((acc, [k, n]) => ({ ...acc, [k]: (acc[k] ?? 0) + n }), {})
  return (
    <div className="ag-bench">
      <div className="ag-bench__bar">
        <Segmented label="Стресс" size="sm" fit value={stress} onChange={setStress}
          options={(Object.keys(STRESS_LABEL) as V5Stress[]).map((id) => ({ id, label: STRESS_LABEL[id], title: STRESS_HINT[id] }))} />
        <Segmented label="Против чего" size="sm" fit value={vs} onChange={setVs}
          options={[{ id: 'best_rule', label: 'лучшее правило' }, { id: 'GA', label: 'ГА' }, { id: 'EDD', label: 'EDD' }]} />
        <Chip tone="idle" title={V5.source}>снимок от {dateTime(V5.snapshot_date, { time: false })}</Chip>
      </div>
      <p className="pl-note">{STRESS_HINT[stress]}. Гейт: ДИ выигрыша CVaR целиком выше нуля и p &lt; 0,05 против чемпиона.</p>
      <DataTable columns={V5_COLS} rows={rows} rowKey={(r) => `${r.policy}-${r.vs}`} tight caption="V5: претенденты RL против базовой линии" />
      <p className="pl-note">
        Структурные ходы L2 на базовых holdout-сценариях (сумма по экземплярам и сидам):{' '}
        {Object.entries(byKind).map(([k, n]) => `${moveLabel(k as MoveKind)} — ${num(n, 0)}`).join(' · ') || 'нет'};
        «сдвиг запуска» ни разу — маска «запуск + цикл ≤ срок» почти всегда закрыта; аутсорсинг, маршрут и станок недоступны на демо-НСИ.
      </p>
    </div>
  )
}

export function V4Table() {
  const s = summarizeV4(V4.rows)
  return (
    <div className="ag-bench">
      <div className="ag-bench__bar">
        <Chip tone="good">CP-SAT = BKS: {s.cpsatAtBks} из {s.withBks}</Chip>
        <Chip>медиана разрыва: правило {signed(s.medRule, '%')} · событийно {signed(s.medEvent, '%')} · ГА {signed(s.medGa, '%')}</Chip>
        <Chip tone="idle" title={V4.source}>снимок от {dateTime(V4.snapshot_date, { time: false })} · CP-SAT {num(V4.cpsat_sec, 0)} с · ГА {V4.ga_gens} поколений</Chip>
      </div>
      <DataTable columns={V4_COLS} rows={V4.rows} rowKey={(r) => r.name} tight groupBy={(r) => FAMILY_LABEL[familyOf(r.name)]} framed
        caption="V4: правила, ГА и CP-SAT против BKS" />
      <p className="pl-note">На экземплярах MAOS CP-SAT — релаксация (без наладок, рабочих и календарей), поэтому разрыв там — к нижней оценке, не к оптимуму.</p>
    </div>
  )
}
