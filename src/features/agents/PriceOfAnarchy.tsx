/**
 * Игры (METHODOLOGY-V2 §7.5, волна V6 — не начата): «Цена анархии» стимулов цехов и Штакельберг
 * «банк/поставщик → предприятие». Состояние `planned`: формулы — из реестра «i» (metrics.agent.ts),
 * значения — «—»; никаких выдуманных чисел. Показано, что понадобится для расчёта и откуда.
 */
import { bindFormulaParts } from '../../explain/format'
import { getMetric } from '../../explain/metrics'
import { InfoTip } from '../../ui/InfoTip'
import { Chip } from '../../ui/kit'

const GAMES: ReadonlyArray<{ id: string; title: string; needs: string[] }> = [
  { id: 'agent.price_of_anarchy', title: 'Цена анархии', needs: ['KPI цехов и внутренние цены (НСИ)', 'mean-field равновесие игры цехов', 'кооперативная политика на той же среде', 'ДИ по сидам'] },
  { id: 'agent.stackelberg_rate', title: 'Штакельберг · банк / поставщик', needs: ['P(разрыв) предприятия из симулятора кассы', 'LGD банка [НОРМ]', 'сетка ставок r и лимитов', 'внутренний CVaR-LP предприятия'] },
]

export function PriceOfAnarchy() {
  return (
    <div className="ag-games">
      {GAMES.map((g) => {
        const m = getMetric(g.id)
        if (!m) return null
        return (
          <article key={g.id} className="ag-game" aria-labelledby={`${g.id}-t`}>
            <header className="ag-game__hd">
              <h3 className="ag-game__t" id={`${g.id}-t`}>{g.title} <InfoTip id={g.id} /></h3>
              <Chip tone="idle">в плане · волна «Игры» (V6)</Chip>
            </header>
            <p className="ag-game__short">{m.short}</p>
            <div className="ag-game__formula mono" aria-label={`Формула: ${m.title}`}>
              {m.formula.split('\n').map((line, li) => (
                <div key={li}>
                  {bindFormulaParts(line, {}, m.variables).map((p, i) => (p.kind === 'text'
                    ? <span key={i}>{p.text}</span>
                    : <b key={i} className="ag-game__slot" title="значение появится после расчёта">{p.text}</b>))}
                </div>
              ))}
            </div>
            <p className="text-caps ag-game__needs-h">Что нужно для расчёта</p>
            <ul className="ag-game__needs">{g.needs.map((n) => <li key={n}><span className="glyph-idle" aria-hidden="true" /> {n}</li>)}</ul>
          </article>
        )
      })}
    </div>
  )
}
