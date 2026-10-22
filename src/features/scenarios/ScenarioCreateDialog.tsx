/**
 * Создание сценария из шаблона (UX-V2 §8 п. 4): название, описание, шаблон с паспортом значений
 * (происхождение каждого числа видно до создания). Шаблоны — фронтовые пресеты до появления
 * `GET /api/scenarios/templates` (помечено «локально»).
 */
import { useId, useState, type FormEvent } from 'react'
import { Modal } from '../../shell/Modal'
import { ProvenanceBadge } from '../../ui/ProvenanceBadge'
import { SCENARIO_TEMPLATES, getTemplate, type ScenarioTemplate } from './scenarioTemplates'
import '../../ui/dialogs.css'
import './scenarios-v2.css'

interface Props {
  onSubmit: (name: string, description: string, template: ScenarioTemplate | null) => void
  onCancel: () => void
  busy?: boolean
}

export function ScenarioCreateDialog({ onSubmit, onCancel, busy = false }: Props) {
  const [templateId, setTemplateId] = useState('base')
  const tpl = getTemplate(templateId) ?? null
  const [name, setName] = useState(tpl?.name ?? 'Новый сценарий')
  const [description, setDescription] = useState(tpl?.description ?? '')
  const [touched, setTouched] = useState(false)
  const formId = useId()
  const pick = (id: string) => {
    setTemplateId(id)
    const t = getTemplate(id)
    if (!touched && t) { setName(t.name); setDescription(t.description) }
  }
  const submit = (e: FormEvent) => { e.preventDefault(); if (name.trim() && !busy) onSubmit(name.trim(), description.trim(), templateId === 'empty' ? null : tpl) }
  return (
    <Modal title="Новый сценарий внешних условий" size="lg" onClose={onCancel}
      footer={<>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>Отмена</button>
        <button type="submit" form={formId} className="btn btn--primary" disabled={!name.trim() || busy}>{busy ? 'Создаём…' : 'Создать'}</button>
      </>}>
      <form id={formId} className="dlg__form" onSubmit={submit}>
        <div className="sc2-tpl" role="radiogroup" aria-label="Шаблон">
          {SCENARIO_TEMPLATES.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={templateId === t.id} className={`sc2-tpl__item${templateId === t.id ? ' is-on' : ''}`} onClick={() => pick(t.id)}>
              <span className="sc2-tpl__name">{t.name}</span>
              <span className={`sc2-tpl__kind${t.isForecast ? '' : ' is-stress'}`}>{t.isForecast ? 'прогноз' : 'стресс'}</span>
            </button>
          ))}
          <button type="button" role="radio" aria-checked={templateId === 'empty'} className={`sc2-tpl__item${templateId === 'empty' ? ' is-on' : ''}`} onClick={() => pick('empty')}>
            <span className="sc2-tpl__name">Пустой</span>
            <span className="sc2-tpl__kind">умолчания бэкенда</span>
          </button>
        </div>
        <label className="form__label dlg__field"><span>Название</span>
          <input className="form__input" value={name} autoFocus onFocus={(e) => e.target.select()} onChange={(e) => { setName(e.target.value); setTouched(true) }} maxLength={120} />
        </label>
        <label className="form__label dlg__field"><span>Описание</span>
          <textarea className="form__textarea" rows={2} value={description} onChange={(e) => { setDescription(e.target.value); setTouched(true) }} maxLength={500} />
        </label>
        {tpl && templateId !== 'empty' && (
          <table className="sc2-tpl__pass" aria-label="Паспорт шаблона">
            <thead><tr><th>Поле</th><th>Значение</th><th>Статус</th><th>Источник</th></tr></thead>
            <tbody>
              {tpl.passport.map((r) => (
                <tr key={r.field}><td>{r.label}</td><td className="num">{r.value}</td><td><ProvenanceBadge status={r.status} /></td><td className="sc2-muted">{r.source}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="dlg__hint">Шаблоны — локальные пресеты с паспортом; серверный набор (`GET /api/scenarios/templates`) — задача бэкенду (отчёт G2). Распределения цен создаются из базовых цен НСИ (σ = 12 %, β = 0,7).</p>
      </form>
    </Modal>
  )
}
