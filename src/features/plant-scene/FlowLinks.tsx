import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { SceneEdge, SceneNode } from './graph/sceneModel'

const ASPHALT = '#34383d'
const SHOULDER = '#54595f'
const LANE = '#c9b65a'
const ROAD_W = 3.0

interface FlowLineProps {
  from: [number, number]
  to: [number, number]
  speed: number
  withTruck: boolean
}

/** Дорога между объектами + (опц.) грузовик ЗИЛ, курсирующий по ней. */
function FlowLine({ from, to, speed, withTruck }: FlowLineProps) {
  const truck = useRef<THREE.Group>(null)

  const [start, end, cx, cz, len, yaw] = useMemo(() => {
    const s = new THREE.Vector3(from[0], 0.06, from[1])
    const e = new THREE.Vector3(to[0], 0.06, to[1])
    const mx = (from[0] + to[0]) / 2, mz = (from[1] + to[1]) / 2
    const l = Math.hypot(to[0] - from[0], to[1] - from[1])
    const rot = Math.atan2(-(to[1] - from[1]), to[0] - from[0])
    return [s, e, mx, mz, l, rot] as const
  }, [from, to])

  // Грузовик курсирует туда-обратно (без телепортации), разворачиваясь на концах.
  useFrame((state) => {
    if (!truck.current) return
    const phase = (state.clock.elapsedTime * speed) % 2
    const fwd = phase < 1
    const tt = fwd ? phase : 2 - phase
    truck.current.position.lerpVectors(start, end, tt)
    truck.current.rotation.y = fwd ? yaw : yaw + Math.PI
  })

  return (
    <group>
      {/* обочина */}
      <mesh position={[cx, 0.035, cz]} rotation={[-Math.PI / 2, 0, -yaw]} receiveShadow>
        <planeGeometry args={[len, ROAD_W + 1.0]} />
        <meshStandardMaterial color={SHOULDER} roughness={1} />
      </mesh>
      {/* асфальт */}
      <mesh position={[cx, 0.05, cz]} rotation={[-Math.PI / 2, 0, -yaw]} receiveShadow>
        <planeGeometry args={[len, ROAD_W]} />
        <meshStandardMaterial color={ASPHALT} roughness={1} />
      </mesh>
      {/* осевая разметка */}
      <mesh position={[cx, 0.065, cz]} rotation={[-Math.PI / 2, 0, -yaw]}>
        <planeGeometry args={[len, 0.16]} />
        <meshBasicMaterial color={LANE} />
      </mesh>

      {withTruck && (
        <group ref={truck} rotation={[0, yaw, 0]} scale={0.55}>
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

/** Дороги текущего уровня схемы + грузовики на части из них. */
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
