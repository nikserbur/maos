import { useState } from 'react'
import { Html } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import { OBJECT_REGISTRY } from './registry'
import { STATUS_META, type PlantStage } from './types'

interface StageObjectProps {
  stage: PlantStage
  selected: boolean
  onSelect: (id: string) => void
}

/** Один узел схемы: 3D-модель + кольцо статуса + всплывающая подпись. */
export function StageObject({ stage, selected, onSelect }: StageObjectProps) {
  const [hovered, setHovered] = useState(false)
  const Model = OBJECT_REGISTRY[stage.kind]
  const meta = STATUS_META[stage.status]
  const [x, z] = stage.position

  const ringColor = selected ? '#2d72d2' : meta.color

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    onSelect(stage.id)
  }

  const handleOver = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    setHovered(true)
    document.body.style.cursor = 'pointer'
  }

  const handleOut = () => {
    setHovered(false)
    document.body.style.cursor = 'auto'
  }

  return (
    <group position={[x, 0, z]}>
      <group
        rotation={[0, stage.rotationY ?? 0, 0]}
        scale={stage.scale}
        onClick={handleClick}
        onPointerOver={handleOver}
        onPointerOut={handleOut}
      >
        <Model />
      </group>

      {/* Подсветка площадки при выборе */}
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
          <circleGeometry args={[2.4, 48]} />
          <meshBasicMaterial color="#2d72d2" transparent opacity={0.12} />
        </mesh>
      )}

      {/* Кольцо статуса */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
        <ringGeometry args={[2.2, 2.5, 48]} />
        <meshBasicMaterial
          color={ringColor}
          transparent
          opacity={selected || hovered ? 0.95 : 0.65}
        />
      </mesh>

      {(hovered || selected) && (
        <Html position={[0, 4.2, 0]} center distanceFactor={26} className="stage-tag-wrap">
          <div className="stage-tag">
            <span className="stage-tag__dot" style={{ background: meta.color }} />
            <span className="stage-tag__title">{stage.title}</span>
          </div>
        </Html>
      )}
    </group>
  )
}
