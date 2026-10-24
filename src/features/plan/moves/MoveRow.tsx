/**
 * Строка хода (UX-V2 §4.7.2): ▲/■ · вид и цели (до двух строк) · CVaR прибыли «до → после» · касса и
 * разрыв · доля выигрышных сценариев с ДИ · режим-обоснование · решение: «Принять» в строке,
 * «Отклонить с причиной…» и «Заморозить» — в «⋯». Числа «до → после» парами в одних единицах;
 * Δ — стрелка ▲▼ + слово (DeltaChip), цвет никогда не один.
 */
import { useState } from 'react'
import type { GanttJob, MoveStatus, StructuralMove } from '../../../lib/api'
import { pct, signed } from '../../../explain/format'
import { Meter } from '../../../ui/charts'
import { Chip, DeltaChip, Menu, type ChipTone } from '../../../ui/kit'
import { Icon } from '../../../shell/icons'
import { moveLabel } from './moveKinds'
import { REJECT_REASONS, SAFE_WIN_SHARE, isSafe, type Decision } from './movesStore'
import { cashDelta, changeText, ciText, pair, profitDelta, riskGlyph, targetText } from './moveText'

export const STATUS_LABEL: Readonly<Record<MoveStatus, string>> = {
  proposed: 'предложен', accepted: 'принят', rejected: 'отклонён', applied: 'применён', frozen: 'заморожен',
}
const STATUS_TONE: Readonly<Record<MoveStatus, ChipTone>> = {
  proposed: 'idle', accepted: 'good', rejected: 'bad', applied: 'good', frozen: 'info',
}

interface Props {
  move: StructuralMove
  status: MoveStatus
  reason?: string
  gantt: readonly GanttJob[]
  selected: boolean
  expanded: boolean
  onSelect: () => void
  onToggle: () => void
  onDecide: (d: Decision, reason?: string) => void
  onUndo: () => void
}

export function MoveRow({ move, status, reason, gantt, selected, expanded, onSelect, onToggle, onDecide, onUndo }: Props) {
  const [rejecting, setRejecting] = useState(false)
  const [why, setWhy] = useState<string>(REJECT_REASONS[0])
  const i = move.impact
  const glyph = riskGlyph(i)
  const dp = profitDelta(i)
  const dc = cashDelta(i)
  const decided = status !== 'proposed'
  const deps = (move.depends_on ?? []).length
  return (
    <div className={`mv-row${selected ? ' is-selected' : ''} is-${status}`} data-move={move.id}>
      <span className={`mv-row__glyph mv-row__glyph--${glyph}`} aria-label={glyph === 'up' ? 'улучшение по цели' : 'риск: ДИ задевает ноль'} role="img" />
      <div className="mv-row__main">
        <button type="button" className="mv-row__what" onClick={onSelect} aria-pressed={selected} title="Подсветить на дифе Ганта">
          <span className="mv-row__kind">{moveLabel(move.kind)} · {targetText(move, gantt)}</span>
          <span className="mv-row__change">{changeText(move, gantt)}{deps > 0 && <em className="mv-row__dep"> · пакетом с ходом выше</em>}</span>
        </button>
        <span className="mv-row__why">
          <Chip size="sm" tone="idle">режим: {move.justification.regime.label} · {pct(move.justification.regime.share, 0)}</Chip>
          <button type="button" className="pf-link mv-row__more" aria-expanded={expanded} onClick={onToggle}>
            {expanded ? 'скрыть обоснование' : 'обоснование'}
          </button>
        </span>
      </div>
      <div className="mv-row__num mv-row__num--profit">
        <span className="text-caps mv-row__lbl">CVaR прибыли</span>
        <span className="num">{pair(i.profit.cvar_before, i.profit.cvar_after)}</span>
        <DeltaChip value={dp} better="high" fmt={(v) => signed(v, '₽')} />
      </div>
      <div className="mv-row__num mv-row__num--cash">
        <span className="text-caps mv-row__lbl">CVaR кассы</span>
        <span className="num">{pair(i.cash.min_cash_cvar_before, i.cash.min_cash_cvar_after)}</span>
        <span className="num mv-row__sub">{dc === 0 ? 'касса ±0' : `P(разрыв) ${pct(i.cash.p_gap_before, 0)} → ${pct(i.cash.p_gap_after, 0)}`}</span>
      </div>
      <div className="mv-row__win">
        <span className="text-caps mv-row__lbl">выигрыш в {pct(i.win_share, 0)}</span>
        <Meter value={i.win_share} mark={SAFE_WIN_SHARE} tone={isSafe(move) ? 'good' : i.win_share >= 0.5 ? 'warn' : 'danger'}
          label={`Доля выигрышных сценариев ${pct(i.win_share, 0)}; порог безопасного хода ${pct(SAFE_WIN_SHARE, 0)}`} />
        <span className="num mv-row__sub">{ciText(i)}</span>
      </div>
      <div className="mv-row__act">
        {decided ? (
          <>
            <Chip tone={STATUS_TONE[status]} title={reason}>{STATUS_LABEL[status]}{status === 'frozen' ? ' · не трогать' : ''}</Chip>
            {reason && status === 'rejected' && <span className="mv-row__reason">{reason}</span>}
            <button type="button" className="btn btn--ghost btn--sm" onClick={onUndo}>отменить</button>
          </>
        ) : rejecting ? (
          <span className="mv-row__reject" role="group" aria-label="Причина отклонения">
            <select className="pl-select pl-select--sm" value={why} onChange={(e) => setWhy(e.target.value)} aria-label="Причина отклонения">
              {REJECT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <button type="button" className="btn btn--sm" onClick={() => { onDecide('reject', why); setRejecting(false) }}>Отклонить</button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setRejecting(false)}>Отмена</button>
          </span>
        ) : (
          <>
            <button type="button" className="btn btn--sm" onClick={() => onDecide('accept')} title="Принять (a)"><Icon name="check" size={14} /> Принять</button>
            <Menu label="Ещё действия с ходом" size="sm" items={[
              { id: 'reject', label: 'Отклонить с причиной…', hint: 'станет маской: агент не предложит этот ход снова', onSelect: () => setRejecting(true) },
              { id: 'freeze', label: 'Заморозить', icon: 'pin', hint: 'не трогать эти операции, станок и время (f)', onSelect: () => onDecide('freeze') },
            ]} />
          </>
        )}
      </div>
    </div>
  )
}
