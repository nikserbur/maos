/**
 * Рёбра L0 в SVG (UX-V2 §3.3, X2 P-125): смысл несёт узор штриха (EDGE_DASH), а не цвет — данные
 * сплошные, обратная связь — пунктир, управление — штрих-пунктир, объяснение — точки. Подписи — по
 * запросу: по умолчанию только основной ход [1] → … → [5], остальные — у подсвеченных рёбер (наведение,
 * выбор) или в режиме «все»; у приглушённых рёбер подписей нет; без свободного места подпись не рисуется.
 */
import { AgentLoop, type LoopState } from './AgentLoop'
import { BACKBONE_EDGES, EDGE_DASH } from './edges'
import { LABEL_H, labelWidth, type EdgePath } from './mapLayout'
import type { MapEdgeKind } from './types'

export type EdgeLabelMode = 'main' | 'all'

interface MapEdgesProps {
  paths: readonly EdgePath[]
  width: number
  height: number
  focusId: string | null
  onPick: (edgeId: string) => void
  /** Какие подписи рёбер показывать без наведения. */
  labels?: EdgeLabelMode
  /** Петля агента по ребру [6] → [4]; null — петли нет. */
  loop?: LoopState | null
  /** Анимация петли остановлена (пауза пользователя или prefers-reduced-motion). */
  loopPaused?: boolean
}

const LOOP_EDGE = 'e.6-4'

const KINDS: readonly MapEdgeKind[] = ['data', 'param', 'feedback', 'control', 'explain']

export function MapEdges({ paths, width, height, focusId, onPick, labels = 'main', loop = null, loopPaused = false }: MapEdgesProps) {
  const anyFocus = focusId !== null
  const loopPath = loop ? paths.find((p) => p.edge.id === LOOP_EDGE) : undefined
  return (
    <svg className="mm-edges" width={width + 80} height={height + 80} viewBox={`-40 -60 ${width + 80} ${height + 80}`} aria-hidden="true" focusable="false">
      <defs>
        {KINDS.map((k) => (
          <marker key={k} id={`mm-arrow-${k}`} className={`mm-marker mm-marker--${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            {k === 'param' ? <circle cx="5" cy="5" r="3" /> : <path d="M 1 1 L 9 5 L 1 9 z" />}
          </marker>
        ))}
      </defs>
      {paths.map(({ edge, d, label, loop: isLoop }) => {
        const touches = focusId === edge.from || focusId === edge.to
        const lit = anyFocus && touches
        const dim = anyFocus && !touches
        const cls = `mm-edge mm-edge--${edge.kind}${lit ? ' is-lit' : dim ? ' is-dim' : ''}${isLoop ? ' mm-edge--loop' : ''}`
        const text = edge.label ?? ''
        const showLabel = Boolean(text && label && !dim && (BACKBONE_EDGES.has(edge.id) || labels === 'all' || lit))
        const w = labelWidth(text)
        return (
          <g key={edge.id} className={cls} onClick={() => onPick(edge.id)}>
            <title>{text}</title>
            <path className="mm-edge__hit" d={d} />
            <path className="mm-edge__line" d={d} markerEnd={`url(#mm-arrow-${edge.kind})`} strokeDasharray={EDGE_DASH[edge.kind] || undefined} />
            {showLabel && label && (
              <g className="mm-edge__label" transform={`translate(${label.x - w / 2}, ${label.y - LABEL_H / 2})`}>
                <rect width={w} height={LABEL_H} rx={4} />
                <text x={w / 2} y={12.5} textAnchor="middle">{text}</text>
              </g>
            )}
          </g>
        )
      })}
      {loopPath && loop && <AgentLoop path={loopPath} state={loop} paused={loopPaused} />}
    </svg>
  )
}
