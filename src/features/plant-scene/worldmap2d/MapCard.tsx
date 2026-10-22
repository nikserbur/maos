/**
 * Карточка KPI завода/склада на мировой карте — React-компонент, рендерится порталом в
 * DOM-контейнер popup'а MapLibre (X1 §1 п. 7: без innerHTML, стили — из кита).
 */
import type { SceneNode } from '../graph/sceneModel'
import { STATUS_META } from '../types'
import { num } from '../../../explain/format'

export interface MapCardStats { shops: number; machines: number }

interface MapCardProps {
  node: SceneNode
  stats?: MapCardStats
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="wm2d-card__row"><span>{k}</span><b className="num">{v}</b></div>
  )
}

export function MapCard({ node, stats }: MapCardProps) {
  const meta = STATUS_META[node.status]
  const warehouse = node.kind === 'wirehouse'
  return (
    <>
      <div className="wm2d-card__head">
        <span className="wm2d-card__kind">{warehouse ? 'Склад' : 'Завод'}</span>
        <div className="wm2d-card__title">{node.title}</div>
      </div>
      <div className="wm2d-card__row">
        <span>Статус</span>
        <b className={`wm2d-card__status ${meta.glyphClass}`}>{meta.label}</b>
      </div>
      {warehouse ? (
        <Row k="Тип" v="Центральный склад" />
      ) : (
        <>
          <Row k="Цехов" v={num(stats?.shops ?? 0, 0)} />
          <Row k="Станков" v={num(stats?.machines ?? 0, 0)} />
        </>
      )}
      <div className="wm2d-card__foot">2×ЛКМ — войти на площадку</div>
    </>
  )
}
