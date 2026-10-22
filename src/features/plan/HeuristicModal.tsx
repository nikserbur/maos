/**
 * Конструктор эвристики (вынесен из PlanScreen): редактор критериев с направлением и весом,
 * визуализация вкладов, пресеты. Тип Crit — в types.ts (общий с мастером плана).
 */
import type { Dispatch, SetStateAction } from 'react'
import { Icon } from '../../shell/icons'
import { CRITERIA, CRIT_LABEL, type Crit } from './types'
import './plan.css'
import './plan-screen.css'

/** Компактная сводка активной эвристики (что где в приоритете). */
export function HeurSummary({ crits }: { crits: Crit[] }) {
  const active = crits.filter((c) => c.weight > 0)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <b>Эвристика:</b>
      {active.length === 0 && <span style={{ color: 'var(--text-muted)' }}>не задана</span>}
      {active.map((c, i) => (
        <span key={i} style={{ fontSize: 12, padding: '2px 8px', borderRadius: 999,
                               background: 'var(--bg-card, #12161c)', border: '1px solid var(--border)' }}>
          {c.dir < 0 ? '↑' : '↓'} {CRIT_LABEL[c.criterion]} <span style={{ color: 'var(--text-muted)' }}>×{c.weight}</span>
        </span>
      ))}
    </span>
  )
}

/** Столбиковая визуализация вкладов критериев (знак = направление). */
function HeurViz({ crits }: { crits: Crit[] }) {
  const items = crits.filter((c) => c.weight > 0)
  const mx = Math.max(0.001, ...items.map((c) => c.weight))
  return (
    <div style={{ margin: '8px 0' }}>
      {items.map((c, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 90px', gap: 8, alignItems: 'center', margin: '4px 0' }}>
          <span style={{ fontSize: 12 }}>{CRIT_LABEL[c.criterion]}</span>
          <span style={{ height: 12, background: 'var(--bg-app, #0d1014)', borderRadius: 3, overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', width: `${c.weight / mx * 100}%`,
                           background: 'var(--accent)', borderRadius: 3 }} />
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.dir < 0 ? 'больше→раньше' : 'меньше→раньше'}</span>
        </div>
      ))}
      {items.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>Добавьте критерий с весом &gt; 0.</p>}
    </div>
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
          <button className="plan__modal-x" onClick={onClose} title="Закрыть"><Icon name="close" size={14} /></button>
        </div>

        <div className="plan__modal-body">
          <p className="plan__subtitle" style={{ marginTop: 0 }}>
            Верхний критерий — главный, следующие уточняют порядок среди близких.
            Пример «длинные раньше, а из длинных — с бо́льшим числом входов»:
            <b> длительность</b> (больше→раньше, 1) + <b>входные материалы</b> (больше→раньше, 0.3).
          </p>

          <div className="heur__list">
            {crits.map((c, i) => (
              <div key={i} className="heur__crit">
                <span className="heur__rank" title={`Приоритет ${i + 1}`}>{i + 1}</span>
                <div className="heur__crit-ctl">
                  <select className="plan__select" value={c.criterion}
                          onChange={(e) => upd(i, { criterion: e.target.value as Crit['criterion'] })}>
                    {CRITERIA.map((cr) => <option key={cr.id} value={cr.id}>{cr.label}</option>)}
                  </select>
                  <select className="plan__select" value={c.dir}
                          onChange={(e) => upd(i, { dir: Number(e.target.value) as 1 | -1 })}>
                    <option value={1}>меньше — раньше</option>
                    <option value={-1}>больше — раньше</option>
                  </select>
                  <span className="heur__wrap">
                    <label>вес</label>
                    <input className="heur__weight" type="number" min="0" step="0.1" value={c.weight}
                           onChange={(e) => upd(i, { weight: Number(e.target.value) || 0 })} />
                  </span>
                </div>
                <button className="heur__del" title="Удалить критерий"
                        onClick={() => setCrits((p) => p.filter((_, j) => j !== i))}
                        disabled={crits.length <= 1}>✕</button>
              </div>
            ))}
          </div>
          <button className="heur__add"
                  onClick={() => setCrits((p) => [...p, { criterion: 'inputs', dir: -1, weight: 0.3 }])}>
            + добавить критерий
          </button>

          <p className="plan__section-title" style={{ marginTop: 16, marginBottom: 4 }}>Вклад весов</p>
          <HeurViz crits={crits} />

          <div className="heur__presets">
            <button className="btn btn--primary" style={{ height: 30 }} onClick={onSave}>💾 Сохранить как…</button>
            {savedNames.length > 0 && (
              <>
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Пресеты:</span>
                {savedNames.map((name) => (
                  <span key={name} className="heur__chip">
                    <button onClick={() => onLoad(saved[name])} title="Загрузить пресет">{name}</button>
                    <button onClick={() => onDelete(name)} title="Удалить пресет">✕</button>
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
