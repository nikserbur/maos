/**
 * Первый сценарий (пустой экран «Сценарии»): вместо «Создайте из шаблона» — сразу галерея пресетов,
 * «Базовый — обучено на истории» выбран; одно нажатие создаёт сценарий с понятным именем.
 */
import { useState } from 'react'
import type { MacroRegimes } from '../../lib/api'
import { EmptyState } from '../../ui/kit'
import { PresetGallery } from './PresetGallery'
import { getPreset, type ScenarioPreset } from './scenarioPresets'
import { uniqueName } from './scenarioNames'

interface Props {
  regimes: MacroRegimes | null
  existing: readonly string[]
  busy: boolean
  onCreate: (name: string, description: string, preset: ScenarioPreset) => void
}

export function FirstScenario({ regimes, existing, busy, onCreate }: Props) {
  const [id, setId] = useState('base')
  const p = getPreset(id) ?? (getPreset('base') as ScenarioPreset)
  return (
    <div className="scp-first">
      <EmptyState kind="first-use" title="Сценариев пока нет — начните с пресета"
        action={(
          <button type="button" className="btn btn--primary" aria-busy={busy || undefined} disabled={busy}
            onClick={() => onCreate(uniqueName(p.short, existing), p.oneLine, p)}>
            {busy ? 'Создаём…' : `Создать «${p.short}»`}
          </button>
        )}>
        Сценарий — внешние условия для Портфеля и Плана: ключевая ставка, инфляция, курс, спрос и разброс цен.
        «Базовый» — прогноз генератора, обученного на истории Банка России; остальные — «что если».
      </EmptyState>
      <PresetGallery value={id} onChange={setId} regimes={regimes} />
    </div>
  )
}
