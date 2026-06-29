import { FlowLinks } from './FlowLinks'
import { StageObject } from './StageObject'
import { hasChildren } from './graph/sceneModel'
import type { SceneEdge, SceneGraph, SceneNode } from './graph/sceneModel'

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
  onSelect,
  onEnter,
  onMove,
  onConnectFrom,
}: PlantLayoutProps) {
  return (
    <group>
      <FlowLinks nodes={nodes} edges={edges} indoor={indoor} />
      {nodes.map((node) => {
        const isContainer = hasChildren(graph, node.id)
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
