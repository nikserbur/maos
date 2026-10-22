import { useMemo } from 'react'
import * as THREE from 'three'
import type { SceneNode } from './graph/sceneModel'
import { useScenePalette } from './scenePalette'

const PIPE_Y = 4.4   // высота надземных трубопроводов
const RF = 6.9       // уровень ферм/кровли

/** Поддон с грузом. */
function Pallet({ x, z, color }: { x: number; z: number; color: string }) {
  const pal = useScenePalette()
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.1, 0]}><boxGeometry args={[1.2, 0.2, 1]} /><meshStandardMaterial color={pal.orange.m} roughness={1} /></mesh>
      <mesh position={[0, 0.55, 0]} castShadow><boxGeometry args={[1, 0.7, 0.85]} /><meshStandardMaterial color={color} roughness={0.8} /></mesh>
    </group>
  )
}

/** Стальная ферма-балка (верхний/нижний пояс + раскосы). */
function Truss({ x1, x2, z, y }: { x1: number; x2: number; z: number; y: number }) {
  const pal = useScenePalette()
  const len = x2 - x1
  const n = Math.max(3, Math.round(len / 7))
  return (
    <group position={[(x1 + x2) / 2, y, z]}>
      <mesh castShadow><boxGeometry args={[len, 0.18, 0.16]} /><meshStandardMaterial color={pal.n[4]} metalness={0.45} roughness={0.5} /></mesh>
      <mesh position={[0, -0.55, 0]}><boxGeometry args={[len, 0.14, 0.14]} /><meshStandardMaterial color={pal.n[4]} metalness={0.45} roughness={0.5} /></mesh>
      {Array.from({ length: n + 1 }, (_, i) => {
        const px = -len / 2 + i * (len / n)
        return <mesh key={i} position={[px, -0.28, 0]}><boxGeometry args={[0.07, 0.62, 0.07]} /><meshStandardMaterial color={pal.n[4]} metalness={0.4} roughness={0.55} /></mesh>
      })}
    </group>
  )
}

/** Надземный трубопровод (труба + кронштейны). */
function PipeRun({ x, z, len, y, color }: { x: number; z: number; len: number; y: number; color: string }) {
  const pal = useScenePalette()
  const n = Math.max(2, Math.round(len / 5))
  return (
    <group position={[x, y, z]}>
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[0.13, 0.13, len * 0.96, 12]} /><meshStandardMaterial color={color} metalness={0.4} roughness={0.5} /></mesh>
      {Array.from({ length: n }, (_, i) => {
        const t = -len / 2 + (i + 0.5) * (len / n)
        return <mesh key={i} position={[0, 0.22, t]}><boxGeometry args={[0.06, 0.44, 0.06]} /><meshStandardMaterial color={pal.n[4]} metalness={0.4} roughness={0.6} /></mesh>
      })}
    </group>
  )
}

/** Подвесной светильник. */
function Lamp({ x, z, y }: { x: number; z: number; y: number }) {
  const pal = useScenePalette()
  return (
    <group position={[x, y, z]}>
      <mesh position={[0, 0.35, 0]}><boxGeometry args={[0.04, 0.7, 0.04]} /><meshStandardMaterial color={pal.n[4]} metalness={0.4} roughness={0.6} /></mesh>
      <mesh><boxGeometry args={[1.6, 0.12, 0.4]} /><meshStandardMaterial color={pal.n[1]} metalness={0.3} roughness={0.6} /></mesh>
      <mesh position={[0, -0.07, 0]}><boxGeometry args={[1.5, 0.03, 0.32]} /><meshStandardMaterial color={pal.n[8]} emissive={pal.n[8]} emissiveIntensity={0.9} /></mesh>
    </group>
  )
}

/** Электрошкаф. */
function Cabinet({ x, z, ry = 0 }: { x: number; z: number; ry?: number }) {
  const pal = useScenePalette()
  return (
    <group position={[x, 0, z]} rotation={[0, ry, 0]}>
      <mesh position={[0, 0.95, 0]} castShadow><boxGeometry args={[0.9, 1.9, 0.5]} /><meshStandardMaterial color={pal.n[2]} metalness={0.35} roughness={0.5} /></mesh>
      <mesh position={[0, 1.05, 0.26]}><boxGeometry args={[0.7, 1.3, 0.03]} /><meshStandardMaterial color={pal.n[3]} metalness={0.3} roughness={0.45} /></mesh>
      <mesh position={[0.3, 1.05, 0.28]}><boxGeometry args={[0.05, 0.3, 0.03]} /><meshStandardMaterial color={pal.n[7]} metalness={0.5} roughness={0.4} /></mesh>
    </group>
  )
}

/* Рабочих-операторов во время симуляции рисует SimulationLayer (по задачам плана) —
   здесь их НЕ дублируем, иначе на станке появлялись «2 человечка». */

interface WorkshopInteriorProps { nodes: SceneNode[] }

/**
 * Интерьер цеха (drill-down) БЕЗ стен (открытый план для обзора): бетонный пол
 * с разметкой, фермы кровли, надземные трубопроводы, подвесные светильники,
 * мостовой кран, электрошкафы, поддоны, рабочие-операторы у станков.
 * Тени станков запечены в ОДНУ текстуру пола (одна прозрачная плоскость —
 * не мерцает и не «лагает», в отличие от множества перекрывающихся декалей).
 */
export function WorkshopInterior({ nodes }: WorkshopInteriorProps) {
  const pal = useScenePalette()
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

  // Пол ЦЕЛИКОМ рисуем в одну НЕПРОЗРАЧНУЮ текстуру: бетон + жёлтая разметка +
  // транспортная полоса + мягкие тени под станками. Никаких наложенных
  // полупрозрачных плоскостей → нечему пересортировываться и мерцать чёрным.
  const floorTex = useMemo(() => {
    const S = 1024
    const cnv = document.createElement('canvas')
    cnv.width = cnv.height = S
    const g = cnv.getContext('2d')
    if (g) {
      g.fillStyle = pal.n[3]; g.fillRect(0, 0, S, S)
      // предупредительная рамка (жёлтая), ~0.6 ед от края
      g.fillStyle = pal.yellow.l
      const bx = (0.6 / w) * S, bz = (0.6 / d) * S, tX = (0.3 / w) * S, tZ = (0.3 / d) * S
      g.fillRect(0, bz - tZ / 2, S, tZ)
      g.fillRect(0, S - bz - tZ / 2, S, tZ)
      g.fillRect(bx - tX / 2, 0, tX, S)
      g.fillRect(S - bx - tX / 2, 0, tX, S)
      // центральная транспортная полоса
      g.fillStyle = pal.n[7]
      g.fillRect(0, S / 2 - (0.16 / d) * S, S, (0.16 / d) * S * 2)
      // мягкие тени под станками — запечены в пол
      const r = Math.max(28, (3.4 / Math.max(w, d)) * S)
      for (const n of nodes) {
        const px = ((n.position[0] - minX) / w) * S
        const py = ((n.position[1] - minZ) / d) * S
        const grd = g.createRadialGradient(px, py, 0, px, py, r)
        grd.addColorStop(0, 'rgba(0,0,0,0.42)')
        grd.addColorStop(0.55, 'rgba(0,0,0,0.18)')
        grd.addColorStop(1, 'rgba(0,0,0,0)')
        g.fillStyle = grd
        g.fillRect(px - r, py - r, r * 2, r * 2)
      }
    }
    const t = new THREE.CanvasTexture(cnv)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 4
    return t
  }, [nodes, minX, minZ, w, d, pal])

  const pallets = useMemo(() => {
    const cols = [pal.red.m, pal.blue.m, pal.green.m, pal.n[5], pal.violet.m, pal.orange.m]
    const hash = (i: number) => { const s = Math.sin(i * 91.7 + 5.3) * 43758.5; return s - Math.floor(s) }
    const out: [number, number, string][] = []
    for (let i = 0; i < 8; i++) {
      const onX = hash(i) > 0.5
      const x = onX ? minX + 2 + hash(i + 1) * (w - 4) : (i % 2 ? minX + 2.2 : maxX - 2.2)
      const z = onX ? (i % 2 ? minZ + 2.2 : maxZ - 2.2) : minZ + 2 + hash(i + 2) * (d - 4)
      out.push([x, z, cols[i % cols.length]])
    }
    return out
  }, [minX, maxX, minZ, maxZ, w, d, pal])

  const colPos: [number, number][] = [
    [minX, minZ], [maxX, minZ], [minX, maxZ], [maxX, maxZ],
    [cx, minZ], [cx, maxZ], [minX, cz], [maxX, cz],
  ]
  const trussZ = Array.from({ length: Math.max(2, Math.round(d / 7)) }, (_, i) => minZ + (i + 1) * (d / (Math.round(d / 7) + 1)))
  const lampX = Array.from({ length: Math.max(2, Math.round(w / 8)) }, (_, i) => minX + (i + 1) * (w / (Math.round(w / 8) + 1)))

  return (
    <group>
      {/* Бетонный пол цеха — разметка и тени станков запечены в текстуру (одна
          непрозрачная плоскость): ничего не наложено сверху → мерцать нечему. */}
      <mesh position={[cx, 0.0, cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[w, d]} /><meshStandardMaterial map={floorTex} roughness={1} />
      </mesh>

      {/* Колонны с опорными плитами (стен нет — открытый план) */}
      {colPos.map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, 3.4, 0]} castShadow><boxGeometry args={[0.55, 6.8, 0.55]} /><meshStandardMaterial color={pal.n[4]} roughness={0.85} /></mesh>
          <mesh position={[0, 0.15, 0]}><boxGeometry args={[0.85, 0.3, 0.85]} /><meshStandardMaterial color={pal.n[3]} roughness={0.9} /></mesh>
        </group>
      ))}

      {/* Стальные фермы кровли + продольные прогоны */}
      {trussZ.map((z, i) => <Truss key={i} x1={minX} x2={maxX} z={z} y={RF} />)}
      {[minZ + d * 0.3, maxZ - d * 0.3].map((z, i) => (
        <mesh key={i} position={[cx, RF + 0.12, z]}><boxGeometry args={[w, 0.14, 0.14]} /><meshStandardMaterial color={pal.n[4]} metalness={0.45} roughness={0.5} /></mesh>
      ))}

      {/* Подвесные светильники (один ряд по центру — экономно) */}
      {lampX.map((x, i) => <Lamp key={i} x={x} z={cz} y={RF - 0.5} />)}

      {/* Надземные трубопроводы по краям пролёта */}
      <PipeRun x={minX + 1} z={cz} len={d} y={PIPE_Y} color={pal.blue.m} />
      <PipeRun x={minX + 1.35} z={cz} len={d} y={PIPE_Y - 0.35} color={pal.orange.m} />
      <PipeRun x={maxX - 1} z={cz} len={d} y={PIPE_Y} color={pal.blue.m} />

      {/* Подкрановые балки + мостовой кран */}
      {[minZ, maxZ].map((z, i) => (
        <mesh key={i} position={[cx, 5.6, z]}><boxGeometry args={[w, 0.35, 0.35]} /><meshStandardMaterial color={pal.n[3]} metalness={0.4} roughness={0.6} /></mesh>
      ))}
      <group position={[cx + w * 0.15, 0, cz]}>
        <mesh position={[0, 5.7, 0]} castShadow><boxGeometry args={[0.5, 0.5, d]} /><meshStandardMaterial color={pal.yellow.l} metalness={0.3} /></mesh>
        <mesh position={[0, 5.3, 0]}><boxGeometry args={[1.2, 0.5, 1.2]} /><meshStandardMaterial color={pal.n[1]} /></mesh>
        <mesh position={[0, 4.4, 0]}><boxGeometry args={[0.12, 1.4, 0.12]} /><meshStandardMaterial color={pal.n[0]} /></mesh>
      </group>

      {/* Электрошкафы вдоль дальней стороны */}
      {[cx - 3, cx - 1.5, cx].map((x, i) => <Cabinet key={i} x={x} z={maxZ - 0.6} ry={Math.PI} />)}

      {/* Поддоны с грузом */}
      {pallets.map(([x, z, c], i) => <Pallet key={i} x={x} z={z} color={c} />)}

      {/* Рабочие-операторы во время симуляции рисуются в SimulationLayer (по задачам плана). */}
    </group>
  )
}
