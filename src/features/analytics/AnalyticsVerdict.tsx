/**
 * Строка-вердикт под шапкой «Аналитики» (X2 «ответ сначала»): одно предложение о выбранном
 * построении и переход к следующему действию — инвестпроекту для узкого места. Числа — текстовым
 * цветом; глиф (▲/■) и слово — только у отклонения. Пока KPI грузятся — скелет той же высоты.
 */
import { Skeleton } from '../../ui/kit'
import type { Verdict } from './verdict'

interface AnalyticsVerdictProps {
  verdict: Verdict | null
  loading: boolean
  onInvest: (wcTypeId: string) => void
}

export function AnalyticsVerdict({ verdict, loading, onInvest }: AnalyticsVerdictProps) {
  if (loading || !verdict) {
    return (
      <div className="an-verdict" aria-busy="true" aria-label="Итог построения загружается">
        <Skeleton h={18} w="min(640px, 70%)" />
      </div>
    )
  }
  const last = verdict.facts.length - 1
  const bn = verdict.bottleneck
  return (
    <div className="an-verdict" role="group" aria-label="Итог построения">
      <p className="an-verdict__text">
        <span className="an-verdict__head">{verdict.head}:</span>{' '}
        {verdict.facts.map((f, i) => (
          <span key={f.key} className="an-verdict__fact">
            {f.glyph && <span className={f.glyph} aria-hidden="true" />}
            {f.text}
            {f.word && <span className="dk-vh"> — {f.word}</span>}
            {i < last ? '; ' : ''}
          </span>
        ))}
      </p>
      {bn && (
        <button type="button" className="btn btn--sm an-verdict__act" onClick={() => onInvest(bn.typeId)}
                title={`Оценить докупку оборудования «${bn.name}»`}>
          Инвестпроект →
        </button>
      )}
    </div>
  )
}
