import { useRef, useState } from 'react'
import * as THREE from 'three'
import { Html, TransformControls } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import { OBJECT_REGISTRY } from './registry'
import { Building } from './Building'
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
  /** Верхний уровень схемы — рисуем здание (цех/склад), а не модель оборудования. */
  asBuilding: boolean
  onSelect: (id: string) => void
  onEnter: (id: string) => void
  onMove: (id: string, position: [number, number]) => void
  /** Запустить прокладку связи из этого узла. */
  onConnectFrom: (id: string) => void
}

/** Узел схемы: здание (верхний уровень) или 3D-модель оборудования (внутри цеха). */
export function StageObject({
  node,
  selected,
  editing,
  connectSource,
  connecting,
  asBuilding,
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

  // Здания крупнее моделей — подложка/кольцо/подпись масштабируются под них.
  const pad   = asBuilding ? 6.5 : 5
  const ringR = asBuilding ? 3.4 : 2.4
  const labelY = asBuilding ? 5 : 4.2

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
        {/* Бетонная площадка под объектом. */}
        <mesh position={[0, 0.03, 0]} receiveShadow>
          <boxGeometry args={[pad, 0.08, pad]} />
          <meshStandardMaterial color="#565b62" roughness={0.95} metalness={0.05} />
        </mesh>

        <group
          rotation={[0, node.rotationY ?? 0, 0]}
          onClick={handleClick}
          onDoubleClick={handleDouble}
          onPointerOver={handleOver}
          onPointerOut={handleOut}
        >
          {asBuilding
            ? <Building kind={node.kind} accent={meta.color} />
            : <group scale={node.scale}><Model /></group>}
        </group>

        {(selected || connectSource) && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
            <circleGeometry args={[ringR, 56]} />
            <meshBasicMaterial color={ringColor} transparent opacity={0.1} />
          </mesh>
        )}

        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.07, 0]}>
          <ringGeometry args={[ringR - 0.3, ringR, 56]} />
          <meshBasicMaterial
            color={ringColor}
            transparent
            opacity={selected || hovered || connectSource ? 0.95 : 0.6}
          />
        </mesh>

        {showLabel && (
          <Html position={[0, labelY, 0]} center distanceFactor={26} className="stage-tag-wrap">
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
