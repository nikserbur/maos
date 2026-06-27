import { useRef, useState } from 'react'
import * as THREE from 'three'
import { Html, TransformControls } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import { OBJECT_REGISTRY } from './registry'
import { STATUS_META } from './types'
import type { SceneNode } from './graph/sceneModel'

interface StageObjectProps {
  node: SceneNode
  selected: boolean
  editing: boolean
  /** Этот узел выбран как источник соединения. */
  connectSource: boolean
  /** Режим прокладки связи активен (кнопка ↔ скрыта). */
  connecting: boolean
  onSelect: (id: string) => void
  onEnter: (id: string) => void
  onMove: (id: string, position: [number, number]) => void
  /** Запустить прокладку связи из этого узла. */
  onConnectFrom: (id: string) => void
}

/** Узел схемы: 3D-модель + кольцо статуса + подпись; в режиме правки — gizmo. */
export function StageObject({
  node,
  selected,
  editing,
  connectSource,
  connecting,
  onSelect,
  onEnter,
  onMove,
  onConnectFrom,
}: StageObjectProps) {
  const [hovered, setHovered] = useState(false)
  const groupRef = useRef<THREE.Group>(null)
  const Model = OBJECT_REGISTRY[node.kind]
  const meta = STATUS_META[node.status]
  const [x, z] = node.position
  const ringColor = connectSource ? '#2bb3a3' : selected ? '#2d72d2' : meta.color

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    onSelect(node.id)
  }
  const handleDouble = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    onEnter(node.id)
  }
  const handleOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    setHovered(true)
    document.body.style.cursor = 'pointer'
  }
  const handleOut = () => {
    setHovered(false)
    document.body.style.cursor = 'auto'
  }
  const handleTransformEnd = () => {
    const g = groupRef.current
    if (g) onMove(node.id, [Math.round(g.position.x), Math.round(g.position.z)])
  }

  const showLabel = hovered || selected || connectSource

  return (
    <>
      <group ref={groupRef} position={[x, 0, z]}>
        <group
          rotation={[0, node.rotationY ?? 0, 0]}
          scale={node.scale}
          onClick={handleClick}
          onDoubleClick={handleDouble}
          onPointerOver={handleOver}
          onPointerOut={handleOut}
        >
          <Model />
        </group>

        {(selected || connectSource) && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
            <circleGeometry args={[2.4, 48]} />
            <meshBasicMaterial color={ringColor} transparent opacity={0.12} />
          </mesh>
        )}

        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
          <ringGeometry args={[2.2, 2.5, 48]} />
          <meshBasicMaterial
            color={ringColor}
            transparent
            opacity={selected || hovered || connectSource ? 0.95 : 0.65}
          />
        </mesh>

        {showLabel && (
          <Html position={[0, 4.2, 0]} center distanceFactor={26} className="stage-tag-wrap">
            <div className="stage-tag">
              <span className="stage-tag__dot" style={{ background: meta.color }} />
              <span>{node.title}</span>
              {editing && !connecting && (
                <button
                  className="stage-connect-btn"
                  title="Соединить с другим узлом"
                  onClick={(e) => {
                    e.stopPropagation()
                    onConnectFrom(node.id)
                  }}
                >
                  ↔
                </button>
              )}
            </div>
          </Html>
        )}
      </group>

      {selected && editing && (
        <TransformControls
          object={groupRef.current ?? undefined}
          mode="translate"
          showY={false}
          size={0.7}
          translationSnap={1}
          onMouseUp={handleTransformEnd}
        />
      )}
    </>
  )
}
