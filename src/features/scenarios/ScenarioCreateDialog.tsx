/**
 * Создание сценария из шаблона (UX-V2 §8 п. 4): шаблон с паспортом значений (происхождение каждого
 * числа видно до создания), название — свободное, но не повторяющееся («Базовый» → «Базовый 2»);
 * повтор блокируется сообщением у поля (aria-invalid). Источник — простыми словами, код — в подсказке.
 */
import { useId, useState, type FormEvent } from 'react'
import { Modal } from '../../shell/Modal'
import { num, pct } from '../../explain/format'
import { ProvenanceBadge } from '../../ui/ProvenanceBadge'
import { BETA_DEFAULT, SIGMA_DEFAULT } from './distModel'
import { fromMacroMode, regimeChip } from './regimeMenu'
import { SCENARIO_TEMPLATES, getTemplate, isDuplicateName, uniqueName, type ScenarioTemplate } from './scenarioTemplates'
import '../../ui/dialogs.css'
import './scenarios-v2.css'

interface Props {
  existing: readonly string[]
  onSubmit: (name: string, description: string, template: ScenarioTemplate | null) => void
  onCancel: () => void
  busy?: boolean
}

const EMPTY = 'empty'
const EMPTY_NAME = 'Новый сценарий'

function chipOf(t: ScenarioTemplate): string {
  const mode = t.values.macro_mode
  const c = regimeChip(fromMacroMode(typeof mode === 'string' || mode === undefined ? mode : JSON.stringify(mode)))
  return `${c.glyph} ${c.word}`
}

export function ScenarioCreateDialog({ existing, onSubmit, onCancel, busy = false }: Props) {
  const [templateId, setTemplateId] = useState('base')
  const tpl = templateId === EMPTY ? null : getTemplate(templateId) ?? null
  const [name, setName] = useState(() => uniqueName(tpl?.name ?? EMPTY_NAME, existing))
  const [description, setDescription] = useState(tpl?.description ?? '')
  const [touched, setTouched] = useState(false)
  const [tried, setTried] = useState(false)
  const formId = useId()
  const errId = useId()
  const duplicate = isDuplicateName(name, existing)
  const emptyName = name.trim() === ''
  const invalid = duplicate || emptyName

  const pick = (id: string) => {
    setTemplateId(id)
    const t = id === EMPTY ? null : getTemplate(id)
    if (!touched) { setName(uniqueName(t?.name ?? EMPTY_NAME, existing)); setDescription(t?.description ?? '') }
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTried(true)
    if (invalid || busy) return
    onSubmit(name.trim(), description.trim(), tpl)
  }
  const showErr = invalid && (tried || duplicate)
  return (
    <Modal title="Новый сценарий внешних условий" size="lg" onClose={onCancel}
      footer={<>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>Отмена</button>
        <button type="submit" form={formId} className="btn btn--primary" aria-busy={busy || undefined}>{busy ? 'Создаём…' : 'Создать'}</button>
      </>}>
      <form id={formId} className="dlg__form" onSubmit={submit} noValidate>
        <div className="sc2-tpl" role="radiogroup" aria-label="Шаблон">
          {SCENARIO_TEMPLATES.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={templateId === t.id} className={`sc2-tpl__item${templateId === t.id ? ' is-on' : ''}`} onClick={() => pick(t.id)}>
              <span className="sc2-tpl__name">{t.name}</span>
              <span className="sc2-tpl__kind">{chipOf(t)}</span>
            </button>
          ))}
          <button type="button" role="radio" aria-checked={templateId === EMPTY} className={`sc2-tpl__item${templateId === EMPTY ? ' is-on' : ''}`} onClick={() => pick(EMPTY)}>
            <span className="sc2-tpl__name">С нуля</span>
            <span className="sc2-tpl__kind">значения по умолчанию</span>
          </button>
        </div>
        <label className="form__label dlg__field"><span>Название</span>
          <input className="form__input" value={name} autoFocus onFocus={(e) => e.target.select()} maxLength={120}
            aria-invalid={showErr || undefined} aria-describedby={showErr ? errId : undefined}
            onChange={(e) => { setName(e.target.value); setTouched(true) }} />
          {showErr && (
            <span className="sc2-field-err" id={errId} role="alert">
              <span className="glyph-setup" aria-hidden="true" /> {emptyName ? 'Введите название сценария' : `Сценарий «${name.trim()}» уже есть — выберите другое название`}
            </span>
          )}
        </label>
        <label className="form__label dlg__field"><span>Описание</span>
          <textarea className="form__textarea" rows={2} value={description} onChange={(e) => { setDescription(e.target.value); setTouched(true) }} maxLength={500} />
        </label>
        {tpl && (
          <table className="sc2-tpl__pass" aria-label="Откуда значения шаблона">
            <thead><tr><th>Поле</th><th>Значение</th><th>Происхождение</th><th>Источник</th></tr></thead>
            <tbody>
              {tpl.passport.map((r) => (
                <tr key={r.field}>
                  <td>{r.label}</td><td className="num">{r.value}</td><td><ProvenanceBadge status={r.status} /></td>
                  <td className="sc2-muted" title={r.code ? `запись паспорта ${r.code}` : undefined}>{r.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="dlg__hint">Распределения цен создаются из базовых цен справочника: разброс {pct(SIGMA_DEFAULT, 0)} цены, связь с рынком {num(BETA_DEFAULT, 1)}.</p>
      </form>
    </Modal>
  )
}
