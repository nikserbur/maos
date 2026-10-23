/**
 * Панель «Структурные ходы агента» (UX-V2 §4.7.2) на результате плана: итог пакета («до → после»
 * по CVaR прибыли и кассы, P(разрыв), E[Cmax], OTD, доля выигрышных сценариев с ДИ), фильтр по виду
 * и статусу, «Принять все безопасные», строки ходов по вкладу в цель, обоснование по раскрытию.
 * Без RL — честное пустое состояние с причиной и пример на фикстурах с пометкой «пример».
 */
import { useState } from 'react'
import type { MoveStatus, ScheduleResult } from '../../../lib/api'
import { num, pct, signed } from '../../../explain/format'
import { InfoTip } from '../../../ui/InfoTip'
import { Chip, EmptyState, Segmented } from '../../../ui/kit'
import { disabledKinds } from '../../agents/guardrails'
import { useGuardrails } from '../../agents/guardrailsStore'
import { rlReason, useRlStatus } from '../../agents/rlStatusStore'
import { movesActions, useMovesSession } from './decisionsStore'
import { MoveJustification } from './MoveJustification'
import { MoveRow } from './MoveRow'
import { moveLabel } from './moveKinds'
import { acceptSafe, filterMoves, sortByGain, statusOf, summarize, type MoveFilter } from './movesStore'
import { ciText, pair } from './moveText'
import type { MovesSource } from './movesSource'
import './moves.css'

const STATUS_OPTS: ReadonlyArray<{ id: MoveFilter['status']; label: string }> = [
  { id: 'all', label: 'все' }, { id: 'proposed', label: 'предложены' }, { id: 'accepted', label: 'приняты' },
  { id: 'rejected', label: 'отклонены' }, { id: 'frozen', label: 'заморожены' },
]

interface Props {
  result: ScheduleResult
  source: MovesSource
}

export function MovesPanel({ result, source }: Props) {
  const rl = useRlStatus()
  const guard = useGuardrails()
  const session = useMovesSession(source.runKey)
  const [filter, setFilter] = useState<MoveFilter>({ kind: 'all', status: 'all' })
  const [open, setOpen] = useState<string | null>(null)
  const mr = source.moves
  const demo = source.kind === 'demo'

  if (!mr || source.kind === 'none') return null
  if (source.kind === 'agent-empty') {
    return (
      <EmptyState title="Агент не нашёл ходов лучше правила/ГА на отложенных сценариях" size="sm" diagram="agent-layers"
        action={<a className="btn btn--sm" href="#/agents">Полномочия и гейт — «Агенты»</a>}>
        Пакет пуст: ни один допустимый ход не улучшил CVaR прибыли на {num(mr.n_scenarios ?? 0, 0)} сценариях CRN — план остаётся как построен
        (та же честность, что «оставлено EDD» у ГА).
      </EmptyState>
    )
  }

  const moves = mr.moves
  const kinds = [...new Set(moves.map((m) => m.kind))]
  const rows = sortByGain(filterMoves(moves, session.decisions, filter))
  const sum = summarize(moves, session.decisions, guard.value.allowed)
  const off = disabledKinds(guard.value)
  const t = mr.totals
  const n = mr.n_scenarios ?? 0
  const level = moves[0]?.agent.level ?? 'L2'
  const policy = moves[0]?.agent.policy_version ?? '—'
  const acceptAllSafe = () => {
    const r = acceptSafe(session.decisions, moves)
    movesActions.setDecisions(source.runKey, r.state, r.accepted.length ? `Принято безопасных: ${r.accepted.length}` : 'Безопасных ходов (выигрыш ≥ 75 % и ДИ > 0) среди предложенных нет')
  }

  return (
    <div className={`mv${demo ? ' mv--demo' : ''}`}>
      {demo && (
        <div className="mv-demo" role="note">
          <Chip tone="setup">пример</Chip>
          <p className="mv-demo__text">
            <b>Правило «RL» в этом прогоне не работало</b> — {rlReason(rl)}. Ниже — пример пакета на фикстурах поверх вашего Ганта:
            цели настоящие (заказы, операции, станки этого плана), деньги — иллюстративные. Решения меняют только диф ниже и живут в этой сессии — в полномочия проекта пример не пишет.
          </p>
          <a className="btn btn--sm" href="#/agents">Почему — «Агенты»</a>
        </div>
      )}

      <div className="mv-total">
        <p className="mv-total__eyebrow text-caps">
          {level} · {policy} · {sum.proposed} предложено · {sum.accepted} принято · {sum.frozen} заморожено
          <InfoTip id="agent.move_gain" values={{ cvar_after: t.profit.cvar_after, cvar_before: t.profit.cvar_before, gain: t.profit.cvar_after - t.profit.cvar_before, ci_lo: t.ci95[0], ci_hi: t.ci95[1], alpha: guard.value.alpha, n }} />
        </p>
        <dl className="mv-total__grid">
          <div><dt>CVaR прибыли</dt><dd className="num">{pair(t.profit.cvar_before, t.profit.cvar_after)} <b className="mv-good">({signed(t.profit.cvar_after - t.profit.cvar_before, '₽')})</b></dd></div>
          <div><dt>CVaR кассы</dt><dd className="num">{pair(t.cash.min_cash_cvar_before, t.cash.min_cash_cvar_after)}</dd></div>
          <div><dt>P(разрыв)</dt><dd className="num">{pct(t.cash.p_gap_before, 0)} → {pct(t.cash.p_gap_after, 0)}</dd></div>
          <div><dt>E[Cmax] · OTD</dt><dd className="num">{signed(t.schedule.cmax_e_delta_h, 'ч')} · OTD {signed(t.schedule.otd_delta, '%')}</dd></div>
          <div><dt>Выигрыш <InfoTip id="agent.win_share" values={{ win: t.win_share }} /></dt><dd className="num">в {pct(t.win_share, 0)}{n ? ` из ${num(n, 0)} сценариев` : ''} · {ciText(t)}</dd></div>
        </dl>
        <p className="pl-note">Атрибуция — на пакет: «до → после» строк ходов не складываются в итог (A1 §6). Σ принятых: {signed(sum.gainAccepted, '₽')} по CVaR прибыли.</p>
      </div>

      <div className="mv-tools">
        <label className="mv-tools__kind">вид:
          <select className="plan__select" value={filter.kind} onChange={(e) => setFilter((f) => ({ ...f, kind: e.target.value }))} aria-label="Фильтр по виду хода">
            <option value="all">все виды</option>
            {kinds.map((k) => <option key={k} value={k}>{moveLabel(k)}</option>)}
          </select>
        </label>
        <Segmented label="Фильтр по статусу" size="sm" fit value={filter.status} onChange={(s: MoveFilter['status']) => setFilter((f) => ({ ...f, status: s }))} options={STATUS_OPTS} />
        <span className="mv-tools__spacer" />
        {off.length > 0 && <span className="pl-note">отключено пользователем: {off.length} {off.length === 1 ? 'вид' : 'вида'} · <a className="mv-link" href="#/agents">полномочия</a></span>}
        <button type="button" className="btn btn--sm" onClick={acceptAllSafe} title="Выигрыш ≥ 75 % сценариев, ДИ выше нуля, родители тоже безопасны; заморозки не трогаются">
          Принять все безопасные
        </button>
      </div>
      <p className="dk-vh" aria-live="polite">{session.notice ?? ''}</p>
      {session.notice && <p className="mv-notice">{session.notice}</p>}

      <ol className="mv-list" aria-label="Ходы агента по вкладу в цель">
        {rows.map((m) => {
          const st: MoveStatus = statusOf(m, session.decisions)
          return (
            <li key={m.id} className="mv-item">
              <MoveRow move={m} status={st} reason={session.decisions.reasons[m.id]} gantt={result.gantt}
                selected={session.selectedId === m.id} expanded={open === m.id}
                onSelect={() => movesActions.select(source.runKey, session.selectedId === m.id ? null : m.id)}
                onToggle={() => setOpen((o) => (o === m.id ? null : m.id))}
                onDecide={(d, reason) => movesActions.decide(source.runKey, moves, m.id, d, reason)}
                onUndo={() => movesActions.clear(source.runKey, m.id)} />
              {open === m.id && <MoveJustification move={m} moves={moves} nScenarios={n} />}
            </li>
          )
        })}
        {rows.length === 0 && <li className="pl-note mv-list__empty">Под фильтр не попал ни один ход.</li>}
      </ol>
      {sum.frozen > 0 && <p className="pl-note">Заморожено: {sum.frozen} — агент получит их как маску «не менять станок, время и маршрут»; снять — в полномочиях на экране «Агенты».</p>}
    </div>
  )
}
