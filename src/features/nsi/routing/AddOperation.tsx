/**
 * Добавление операции в маршрут (P-46/P-54): из реестра — без повторов (имя + тип станка), списком,
 * сгруппированным по типу станка, с временем; или новая — раскрывающаяся форма. Сохранить новую и в
 * реестре операций можно только явно (галочка), ошибка этой записи показывается, а не глотается.
 */
import { useEffect, useMemo, useRef, useState, type Dispatch } from 'react'
import { api, type Operation, type WorkCenterType } from '../../../lib/api'
import { num, NBSP } from '../../../explain/format'
import { Icon } from '../../../shell/icons'
import { errorText } from '../../../ui/kit'
import { invalidateNsi } from '../useNsi'
import { opsFromApi, type RoutingAction } from './routingModel'

interface AddOperationProps {
  dispatch: Dispatch<RoutingAction>
  registryOps: ReadonlyArray<Operation>
  wcTypes: ReadonlyArray<WorkCenterType>
  /** Растёт, когда нажали «+ Операция»: фокус в выбор из реестра. */
  focusToken: number
}

interface Choice { key: string; op: Operation; group: string; label: string }

/** Различные операции реестра (имя + тип станка), по группам типов станка, с временем нормы. */
export function registryChoices(ops: ReadonlyArray<Operation>): Array<[string, Choice[]]> {
  const seen = new Map<string, Choice>()
  for (const op of ops) {
    const key = `${op.name.trim()}|${(op.wc_types ?? '').trim()}`
    if (seen.has(key) || !op.name.trim()) continue
    const t = Number(op.t_norm)
    seen.set(key, { key, op, group: (op.wc_types ?? '').trim() || 'Тип станка не задан', label: Number.isFinite(t) && t > 0 ? `${op.name} · ${num(t, 0)}${NBSP}мин` : op.name })
  }
  const groups = new Map<string, Choice[]>()
  for (const c of seen.values()) groups.set(c.group, [...(groups.get(c.group) ?? []), c])
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ru'))
}

export function AddOperation({ dispatch, registryOps, wcTypes, focusToken }: AddOperationProps) {
  const choices = useMemo(() => registryChoices(registryOps), [registryOps])
  const [picked, setPicked] = useState('')
  const [showCustom, setShowCustom] = useState(registryOps.length === 0)
  const [title, setTitle] = useState('')
  const [wc, setWc] = useState('')
  const [time, setTime] = useState('30')
  const [saveToNsi, setSaveToNsi] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selectRef = useRef<HTMLSelectElement>(null)
  useEffect(() => { if (focusToken > 0) selectRef.current?.focus() }, [focusToken])

  const addFromRegistry = () => {
    const c = choices.flatMap(([, list]) => list).find((x) => x.key === picked)
    if (!c) { setError('Выберите операцию из списка'); return }
    // Все поля шаблона — как в реестре: PERT-время, наладка, ставка, риск, связи типов.
    const [src] = opsFromApi([{ ...c.op, routing_id: '__pick__' }], '__pick__', wcTypes)
    const { id: _id, order: _order, ...rest } = src
    dispatch({ type: 'ADD_OP', ...rest, code: '', inputs: [], inputsKnown: true })
    setPicked('')
    setError(null)
  }

  const addCustom = async () => {
    if (!title.trim()) { setError('Введите название операции'); return }
    const wcName = wcTypes.find((t) => t.id === wc)?.name ?? ''
    if (saveToNsi) {
      setSaving(true)
      try {
        await api.operations.create({ name: title.trim(), wc_types: wcName, wc_type_ids: wc ? [wc] : [], t_norm: time, t_opt: time, t_pess: time, inputs: '[]' })
        invalidateNsi('operations')
      } catch (e) {
        setSaving(false)
        setError(`В реестр не записалась: ${errorText(e)}. В маршрут не добавлено — повторите или снимите галочку.`)
        return
      }
      setSaving(false)
    }
    dispatch({ type: 'ADD_OP', title: title.trim(), wcType: wcName, wcTypeIds: wc ? [wc] : [], timeMin: Number(time) || 30 })
    setTitle(''); setTime('30'); setWc(''); setError(null)
  }

  return (
    <section className="rt-section rt-section--add" aria-labelledby="rt-add-t">
      <p className="text-caps rt-inspector__t" id="rt-add-t">Добавить операцию</p>
      {error && <p className="form__error" role="alert">{error}</p>}
      {choices.length > 0 && (
        <div className="rt-row">
          <select ref={selectRef} className="form__select" value={picked} aria-label="Операция из реестра" onChange={(e) => { setPicked(e.target.value); setError(null) }}>
            <option value="">— из реестра —</option>
            {choices.map(([group, list]) => (
              <optgroup key={group} label={group}>
                {list.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </optgroup>
            ))}
          </select>
          <button type="button" className="btn btn--icon" aria-label="Добавить из реестра" title="Добавить в конец маршрута" onClick={addFromRegistry}><Icon name="plus" size={14} /></button>
        </div>
      )}
      {choices.length > 0 && (
        <button type="button" className="rt-link" aria-expanded={showCustom} onClick={() => setShowCustom((v) => !v)}>
          {showCustom ? '▾' : '▸'} или создать новую
        </button>
      )}
      {showCustom && (
        <div className="rt-custom">
          <input className="form__input" value={title} placeholder="Название операции" aria-label="Название новой операции"
            onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void addCustom() }} />
          <div className="rt-row">
            <select className="form__select" value={wc} aria-label="Тип станка" onChange={(e) => setWc(e.target.value)}>
              <option value="">— тип станка —</option>
              {wcTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <input className="form__input rt-custom__time" type="number" min="1" value={time} aria-label="Время, мин" onChange={(e) => setTime(e.target.value)} />
          </div>
          <label className="rt-check">
            <input type="checkbox" checked={saveToNsi} onChange={(e) => setSaveToNsi(e.target.checked)} />
            сохранить и в реестре операций
          </label>
          <button type="button" className="btn" onClick={() => void addCustom()} aria-busy={saving || undefined}>
            {saving ? 'Сохраняем…' : 'Добавить в маршрут'}
          </button>
        </div>
      )}
    </section>
  )
}
