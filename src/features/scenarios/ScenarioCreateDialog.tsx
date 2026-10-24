/**
 * Создание сценария из пресета (владелец: «дружелюбнее; базовый — обучено на истории; пресеты как
 * COVID, как 2022»): галерея пресетов по группам, ниже — что выбранный пресет меняет относительно
 * Базового (только отличия, происхождение словами); название — свободное, но не повторяющееся,
 * повтор блокируется сообщением у поля. Описание предзаполняется одной понятной фразой пресета.
 * Если прогноз «Базовый» уже есть, второй не предлагается: сверху «Уже есть «Базовый» — открыть»,
 * а выбор по умолчанию — первый пресет из истории. Подписи полей — обычным регистром.
 */
import { useId, useState, type FormEvent } from 'react'
import type { MacroRegimes } from '../../lib/api'
import { Modal } from '../../shell/Modal'
import { num, pct } from '../../explain/format'
import { BETA_DEFAULT, SIGMA_DEFAULT } from './distModel'
import { PresetDiff, PresetGallery } from './PresetGallery'
import { PRESETS, PRESET_MONTHS, getPreset, type ScenarioPreset } from './scenarioPresets'
import { isDuplicateName, uniqueName } from './scenarioNames'
import '../../ui/dialogs.css'
import './scenarios-v2.css'

interface Props {
  existing: readonly string[]
  regimes: MacroRegimes | null
  /** Уже существующий прогноз «Базовый» (без правок) — его открывают, а не создают второй. */
  base?: { id: string; name: string } | null
  onOpenExisting?: (id: string) => void
  onSubmit: (name: string, description: string, preset: ScenarioPreset) => void
  onCancel: () => void
  busy?: boolean
}

const FIRST_HISTORY = PRESETS.find((p) => p.group === 'history')?.id ?? 'base'

export function ScenarioCreateDialog({ existing, regimes, base = null, onOpenExisting, onSubmit, onCancel, busy = false }: Props) {
  const [presetId, setPresetId] = useState(base ? FIRST_HISTORY : 'base')
  const preset = getPreset(presetId) ?? (getPreset('base') as ScenarioPreset)
  const [name, setName] = useState(() => uniqueName(preset.short, existing))
  const [description, setDescription] = useState(preset.oneLine)
  const [touched, setTouched] = useState(false)
  const [tried, setTried] = useState(false)
  const formId = useId()
  const errId = useId()
  const duplicate = isDuplicateName(name, existing)
  const emptyName = name.trim() === ''
  const invalid = duplicate || emptyName

  const pick = (id: string) => {
    setPresetId(id)
    const p = getPreset(id)
    if (p && !touched) { setName(uniqueName(p.short, existing)); setDescription(p.oneLine) }
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTried(true)
    if (invalid || busy) return
    onSubmit(name.trim(), description.trim(), preset)
  }
  const showErr = invalid && (tried || duplicate)
  return (
    <Modal title="Новый сценарий внешних условий" size="lg" onClose={onCancel}
      footer={<>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>Отмена</button>
        <button type="submit" form={formId} className="btn btn--primary" aria-busy={busy || undefined}>{busy ? 'Создаём…' : `Создать «${preset.short}»`}</button>
      </>}>
      <form id={formId} className="dlg__form" onSubmit={submit} noValidate>
        {base && (
          <p className="sc2-exists">
            Прогноз «{base.name}» уже есть — второй такой же не нужен.
            {onOpenExisting && <button type="button" className="pf-link" onClick={() => onOpenExisting(base.id)}>Открыть «{base.name}»</button>}
          </p>
        )}
        <PresetGallery value={presetId} onChange={pick} regimes={regimes} months={PRESET_MONTHS} />
        <PresetDiff preset={preset} regimes={regimes} />
        <label className="dlg__field sc2-dlg-field"><span>Название</span>
          <input className="form__input" value={name} maxLength={120}
            aria-invalid={showErr || undefined} aria-describedby={showErr ? errId : undefined}
            onChange={(e) => { setName(e.target.value); setTouched(true) }} />
          {showErr && (
            <span className="sc2-field-err" id={errId} role="alert">
              <span className="glyph-setup" aria-hidden="true" /> {emptyName ? 'Введите название сценария' : `Сценарий «${name.trim()}» уже есть — выберите другое название`}
            </span>
          )}
        </label>
        <label className="dlg__field sc2-dlg-field"><span>Описание</span>
          <textarea className="form__textarea" rows={2} value={description} onChange={(e) => { setDescription(e.target.value); setTouched(true) }} maxLength={500} />
        </label>
        <p className="dlg__hint">
          Горизонт — {num(PRESET_MONTHS, 0)} мес. Распределения цен изделий создаются из цен справочника: разброс цены ±{pct(SIGMA_DEFAULT, 0)}
          {' '}вокруг неё, зависимость от рынка (β) {num(BETA_DEFAULT, 1)}. Всё можно изменить после создания.
        </p>
      </form>
    </Modal>
  )
}
