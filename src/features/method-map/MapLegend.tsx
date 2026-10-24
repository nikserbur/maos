/**
 * Легенда карты поверх канваса слева сверху (X2 P-125): только состояния, которые есть на карте,
 * и виды рёбер с образцами узора (inline SVG по EDGE_DASH — тот же узор, что у рёбер). Полный словарь
 * состояний — по кнопке «все состояния» (поповер «i»). Переключатель «Подписи рёбер: основные / все».
 */
import { useCallback, useId, useRef, useState } from 'react'
import { InfoTipPopover } from '../../ui/InfoTip'
import { Segmented } from '../../ui/kit'
import { StateLegend } from '../../ui/StateLegend'
import { LOOP_LABEL, type LoopState } from './AgentLoop'
import { EDGE_DASH } from './edges'
import type { EdgeLabelMode } from './MapEdges'
import { EDGE_KIND_LABEL } from './NodeRows'
import type { MapEdgeKind, NodeState } from './types'

const ALL_STATES: readonly NodeState[] = ['estimated', 'normative', 'manual', 'default', 'stale', 'error', 'unconfigured', 'planned']
const LEGEND_EDGES: readonly MapEdgeKind[] = ['data', 'feedback', 'control', 'explain']

function EdgeSwatch({ kind }: { kind: MapEdgeKind }) {
  return (
    <svg className={`mm-legend__edge mm-edge--${kind}`} viewBox="0 0 24 6" width="24" height="6" aria-hidden="true" focusable="false">
      <line className="mm-legend__line" x1="1" y1="3" x2="23" y2="3" strokeDasharray={EDGE_DASH[kind] || undefined} />
    </svg>
  )
}

function AllStatesTip() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement | null>(null)
  const popId = useId()
  const close = useCallback((returnFocus: boolean) => {
    setOpen(false)
    if (returnFocus) ref.current?.focus()
  }, [])
  return (
    <>
      <button ref={ref} type="button" className="mm-link mm-legend__all" aria-haspopup="dialog" aria-expanded={open}
        aria-controls={open ? popId : undefined} onClick={() => (open ? close(true) : setOpen(true))}>
        все состояния
      </button>
      {open && (
        <InfoTipPopover anchor={ref.current} placement="bottom-start" popId={popId} titleId={`${popId}-t`} onClose={close}>
          <div className="mm-legend__pop">
            <p className="mm-legend__pop-title" id={`${popId}-t`}>Состояния узлов карты</p>
            <StateLegend states={ALL_STATES} label="Все состояния узлов" />
            <p className="mm-legend__pop-note">Пунктирная карточка без глифа — «в плане»: ещё не реализовано, волна указана в «Методике».
              Блок показывает худшее состояние своих подблоков.</p>
          </div>
        </InfoTipPopover>
      )}
    </>
  )
}

interface MapLegendProps {
  present: readonly NodeState[]
  labels: EdgeLabelMode
  onLabels: (m: EdgeLabelMode) => void
  loop: LoopState | null
}

export function MapLegend({ present, labels, onLabels, loop }: MapLegendProps) {
  return (
    <aside className="mm-legend" aria-label="Легенда карты">
      <div className="mm-legend__row">
        <StateLegend states={ALL_STATES} present={present} compact label="Состояния на карте" />
        <AllStatesTip />
      </div>
      <ul className="mm-legend__row mm-legend__edges" aria-label="Виды связей">
        {LEGEND_EDGES.map((k) => (
          <li key={k} className="mm-legend__item"><EdgeSwatch kind={k} />{EDGE_KIND_LABEL[k]}</li>
        ))}
        {loop && <li className="mm-legend__item">{LOOP_LABEL[loop]}</li>}
      </ul>
      <div className="mm-legend__row">
        <span className="mm-legend__caption" aria-hidden="true">Подписи рёбер</span>
        <Segmented<EdgeLabelMode> options={[{ id: 'main', label: 'основные' }, { id: 'all', label: 'все' }]}
          value={labels} onChange={onLabels} label="Подписи рёбер" size="sm" fit />
      </div>
    </aside>
  )
}
