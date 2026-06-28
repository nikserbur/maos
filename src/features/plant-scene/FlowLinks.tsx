import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { SceneEdge, SceneNode } from './graph/sceneModel'

const ROAD_COLOR = '#3b3f45'
const ROAD_EDGE = '#5a5f66'

interface FlowLineProps {
  from: [number, number]
  to: [number, number]
  speed: number
  withTruck: boolean
}

/** Дорога между объектами + (опц.) едущий по ней грузовик ЗИЛ. */
function FlowLine({ from, to, speed, withTruck }: FlowLineProps) {
  const truck = useRef<THREE.Group>(null)

  const [start, end, cx, cz, len, yaw] = useMemo(() => {
    const s = new THREE.Vector3(from[0], 0.32, from[1])
    const e = new THREE.Vector3(to[0], 0.32, to[1])
    const mx = (from[0] + to[0]) / 2, mz = (from[1] + to[1]) / 2
    const l = Math.hypot(to[0] - from[0], to[1] - from[1])
    const rot = Math.atan2(-(to[1] - from[1]), to[0] - from[0])
    return [s, e, mx, mz, l, rot] as const
  }, [from, to])

  useFrame((state) => {
    if (!truck.current) return
    const t = (state.clock.elapsedTime * speed) % 1
    truck.current.position.lerpVectors(start, end, t)
  })

  return (
    <group>
      {/* асфальт */}
      <mesh position={[cx, 0.05, cz]} rotation={[-Math.PI / 2, 0, -yaw]} receiveShadow>
        <planeGeometry args={[len, 2.0]} />
        <meshStandardMaterial color={ROAD_COLOR} roughness={1} />
      </mesh>
      {/* осевая разметка */}
      <mesh position={[cx, 0.07, cz]} rotation={[-Math.PI / 2, 0, -yaw]}>
        <planeGeometry args={[len, 0.12]} />
        <meshBasicMaterial color={ROAD_EDGE} />
      </mesh>

      {withTruck && (
        <group ref={truck} rotation={[0, yaw, 0]} scale={1.1}>
          <Zil />
        </group>
      )}
    </group>
  )
}

/** Грузовик ЗИЛ: синяя кабина + бортовой кузов + колёса. */
function Zil() {
  const wheels: [number, number][] = [
    [0.55, 0.34], [0.55, -0.34],            // передние
    [-0.35, 0.34], [-0.35, -0.34],          // задние 1
    [-0.7, 0.34], [-0.7, -0.34],            // задние 2 (ЗИЛ — 6 колёс)
  ]
  return (
    <group position={[0, 0.05, 0]}>
      {/* рама */}
      <mesh position={[-0.1, 0.18, 0]}><boxGeometry args={[1.9, 0.12, 0.62]} /><meshStandardMaterial color="#23262b" /></mesh>
      {/* кабина */}
      <mesh position={[0.62, 0.42, 0]} castShadow><boxGeometry args={[0.62, 0.5, 0.66]} /><meshStandardMaterial color="#2f6fb0" metalness={0.3} roughness={0.5} /></mesh>
      {/* лобовое/крыша */}
      <mesh position={[0.5, 0.74, 0]}><boxGeometry args={[0.4, 0.18, 0.62]} /><meshStandardMaterial color="#1c2a3a" /></mesh>
      {/* кузов (борт) */}
      <mesh position={[-0.42, 0.5, 0]} castShadow><boxGeometry args={[1.05, 0.42, 0.66]} /><meshStandardMaterial color="#6b6f4e" roughness={0.85} /></mesh>
      {/* фары */}
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
            speed={0.05 + (index % 3) * 0.015}
            withTruck={index % 2 === 0}
          />
        )
      })}
    </group>
  )
}
