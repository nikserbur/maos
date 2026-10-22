import { useRef, useState } from 'react'
import * as THREE from 'three'
import { Html, TransformControls } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import { OBJECT_REGISTRY } from './registry'
import { MachineModel } from './objects/machines'
import { Building } from './Building'
import { Icon } from '../../shell/icons'
import { STATUS_META } from './types'
import type { SceneNode } from './graph/sceneModel'
import { useThemeColors } from './themeColors'
import { useScenePalette } from './scenePalette'

/** ISA-101: штатный режим спокойный, насыщенный цвет — только для отклонений. */
const CALM_STATUS = new Set(['running', 'idle'])

interface StageObjectProps {
  node: SceneNode
  selected: boolean
  editing: boolean
  /** Этот узел выбран как источник соединения. */
  connectSource: boolean
  /** Режим прокладки связи активен (кнопка ↔ скрыта). */
  connecting: boolean
  /** Узел-контейнер (есть вложенные узлы) — рисуем здание, а не модель оборудования. */
  asBuilding: boolean
  /** Кол-во вложенных единиц (для подписи здания-цеха). */
  childCount: number
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
  childCount,
  onSelect,
  onEnter,
  onMove,
  onConnectFrom,
}: StageObjectProps) {
  const pal = useScenePalette()
  const [hovered, setHovered] = useState(false)
  const groupRef = useRef<THREE.Group>(null)
  const Model = OBJECT_REGISTRY[node.kind]
  const meta = STATUS_META[node.status]
  const colors = useThemeColors()
  const statusColor = colors.status[node.status]
  const [x, z] = node.position
  // Источник связи — ярь-медянка, выделение — цвет фокуса (accent), иначе — статус.
  const ringColor = connectSource ? colors.verdigris : selected ? colors.focus : statusColor
  const calm = CALM_STATUS.has(node.status)
  const ringOpacity = selected || hovered || connectSource ? 0.95 : calm ? 0.38 : 0.85

  // Здания крупнее моделей — подложка/кольцо/подпись масштабируются под них.
  const pad   = asBuilding ? 13 : 5
  const ringR = asBuilding ? 7 : 2.4
  const labelY = asBuilding ? 10.5 : 4.2

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    onSelect(node.id)
  }
  const handleDouble = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    // Станок — лист (на нём висят операции): внутрь не входим — «ниже станков ничего нет».
    // Углубляться можно только в контейнеры (цех / отдел = refType 'shop').
    if (node.refType === 'machine') return
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
        {/* Бетонная площадка — ТОЛЬКО под зданиями (фундамент). Под станками её
            убрали: сетка тёмных плит на полу цеха читалась как «глючные тени».
            Привязку станка к полу даёт мягкое градиентное пятно в WorkshopInterior. */}
        {asBuilding && (
          <mesh position={[0, 0.03, 0]} receiveShadow>
            <boxGeometry args={[pad, 0.08, pad]} />
            <meshStandardMaterial color={pal.n[2]} roughness={0.95} metalness={0.05} />
          </mesh>
        )}

        <group
          rotation={[0, node.rotationY ?? 0, 0]}
          onClick={handleClick}
          onDoubleClick={handleDouble}
          onPointerOver={handleOver}
          onPointerOut={handleOut}
        >
          {asBuilding
            ? <Building kind={node.kind} accent={statusColor} />
            : node.machineArch
              ? <MachineModel arch={node.machineArch} status={node.status} />
              : <group scale={node.scale}><Model /></group>}
        </group>

        {(selected || connectSource) && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.11, 0]}>
            <circleGeometry args={[ringR, 56]} />
            <meshBasicMaterial color={ringColor} transparent opacity={0.1} depthWrite={false} />
          </mesh>
        )}

        {/* Кольцо статуса приподнято над верхней гранью площадки (0.07) и без записи
            в depth — иначе z-fighting давал рваные «помехи» на кромке. */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.14, 0]} renderOrder={2}>
          <ringGeometry args={[ringR - 0.3, ringR, 56]} />
          <meshBasicMaterial
            color={ringColor}
            transparent
            depthWrite={false}
            polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2}
            opacity={ringOpacity}
          />
        </mesh>

        {showLabel && (
          <Html position={[0, labelY, 0]} center distanceFactor={26} className="stage-tag-wrap">
            <div className={`stage-tag${selected ? ' is-selected' : ''}`}>
              <span className={`stage-tag__glyph ${meta.glyphClass}`} role="img" aria-label={meta.label} />
              <span className="stage-tag__title">{node.title}</span>
              {asBuilding && childCount > 0 && <span className="stage-tag__meta num">{childCount} ед.</span>}
              {editing && !connecting && (
                <button
                  type="button"
                  className="stage-connect-btn"
                  title="Соединить с другим узлом"
                  aria-label="Соединить с другим узлом"
                  onClick={(e) => {
                    e.stopPropagation()
                    onConnectFrom(node.id)
                  }}
                >
                  <Icon name="link" size={13} />
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
