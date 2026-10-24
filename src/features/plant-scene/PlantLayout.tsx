import { FlowLinks } from './FlowLinks'
import { StageObject } from './StageObject'
import { hasChildren } from './graph/sceneModel'
import type { SceneEdge, SceneGraph, SceneNode } from './graph/sceneModel'
import type { NodeOps } from './sceneOps'

interface PlantLayoutProps {
  graph: SceneGraph
  nodes: SceneNode[]
  edges: SceneEdge[]
  selectedId: string | null
  connectFrom: string | null
  connecting: boolean
  editing: boolean
  /** Текущий уровень внутри здания (а не открытая территория). */
  indoor: boolean
  /** Загрузка узлов по последнему плану (подписи и маркеры ▲). */
  ops: ReadonlyMap<string, NodeOps>
  /** Режим симуляции: кольца статуса уступают кольцам загрузки. */
  simActive: boolean
  /** Анимация на паузе: транспорт стоит. */
  still: boolean
  onSelect: (id: string) => void
  onEnter: (id: string) => void
  onMove: (id: string, position: [number, number]) => void
  onConnectFrom: (id: string) => void
}

/** Кол-во прямых потомков узла (агрегат для здания-контейнера). */
function childCount(graph: SceneGraph, id: string): number {
  return graph.nodes.filter((n) => n.parentId === id).length
}

/**
 * Раскладка текущего уровня: связи + узлы. Узел с вложенными узлами рисуется как
 * ЗДАНИЕ-контейнер (на любом уровне вложенности), лист — как оборудование.
 */
export function PlantLayout({
  graph,
  nodes,
  edges,
  selectedId,
  connectFrom,
  connecting,
  editing,
  indoor,
  ops,
  simActive,
  still,
  onSelect,
  onEnter,
  onMove,
  onConnectFrom,
}: PlantLayoutProps) {
  return (
    <group>
      <FlowLinks nodes={nodes} edges={edges} indoor={indoor} still={still} />
      {nodes.map((node) => {
        // Цех — ВСЕГДА здание (даже пустой, без станков); контейнерность отдельно.
        const isContainer = node.refType === 'shop' || hasChildren(graph, node.id)
        return (
          <StageObject
            key={node.id}
            node={node}
            selected={node.id === selectedId}
            connectSource={node.id === connectFrom}
            connecting={connecting}
            editing={editing}
            asBuilding={isContainer}
            childCount={isContainer ? childCount(graph, node.id) : 0}
            ops={ops.get(node.id)}
            simActive={simActive}
            onSelect={onSelect}
            onEnter={onEnter}
            onMove={onMove}
            onConnectFrom={onConnectFrom}
          />
        )
      })}
    </group>
  )
}
