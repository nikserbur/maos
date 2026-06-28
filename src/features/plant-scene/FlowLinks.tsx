import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { SceneEdge, SceneNode } from './graph/sceneModel'

const ASPHALT = '#34383d'
const SHOULDER = '#54595f'
const LANE = '#c9b65a'
const ROAD_W = 2.4
const Y_SHOULDER = 0.035
const Y_ROAD = 0.05
const Y_LANE = 0.065

/** Прямой сегмент дороги по оси (горизонтальный вдоль X или вертикальный вдоль Z). */
function RoadSegment({ x1, z1, x2, z2 }: { x1: number; z1: number; x2: number; z2: number }) {
  const horizontal = Math.abs(x2 - x1) >= Math.abs(z2 - z1)
  const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2
  const len = Math.hypot(x2 - x1, z2 - z1)
  if (len < 0.01) return null
  // План повёрнут в горизонталь: локальный X → мир X, локальный Y → мир Z.
  const roadArgs: [number, number]     = horizontal ? [len, ROAD_W] : [ROAD_W, len]
  const shoulderArgs: [number, number] = horizontal ? [len, ROAD_W + 0.9] : [ROAD_W + 0.9, len]
  const laneArgs: [number, number]     = horizontal ? [len, 0.14] : [0.14, len]
  return (
    <group>
      <mesh position={[cx, Y_SHOULDER, cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={shoulderArgs} /><meshStandardMaterial color={SHOULDER} roughness={1} />
      </mesh>
      <mesh position={[cx, Y_ROAD, cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={roadArgs} /><meshStandardMaterial color={ASPHALT} roughness={1} />
      </mesh>
      <mesh position={[cx, Y_LANE, cz]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={laneArgs} /><meshBasicMaterial color={LANE} />
      </mesh>
    </group>
  )
}

interface FlowLineProps {
  from: [number, number]
  to: [number, number]
  speed: number
  withTruck: boolean
}

/** Г-образная дорога (прямые углы) между объектами + курсирующий ЗИЛ. */
function FlowLine({ from, to, speed, withTruck }: FlowLineProps) {
  const truck = useRef<THREE.Group>(null)

  // Ломаная с прямым углом: горизонтальный участок → поворот → вертикальный.
  const { waypoints, segLen, total, corner } = useMemo(() => {
    const a: [number, number] = from
    const c: [number, number] = [to[0], from[1]]   // угол
    const b: [number, number] = to
    const wp: [number, number][] = [a, c, b]
    const l1 = Math.abs(c[0] - a[0])
    const l2 = Math.abs(b[1] - c[1])
    return { waypoints: wp, segLen: [l1, l2], total: l1 + l2 || 0.001, corner: c }
  }, [from, to])

  useFrame((state) => {
    if (!truck.current) return
    const phase = (state.clock.elapsedTime * speed) % 2
    const fwd = phase < 1
    let d = (fwd ? phase : 2 - phase) * total
    let i = 0
    while (i < segLen.length - 1 && d > segLen[i]) { d -= segLen[i]; i++ }
    const a = waypoints[i], b = waypoints[i + 1]
    const f = segLen[i] > 0.001 ? d / segLen[i] : 0
    truck.current.position.set(a[0] + (b[0] - a[0]) * f, 0.06, a[1] + (b[1] - a[1]) * f)
    const segYaw = Math.atan2(-(b[1] - a[1]), b[0] - a[0])
    truck.current.rotation.y = fwd ? segYaw : segYaw + Math.PI
  })

  return (
    <group>
      <RoadSegment x1={waypoints[0][0]} z1={waypoints[0][1]} x2={corner[0]} z2={corner[1]} />
      <RoadSegment x1={corner[0]} z1={corner[1]} x2={waypoints[2][0]} z2={waypoints[2][1]} />
      {/* заполнение угла */}
      <mesh position={[corner[0], Y_ROAD, corner[1]]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[ROAD_W, ROAD_W]} /><meshStandardMaterial color={ASPHALT} roughness={1} />
      </mesh>

      {withTruck && (
        <group ref={truck} rotation={[0, 0, 0]} scale={0.5}>
          <Zil />
        </group>
      )}
    </group>
  )
}

/** Грузовик ЗИЛ: синяя кабина + бортовой кузов + 6 колёс. */
function Zil() {
  const wheels: [number, number][] = [
    [0.55, 0.34], [0.55, -0.34],
    [-0.35, 0.34], [-0.35, -0.34],
    [-0.7, 0.34], [-0.7, -0.34],
  ]
  return (
    <group position={[0, 0.02, 0]}>
      <mesh position={[-0.1, 0.18, 0]}><boxGeometry args={[1.9, 0.12, 0.62]} /><meshStandardMaterial color="#23262b" /></mesh>
      <mesh position={[0.62, 0.42, 0]} castShadow><boxGeometry args={[0.62, 0.5, 0.66]} /><meshStandardMaterial color="#2f6fb0" metalness={0.3} roughness={0.5} /></mesh>
      <mesh position={[0.5, 0.74, 0]}><boxGeometry args={[0.4, 0.18, 0.62]} /><meshStandardMaterial color="#1c2a3a" /></mesh>
      <mesh position={[-0.42, 0.5, 0]} castShadow><boxGeometry args={[1.05, 0.42, 0.66]} /><meshStandardMaterial color="#6b6f4e" roughness={0.85} /></mesh>
      <mesh position={[0.94, 0.36, 0.22]}><boxGeometry args={[0.05, 0.1, 0.1]} /><meshStandardMaterial color="#ffe9a8" emissive="#ffd36b" emissiveIntensity={0.8} /></mesh>
      <mesh position={[0.94, 0.36, -0.22]}><boxGeometry args={[0.05, 0.1, 0.1]} /><meshStandardMaterial color="#ffe9a8" emissive="#ffd36b" emissiveIntensity={0.8} /></mesh>
      {wheels.map(([x, z], i) => (
        <mesh key={i} position={[x, 0.16, z]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.17, 0.17, 0.12, 12]} />
          <meshStandardMaterial color="#15171a" roughness={0.8} />
        </mesh>
      ))}
    </group>
  )
}

interface FlowLinksProps {
  nodes: SceneNode[]
  edges: SceneEdge[]
}

/** Ортогональная дорожная сеть текущего уровня + грузовики на части дорог. */
export function FlowLinks({ nodes, edges }: FlowLinksProps) {
  const positions = useMemo(() => {
    const map: Record<string, [number, number]> = {}
    for (const n of nodes) map[n.id] = n.position
    return map
  }, [nodes])

  return (
    <group>
      {edges.map((edge, index) => {
        const from = positions[edge.from]
        const to = positions[edge.to]
        if (!from || !to) return null
        return (
          <FlowLine
            key={edge.id}
            from={from}
            to={to}
            speed={0.1 + (index % 3) * 0.03}
            withTruck={index % 2 === 0}
          />
        )
      })}
    </group>
  )
}
