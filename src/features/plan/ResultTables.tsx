/**
 * Таблицы результата плана (X1 §5 п. 10, 12): сравнение правил (выбранное — фоном и глифом ●,
 * веса — чипами) и планы по рабочим (сортировка по колонкам, топ-12 + «показать всех»).
 * Числа — только через форматтеры src/explain/format.ts.
 */
import { useMemo, useState } from 'react'
import type { ScheduleResult } from '../../lib/api'
import { hours, num, pct } from '../../explain/format'
import { Chip } from './ui'

type Dir = 'asc' | 'desc'
interface Sort<K extends string> { key: K; dir: Dir }

/** Сортировка по ключу с переключением направления по клику на заголовок. */
function useSort<K extends string>(initial: Sort<K>) {
  const [sort, setSort] = useState<Sort<K>>(initial)
  const toggle = (key: K) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))
  return { sort, toggle }
}

function SortTh<K extends string>({ k, label, sort, onSort, numeric = true }: { k: K; label: string; sort: Sort<K>; onSort: (k: K) => void; numeric?: boolean }) {
  const on = sort.key === k
  return (
    <th scope="col" className={numeric ? 'num' : undefined} aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={`pl-th${on ? ' is-on' : ''}`} onClick={() => onSort(k)}>
        {label}<span className="pl-th__dir" aria-hidden="true">{on ? (sort.dir === 'asc' ? '↑' : '↓') : ''}</span>
      </button>
    </th>
  )
}

const by = <T,>(get: (x: T) => number | string, dir: Dir) => (a: T, b: T) => {
  const va = get(a), vb = get(b)
  const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'ru')
  return dir === 'asc' ? cmp : -cmp
}

/* ── Правила ─────────────────────────────────────────────────────────────── */

type RuleKey = 'rule' | 'makespan' | 'makespan_cvar' | 'tardiness' | 'score'

export function RulesTable({ result }: { result: ScheduleResult }) {
  const { sort, toggle } = useSort<RuleKey>({ key: 'score', dir: 'asc' })
  const rows = useMemo(() => [...result.rules].sort(by((r) => r[sort.key], sort.dir)), [result.rules, sort])
  const w = result.weights
  return (
    <div className="pl-rules">
      <div className="pl-rules__weights" aria-label="Веса целевой функции">
        <Chip tone="accent">w_time {num(w.time, 2)}</Chip>
        <Chip tone="accent">w_risk {num(w.risk, 2)}</Chip>
        <Chip tone="accent">w_cost {num(w.cost, 2)}</Chip>
        <Chip>α {pct(result.alpha, 0)}</Chip>
      </div>
      <table className="pl-table pl-table--tight">
        <thead>
          <tr>
            <SortTh k="rule" label="Правило" sort={sort} onSort={toggle} numeric={false} />
            <SortTh k="makespan" label="E[Cmax]" sort={sort} onSort={toggle} />
            <SortTh k="makespan_cvar" label="CVaR" sort={sort} onSort={toggle} />
            <SortTh k="tardiness" label="Просрочка" sort={sort} onSort={toggle} />
            <SortTh k="score" label="F" sort={sort} onSort={toggle} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.rule} className={r.chosen ? 'is-chosen' : ''}>
              <td className="pl-td-name">{r.chosen && <span className="glyph-running" aria-label="выбрано" />}{r.rule}</td>
              <td className="num">{hours(r.makespan)}</td>
              <td className="num">{hours(r.makespan_cvar)}</td>
              <td className="num">{hours(r.tardiness)}</td>
              <td className="num">{num(r.score, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ── Рабочие ─────────────────────────────────────────────────────────────── */

type WorkerKey = 'name' | 'job_count' | 'busy_hours' | 'utilization'
const WORKERS_TOP = 12

export function WorkersTable({ result }: { result: ScheduleResult }) {
  const { sort, toggle } = useSort<WorkerKey>({ key: 'utilization', dir: 'desc' })
  const [all, setAll] = useState(false)
  const active = useMemo(() => result.worker_plan.filter((w) => w.job_count > 0), [result.worker_plan])
  const rows = useMemo(() => [...active].sort(by((w) => w[sort.key], sort.dir)), [active, sort])
  const visible = all ? rows : rows.slice(0, WORKERS_TOP)
  if (active.length === 0) return <p className="pl-note">Назначений рабочих в плане нет.</p>
  return (
    <div className="pl-workers">
      <table className="pl-table pl-table--tight">
        <thead>
          <tr>
            <SortTh k="name" label="Рабочий" sort={sort} onSort={toggle} numeric={false} />
            <SortTh k="job_count" label="Операций" sort={sort} onSort={toggle} />
            <SortTh k="busy_hours" label="Занят" sort={sort} onSort={toggle} />
            <SortTh k="utilization" label="Загрузка" sort={sort} onSort={toggle} />
          </tr>
        </thead>
        <tbody>
          {visible.map((w) => (
            <tr key={w.worker_id}>
              <td className="pl-td-name">{w.name}</td>
              <td className="num">{num(w.job_count, 0)}</td>
              <td className="num">{hours(w.busy_hours)}</td>
              <td className="num">{pct(w.utilization, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > WORKERS_TOP && (
        <button type="button" className="pf-link" onClick={() => setAll((v) => !v)}>
          {all ? `свернуть до ${WORKERS_TOP}` : `показать всех ${num(rows.length, 0)}`}
        </button>
      )}
    </div>
  )
}
