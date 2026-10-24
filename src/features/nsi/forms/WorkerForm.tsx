import { useMemo, useState } from 'react'
import { api } from '../../../lib/api'
import { num } from '../../../explain/format'
import { currentSession, workerAccess } from '../../../shell/session'
import { InfoTip } from '../../../ui/InfoTip'
import { isEligible } from '../labor'
import { shopCode, shopShort } from '../registries'
import { useOrgUnits, useWorkCenterTypes, useWorkers } from '../useNsi'
import { changedFields, fieldOf, useFormBridge, type NsiFormProps } from './formBridge'
import { FormError, FormNote, NO_CHANGES } from './FormError'

const OUTSIDE = '__outside__'
const OUTSIDE_LABEL = 'вне цеха'
const TAB_RE = /^T\d{4}$/
const LETTERS = /\p{L}/u

type Field = 'last' | 'first' | 'tab' | 'unit'
type Errors = Partial<Record<Field, string>>

/** Табельный номер: верхний регистр, кириллическая «Т» → латинская (формат T0000). */
const normTab = (v: string) => v.trim().toUpperCase().replace(/^Т/, 'T')

/** Проверка полей сотрудника (P-49): буквы в имени, цех (или «вне цеха»), уникальный табельный T0000. */
export function validateWorker(v: { last: string; first: string; tab: string; unit: string }, takenTabs: ReadonlySet<string>): Errors {
  const e: Errors = {}
  if (!LETTERS.test(v.last)) e.last = v.last.trim() ? 'Фамилия должна содержать буквы' : 'Укажите фамилию'
  if (!LETTERS.test(v.first)) e.first = v.first.trim() ? 'Имя должно содержать буквы' : 'Укажите имя'
  const tab = normTab(v.tab)
  if (!TAB_RE.test(tab)) e.tab = 'Табельный номер — буква T и четыре цифры, например T0042'
  else if (takenTabs.has(tab)) e.tab = `Номер ${tab} уже занят`
  if (!v.unit) e.unit = 'Выберите цех или «вне цеха»'
  return e
}

/** Сотрудник: личные данные, цех, должность, допуски к типам станков (группы по цехам). */
export function WorkerForm({ onSuccess, edit, bridge }: NsiFormProps) {
  const orgUnits = useOrgUnits()
  const wcTypes = useWorkCenterTypes()
  const workers = useWorkers()
  const r = useMemo(() => edit?.row ?? {}, [edit])
  const sv = fieldOf(r)
  const session = currentSession()
  const lockedUnit = workerAccess(session) === 'shop' ? session.orgUnitId : ''

  const [tabNo, setTabNo]   = useState(sv('tab_no'))
  const [last, setLast]     = useState(sv('last_name'))
  const [first, setFirst]   = useState(sv('first_name'))
  const [middle, setMiddle] = useState(sv('middle_name'))
  const [unitId, setUnitId] = useState(lockedUnit || sv('org_unit_id') || (sv('org_unit') === OUTSIDE_LABEL ? OUTSIDE : ''))
  const [position, setPos]  = useState(sv('position'))
  const [grade, setGrade]   = useState(sv('grade', '3'))
  const initialSkills = sv('skills')
  const [universal, setUniversal] = useState(() => !initialSkills.trim())
  const [allowed, setAllowed] = useState<Set<string> | null>(null) // null — допуски не трогали
  const [errors, setErrors]   = useState<Errors>({})
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<unknown>(null)
  const [note, setNote]       = useState<string | null>(null)

  // Старые записи без org_unit_id: цех по названию (подставляется в выбор, но правкой не считается).
  const legacyId = !unitId && sv('org_unit') ? orgUnits.find((o) => o.name === sv('org_unit'))?.id ?? '' : ''
  const unitSel = unitId || legacyId

  // Допуски записи (как у планировщика): пустые навыки — универсал.
  const savedAllowed = useMemo(() => new Set(wcTypes.filter((t) => initialSkills.trim() && isEligible(initialSkills, t.name, t.id)).map((t) => t.id)), [wcTypes, initialSkills])
  const cur = allowed ?? savedAllowed
  const permsTouched = allowed !== null || universal !== !initialSkills.trim()

  const unitName = unitSel === OUTSIDE ? OUTSIDE_LABEL : orgUnits.find((o) => o.id === unitSel)?.name ?? sv('org_unit')
  const fields = {
    tab_no: normTab(tabNo), last_name: last.trim(), first_name: first.trim(), middle_name: middle.trim(),
    org_unit: unitName, org_unit_id: unitSel === OUTSIDE ? '' : unitSel, position, grade,
  }
  const [initial] = useState(() => ({ ...fields }))
  // «Есть изменения» — по тому, что ввёл пользователь (подстановки справочников правкой не считаются).
  const raw = { tabNo, last, first, middle, unitId, position, grade }
  const [initialRaw] = useState(() => ({ ...raw }))
  const dirty = permsTouched || Object.keys(changedFields(raw, initialRaw)).length > 0
  const takenTabs = useMemo(() => new Set(workers.filter((w) => w.id !== edit?.id).map((w) => normTab(w.tab_no))), [workers, edit])

  const handleSubmit = async () => {
    setNote(null)
    const errs = validateWorker({ last, first, tab: tabNo, unit: unitSel }, takenTabs)
    setErrors(errs)
    if (Object.keys(errs).length) { setError('Проверьте отмеченные поля'); return }
    // Универсал → пустые навыки; иначе CSV ИМЁН типов (планировщик сопоставляет по имени).
    const skills = universal ? '' : wcTypes.filter((t) => cur.has(t.id)).map((t) => t.name).join(', ')
    const base = edit ? changedFields(fields, initial) : fields
    const body = permsTouched || !edit ? { ...base, skills } : base
    if (edit && Object.keys(body).length === 0) { setNote(NO_CHANGES); return }
    setLoading(true)
    setError(null)
    try {
      if (edit) await api.workers.update(edit.id, body)
      else await api.workers.create(body)
      onSuccess(edit ? `Сохранено: ${last} ${first}` : `Добавлен сотрудник ${last} ${first}`)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }
  useFormBridge(bridge, () => void handleSubmit(), dirty, loading)

  const groups = useMemo(() => {
    const g = new Map<string, typeof wcTypes>()
    for (const t of wcTypes) {
      const key = shopShort(t.group_name) || 'Прочие'
      g.set(key, [...(g.get(key) ?? []), t])
    }
    return [...g.entries()]
  }, [wcTypes])
  const ownShop = shopShort(unitName)
  const toggle = (ids: string[], on: boolean) => {
    const n = new Set(cur)
    ids.forEach((id) => (on ? n.add(id) : n.delete(id)))
    setAllowed(n)
  }
  const fieldProps = (f: Field) => ({
    'aria-invalid': errors[f] ? true : undefined,
    'aria-describedby': errors[f] ? `wf-${f}-err` : undefined,
  })
  const fieldErr = (f: Field) => (errors[f] ? <span className="form__hint form__hint--danger" id={`wf-${f}-err`}>{errors[f]}</span> : null)
  const clear = (f: Field) => { if (errors[f]) setErrors({ ...errors, [f]: undefined }) }

  return (
    <div className="form">
      <FormError error={error} />
      <FormNote text={note} />

      <div className="form__row">
        <label className="form__field">
          <span className="form__label">Фамилия *</span>
          <input className="form__input" value={last} {...fieldProps('last')} onChange={(e) => { setLast(e.target.value); clear('last') }} placeholder="Иванов" />
          {fieldErr('last')}
        </label>
        <label className="form__field">
          <span className="form__label">Имя *</span>
          <input className="form__input" value={first} {...fieldProps('first')} onChange={(e) => { setFirst(e.target.value); clear('first') }} placeholder="Иван" />
          {fieldErr('first')}
        </label>
      </div>
      <div className="form__row">
        <label className="form__field">
          <span className="form__label">Отчество</span>
          <input className="form__input" value={middle} onChange={(e) => setMiddle(e.target.value)} placeholder="Иванович" />
        </label>
        <label className="form__field">
          <span className="form__label">Табельный № *</span>
          <input className="form__input mono" value={tabNo} {...fieldProps('tab')} onChange={(e) => { setTabNo(e.target.value); clear('tab') }} placeholder="T0042" />
          {fieldErr('tab')}
        </label>
      </div>
      <label className="form__field">
        <span className="form__label">Цех *</span>
        <select className="form__select" value={unitSel} disabled={Boolean(lockedUnit)} {...fieldProps('unit')} onChange={(e) => { setUnitId(e.target.value); clear('unit') }}>
          <option value="">— выберите цех —</option>
          {orgUnits.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          <option value={OUTSIDE}>Вне цеха (без подразделения)</option>
        </select>
        {fieldErr('unit')}
        {lockedUnit && <span className="form__hint">Начальник цеха нанимает и переводит сотрудников только в свой цех.</span>}
      </label>
      <div className="form__row">
        <label className="form__field">
          <span className="form__label">Должность</span>
          <input className="form__input" value={position} onChange={(e) => setPos(e.target.value)} placeholder="Оператор ЧПУ" />
        </label>
        <label className="form__field">
          <span className="form__label">Разряд</span>
          <select className="form__select" value={grade} onChange={(e) => setGrade(e.target.value)}>
            {[1, 2, 3, 4, 5, 6].map((g) => <option key={g} value={g}>{g} разряд</option>)}
          </select>
        </label>
      </div>

      <div className="form__section nsi-form-head">
        Допуски к оборудованию
        <InfoTip id="plan.labor_cost" label="Как допуски влияют на план" note="Операция ставится, только если есть свободный станок и допущенный к его типу оператор." />
      </div>
      <label className="form__check">
        <input type="checkbox" checked={universal} onChange={(e) => setUniversal(e.target.checked)} />
        Универсал — допущен ко всем типам оборудования
      </label>
      {!universal && (wcTypes.length === 0 ? (
        <span className="form__hint form__hint--warn">Типов оборудования ещё нет — создайте их в реестре «Типы оборудования».</span>
      ) : (
        <div className="nsi-perms">
          {groups.map(([group, types]) => {
            const ids = types.map((t) => t.id)
            const on = ids.filter((id) => cur.has(id)).length
            return (
              <details key={group} className="nsi-perms__group" open={group === ownShop}>
                <summary className="nsi-perms__sum" title={group}>
                  <span>{shopCode(group)}</span><span className="nsi-perms__n num">{num(on, 0)} из {num(ids.length, 0)}</span>
                </summary>
                <label className="form__check nsi-perms__all">
                  <input type="checkbox" checked={on === ids.length}
                         ref={(el) => { if (el) el.indeterminate = on > 0 && on < ids.length }}
                         onChange={(e) => toggle(ids, e.target.checked)} />
                  Все типы цеха
                </label>
                {types.map((t) => (
                  <label key={t.id} className="form__check nsi-perms__item">
                    <input type="checkbox" checked={cur.has(t.id)} onChange={(e) => toggle([t.id], e.target.checked)} />
                    <span title={t.name}>{t.name}</span>
                  </label>
                ))}
              </details>
            )
          })}
          {cur.size === 0 && <span className="form__hint form__hint--warn">Допусков нет — сотрудник не встанет ни на один станок.</span>}
        </div>
      ))}
    </div>
  )
}
