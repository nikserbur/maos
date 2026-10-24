/**
 * Передача портфеля в «План» (X2 «конвейер виден»: Сценарий → Портфель → План): один блок под
 * вердиктом героя — название программы и кнопка «Передать в «План» →» (primary, когда результат
 * свежий). Успех — «● Сохранено · чч:мм» и ссылка в мастер плана; контекст решения запоминает прогон
 * и программу. Сбой — баннер ошибки простыми словами (никогда не зелёный), сырой текст — в «Подробнее».
 */
import { useState } from 'react'
import { api } from '../../lib/api'
import { countText, dateTime, time } from '../../explain/format'
import { setDecisionContext } from '../../shell/context'
import { Chip, ErrorBanner, errorText } from '../../ui/kit'

const PRODUCTS = ['изделие', 'изделия', 'изделий'] as const
const WIZARD_PROGRAM = '#/plan/new/program'

interface Saved { name: string; orders: number; at: number }

interface PlanHandoffProps {
  runId: string
  /** Главное действие региона: true, пока результат свежий (иначе главное — «Пересчитать»). */
  primary: boolean
}

export function PlanHandoff({ runId, primary }: PlanHandoffProps) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<Saved | null>(null)
  const [failure, setFailure] = useState<unknown>(null)

  const save = async () => {
    if (saving) return
    setSaving(true)
    setFailure(null)
    try {
      const p = await api.optimize.savePlan(runId, name.trim() || `Портфель ${dateTime(Date.now())}`)
      setSaved({ name: p.name, orders: p.orders, at: Date.now() })
      setDecisionContext({ portfolioRunId: runId, planId: p.id })
      setName('')
    } catch (e) {
      setSaved(null)
      setFailure(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="opt-handoff" role="group" aria-labelledby="opt-handoff-label">
      <span className="dk-vh" id="opt-handoff-label">Передать портфель в «План»</span>
      <div className="opt-handoff__row">
        <input className="dk-input opt-handoff__name" value={name} aria-label="Название производственной программы"
          placeholder="Название программы — необязательно" onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void save() }} />
        <button type="button" className={`btn${primary ? ' btn--primary' : ''}`} onClick={() => void save()} disabled={saving} aria-busy={saving || undefined}>
          {saving ? 'Передаём…' : 'Передать в «План» →'}
        </button>
      </div>
      <div className="opt-handoff__status" role="status" aria-live="polite">
        {saved && (
          <>
            <Chip size="sm"><span className="glyph-running" aria-hidden="true" />Сохранено · {time(saved.at)}</Chip>
            <span className="opt-handoff__what">Программа «{saved.name}» — {countText(saved.orders, PRODUCTS)}</span>
            <a className="opt-link" href={WIZARD_PROGRAM}>Открыть в мастере плана →</a>
          </>
        )}
      </div>
      {failure !== null && (
        <ErrorBanner title="Программа не сохранена" message={errorText(failure)} error={failure} onRetry={() => void save()} retrying={saving} />
      )}
    </div>
  )
}
