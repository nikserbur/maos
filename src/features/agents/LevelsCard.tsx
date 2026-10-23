/**
 * Два уровня агента (A1 §2.2, RL-METHODOLOGY-PROPOSAL §3): L0 — диспетчер типа РЦ (порядок
 * операций, момент решения — станок освободился), L2 — планировщик (структурные ходы на границе
 * недели). Ниже — словарь ходов с жёсткими масками и готовностью на демо-НСИ (moveKinds).
 */
import { Chip, DataTable, type DataColumn } from '../../ui/kit'
import { MOVE_KINDS, READINESS_LABEL, type MoveKindMeta } from '../plan/moves/moveKinds'

const LEVELS: ReadonlyArray<{ id: 'L0' | 'L2'; title: string; epoch: string; action: string; mask: string; out: string }> = [
  {
    id: 'L0', title: 'Диспетчер типа РЦ',
    epoch: 'станок освободился (событие)', action: 'одна из 16 готовых операций или «ждать»',
    mask: 'предшественники завершены, тип станка допустим, есть допущенный рабочий, календарь открыт, запуск заказа наступил',
    out: 'ключ приоритетов (ранг старта) → тот же конвейер Ганта и Монте-Карло, что у правил',
  },
  {
    id: 'L2', title: 'Планировщик структуры',
    epoch: 'граница недели (до 3 ходов за неделю)', action: 'структурный ход из меню или «ничего»',
    mask: 'только не начатые заказы; маски каждого вида — в таблице ниже',
    out: 'moves[] с «до → после» по CVaR прибыли и кассы на N сценариях CRN',
  },
]

const tone = (m: MoveKindMeta) => (m.readiness === 'done' ? 'good' : m.readiness === 'nsi' ? 'setup' : 'idle')

const COLS: ReadonlyArray<DataColumn<MoveKindMeta>> = [
  { key: 'label', title: 'Ход', rowHeader: true },
  { key: 'level', title: 'Уровень', className: 'mono' },
  { key: 'what', title: 'Что меняется в плане' },
  { key: 'mask', title: 'Жёсткая маска' },
  { key: 'readiness', title: 'Готовность', get: (m) => READINESS_LABEL[m.readiness],
    render: (m) => (
      <span className="ag-ready">
        <Chip size="sm" tone={tone(m)}>{READINESS_LABEL[m.readiness]}</Chip>
        {m.note && <span className="ag-ready__note">{m.note}</span>}
      </span>
    ) },
]

export function LevelsCard() {
  return (
    <div className="ag-levels">
      <div className="ag-levels__side">
        <div className="ag-levels__pair">
          {LEVELS.map((l) => (
            <article key={l.id} className={`ag-level ag-level--${l.id}`}>
              <p className="ag-level__id mono">{l.id}</p>
              <h3 className="ag-level__t">{l.title}</h3>
              <dl className="ag-level__dl">
                <div><dt>Когда решает</dt><dd>{l.epoch}</dd></div>
                <div><dt>Действие</dt><dd>{l.action}</dd></div>
                <div><dt>Маска</dt><dd>{l.mask}</dd></div>
                <div><dt>Что отдаёт</dt><dd>{l.out}</dd></div>
              </dl>
            </article>
          ))}
        </div>
        <p className="pl-note">
          Маска — не штраф, а запрет по построению: недопустимое действие агенту даже не показывается (маскирование логитов).
          Поэтому выключенный в полномочиях вид хода агент не предложит ни разу.
        </p>
      </div>
      <DataTable columns={COLS} rows={MOVE_KINDS} rowKey={(m) => m.kind} tight caption="Словарь структурных ходов и масок" />
    </div>
  )
}
