/**
 * Конструктор эвристики (вынесен из PlanScreen): редактор критериев с направлением и весом,
 * визуализация вкладов (`BarList` chart-системы), пресеты. Тип Crit — в types.ts (общий с мастером плана).
 */
import type { Dispatch, SetStateAction } from 'react'
import { num } from '../../explain/format'
import { Icon } from '../../shell/icons'
import { BarList } from '../../ui/charts'
import { Chip } from '../../ui/kit'
import { CRITERIA, CRIT_LABEL, type Crit } from './types'
import './plan.css'
import './plan-screen.css'

/** Компактная сводка активной эвристики (что где в приоритете). */
export function HeurSummary({ crits }: { crits: Crit[] }) {
  const active = crits.filter((c) => c.weight > 0)
  return (
    <span className="heur__summary">
      <b>Эвристика:</b>
      {active.length === 0 && <span className="heur__summary-none">не задана</span>}
      {active.map((c, i) => (
        <Chip key={i}>{c.dir < 0 ? '↑' : '↓'} {CRIT_LABEL[c.criterion]} <span className="num">×{num(c.weight, 2)}</span></Chip>
      ))}
    </span>
  )
}

/** Столбиковая визуализация вкладов критериев (знак = направление). */
function HeurViz({ crits }: { crits: Crit[] }) {
  const items = crits.filter((c) => c.weight > 0)
  if (items.length === 0) return <p className="pl-note">Добавьте критерий с весом &gt; 0.</p>
  return (
    <BarList compact fmt={(v) => num(v, 2)} valueHeader="Вес" ariaLabel={`Вклад весов: ${items.map((c) => `${CRIT_LABEL[c.criterion]} ${num(c.weight, 2)}`).join(', ')}`}
      rows={items.map((c, i) => ({
        key: `${c.criterion}-${i}`, label: CRIT_LABEL[c.criterion], value: c.weight,
        secondary: c.dir < 0 ? 'больше → раньше' : 'меньше → раньше',
      }))} />
  )
}

/** Модальное окно конструктора эвристик: редактор критериев + визуализация + пресеты. */
export function HeuristicModal({ crits, setCrits, saved, onSave, onDelete, onLoad, onClose }: {
  crits: Crit[]
  setCrits: Dispatch<SetStateAction<Crit[]>>
  saved: Record<string, Crit[]>
  onSave: () => void
  onDelete: (name: string) => void
  onLoad: (c: Crit[]) => void
  onClose: () => void
}) {
  const upd = (i: number, patch: Partial<Crit>) =>
    setCrits((p) => p.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const savedNames = Object.keys(saved)
  return (
    <div className="plan__modal" onClick={onClose}>
      <div className="plan__modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="plan__modal-head">
          <div>
            <h3>Конструктор эвристики</h3>
            <p>Приоритет операции = взвешенная сумма критериев сверху вниз</p>
          </div>
          <button className="plan__modal-x" onClick={onClose} title="Закрыть" aria-label="Закрыть"><Icon name="close" size={14} /></button>
        </div>

        <div className="plan__modal-body">
          <p className="pl-note heur__intro">
            Верхний критерий — главный, следующие уточняют порядок среди близких.
            Пример «длинные раньше, а из длинных — с бо́льшим числом входов»:
            <b> длительность</b> (больше → раньше, 1) + <b>входные материалы</b> (больше → раньше, 0,3).
          </p>

          <div className="heur__list">
            {crits.map((c, i) => (
              <div key={i} className="heur__crit">
                <span className="heur__rank" title={`Приоритет ${i + 1}`}>{i + 1}</span>
                <div className="heur__crit-ctl">
                  <select className="plan__select" value={c.criterion} aria-label="Критерий"
                          onChange={(e) => upd(i, { criterion: e.target.value as Crit['criterion'] })}>
                    {CRITERIA.map((cr) => <option key={cr.id} value={cr.id}>{cr.label}</option>)}
                  </select>
                  <select className="plan__select" value={c.dir} aria-label="Направление"
                          onChange={(e) => upd(i, { dir: Number(e.target.value) as 1 | -1 })}>
                    <option value={1}>меньше — раньше</option>
                    <option value={-1}>больше — раньше</option>
                  </select>
                  <span className="heur__wrap">
                    <label htmlFor={`heur-w-${i}`}>вес</label>
                    <input id={`heur-w-${i}`} className="heur__weight" type="number" min="0" step="0.1" value={c.weight}
                           onChange={(e) => upd(i, { weight: Number(e.target.value) || 0 })} />
                  </span>
                </div>
                <button className="heur__del" title="Удалить критерий" aria-label="Удалить критерий"
                        onClick={() => setCrits((p) => p.filter((_, j) => j !== i))}
                        disabled={crits.length <= 1}><Icon name="close" size={12} /></button>
              </div>
            ))}
          </div>
          <button className="heur__add"
                  onClick={() => setCrits((p) => [...p, { criterion: 'inputs', dir: -1, weight: 0.3 }])}>
            <Icon name="plus" size={12} /> добавить критерий
          </button>

          <p className="plan__section-title heur__viz-title">Вклад весов</p>
          <HeurViz crits={crits} />

          <div className="heur__presets">
            <button className="btn btn--primary btn--sm" onClick={onSave}>Сохранить как…</button>
            {savedNames.length > 0 && (
              <>
                <span className="heur__presets-label">Пресеты:</span>
                {savedNames.map((name) => (
                  <span key={name} className="heur__chip">
                    <button onClick={() => onLoad(saved[name])} title="Загрузить пресет">{name}</button>
                    <button onClick={() => onDelete(name)} title="Удалить пресет" aria-label={`Удалить пресет ${name}`}><Icon name="close" size={11} /></button>
                  </span>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
