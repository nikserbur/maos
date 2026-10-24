/**
 * Обоснование хода (UX-V2 §4.7.2): режим внешних условий с долей (полоса долей chart-системы),
 * сценарии с наибольшим выигрышем и их параметры (DataTable кита), узлы карты, через которые ход
 * влияет на результат (переход в `#/map/<узел>`), проверенные маски, зависимости пакета, текст агента.
 */
import type { StructuralMove } from '../../../lib/api'
import { money, num, pct } from '../../../explain/format'
import { StackBar } from '../../../ui/charts'
import { Chip, DataTable, type DataColumn } from '../../../ui/kit'
import { getNode } from '../../method-map/registry'
import { moveLabel } from './moveKinds'
import { isDemoMove } from './fixtures'

type Scn = StructuralMove['justification']['scenarios'][number]

const opt = (v: number | undefined, f: (x: number) => string) => (v === undefined ? '—' : f(v))

const COLUMNS: ReadonlyArray<DataColumn<Scn>> = [
  { key: 'idx', title: 'Сценарий', rowHeader: true, width: 'fit', get: (s) => s.idx, render: (s) => `№ ${num(s.idx, 0)}` },
  { key: 'key_rate', title: 'Ключевая ставка, %', num: true, render: (s) => opt(s.key_rate, (v) => num(v * 100, 0)) },
  { key: 'price_shock', title: 'Шок цены, %', num: true, render: (s) => opt(s.price_shock, (v) => num(v * 100, 0)) },
  { key: 'lead_delay_h', title: 'Задержка поставки, ч', num: true, render: (s) => opt(s.lead_delay_h, (v) => num(v, 0)) },
  { key: 'gain', title: 'Выигрыш', num: true, hint: 'Прибыль хода в этом сценарии, ₽', render: (s) => money(s.gain) },
]

interface Props {
  move: StructuralMove
  moves: readonly StructuralMove[]
  nScenarios?: number
}

export function MoveJustification({ move, moves, nScenarios }: Props) {
  const j = move.justification
  const deps = (move.depends_on ?? []).map((id) => moves.find((m) => m.id === id)).filter((m): m is StructuralMove => Boolean(m))
  const dependants = moves.filter((m) => (m.depends_on ?? []).includes(move.id))
  return (
    <div className="mv-just">
      <div className="mv-just__regime">
        <StackBar
          title={<>Режим: {j.regime.label}</>}
          subtitle={nScenarios ? `доля сценариев режима из ${nScenarios}` : 'доля сценариев режима'}
          fmt={(v) => pct(v, 0)}
          segments={[
            { key: 'reg', label: j.regime.label, value: j.regime.share, color: 'var(--cinnabar)' },
            { key: 'rest', label: 'остальные режимы', value: Math.max(0, 1 - j.regime.share), color: 'var(--chart-other)' },
          ]}
          ariaLabel={`Режим «${j.regime.label}»: ${pct(j.regime.share, 0)} сценариев`}
        />
        {j.text && <p className="mv-just__text">{j.text}{isDemoMove(move) && <Chip tone="setup" size="sm">пример</Chip>}</p>}
      </div>

      <div className="mv-just__scn">
        <p className="mv-just__h text-caps">Сценарии с наибольшим выигрышем</p>
        <DataTable columns={COLUMNS} rows={j.scenarios} rowKey={(s) => String(s.idx)} tight empty="агент не передал сценарии" caption="Сценарии обоснования хода" />
      </div>

      <div className="mv-just__side">
        <p className="mv-just__h text-caps">Через какие узлы карты</p>
        <ul className="mv-just__nodes">
          {j.map_nodes.map((id) => (
            <li key={id}><a className="mv-link" href={`#/map/${id}`}>{getNode(id)?.title ?? id} ↗</a></li>
          ))}
          {j.map_nodes.length === 0 && <li className="pl-note">не указаны</li>}
        </ul>
        {move.masks_checked.length > 0 && (
          <>
            <p className="mv-just__h text-caps">Проверенные маски</p>
            <ul className="mv-just__masks">{move.masks_checked.map((m) => <li key={m}><span className="glyph-running" aria-hidden="true" /> {m}</li>)}</ul>
          </>
        )}
        {(deps.length > 0 || dependants.length > 0) && (
          <>
            <p className="mv-just__h text-caps">Пакет</p>
            <ul className="mv-just__masks">
              {deps.map((d) => <li key={d.id}>нужен ход «{moveLabel(d.kind)}» — принимается вместе</li>)}
              {dependants.map((d) => <li key={d.id}>от него зависит «{moveLabel(d.kind)}» — отклонение снимет и его</li>)}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
