/**
 * «Один α на всех» (UX-V2 §4.10): уровень хвоста α живёт в активном сценарии (паспорт
 * `scenario.alpha`, владелец — сценарий). Портфель, план, касса, карта и агент читают его же;
 * правка отсюда пишется в сам сценарий (PUT /api/scenarios/:id, дебаунс 400 мс — как ползунки
 * экрана «Сценарии»), после чего кэш справочников карты обновляется — подписи меняются везде.
 */
import { useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { useDecisionContext } from '../../shell/context'
import { useOptStore } from '../optimization/optStore'
import { ensureRefs, invalidateScenario, resolveScenarioId, useRefs } from '../method-map/useMethodMapState'
import { payloadOf } from './scenarioPayload'

const SAVE_DEBOUNCE_MS = 400
export const ALPHA_FALLBACK = 0.1

export type AlphaSave = 'idle' | 'pending' | 'saved' | 'error'

export interface ScenarioAlpha {
  /** Доля (0,01…0,5). */
  alpha: number
  scenarioId: string
  scenarioName: string | null
  /** Из сценария или запасное значение (сценария нет). */
  fromScenario: boolean
  save: AlphaSave
  setAlpha: (v: number) => void
}

export function useScenarioAlpha(): ScenarioAlpha {
  const refs = useRefs()
  useDecisionContext()
  const opt = useOptStore()
  const [local, setLocal] = useState<number | null>(null)
  const [save, setSave] = useState<AlphaSave>('idle')
  const timer = useRef<number>()

  useEffect(() => { void ensureRefs() }, [])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const scenarioId = resolveScenarioId(refs, opt.form.scenarioId, opt.result?.scenario_id)
  const sc = refs.full[scenarioId] ?? refs.scenarios.find((s) => s.id === scenarioId) ?? null
  const stored = sc ? Number(sc.alpha) : Number.NaN
  const fromScenario = Number.isFinite(stored) && stored > 0
  const alpha = local ?? (fromScenario ? stored : ALPHA_FALLBACK)

  const setAlpha = (v: number) => {
    if (!scenarioId || !Number.isFinite(v)) return
    const next = Math.min(0.5, Math.max(0.01, v))
    setLocal(next)
    setSave('pending')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      api.scenarios.get(scenarioId)
        .then((full) => api.scenarios.update(scenarioId, payloadOf(full, { alpha: next })))
        .then(() => { invalidateScenario(scenarioId); return ensureRefs(true) })
        .then(() => { setSave('saved'); setLocal(null) })
        .catch(() => setSave('error'))
    }, SAVE_DEBOUNCE_MS)
  }

  return { alpha, scenarioId, scenarioName: sc?.name ?? null, fromScenario, save, setAlpha }
}
