import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { SceneEdge, SceneNode } from './graph/sceneModel'

const ASPHALT = '#34383d'
const SHOULDER = '#54595f'
const LANE = '#c9b65a'
const ROAD_W = 2.4
const EPS = 0.6
const Y_SHOULDER = 0.035, Y_ROAD = 0.05, Y_LANE = 0.065

interface HSeg { z: number; x0: number; x1: number }
interface VSeg { x: number; z0: number; z1: number }

/** Единая ортогональная сеть из рёбер: Г-разводка → слияние совпадающих отрезков. */
function buildNetwork(nodes: SceneNode[], edges: SceneEdge[]) {
  const pos: Record<string, [number, number]> = {}
  for (const n of nodes) pos[n.id] = n.position

  const hor = new Map<number, [number, number][]>()
  const ver = new Map<number, [number, number][]>()
  const addH = (z: number, x0: number, x1: number) => {
    if (Math.abs(x1 - x0) < 0.5) return
    const k = Math.round(z)
    if (!hor.has(k)) hor.set(k, [])
    hor.get(k)!.push([Math.min(x0, x1), Math.max(x0, x1)])
  }
  const addV = (x: number, z0: number, z1: number) => {
    if (Math.abs(z1 - z0) < 0.5) return
    const k = Math.round(x)
    if (!ver.has(k)) ver.set(k, [])
    ver.get(k)!.push([Math.min(z0, z1), Math.max(z0, z1)])
  }
  // Г-образно (горизонталь от источника → вертикаль к цели).
  for (const e of edges) {
    const a = pos[e.from], b = pos[e.to]
    if (!a || !b) continue
    addH(a[1], a[0], b[0])
    addV(b[0], a[1], b[1])
  }
  // Слияние пересекающихся/совпадающих интервалов на одной линии → нет дублей.
  const merge = (arr: [number, number][]): [number, number][] => {
    arr.sort((p, q) => p[0] - q[0])
    const out: [number, number][] = []
    for (const iv of arr) {
      const last = out[out.length - 1]
      if (last && iv[0] <= last[1] + 0.5) last[1] = Math.max(last[1], iv[1])
      else out.push([iv[0], iv[1]])
    }
    return out
  }
  const hSegs: HSeg[] = []
  for (const [z, arr] of hor) for (const [x0, x1] of merge(arr)) hSegs.push({ z, x0, x1 })
  const vSegs: VSeg[] = []
  for (const [x, arr] of ver) for (const [z0, z1] of merge(arr)) vSegs.push({ x, z0, z1 })

  // Кольцевые развязки только на настоящих перекрёстках (T/крест, степень ≥ 3).
  const seen = new Set<string>()
  const roundabouts: [number, number][] = []
  for (const h of hSegs) for (const v of vSegs) {
    const x = v.x, z = h.z
    if (!(x >= h.x0 - EPS && x <= h.x1 + EPS && z >= v.z0 - EPS && z <= v.z1 + EPS)) continue
    const hArms = (x > h.x0 + EPS ? 1 : 0) + (x < h.x1 - EPS ? 1 : 0)
    const vArms = (z > v.z0 + EPS ? 1 : 0) + (z < v.z1 - EPS ? 1 : 0)
    if (hArms + vArms < 3) continue
    const key = `${Math.round(x)},${Math.round(z)}`
    if (seen.has(key)) continue
    seen.add(key)
    roundabouts.push([x, z])
  }
  return { hSegs, vSegs, roundabouts }
}

function RoadStrip({ cx, cz, w, d }: { cx: number; cz: number; w: number; d: number }) {
  const along = Math.max(w, d)
  const horiz = w >= d
  const shoulder: [number, number] = horiz ? [along, ROAD_W + 0.9] : [ROAD_W + 0.9, along]
  const road: [number, number] = horiz ? [along, ROAD_W] : [ROAD_W, along]
  const lane: [number, number] = horiz ? [along, 0.14] : [0.14, along]
  return (
    <group>
      <mesh position={[cx, Y_SHOULDER, cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={shoulder} /><meshStandardMaterial color={SHOULDER} roughness={1} />
      </mesh>
      <mesh position={[cx, Y_ROAD, cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={road} /><meshStandardMaterial color={ASPHALT} roughness={1} />
      </mesh>
      <mesh position={[cx, Y_LANE, cz]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={lane} /><meshBasicMaterial color={LANE} />
      </mesh>
    </group>
  )
}

/**
 * Кольцевая развязка: асфальтовое кольцо + бордюр + островок. На улице островок
 * газонный с деревцем; в цехе — бетонный, без «ёлочки».
 */
function Roundabout({ x, z, indoor }: { x: number; z: number; indoor?: boolean }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.052, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <ringGeometry args={[1.3, 2.6, 36]} /><meshStandardMaterial color={ASPHALT} roughness={1} />
      </mesh>
      <mesh position={[0, 0.066, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.5, 2.6, 36]} /><meshBasicMaterial color={indoor ? '#c7cdd2' : LANE} />
      </mesh>
      <mesh position={[0, 0.07, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.25, 28]} /><meshStandardMaterial color={indoor ? '#6a7076' : '#3f5d3a'} roughness={1} />
      </mesh>
      {!indoor && (
        <mesh position={[0, 0.45, 0]} castShadow>
          <coneGeometry args={[0.5, 1, 8]} /><meshStandardMaterial color="#4d7d44" roughness={1} />
        </mesh>
      )}
    </group>
  )
}

/** Транспорт, курсирующий по отрезку: ЗИЛ на улице, вилочный погрузчик в цехе. */
function Vehicle({ a, b, speed, indoor }: { a: [number, number]; b: [number, number]; speed: number; indoor?: boolean }) {
  const ref = useRef<THREE.Group>(null)
  const yaw = Math.atan2(-(b[1] - a[1]), b[0] - a[0])
  useFrame((s) => {
    if (!ref.current) return
    const ph = (s.clock.elapsedTime * speed) % 2
    const fwd = ph < 1
    const t = fwd ? ph : 2 - ph
    ref.current.position.set(a[0] + (b[0] - a[0]) * t, 0.06, a[1] + (b[1] - a[1]) * t)
    ref.current.rotation.y = fwd ? yaw : yaw + Math.PI
  })
  return <group ref={ref} scale={indoor ? 0.85 : 0.9}>{indoor ? <ForkliftModel /> : <Zil />}</group>
}

/** Вилочный погрузчик (для движения внутри цеха). */
function ForkliftModel() {
  return (
    <group position={[0, 0.05, 0]}>
      <mesh position={[0, 0.5, 0]} castShadow><boxGeometry args={[1.4, 0.7, 0.9]} /><meshStandardMaterial color="#d8b24a" metalness={0.2} roughness={0.6} /></mesh>
      <mesh position={[0.35, 1.15, 0]}><boxGeometry args={[0.55, 0.6, 0.8]} /><meshStandardMaterial color="#33363a" /></mesh>
      <mesh position={[0.85, 0.7, 0]}><boxGeometry args={[0.12, 1.4, 0.7]} /><meshStandardMaterial color="#2a2d31" /></mesh>
      <mesh position={[1.1, 0.2, 0.18]}><boxGeometry args={[0.6, 0.08, 0.1]} /><meshStandardMaterial color="#1e2024" /></mesh>
      <mesh position={[1.1, 0.2, -0.18]}><boxGeometry args={[0.6, 0.08, 0.1]} /><meshStandardMaterial color="#1e2024" /></mesh>
      {[[0.45, 0.45], [0.45, -0.45], [-0.45, 0.45], [-0.45, -0.45]].map(([wx, wz], i) => (
        <mesh key={i} position={[wx, 0.22, wz]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.22, 0.22, 0.16, 10]} /><meshStandardMaterial color="#15171a" /></mesh>
      ))}
    </group>
  )
}

function Zil() {
  const wheels: [number, number][] = [
    [0.55, 0.34], [0.55, -0.34], [-0.35, 0.34], [-0.35, -0.34], [-0.7, 0.34], [-0.7, -0.34],
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
          <cylinderGeometry args={[0.17, 0.17, 0.12, 12]} /><meshStandardMaterial color="#15171a" roughness={0.8} />
        </mesh>
      ))}
    </group>
  )
}

interface FlowLinksProps { nodes: SceneNode[]; edges: SceneEdge[]; indoor?: boolean }

/** Единая ортогональная дорожная сеть: дедуп-отрезки + развязки + транспорт. */
export function FlowLinks({ nodes, edges, indoor }: FlowLinksProps) {
  const { hSegs, vSegs, roundabouts, trucks } = useMemo(() => {
    const net = buildNetwork(nodes, edges)
    // Грузовики — на самых длинных отрезках сети (по одному, чтобы без толкучки).
    const cands: { a: [number, number]; b: [number, number]; len: number }[] = [
      ...net.hSegs.map((h) => ({ a: [h.x0 + 1.5, h.z] as [number, number], b: [h.x1 - 1.5, h.z] as [number, number], len: h.x1 - h.x0 })),
      ...net.vSegs.map((v) => ({ a: [v.x, v.z0 + 1.5] as [number, number], b: [v.x, v.z1 - 1.5] as [number, number], len: v.z1 - v.z0 })),
    ].filter((c) => c.len > 8).sort((p, q) => q.len - p.len).slice(0, 8)
    return { ...net, trucks: cands }
  }, [nodes, edges])

  return (
    <group>
      {hSegs.map((h, i) => <RoadStrip key={`h${i}`} cx={(h.x0 + h.x1) / 2} cz={h.z} w={h.x1 - h.x0} d={0} />)}
      {vSegs.map((v, i) => <RoadStrip key={`v${i}`} cx={v.x} cz={(v.z0 + v.z1) / 2} w={0} d={v.z1 - v.z0} />)}
      {roundabouts.map(([x, z], i) => <Roundabout key={`r${i}`} x={x} z={z} indoor={indoor} />)}
      {trucks.map((t, i) => <Vehicle key={`t${i}`} a={t.a} b={t.b} speed={0.1 + (i % 3) * 0.03} indoor={indoor} />)}
    </group>
  )
}
