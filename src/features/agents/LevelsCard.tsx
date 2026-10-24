/**
 * Два уровня агента (A1 §2.2, RL-METHODOLOGY-PROPOSAL §3) — свёрнутое пояснение вкладки «Как устроен»:
 * L0 — диспетчер (порядок операций, решение — когда станок освободился), L2 — планировщик (структурные
 * ходы на границе недели). Виды ходов и маски — один раз, в таблице «Полномочий».
 */
const LEVELS: ReadonlyArray<{ id: 'L0' | 'L2'; title: string; epoch: string; action: string; mask: string; out: string }> = [
  {
    id: 'L0', title: 'Диспетчер',
    epoch: 'станок освободился (событие)', action: 'одна из готовых операций или «ждать»',
    mask: 'предшественники завершены, тип станка допустим, есть допущенный рабочий, календарь открыт, запуск заказа наступил',
    out: 'ключ приоритетов → тот же Гант и Монте-Карло, что у правил',
  },
  {
    id: 'L2', title: 'Планировщик структуры',
    epoch: 'граница недели (до 3 ходов за неделю)', action: 'структурный ход из меню или «ничего»',
    mask: 'только не начатые заказы; маски каждого вида — в таблице «Полномочий»',
    out: 'ходы «до → после» по CVaR прибыли и кассы на тех же сценариях',
  },
]

export function LevelsCard() {
  return (
    <details className="ag-details ag-levels">
      <summary>Два уровня агента: L0 — диспетчер, L2 — планировщик структуры</summary>
      <div className="ag-levels__pair">
        {LEVELS.map((l) => (
          <article key={l.id} className="ag-level" aria-labelledby={`ag-level-${l.id}`}>
            <h3 className="ag-level__t" id={`ag-level-${l.id}`}><span className="mono">{l.id}</span> · {l.title}</h3>
            <dl className="ag-level__dl">
              <div><dt>Когда решает</dt><dd>{l.epoch}</dd></div>
              <div><dt>Действие</dt><dd>{l.action}</dd></div>
              <div><dt>Маска</dt><dd>{l.mask}</dd></div>
              <div><dt>Что отдаёт</dt><dd>{l.out}</dd></div>
            </dl>
          </article>
        ))}
      </div>
      <p className="ag-note">
        Маска — не штраф, а запрет по построению: недопустимое действие агенту даже не показывается. Поэтому выключенный в полномочиях вид хода агент не предложит ни разу.
      </p>
    </details>
  )
}
