import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import type { SceneEdge, SceneNode } from './graph/sceneModel'

const LINK_COLOR = '#4a9eff'
const LINK_WIDTH = 3.5

interface FlowLineProps {
  from: [number, number]
  to: [number, number]
  speed: number
}

/** Линия физической связи + бегущий «пакет», показывающий направление. */
function FlowLine({ from, to, speed }: FlowLineProps) {
  const packet = useRef<THREE.Mesh>(null)

  const [start, end, linePoints] = useMemo(() => {
    const s = new THREE.Vector3(from[0], 0.45, from[1])
    const e = new THREE.Vector3(to[0], 0.45, to[1])
    const pts: [number, number, number][] = [
      [from[0], 0.25, from[1]],
      [to[0], 0.25, to[1]],
    ]
    return [s, e, pts] as const
  }, [from, to])

  useFrame((state) => {
    if (!packet.current) return
    const t = (state.clock.elapsedTime * speed) % 1
    packet.current.position.lerpVectors(start, end, t)
  })

  return (
    <group>
      <Line points={linePoints} color={LINK_COLOR} lineWidth={LINK_WIDTH} transparent opacity={0.55} />
      <mesh ref={packet}>
        <sphereGeometry args={[0.26, 16, 16]} />
        <meshStandardMaterial
          color={LINK_COLOR}
          emissive={LINK_COLOR}
          emissiveIntensity={1.5}
          toneMapped={false}
        />
      </mesh>
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
