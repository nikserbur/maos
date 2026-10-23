/**
 * Режим «Маршрут» дифа плана (UX-V2 §4.8): по заказам — цепочка операций «до» с пометками
 * удалено / перенесено (с новым станком) / заморожено и добавленные «после». Изменённые заказы
 * первыми; цепочка читается слева направо как техкарта.
 */
import type { RouteDiffRow } from './diffModel'
import { DIFF_KIND_LABEL } from './diffModel'

interface Props {
  rows: readonly RouteDiffRow[]
  showUnchanged: boolean
}

export function RouteDiff({ rows, showUnchanged }: Props) {
  const shown = rows.filter((r) => showUnchanged || r.changed)
  if (shown.length === 0) return <p className="pl-note gd-empty">Маршруты не изменились: принятые ходы не трогают операции.</p>
  return (
    <ol className="rd" aria-label="Маршруты заказов: до и после ходов">
      {shown.map((r) => (
        <li key={r.orderIdx} className={`rd-row${r.changed ? ' is-changed' : ''}`}>
          <span className="rd-row__head">
            <b className="num">#{r.orderIdx}</b> {r.product}
          </span>
          <ol className="rd-chain">
            {r.steps.map((s, i) => (
              <li key={`${s.op_id}-${i}`} className={`rd-step rd-step--${s.kind}`} title={`${s.op_name} · ${s.wc_name} — ${DIFF_KIND_LABEL[s.kind]}`}>
                <span className="rd-step__op">{s.op_name}{s.count > 1 && <b className="rd-step__n num"> ×{s.count}</b>}</span>
                <span className="rd-step__wc">{s.wc_name}</span>
                {s.kind !== 'same' && <span className="rd-step__kind text-caps">{DIFF_KIND_LABEL[s.kind]}</span>}
              </li>
            ))}
          </ol>
        </li>
      ))}
    </ol>
  )
}
