import { FlowLinks } from './FlowLinks'
import { StageObject } from './StageObject'
import type { SceneEdge, SceneNode } from './graph/sceneModel'

interface PlantLayoutProps {
  nodes: SceneNode[]
  edges: SceneEdge[]
  selectedId: string | null
  connectFrom: string | null
  connecting: boolean
  editing: boolean
  onSelect: (id: string) => void
  onEnter: (id: string) => void
  onMove: (id: string, position: [number, number]) => void
  onConnectFrom: (id: string) => void
}

/** Раскладка текущего уровня схемы: связи + узлы. */
export function PlantLayout({
  nodes,
  edges,
  selectedId,
  connectFrom,
  connecting,
  editing,
  onSelect,
  onEnter,
  onMove,
  onConnectFrom,
}: PlantLayoutProps) {
  return (
    <group>
      <FlowLinks nodes={nodes} edges={edges} />
      {nodes.map((node) => (
        <StageObject
          key={node.id}
          node={node}
          selected={node.id === selectedId}
          connectSource={node.id === connectFrom}
          connecting={connecting}
          editing={editing}
          onSelect={onSelect}
          onEnter={onEnter}
          onMove={onMove}
          onConnectFrom={onConnectFrom}
        />
      ))}
    </group>
  )
}
