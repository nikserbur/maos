/**
 * «Сменить пресет сценария» — та же галерея, что при создании. Выбор честный: если сценарий — своя
 * настройка генератора, сверху строка «Сейчас: своя настройка — …», и ничего не отмечено; если пресет —
 * отмечен он. «Применить» недоступна, пока не выбран другой пресет. Ручные инфляция и сдвиг курса по
 * умолчанию возвращаются к данным (иначе сценарий не совпадает с пресетом); галочка «Оставить мои
 * правки инфляции и курса (N)» их сохраняет.
 */
import { useId, useState } from 'react'
import type { MacroRegimes } from '../../lib/api'
import { num } from '../../explain/format'
import { Modal } from '../../shell/Modal'
import { PresetDiff, PresetGallery } from './PresetGallery'
import { getPreset, type ScenarioPreset } from './scenarioPresets'
import './scenario-presets.css'

interface Props {
  /** id текущего пресета; null — своя настройка генератора. */
  current: string | null
  /** Своя настройка словами — для строки «Сейчас: …». */
  currentText: string
  /** Сколько из инфляции и сдвига курса заданы вручную. */
  manualMacro: number
  regimes: MacroRegimes | null
  months: number
  onApply: (p: ScenarioPreset, keepEdits: boolean) => void
  onCancel: () => void
}

export function PresetDialog({ current, currentText, manualMacro, regimes, months, onApply, onCancel }: Props) {
  const [id, setId] = useState<string | null>(current)
  const [keep, setKeep] = useState(false)
  const keepId = useId()
  const p = getPreset(id)
  const canApply = p !== undefined && id !== current
  return (
    <Modal title="Сменить пресет сценария" size="lg" onClose={onCancel}
      footer={<>
        <button type="button" className="btn" onClick={onCancel}>Отмена</button>
        <button type="button" className="btn btn--primary" disabled={!canApply} onClick={() => p && onApply(p, keep)}>
          {!p ? 'Выберите пресет' : id === current ? 'Это текущий пресет' : `Применить «${p.short}»`}
        </button>
      </>}>
      <div className="dlg__form">
        {current === null && currentText && (
          <p className="scp-now" role="status"><span className="scp-now__k">Сейчас:</span> своя настройка генератора — {currentText.charAt(0).toLowerCase() + currentText.slice(1)}</p>
        )}
        <PresetGallery value={id} onChange={setId} regimes={regimes} months={months} />
        {p && <PresetDiff preset={p} regimes={regimes} />}
        {manualMacro > 0 && (
          <label className="scp-keep" htmlFor={keepId}>
            <input id={keepId} type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
            Оставить мои правки инфляции и курса ({num(manualMacro, 0)})
          </label>
        )}
        <p className="dlg__hint">
          Меняются режим генератора, разброс и связь цен, спрос{keep ? '' : ', а инфляция и сдвиг курса возвращаются к данным'}.
          Критерий и распределения цен остаются как есть. Применение можно отменить.
        </p>
      </div>
    </Modal>
  )
}
