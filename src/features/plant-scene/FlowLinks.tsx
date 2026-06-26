import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { FLOWS, STAGE_BY_ID } from './layout'
import { FLOW_META } from './types'

interface FlowLineProps {
  from: [number, number]
  to: [number, number]
  color: string
  speed: number
}

/** Линия связи + бегущий «пакет», показывающий направление потока. */
function FlowLine({ from, to, color, speed }: FlowLineProps) {
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
      <Line points={linePoints} color={color} lineWidth={1.4} transparent opacity={0.35} />
      <mesh ref={packet}>
        <sphereGeometry args={[0.26, 16, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.5} toneMapped={false} />
      </mesh>
    </group>
  )
}

/** Все потоки схемы (материальные, энергетические, газовые). */
export function FlowLinks() {
  return (
    <group>
      {FLOWS.map((flow, index) => {
        const from = STAGE_BY_ID[flow.from]
        const to = STAGE_BY_ID[flow.to]
        if (!from || !to) return null
        return (
          <FlowLine
            key={`${flow.from}-${flow.to}`}
            from={from.position}
            to={to.position}
            color={FLOW_META[flow.kind].color}
            speed={0.18 + (index % 3) * 0.04}
          />
        )
      })}
    </group>
  )
}
