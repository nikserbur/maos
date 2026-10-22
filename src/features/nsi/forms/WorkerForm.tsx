import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../../lib/api'
import { useOrgUnits, useWorkCenterTypes } from '../useNsi'
import type { EditCtx } from '../CreateDialog'

interface Props {
  onSuccess: () => void
  edit?: EditCtx
}

export function WorkerForm({ onSuccess, edit }: Props) {
  const orgUnits = useOrgUnits()
  const wcTypes = useWorkCenterTypes()
  const r = edit?.row ?? {}
  const sv = (k: string, d = '') => (r[k] == null ? d : String(r[k]))
  const [tabNo, setTabNo]     = useState(sv('tab_no'))
  const [last, setLast]       = useState(sv('last_name'))
  const [first, setFirst]     = useState(sv('first_name'))
  const [middle, setMiddle]   = useState(sv('middle_name'))
  const [orgUnit, setOrgUnit] = useState(sv('org_unit'))
  const [position, setPos]    = useState(sv('position'))
  const [grade, setGrade]     = useState(sv('grade', '3'))
  // Допуски — множество ID типов РЦ. Раньше был текстовый ввод; теперь галочки.
  // Пустое множество = универсал (допущен ко всем типам).
  const initialSkills = sv('skills')
  const [allowed, setAllowed] = useState<Set<string>>(() => {
    if (!initialSkills.trim()) return new Set()   // универсал — конкретных галочек нет
    const toks = initialSkills.toLowerCase().split(',').map((s) => s.trim()).filter(Boolean)
    return new Set(wcTypes.filter((t) => {
      const nm = t.name.toLowerCase(), idl = t.id.toLowerCase()
      return toks.some((x) => x === nm || x === idl || (x.length > 3 && nm.includes(x)))
    }).map((t) => t.id))
  })
  const [universal, setUniversal] = useState(() => !initialSkills.trim())
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  // Гидратация допусков, когда типы РЦ подгрузились асинхронно (режим правки):
  // useState-инициализатор мог сработать при пустом wcTypes.
  const hydrated = useRef(false)
  useEffect(() => {
    if (hydrated.current || !initialSkills.trim() || wcTypes.length === 0) return
    hydrated.current = true
    const toks = initialSkills.toLowerCase().split(',').map((s) => s.trim()).filter(Boolean)
    setAllowed(new Set(wcTypes.filter((t) => {
      const nm = t.name.toLowerCase(), idl = t.id.toLowerCase()
      return toks.some((x) => x === nm || x === idl || (x.length > 3 && nm.includes(x)))
    }).map((t) => t.id)))
  }, [wcTypes, initialSkills])

  // Группировка типов по group_name (группы допусков).
  const groups = useMemo(() => {
    const g = new Map<string, typeof wcTypes>()
    for (const t of wcTypes) {
      const key = t.group_name?.trim() || 'Прочие'
      if (!g.has(key)) g.set(key, [])
      g.get(key)!.push(t)
    }
    return [...g.entries()]
  }, [wcTypes])

  const toggle = (id: string) => setAllowed((prev) => {
    const n = new Set(prev)
    n.has(id) ? n.delete(id) : n.add(id)
    return n
  })
  const toggleGroup = (ids: string[], on: boolean) => setAllowed((prev) => {
    const n = new Set(prev)
    ids.forEach((id) => (on ? n.add(id) : n.delete(id)))
    return n
  })

  const handleSubmit = async () => {
    if (!last.trim() || !first.trim()) { setError('Укажите фамилию и имя'); return }
    if (!tabNo.trim()) { setError('Укажите табельный номер'); return }
    // Универсал → пустые навыки; иначе CSV ИМЁН типов (планировщик матчит по имени).
    const skills = universal ? '' :
      wcTypes.filter((t) => allowed.has(t.id)).map((t) => t.name).join(', ')
    setLoading(true)
    setError(null)
    try {
      const payload = {
        tab_no: tabNo, last_name: last, first_name: first,
        middle_name: middle, org_unit: orgUnit, position,
        grade, skills,
      }
      if (edit) await api.workers.update(edit.id, payload)
      else await api.workers.create(payload)
      onSuccess()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="form">
      {error && <div className="form__error">{error}</div>}

      <div className="form__section">Личные данные</div>
      <div className="form__row form__row--3">
        <div className="form__field">
          <label className="form__label">Фамилия *</label>
          <input className="form__input" value={last} onChange={(e) => setLast(e.target.value)} placeholder="Иванов" />
        </div>
        <div className="form__field">
          <label className="form__label">Имя *</label>
          <input className="form__input" value={first} onChange={(e) => setFirst(e.target.value)} placeholder="Иван" />
        </div>
        <div className="form__field">
          <label className="form__label">Отчество</label>
          <input className="form__input" value={middle} onChange={(e) => setMiddle(e.target.value)} placeholder="Иванович" />
        </div>
      </div>

      <div className="form__section">Должность и место работы</div>
      <div className="form__row">
        <div className="form__field">
          <label className="form__label">Табельный № *</label>
          <input className="form__input" value={tabNo} onChange={(e) => setTabNo(e.target.value)} placeholder="ТВ-01042" />
        </div>
        <div className="form__field">
          <label className="form__label">Разряд</label>
          <select className="form__select" value={grade} onChange={(e) => setGrade(e.target.value)}>
            {[1,2,3,4,5,6].map((g) => <option key={g} value={g}>{g} разряд</option>)}
          </select>
        </div>
      </div>
      <div className="form__row">
        <div className="form__field">
          <label className="form__label">Подразделение / Цех</label>
          <select className="form__select" value={orgUnit} onChange={(e) => setOrgUnit(e.target.value)}>
            <option value="">— выберите подразделение —</option>
            {orgUnits.map((o) => <option key={o.id} value={o.name}>{o.name}</option>)}
          </select>
        </div>
        <div className="form__field">
          <label className="form__label">Должность</label>
          <input className="form__input" value={position} onChange={(e) => setPos(e.target.value)} placeholder="Оператор ЧПУ" />
        </div>
      </div>

      <div className="form__section">Допуски к оборудованию</div>
      <label className="form__check">
        <input type="checkbox" checked={universal} onChange={(e) => setUniversal(e.target.checked)} />
        Универсал — допущен ко всем типам оборудования
      </label>
      <span className="form__hint form__hint--tight">
        Допуск = к каким <b>типам станков</b> рабочий может встать. Планировщик ставит
        операцию только если есть свободный станок <b>и</b> допущенный оператор — поэтому
        мало операторов с допуском = станки простаивают, даже если их несколько.
      </span>

      {!universal && (
        wcTypes.length === 0 ? (
          <span className="form__hint form__hint--warn">
            Типов оборудования ещё нет — создайте их в реестре «Типы оборудования».
          </span>
        ) : (
          <div className="form__groups">
            {groups.map(([group, types]) => {
              const ids = types.map((t) => t.id)
              const allOn = ids.every((id) => allowed.has(id))
              return (
                <div key={group} className="form__group">
                  <label className="form__check form__check--group">
                    <input type="checkbox" checked={allOn}
                           ref={(el) => { if (el) el.indeterminate = !allOn && ids.some((id) => allowed.has(id)) }}
                           onChange={(e) => toggleGroup(ids, e.target.checked)} />
                    {group} <span className="form__group-note">· группа допусков</span>
                  </label>
                  <div className="form__group-grid">
                    {types.map((t) => (
                      <label key={t.id} className="form__check form__check--flat">
                        <input type="checkbox" checked={allowed.has(t.id)} onChange={() => toggle(t.id)} />
                        {t.name}
                      </label>
                    ))}
                  </div>
                </div>
              )
            })}
            <span className="form__hint">
              Отмечено допусков: <b>{allowed.size}</b>. Пусто и не «универсал» — рабочий
              не встанет ни на один станок.
            </span>
          </div>
        )
      )}

      <div className="form__actions">
        <button className="btn btn--primary" onClick={handleSubmit} disabled={loading}>
          {loading ? 'Сохраняем…' : 'Создать'}
        </button>
      </div>
    </div>
  )
}
