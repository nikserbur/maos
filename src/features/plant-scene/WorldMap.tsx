/**
 * WorldMap — МАКРО-уровень схемы предприятия: мировая карта с заводами и складом
 * как компактными узнаваемыми иконками на плитах-участках, соединёнными
 * пунктирными магистралями. Это верхний (корневой) уровень иерархии:
 *   Мир (WorldMap) → Завод (Facility-площадка) → Цех (WorkshopInterior).
 *
 * Иконки собраны из готовых деталей plantKit (операторная + дымовая труба + бак)
 * для завода и складского ангара для склада — читаемо сверху, без новых зависимостей.
 * Всё детерминировано (хэш от позиции; Math.random/Date не используются),
 * только примитивы three + <meshStandardMaterial> (+ переиспользование plantKit).
 */
import { useRef, useState } from 'react'
import * as THREE from 'three'
import { Html, TransformControls } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import { ControlBuilding, Chimney, StorageTank, M } from './plantKit'
import { STATUS_META } from './types'
import type { SceneEdge, SceneNode } from './graph/sceneModel'

interface WorldMapProps {
  nodes: SceneNode[]
  edges: SceneEdge[]
  selectedId: string | null
  editing: boolean
  onSelect: (id: string) => void
  onEnter: (id: string) => void
  onMove: (id: string, position: [number, number]) => void
}

// Плита-участок под иконкой (отличается от газона площадки — «промзона»).
const PLOT = 22
const PLOT_COLOR = '#5b6169'
const PLOT_EDGE = '#787f88'
// Карта-подложка: крупная тёплая земляная плоскость (не газон площадки).
const MAP_GROUND = '#6f6a5c'
const MAP_TINT = '#79745f'

/** Детерминированный псевдослучайный шум из числа (Math.random недоступен). */
const hash = (i: number): number => {
  const s = Math.sin(i * 91.37 + 13.1) * 43758.5453
  return s - Math.floor(s)
}

/** Иконка ЗАВОДА: операторная + пара труб + бак хранения на компактной группе. */
function FactoryGlyph({ seed }: { seed: number }) {
  const jitter = (hash(seed) - 0.5) * 0.4
  return (
    <group scale={0.62}>
      <ControlBuilding w={7} d={4.2} h={3.6} position={[-1.5, 0, 1.6]} />
      <Chimney h={7} r={0.5} position={[3.6, 0, -1.8 + jitter]} />
      <Chimney h={5.4} r={0.4} striped={false} position={[4.7, 0, -2.6]} />
      <StorageTank r={1.7} h={2.6} position={[1.6, 0, -3.4]} />
    </group>
  )
}

/** Иконка СКЛАДА: длинный светлый ангар с двускатной крышей и воротами. */
function WarehouseGlyph() {
  const w = 8, d = 5, h = 3
  return (
    <group>
      <mesh position={[0, 0.1, 0]} receiveShadow>
        <boxGeometry args={[w + 0.6, 0.2, d + 0.6]} />
        <meshStandardMaterial {...M.concreteLt()} />
      </mesh>
      <mesh position={[0, 0.2 + h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial {...M.facadeWhite()} />
      </mesh>
      {/* полукруглая (сводчатая) крыша-ангар */}
      <mesh position={[0, 0.2 + h, 0]} rotation={[0, 0, Math.PI / 2]} scale={[1, 1, d / (w * 0.62)]} castShadow>
        <cylinderGeometry args={[w * 0.52, w * 0.52, w, 16, 1, false, 0, Math.PI]} />
        <meshStandardMaterial {...M.roof()} side={2} />
      </mesh>
      {/* грузовые ворота на торце */}
      {[-1.6, 0, 1.6].map((z, i) => (
        <mesh key={i} position={[w / 2 + 0.02, 0.2 + h * 0.4, z]}>
          <boxGeometry args={[0.06, h * 0.7, 1.1]} />
          <meshStandardMaterial {...M.frame()} />
        </mesh>
      ))}
    </group>
  )
}

interface MarkerProps {
  node: SceneNode
  selected: boolean
  editing: boolean
  onSelect: (id: string) => void
  onEnter: (id: string) => void
  onMove: (id: string, position: [number, number]) => void
}

/** Узел мировой карты: плита-участок + иконка + кольцо статуса + плавающая подпись. */
function WorldMarker({ node, selected, editing, onSelect, onEnter, onMove }: MarkerProps) {
  const [hovered, setHovered] = useState(false)
  const groupRef = useRef<THREE.Group>(null)
  const meta = STATUS_META[node.status]
  const [x, z] = node.position
  const warehouse = node.kind === 'wirehouse'
  const ringColor = selected ? '#2d72d2' : meta.color
  const ringR = 13
  const seed = Math.round(x) * 31 + Math.round(z) * 7

  const handleClick = (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSelect(node.id) }
  const handleDouble = (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onEnter(node.id) }
  const handleOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer'
  }
  const handleOut = () => { setHovered(false); document.body.style.cursor = 'auto' }
  const handleTransformEnd = () => {
    const g = groupRef.current
    if (g) onMove(node.id, [Math.round(g.position.x), Math.round(g.position.z)])
  }

  const showLabel = hovered || selected

  return (
    <>
      <group ref={groupRef} position={[x, 0, z]}>
        {/* Плита-участок (промзона) — фундамент иконки, отличает завод от газона. */}
        <mesh position={[0, 0.04, 0]} receiveShadow>
          <boxGeometry args={[PLOT, 0.1, PLOT]} />
          <meshStandardMaterial color={PLOT_COLOR} roughness={0.95} metalness={0.05} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.095, 0]}>
          <ringGeometry args={[PLOT / 2 - 0.8, PLOT / 2 - 0.4, 4, 1]} />
          <meshBasicMaterial color={PLOT_EDGE} transparent opacity={0.5} depthWrite={false} />
        </mesh>

        <group
          onClick={handleClick}
          onDoubleClick={handleDouble}
          onPointerOver={handleOver}
          onPointerOut={handleOut}
        >
          {warehouse ? <WarehouseGlyph /> : <FactoryGlyph seed={seed} />}
        </group>

        {selected && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.11, 0]}>
            <circleGeometry args={[ringR, 56]} />
            <meshBasicMaterial color={ringColor} transparent opacity={0.1} depthWrite={false} />
          </mesh>
        )}
        {/* Кольцо статуса — как у StageObject: приподнято, без записи в depth. */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.14, 0]} renderOrder={2}>
          <ringGeometry args={[ringR - 0.5, ringR, 56]} />
          <meshBasicMaterial
            color={ringColor}
            transparent
            depthWrite={false}
            polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2}
            opacity={selected || hovered ? 0.95 : 0.6}
          />
        </mesh>

        {showLabel && (
          <Html position={[0, 11, 0]} center distanceFactor={40} className="stage-tag-wrap">
            <div className="stage-tag">
              <span className="stage-tag__dot" style={{ background: meta.color }} />
              <span>{node.title}</span>
            </div>
          </Html>
        )}
      </group>

      {selected && editing && (
        <TransformControls
          object={groupRef.current ?? undefined}
          mode="translate"
          showY={false}
          size={0.9}
          translationSnap={1}
          onMouseUp={handleTransformEnd}
        />
      )}
    </>
  )
}

// ─── Магистрали ───────────────────────────────────────────────────────────────
const HIGHWAY = '#3a3f45'
const DASH = '#e6c34a'
const HW_W = 3.2
const Y_HW = 0.06, Y_DASH = 0.08

/** Прямая магистраль между двумя заводами: тёмное полотно + пунктирная осевая. */
function Highway({ a, b }: { a: [number, number]; b: [number, number] }) {
  const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0])
  if (len < 1) return null
  const dashN = Math.max(2, Math.floor(len / 4))
  const dashLen = len / (dashN * 2 - 1)
  return (
    <group position={[cx, 0, cz]} rotation={[0, -angle, 0]}>
      {/* Полотно магистрали (лежит в плоскости XZ, длина вдоль локального X). */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, Y_HW, 0]} receiveShadow>
        <planeGeometry args={[len, HW_W]} />
        <meshStandardMaterial color={HIGHWAY} roughness={0.95} />
      </mesh>
      {/* Пунктирная осевая разметка. */}
      {Array.from({ length: dashN }, (_, i) => {
        const px = -len / 2 + dashLen / 2 + i * dashLen * 2
        return (
          <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[px, Y_DASH, 0]}>
            <planeGeometry args={[dashLen * 0.7, 0.34]} />
            <meshBasicMaterial color={DASH} transparent depthWrite={false}
                               polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
          </mesh>
        )
      })}
    </group>
  )
}

/**
 * Мировая карта: земляная подложка, заводы/склад как иконки на плитах,
 * магистрали между ними (из рёбер мирового уровня).
 */
export function WorldMap({ nodes, edges, selectedId, editing, onSelect, onEnter, onMove }: WorldMapProps) {
  const pos: Record<string, [number, number]> = {}
  for (const n of nodes) pos[n.id] = n.position

  return (
    <group>
      {/* Земляная карта-подложка (крупная, тёплый тон) + лёгкая тональная вставка. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} receiveShadow>
        <planeGeometry args={[900, 900]} />
        <meshStandardMaterial color={MAP_GROUND} roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <planeGeometry args={[420, 420]} />
        <meshStandardMaterial color={MAP_TINT} roughness={1} transparent opacity={0.5} />
      </mesh>

      {/* Магистрали — под иконками (рисуем первыми). */}
      {edges.map((e) => {
        const a = pos[e.from], b = pos[e.to]
        if (!a || !b) return null
        return <Highway key={e.id} a={a} b={b} />
      })}

      {nodes.map((n) => (
        <WorldMarker
          key={n.id}
          node={n}
          selected={n.id === selectedId}
          editing={editing}
          onSelect={onSelect}
          onEnter={onEnter}
          onMove={onMove}
        />
      ))}
    </group>
  )
}
