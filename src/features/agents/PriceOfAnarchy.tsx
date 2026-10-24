/**
 * Игры цехов и банка — одна строка вкладки «Как устроен»: запланированы, чисел нет; формулы «цены
 * анархии» и Штакельберга — в реестре «i» (metrics.agent.ts) и в «Методике», узел [6] на карте.
 */
import { InfoTip } from '../../ui/InfoTip'

export function GamesStrip() {
  return (
    <p className="ag-strip">
      <span className="glyph-idle" aria-hidden="true" />
      <span>Игры цехов и банка — запланированы. Цена анархии <InfoTip id="agent.price_of_anarchy" /> и Штакельберг <InfoTip id="agent.stackelberg_rate" />:</span>
      <a className="ag-link" href="#/methodology/rl">формулы в Методике →</a>
      <a className="ag-link" href="#/map/ag.games">узел на карте ↗</a>
    </p>
  )
}
