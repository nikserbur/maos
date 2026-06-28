import { useMemo } from 'react'
import type { SceneNode } from './graph/sceneModel'
import { Decorations } from './Decorations'

const FENCE_H = 2.4
const FENCE_COLOR = '#6a7568'
const POST_COLOR = '#4c5550'
/** Отступ забора от крайних цехов (крупные здания + проезд по периметру). */
const MARGIN = 16

interface PostProps { x: number; z: number; h?: number; w?: number }
function Post({ x, z, h = FENCE_H + 0.4, w = 0.32 }: PostProps) {
  return (
    <mesh position={[x, h / 2, z]} castShadow>
      <boxGeometry args={[w, h, w]} />
      <meshStandardMaterial color={POST_COLOR} metalness={0.5} roughness={0.6} />
    </mesh>
  )
}

/** Прямой пролёт забора между двумя точками. */
function FenceRun({ x1, z1, x2, z2 }: { x1: number; z1: number; x2: number; z2: number }) {
  const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2
  const len = Math.hypot(x2 - x1, z2 - z1)
  const angle = Math.atan2(-(z2 - z1), x2 - x1)
  const n = Math.max(1, Math.round(len / 6))
  const posts = []
  for (let i = 0; i <= n; i++) posts.push([x1 + ((x2 - x1) * i) / n, z1 + ((z2 - z1) * i) / n] as const)
  return (
    <group>
      <mesh position={[cx, FENCE_H / 2 + 0.1, cz]} rotation={[0, angle, 0]} castShadow>
        <boxGeometry args={[len, FENCE_H, 0.08]} />
        <meshStandardMaterial color={FENCE_COLOR} metalness={0.4} roughness={0.7} transparent opacity={0.85} />
      </mesh>
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
      <mesh position={[0, legH + 1.2, 0]} castShadow>
        <boxGeometry args={[3.2, 2.4, 3.2]} />
        <meshStandardMaterial color="#7c8a76" metalness={0.3} roughness={0.7} />
      </mesh>
      <mesh position={[0, legH + 3, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <coneGeometry args={[2.6, 1.6, 4]} />
        <meshStandardMaterial color="#564b3a" roughness={0.9} />
      </mesh>
      <mesh position={[0, legH, 0]}>
        <boxGeometry args={[3.6, 0.2, 3.6]} />
        <meshStandardMaterial color="#4c5550" />
      </mesh>
    </group>
  )
}

function Trunk({ h = 1.4, r = 0.22, color = '#5b4632' }: { h?: number; r?: number; color?: string }) {
  return (
    <mesh position={[0, h / 2, 0]} castShadow>
      <cylinderGeometry args={[r * 0.8, r, h, 7]} />
      <meshStandardMaterial color={color} roughness={1} />
    </mesh>
  )
}

/** Дерево трёх пород: 0 — ёлка (конусы), 1 — дуб (широкая крона), 2 — клён (золотистый). */
function Tree({ x, z, s, kind }: { x: number; z: number; s: number; kind: number }) {
  return (
    <group position={[x, 0, z]} scale={s}>
      {kind === 0 && (
        <>
          <Trunk h={1.4} r={0.22} />
          <mesh position={[0, 1.9, 0]} castShadow><coneGeometry args={[1.15, 2.1, 9]} /><meshStandardMaterial color="#3f6b39" roughness={1} /></mesh>
          <mesh position={[0, 2.85, 0]} castShadow><coneGeometry args={[0.82, 1.6, 9]} /><meshStandardMaterial color="#4d7d44" roughness={1} /></mesh>
        </>
      )}
      {kind === 1 && (
        <>
          <Trunk h={1.6} r={0.3} color="#5a4a36" />
          {/* дуб — широкая раскидистая крона из нескольких сфер */}
          <mesh position={[0, 2.4, 0]} castShadow><sphereGeometry args={[1.5, 9, 7]} /><meshStandardMaterial color="#3c6b34" roughness={1} /></mesh>
          {[[1, 2.1, 0.6], [-1, 2.1, -0.5], [0.4, 3.1, -0.7], [-0.5, 2.9, 0.7]].map(([dx, dy, dz], i) => (
            <mesh key={i} position={[dx, dy, dz]} castShadow><sphereGeometry args={[0.85, 8, 6]} /><meshStandardMaterial color={i % 2 ? '#46773c' : '#356030'} roughness={1} /></mesh>
          ))}
        </>
      )}
      {kind === 2 && (
        <>
          <Trunk h={1.8} r={0.24} color="#6b5238" />
          {/* клён — округлая золотисто-зелёная крона */}
          <mesh position={[0, 2.7, 0]} castShadow><sphereGeometry args={[1.3, 9, 7]} /><meshStandardMaterial color="#8a9a3a" roughness={1} /></mesh>
          <mesh position={[0.55, 2.3, 0.4]} castShadow><sphereGeometry args={[0.8, 8, 6]} /><meshStandardMaterial color="#b5862e" roughness={1} /></mesh>
          <mesh position={[-0.5, 2.5, -0.4]} castShadow><sphereGeometry args={[0.75, 8, 6]} /><meshStandardMaterial color="#9a8a30" roughness={1} /></mesh>
        </>
      )}
    </group>
  )
}

interface FacilityProps { nodes: SceneNode[] }

/**
 * Территория предприятия: забор по периметру (авто-расширяется под здания),
 * сторожевые вышки по углам, въездные ворота и деревья за оградой.
 */
export function Facility({ nodes }: FacilityProps) {
  const { minX, maxX, minZ, maxZ } = useMemo(() => {
    if (!nodes.length) return { minX: -34, maxX: 40, minZ: -32, maxZ: 26 }
    let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity
    for (const n of nodes) {
      const [x, z] = n.position
      a = Math.min(a, x); b = Math.max(b, x); c = Math.min(c, z); d = Math.max(d, z)
    }
    return { minX: a - MARGIN, maxX: b + MARGIN, minZ: c - MARGIN, maxZ: d + MARGIN }
  }, [nodes])

  const gMid = (minZ + maxZ) / 2
  const gate = { z0: gMid - 5, z1: gMid + 5 }

  const trees = useMemo(() => {
    const hash = (i: number) => { const s = Math.sin(i * 127.1 + 11.7) * 43758.5453; return s - Math.floor(s) }
    const out: [number, number, number, number][] = []
    let i = 1
    const band = () => 4 + hash(i++) * 9          // вынос наружу от забора
    const size = () => 0.85 + hash(i++) * 0.9
    const kind = () => Math.floor(hash(i++) * 3)  // 0 ёлка · 1 дуб · 2 клён
    const nx = Math.max(6, Math.round((maxX - minX) / 7))
    const nz = Math.max(6, Math.round((maxZ - minZ) / 7))
    for (let k = 0; k <= nx; k++) {
      const x = minX + ((maxX - minX) * k) / nx + (hash(i++) - 0.5) * 4
      out.push([x, minZ - band(), size(), kind()])
      out.push([x, maxZ + band(), size(), kind()])
    }
    for (let k = 0; k <= nz; k++) {
      const z = minZ + ((maxZ - minZ) * k) / nz + (hash(i++) - 0.5) * 4
      out.push([minX - band(), z, size(), kind()])
      out.push([maxX + band(), z, size(), kind()])
    }
    return out
  }, [minX, maxX, minZ, maxZ])

  return (
    <group>
      {/* Забор: 3 сплошные стороны + сторона +X с проёмом ворот */}
      <FenceRun x1={minX} z1={minZ} x2={maxX} z2={minZ} />
      <FenceRun x1={minX} z1={maxZ} x2={maxX} z2={maxZ} />
      <FenceRun x1={minX} z1={minZ} x2={minX} z2={maxZ} />
      <FenceRun x1={maxX} z1={minZ} x2={maxX} z2={gate.z0} />
      <FenceRun x1={maxX} z1={gate.z1} x2={maxX} z2={maxZ} />

      {/* Ворота */}
      <Post x={maxX} z={gate.z0} h={3.4} w={0.5} />
      <Post x={maxX} z={gate.z1} h={3.4} w={0.5} />
      <mesh position={[maxX, 3.3, gMid]}>
        <boxGeometry args={[0.3, 0.3, gate.z1 - gate.z0]} />
        <meshStandardMaterial color="#c87619" metalness={0.4} roughness={0.6} />
      </mesh>

      {/* Вышки по углам */}
      <WatchTower x={minX + 1.5} z={minZ + 1.5} />
      <WatchTower x={maxX - 1.5} z={maxZ - 1.5} />

      {/* Деревья за оградой */}
      {trees.map(([x, z, s, k], i) => <Tree key={i} x={x} z={z} s={s} kind={k} />)}

      {/* Декорации территории (КПП, шлагбаум, парковка, навесы, скамейки, курилки) */}
      <Decorations minX={minX} maxX={maxX} minZ={minZ} maxZ={maxZ} gMid={gMid} />
    </group>
  )
}
