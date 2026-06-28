import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import type { SceneEdge, SceneNode } from './graph/sceneModel'

const LINK_COLOR = '#4a9eff'
const LINK_WIDTH = 7

interface FlowLineProps {
  from: [number, number]
  to: [number, number]
  speed: number
}

/** Линия физической связи + бегущая «вагонетка», показывающая направление потока. */
function FlowLine({ from, to, speed }: FlowLineProps) {
  const wagon = useRef<THREE.Group>(null)

  const [start, end, linePoints, yaw] = useMemo(() => {
    const s = new THREE.Vector3(from[0], 0.5, from[1])
    const e = new THREE.Vector3(to[0], 0.5, to[1])
    const pts: [number, number, number][] = [
      [from[0], 0.28, from[1]],
      [to[0], 0.28, to[1]],
    ]
    // Ориентация вагонетки вдоль направления потока (поворот вокруг Y).
    const rot = Math.atan2(-(to[1] - from[1]), to[0] - from[0])
    return [s, e, pts, rot] as const
  }, [from, to])

  useFrame((state) => {
    if (!wagon.current) return
    const t = (state.clock.elapsedTime * speed) % 1
    wagon.current.position.lerpVectors(start, end, t)
  })

  return (
    <group>
      <Line points={linePoints} color={LINK_COLOR} lineWidth={LINK_WIDTH} transparent opacity={0.7} />
      <group ref={wagon} rotation={[0, yaw, 0]}>
        {/* корпус вагонетки */}
        <mesh position={[0, 0.04, 0]} castShadow>
          <boxGeometry args={[0.62, 0.26, 0.4]} />
          <meshStandardMaterial color="#2a3340" metalness={0.6} roughness={0.4} />
        </mesh>
        {/* светящийся груз */}
        <mesh position={[0, 0.22, 0]}>
          <boxGeometry args={[0.46, 0.16, 0.3]} />
          <meshStandardMaterial color={LINK_COLOR} emissive={LINK_COLOR} emissiveIntensity={1.4} toneMapped={false} />
        </mesh>
        {/* колёса */}
        {([[-0.22, 0.16], [0.22, 0.16], [-0.22, -0.16], [0.22, -0.16]] as const).map(([x, z], i) => (
          <mesh key={i} position={[x, -0.08, z]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.09, 0.09, 0.06, 10]} />
            <meshStandardMaterial color="#11151b" metalness={0.3} roughness={0.7} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

interface FlowLinksProps {
  nodes: SceneNode[]
  edges: SceneEdge[]
}

/** Связи текущего уровня схемы. */
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
            speed={0.18 + (index % 3) * 0.04}
          />
        )
      })}
    </group>
  )
}
