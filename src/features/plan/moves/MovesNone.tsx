/**
 * Ходов агента в прогоне нет (X2 «иллюстрация никогда не выглядит результатом»): одна строка с причиной
 * и переходом к «Агентам». Пример пакета на фикстурах — только по раскрытию, в штриховой рамке, с
 * пометкой «пример» и иллюстративными деньгами; в оглавлении результата его нет.
 */
import type { ScheduleResult } from '../../../lib/api'
import { rlAvailable, useRlStatus } from '../../agents/rlStatusStore'
import { MovesPanel } from './MovesPanel'
import type { MovesSource } from './movesSource'
import './moves.css'

/** Причина словами: правило RL не выбиралось или политика не опубликована. */
export function noMovesReason(rule: string, rlPublished: boolean): string {
  if (String(rule).toUpperCase() !== 'RL' && rlPublished) return 'правило RL в этом прогоне не выбиралось'
  return 'политика RL не опубликована (гейт не пройден)'
}

export function MovesNone({ result, source }: { result: ScheduleResult; source: MovesSource }) {
  const rl = useRlStatus()
  const reason = noMovesReason(result.rule, rlAvailable(rl.status))
  return (
    <section className="mv-none" aria-label="Ходы агента">
      <p className="mv-none__line">
        <span className="glyph-idle" aria-hidden="true" />
        Ходов агента нет: {reason} · <a className="pf-link" href="#/agents">Почему → Агенты</a>
      </p>
      {source.kind === 'demo' && (
        <details className="mv-none__demo">
          <summary>Показать пример (иллюстративные деньги) ▸</summary>
          <MovesPanel result={result} source={source} />
        </details>
      )}
    </section>
  )
}
