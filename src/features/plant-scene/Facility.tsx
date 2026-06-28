import { useMemo } from 'react'

/** Граница территории предприятия. */
const MIN_X = -32, MAX_X = 38, MIN_Z = -30, MAX_Z = 24
const FENCE_H = 2.4
const FENCE_COLOR = '#6a7568'
const POST_COLOR = '#4c5550'

interface PostProps { x: number; z: number; h?: number; w?: number }
function Post({ x, z, h = FENCE_H + 0.4, w = 0.32 }: PostProps) {
  return (
    <mesh position={[x, h / 2, z]} castShadow>
      <boxGeometry args={[w, h, w]} />
      <meshStandardMaterial color={POST_COLOR} metalness={0.5} roughness={0.6} />
    </mesh>
  )
}

/** Прямой пролёт забора между двумя точками по оси. */
function FenceRun({ x1, z1, x2, z2 }: { x1: number; z1: number; x2: number; z2: number }) {
  const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2
  const len = Math.hypot(x2 - x1, z2 - z1)
  const angle = Math.atan2(-(z2 - z1), x2 - x1)
  const posts = []
  const n = Math.max(1, Math.round(len / 6))
  for (let i = 0; i <= n; i++) {
    posts.push([x1 + ((x2 - x1) * i) / n, z1 + ((z2 - z1) * i) / n] as const)
  }
  return (
    <group>
      {/* сетчатое полотно (полупрозрачная панель) */}
      <mesh position={[cx, FENCE_H / 2 + 0.1, cz]} rotation={[0, angle, 0]} castShadow>
        <boxGeometry args={[len, FENCE_H, 0.08]} />
        <meshStandardMaterial color={FENCE_COLOR} metalness={0.4} roughness={0.7} transparent opacity={0.85} />
      </mesh>
      {/* верхний рельс */}
      <mesh position={[cx, FENCE_H + 0.15, cz]} rotation={[0, angle, 0]}>
        <boxGeometry args={[len, 0.12, 0.16]} />
        <meshStandardMaterial color={POST_COLOR} metalness={0.5} roughness={0.5} />
      </mesh>
      {posts.map(([px, pz], i) => <Post key={i} x={px} z={pz} />)}
    </group>
  )
}

/** Сторожевая вышка в углу. */
function WatchTower({ x, z }: { x: number; z: number }) {
  const legH = 7
  const legs: [number, number][] = [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]]
  return (
    <group position={[x, 0, z]}>
      {legs.map(([lx, lz], i) => (
        <mesh key={i} position={[lx, legH / 2, lz]} castShadow>
          <boxGeometry args={[0.3, legH, 0.3]} />
          <meshStandardMaterial color={POST_COLOR} metalness={0.4} roughness={0.6} />
        </mesh>
      ))}
      {/* кабина */}
      <mesh position={[0, legH + 1.2, 0]} castShadow>
        <boxGeometry args={[3.2, 2.4, 3.2]} />
        <meshStandardMaterial color="#7c8a76" metalness={0.3} roughness={0.7} />
      </mesh>
      {/* крыша-пирамида */}
      <mesh position={[0, legH + 3, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <coneGeometry args={[2.6, 1.6, 4]} />
        <meshStandardMaterial color="#564b3a" roughness={0.9} />
      </mesh>
      {/* площадка */}
      <mesh position={[0, legH, 0]}>
        <boxGeometry args={[3.6, 0.2, 3.6]} />
        <meshStandardMaterial color="#4c5550" />
      </mesh>
    </group>
  )
}

/**
 * Территория предприятия: газон уже в окружении; здесь — забор по периметру,
 * сторожевая вышка и въездные ворота. Рисуется только на верхнем уровне схемы.
 */
export function Facility() {
  const gate = useMemo(() => ({ z0: -4, z1: 4 }), [])  // проём ворот на стороне +X
  return (
    <group>
      {/* Забор: 3 сплошные стороны + сторона с воротами (два пролёта) */}
      <FenceRun x1={MIN_X} z1={MIN_Z} x2={MAX_X} z2={MIN_Z} />
      <FenceRun x1={MIN_X} z1={MAX_Z} x2={MAX_X} z2={MAX_Z} />
      <FenceRun x1={MIN_X} z1={MIN_Z} x2={MIN_X} z2={MAX_Z} />
      <FenceRun x1={MAX_X} z1={MIN_Z} x2={MAX_X} z2={gate.z0} />
      <FenceRun x1={MAX_X} z1={gate.z1} x2={MAX_X} z2={MAX_Z} />

      {/* Ворота: два столба + перекладина + откатные створки */}
      <Post x={MAX_X} z={gate.z0} h={3.4} w={0.5} />
      <Post x={MAX_X} z={gate.z1} h={3.4} w={0.5} />
      <mesh position={[MAX_X, 3.3, (gate.z0 + gate.z1) / 2]}>
        <boxGeometry args={[0.3, 0.3, gate.z1 - gate.z0]} />
        <meshStandardMaterial color="#c87619" metalness={0.4} roughness={0.6} />
      </mesh>

      {/* Сторожевые вышки в двух углах */}
      <WatchTower x={MIN_X + 1.5} z={MIN_Z + 1.5} />
      <WatchTower x={MAX_X - 1.5} z={MAX_Z - 1.5} />
    </group>
  )
}
