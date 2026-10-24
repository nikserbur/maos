/**
 * Таблицы результата плана (X2 «таблицы, а не стены карточек»): сравнение правил и планы по рабочим —
 * DataTable кита (липкая шапка, человеческая первая колонка, числа вправо с единицами, сортировка).
 * Короткие таблицы — по содержимому (числа рядом с именем). У правил — «хуже лучшего правила, %»
 * (абсолютная целевая функция — в подсказке строки) и пометка о совпадающем порядке; часы — с одним знаком.
 * Заголовки — словами (E[Cmax], CVaR, F — в подсказках), правило — словами; латинский код — только в подсказке.
 * Имя рабочего из одних цифр — ▲ «проверьте имя». Числа — только через src/explain/format.ts.
 */
import type { ScheduleResult, SchedRule, WorkerPlan } from '../../lib/api'
import { NBSP, hours, num, pct } from '../../explain/format'
import { ruleLabel } from '../../explain/labels'
import { Chip, DataTable, type DataColumn } from '../../ui/kit'
import { ruleWords } from './ruleWords'

const WORKERS_TOP = 12
const TIE_EPS = 1e-6

/** Насколько целевая функция правила хуже лучшей, доля: 0 у лучшего; лучшая ≈ 0 — null (доля не определена). */
export function worseThanBest(score: number, best: number): number | null {
  if (!Number.isFinite(score) || !Number.isFinite(best) || Math.abs(best) < TIE_EPS) return null
  return (score - best) / Math.abs(best)
}

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
  const tied = tiedWithChosen(result.rules)
  const best = Math.min(...result.rules.map((r) => r.score))
  const cols: DataColumn<SchedRule>[] = [
    { key: 'rule', title: 'Правило', rowHeader: true, primary: true, get: (r) => ruleWords(r.rule),
      render: (r) => (
        <span className="pl-rule-cell" title={`Код правила: ${ruleLabel(r.rule)}`}>
          <span>{ruleWords(r.rule)}</span>
          {r.chosen && <Chip size="sm"><span aria-hidden="true">●</span> выбрано</Chip>}
        </span>
      ) },
    { key: 'mk', title: 'Средняя длина, ч', num: true, hint: 'E[Cmax] — средняя по сценариям длина расписания', get: (r) => r.makespan, render: (r) => num(r.makespan, 1) },
    { key: 'cvar', title: `Длина в худших ${pct(result.alpha, 0)} сценариев, ч`, num: true, hint: 'CVaR — средняя длина плана в худших α сценариях',
      get: (r) => r.makespan_cvar, render: (r) => num(r.makespan_cvar, 1) },
    { key: 'tard', title: 'Просрочка, ч', num: true, get: (r) => r.tardiness, render: (r) => num(r.tardiness, 1) },
    {
      key: 'score', title: 'Хуже лучшего правила, %', num: true,
      hint: 'Насколько целевая функция F (взвешенная сумма срока, хвоста риска и переналадок; меньше — лучше) выше, чем у лучшего правила. Абсолютное значение — в подсказке строки',
      get: (r) => r.score,
      render: (r) => { const v = worseThanBest(r.score, best); return <span title={`Целевая функция: ${fmtScore(r.score)}`}>{v === null ? '—' : v < TIE_EPS ? '0' : `+${num(v * 100, v < 0.1 ? 1 : 0)}`}</span> },
    },
  ]
  return (
    <div className="pl-rules">
      <p className="pl-note">
        Веса цели: срок {num(w.time, 2)} · хвост риска {num(w.risk, 2)} · переналадки {num(w.cost, 2)} · доля худших сценариев {pct(result.alpha, 0)}
        {tied.length > 1 && <> · правила «{tied.map((r) => ruleWords(r)).join('», «')}» дают одинаковый порядок — выбрано первое по целевой функции</>}
      </p>
      <DataTable columns={cols} rows={result.rules} rowKey={(r) => r.rule} tight width="content" defaultSort={{ key: 'score', dir: 'asc' }}
        rowClassName={(r) => (r.chosen ? 'is-chosen' : undefined)} caption="Сравнение диспетчерских правил" />
    </div>
  )
}

/* ── Рабочие ─────────────────────────────────────────────────────────────── */

const digitsOnly = (name: string): boolean => /^\s*[\d\s.,-]+\s*$/.test(name)

export function WorkersTable({ result }: { result: ScheduleResult }) {
  const active = result.worker_plan.filter((w) => w.job_count > 0)
  const cols: DataColumn<WorkerPlan>[] = [
    { key: 'name', title: 'Рабочий', rowHeader: true, primary: true, get: (w) => w.name,
      render: (w) => (digitsOnly(w.name)
        ? (
          <span className="pl-rule-cell pl-rule-cell--stack">
            <span>{w.name}</span>
            <a className="pf-link pl-warnlink" href="#/nsi/workers"><span className="glyph-setup" aria-hidden="true" />проверьте имя — Справочники › Рабочие</a>
          </span>
        )
        : w.name) },
    { key: 'jobs', title: 'Операций', num: true, get: (w) => w.job_count, render: (w) => num(w.job_count, 0) },
    { key: 'busy', title: 'Занят, ч', num: true, get: (w) => w.busy_hours, render: (w) => num(w.busy_hours, 1) },
    { key: 'idle', title: 'Свободен, ч', num: true, get: (w) => w.idle_hours, render: (w) => num(w.idle_hours, 1) },
    { key: 'util', title: 'Загрузка, %', num: true, get: (w) => w.utilization, render: (w) => num(w.utilization * 100, 0) },
  ]
  return (
    <DataTable columns={cols} rows={active} rowKey={(w) => w.worker_id} tight width="content" limit={WORKERS_TOP} defaultSort={{ key: 'util', dir: 'desc' }}
      empty="Назначений рабочих в плане нет" caption={`Планы по рабочим: ${hours(active.reduce((a, w) => a + w.busy_hours, 0), 0)} занятости`} />
  )
}
