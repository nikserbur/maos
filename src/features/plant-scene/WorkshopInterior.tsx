import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { SceneNode } from './graph/sceneModel'

const FLOOR = '#5a5f64'
const COLUMN = '#8a9088'
const RAIL = '#6a7076'
const HAZARD = '#caa83a'

/** Вилочный погрузчик, курсирующий по полу цеха (туда-обратно). */
function Forklift({ a, b, speed }: { a: [number, number]; b: [number, number]; speed: number }) {
  const ref = useRef<THREE.Group>(null)
  const yaw = Math.atan2(-(b[1] - a[1]), b[0] - a[0])
  useFrame((s) => {
    if (!ref.current) return
    const ph = (s.clock.elapsedTime * speed) % 2
    const fwd = ph < 1
    const t = fwd ? ph : 2 - ph
    ref.current.position.set(a[0] + (b[0] - a[0]) * t, 0.12, a[1] + (b[1] - a[1]) * t)
    ref.current.rotation.y = fwd ? yaw : yaw + Math.PI
  })
  return (
    <group ref={ref} scale={0.85}>
      <mesh position={[0, 0.5, 0]} castShadow><boxGeometry args={[1.4, 0.7, 0.9]} /><meshStandardMaterial color="#d8b24a" metalness={0.2} roughness={0.6} /></mesh>
      <mesh position={[0.35, 1.15, 0]}><boxGeometry args={[0.55, 0.6, 0.8]} /><meshStandardMaterial color="#33363a" /></mesh>
      {/* мачта + вилы */}
      <mesh position={[0.85, 0.7, 0]}><boxGeometry args={[0.12, 1.4, 0.7]} /><meshStandardMaterial color="#2a2d31" /></mesh>
      <mesh position={[1.1, 0.2, 0.18]}><boxGeometry args={[0.6, 0.08, 0.1]} /><meshStandardMaterial color="#1e2024" /></mesh>
      <mesh position={[1.1, 0.2, -0.18]}><boxGeometry args={[0.6, 0.08, 0.1]} /><meshStandardMaterial color="#1e2024" /></mesh>
      {[[0.45, 0.45], [0.45, -0.45], [-0.45, 0.45], [-0.45, -0.45]].map(([wx, wz], i) => (
        <mesh key={i} position={[wx, 0.22, wz]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.22, 0.22, 0.16, 10]} /><meshStandardMaterial color="#15171a" /></mesh>
      ))}
    </group>
  )
}

/** Поддон с грузом. */
function Pallet({ x, z, color }: { x: number; z: number; color: string }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.1, 0]}><boxGeometry args={[1.2, 0.2, 1]} /><meshStandardMaterial color="#6b5436" roughness={1} /></mesh>
      <mesh position={[0, 0.55, 0]} castShadow><boxGeometry args={[1, 0.7, 0.85]} /><meshStandardMaterial color={color} roughness={0.8} /></mesh>
    </group>
  )
}

interface WorkshopInteriorProps { nodes: SceneNode[] }

/**
 * Интерьер цеха (drill-down): бетонный пол с разметкой, колонны, мостовой кран,
 * поддоны и курсирующие погрузчики. Габариты охватывают оборудование цеха.
 */
export function WorkshopInterior({ nodes }: WorkshopInteriorProps) {
  const geo = useMemo(() => {
    let aX = Infinity, bX = -Infinity, aZ = Infinity, bZ = -Infinity
    for (const n of nodes) {
      const [x, z] = n.position
      aX = Math.min(aX, x); bX = Math.max(bX, x); aZ = Math.min(aZ, z); bZ = Math.max(bZ, z)
    }
    if (!nodes.length) { aX = -10; bX = 10; aZ = -8; bZ = 8 }
    const M = 9
    const minX = aX - M, maxX = bX + M, minZ = aZ - M, maxZ = bZ + M
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2
    const w = maxX - minX, d = maxZ - minZ
    return { minX, maxX, minZ, maxZ, cx, cz, w, d }
  }, [nodes])

  const { minX, maxX, minZ, maxZ, cx, cz, w, d } = geo

  const pallets = useMemo(() => {
    const cols = ['#b5483a', '#3a6ea5', '#4c8a52', '#9a9ea3', '#7a5aa0', '#c98a3a']
    const hash = (i: number) => { const s = Math.sin(i * 91.7 + 5.3) * 43758.5; return s - Math.floor(s) }
    const out: [number, number, string][] = []
    for (let i = 0; i < 8; i++) {
      const onX = hash(i) > 0.5
      const x = onX ? minX + 2 + hash(i + 1) * (w - 4) : (i % 2 ? minX + 2.2 : maxX - 2.2)
      const z = onX ? (i % 2 ? minZ + 2.2 : maxZ - 2.2) : minZ + 2 + hash(i + 2) * (d - 4)
      out.push([x, z, cols[i % cols.length]])
    }
    return out
  }, [minX, maxX, minZ, maxZ, w, d])

  const cols: [number, number][] = [
    [minX, minZ], [maxX, minZ], [minX, maxZ], [maxX, maxZ],
    [cx, minZ], [cx, maxZ],
  ]

  return (
    <group>
      {/* Бетонный пол цеха */}
      <mesh position={[cx, 0.0, cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[w, d]} /><meshStandardMaterial color={FLOOR} roughness={1} />
      </mesh>
      {/* Жёлтая предупредительная рамка по периметру */}
      {([[cx, minZ + 0.6, w, 0.3], [cx, maxZ - 0.6, w, 0.3], [minX + 0.6, cz, 0.3, d], [maxX - 0.6, cz, 0.3, d]] as const).map(([x, z, sw, sd], i) => (
        <mesh key={i} position={[x, 0.02, z]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[sw, sd]} /><meshBasicMaterial color={HAZARD} /></mesh>
      ))}
      {/* Транспортная полоса по центру */}
      <mesh position={[cx, 0.02, cz]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[w - 4, 0.16]} /><meshBasicMaterial color="#c7cdd2" /></mesh>

      {/* Колонны */}
      {cols.map(([x, z], i) => (
        <mesh key={i} position={[x, 3, z]} castShadow><boxGeometry args={[0.6, 6, 0.6]} /><meshStandardMaterial color={COLUMN} roughness={0.85} /></mesh>
      ))}
      {/* Подкрановые балки вдоль длинной стороны + мостовой кран */}
      {[minZ, maxZ].map((z, i) => (
        <mesh key={i} position={[cx, 5.8, z]}><boxGeometry args={[w, 0.35, 0.35]} /><meshStandardMaterial color={RAIL} metalness={0.4} roughness={0.6} /></mesh>
      ))}
      <group position={[cx + w * 0.15, 0, cz]}>
        <mesh position={[0, 5.9, 0]} castShadow><boxGeometry args={[0.5, 0.5, d]} /><meshStandardMaterial color="#c2a23a" metalness={0.3} /></mesh>
        <mesh position={[0, 5.5, 0]}><boxGeometry args={[1.2, 0.5, 1.2]} /><meshStandardMaterial color="#33363a" /></mesh>
        <mesh position={[0, 4.6, 0]}><boxGeometry args={[0.12, 1.4, 0.12]} /><meshStandardMaterial color="#15171a" /></mesh>
      </group>

      {/* Поддоны с грузом */}
      {pallets.map(([x, z, c], i) => <Pallet key={i} x={x} z={z} color={c} />)}

      {/* Погрузчики курсируют по полу */}
      <Forklift a={[minX + 3, minZ + 2.5]} b={[maxX - 3, minZ + 2.5]} speed={0.16} />
      <Forklift a={[maxX - 3, maxZ - 2.5]} b={[minX + 3, maxZ - 2.5]} speed={0.12} />
      <Forklift a={[cx, minZ + 3]} b={[cx, maxZ - 3]} speed={0.1} />
    </group>
  )
}
