/**
 * Таблицы результата плана (X2 «таблицы, а не стены карточек»): сравнение правил и планы по рабочим —
 * DataTable кита (липкая шапка, человеческая первая колонка, числа вправо с единицами, сортировка).
 * У правил — «Δ к выбранному» и пометка о совпадающем порядке; F — «27,8 тыс.»; часы — с одним знаком.
 * Имя рабочего из одних цифр — ▲ «проверьте имя». Числа — только через src/explain/format.ts.
 */
import type { ScheduleResult, SchedRule, WorkerPlan } from '../../lib/api'
import { NBSP, hours, num, pct } from '../../explain/format'
import { ruleLabel } from '../../explain/labels'
import { Chip, DataTable, DeltaChip, type DataColumn } from '../../ui/kit'

const WORKERS_TOP = 12
const TIE_EPS = 1e-6

/** Цель F компактно: «27,8 тыс.»; меньше тысячи — с одним знаком. */
export function fmtScore(v: number): string {
  return Math.abs(v) >= 1000 ? `${num(v / 1000, 1)}${NBSP}тыс.` : num(v, 1)
}

/** Правила с той же целью F, что у выбранного (одинаковый порядок операций). */
export function tiedWithChosen(rules: readonly SchedRule[]): string[] {
  const chosen = rules.find((r) => r.chosen)
  if (!chosen) return []
  return rules.filter((r) => Math.abs(r.score - chosen.score) <= TIE_EPS * Math.max(1, Math.abs(chosen.score))).map((r) => r.rule)
}

/* ── Правила ─────────────────────────────────────────────────────────────── */

export function RulesTable({ result }: { result: ScheduleResult }) {
  const w = result.weights
  const chosen = result.rules.find((r) => r.chosen)
  const tied = tiedWithChosen(result.rules)
  const cols: DataColumn<SchedRule>[] = [
    { key: 'rule', title: 'Правило', rowHeader: true, get: (r) => ruleLabel(r.rule),
      render: (r) => <>{ruleLabel(r.rule, 'long')}{r.chosen && <Chip size="sm"><span aria-hidden="true">●</span> выбрано</Chip>}</> },
    { key: 'mk', title: 'E[Cmax], ч', num: true, get: (r) => r.makespan, render: (r) => num(r.makespan, 1) },
    { key: 'cvar', title: 'CVaR, ч', num: true, get: (r) => r.makespan_cvar, render: (r) => num(r.makespan_cvar, 1) },
    { key: 'tard', title: 'Просрочка, ч', num: true, get: (r) => r.tardiness, render: (r) => num(r.tardiness, 1) },
    { key: 'score', title: 'Цель F', num: true, get: (r) => r.score, render: (r) => fmtScore(r.score) },
    { key: 'delta', title: 'Δ F к выбранному', num: true, sortable: false,
      render: (r) => (chosen && !r.chosen ? <DeltaChip value={r.score - chosen.score} better="low" fmt={(v) => `${v > 0 ? '+' : ''}${fmtScore(v)}`} /> : '—') },
  ]
  return (
    <div className="pl-rules">
      <p className="pl-note">
        Веса цели: срок {num(w.time, 2)} · хвост риска {num(w.risk, 2)} · переналадки {num(w.cost, 2)} · α {pct(result.alpha, 0)}
        {tied.length > 1 && <> · {tied.map((r) => ruleLabel(r)).join(', ')} дают одинаковый порядок — выбрано первое по F</>}
      </p>
      <DataTable columns={cols} rows={result.rules} rowKey={(r) => r.rule} tight defaultSort={{ key: 'score', dir: 'asc' }}
        rowClassName={(r) => (r.chosen ? 'is-chosen' : undefined)} caption="Сравнение диспетчерских правил" />
    </div>
  )
}

/* ── Рабочие ─────────────────────────────────────────────────────────────── */

const digitsOnly = (name: string): boolean => /^\s*[\d\s.,-]+\s*$/.test(name)

export function WorkersTable({ result }: { result: ScheduleResult }) {
  const active = result.worker_plan.filter((w) => w.job_count > 0)
  const cols: DataColumn<WorkerPlan>[] = [
    { key: 'name', title: 'Рабочий', rowHeader: true, get: (w) => w.name,
      render: (w) => (digitsOnly(w.name)
        ? <>{w.name} <a className="pf-link pl-warnlink" href="#/nsi/workers"><span className="glyph-setup" aria-hidden="true" />проверьте имя — Справочники › Рабочие</a></>
        : w.name) },
    { key: 'jobs', title: 'Операций', num: true, get: (w) => w.job_count, render: (w) => num(w.job_count, 0) },
    { key: 'busy', title: 'Занят, ч', num: true, get: (w) => w.busy_hours, render: (w) => num(w.busy_hours, 1) },
    { key: 'idle', title: 'Свободен, ч', num: true, get: (w) => w.idle_hours, render: (w) => num(w.idle_hours, 1) },
    { key: 'util', title: 'Загрузка', num: true, get: (w) => w.utilization, render: (w) => pct(w.utilization, 0) },
  ]
  return (
    <DataTable columns={cols} rows={active} rowKey={(w) => w.worker_id} tight limit={WORKERS_TOP} defaultSort={{ key: 'util', dir: 'desc' }}
      empty="Назначений рабочих в плане нет" caption={`Планы по рабочим: ${hours(active.reduce((a, w) => a + w.busy_hours, 0), 0)} занятости`} />
  )
}
