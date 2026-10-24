/**
 * Карточка предприятия/склада на мировой карте — React-компонент, рендерится порталом в
 * DOM-контейнер popup'а MapLibre (без innerHTML). Строки (X2 P-27): Цехов · Станков · Загрузка
 * узкого места (по последнему плану; без плана — «не рассчитано», а не ноль).
 */
import type { ReactNode } from 'react'
import type { SceneNode } from '../graph/sceneModel'
import { statusWord } from '../graph/status'
import { STATUS_META } from '../types'
import { num, pct } from '../../../explain/format'
import { OVERLOAD, type NodeOps } from '../sceneOps'

export interface MapCardStats { shops: number; machines: number }

interface MapCardProps {
  node: SceneNode
  stats?: MapCardStats
  ops?: NodeOps
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="wm2d-card__row"><span>{k}</span><b className="num">{children}</b></div>
  )
}

export function MapCard({ node, stats, ops }: MapCardProps) {
  const meta = STATUS_META[node.status]
  const warehouse = node.kind === 'wirehouse'
  const util = ops?.util ?? null
  return (
    <>
      <div className="wm2d-card__head">
        <span className="wm2d-card__kind">{warehouse ? 'Склад' : 'Предприятие'}</span>
        <div className="wm2d-card__title">{node.title}</div>
        <div className={`wm2d-card__status ${meta.glyphClass}${node.status === 'running' || node.status === 'idle' ? ' is-calm' : ''}`}>
          {statusWord(node.refType, node.status)}
        </div>
      </div>
      <Row k="Цехов">{num(stats?.shops ?? 0, 0)}</Row>
      <Row k="Станков">{num(stats?.machines ?? 0, 0)}</Row>
      <Row k="Загрузка узкого места">
        {util === null ? <span className="wm2d-card__none">не рассчитано</span> : (
          <>{pct(util, 0)}{util >= OVERLOAD && <span className="glyph-setup wm2d-card__flag" role="img" aria-label="перегрузка" />}</>
        )}
      </Row>
      <div className="wm2d-card__foot">2×ЛКМ или Shift+Enter — войти на площадку</div>
    </>
  )
}
