import { useMemo } from 'react'
import type { SceneNode } from './graph/sceneModel'
import { Decorations } from './Decorations'
import { RailYard } from './RailYard'
import { railSpur } from './siteLayout'

const FENCE_H = 2.4
const PANEL_COLOR = '#3a4048'          // тёмное полупрозрачное полотно (рабица)
const RAIL_COLOR = '#7c848c'           // металлический профиль перил
const POST_COLOR = '#4c5550'           // столб (металл)
const PLINTH_COLOR = '#8b8f92'         // бетонный цоколь понизу
/** Отступ забора от крайних цехов (крупные здания + проезд по периметру). */
const MARGIN = 16

/** Тон газона — база из SceneEnvironment (#4a6d45), плюс две вариации для «полос покоса». */
const GRASS_BASE = '#4a6d45'
const GRASS_LIGHT = '#567c4d'
const GRASS_DARK = '#41603d'

/** Детерминированный псевдослучайный шум из числа (Math.random недоступен). */
const hash = (i: number) => { const s = Math.sin(i * 127.1 + 11.7) * 43758.5453; return s - Math.floor(s) }
/** Хэш от пары координат — стабильный поворот/вариация «по позиции». */
const hash2 = (a: number, b: number) => hash(a * 73.13 + b * 19.71 + 3.7)

// ─── Забор ──────────────────────────────────────────────────────────────────

interface PostProps { x: number; z: number; h?: number; w?: number }
/** Столб забора: бетонный цоколь + металлическая стойка + шапка. */
function Post({ x, z, h = FENCE_H + 0.5, w = 0.26 }: PostProps) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.18, 0]} castShadow receiveShadow>
        <boxGeometry args={[w + 0.14, 0.36, w + 0.14]} />
        <meshStandardMaterial color={PLINTH_COLOR} roughness={0.95} />
      </mesh>
      <mesh position={[0, h / 2 + 0.2, 0]} castShadow>
        <boxGeometry args={[w, h, w]} />
        <meshStandardMaterial color={POST_COLOR} metalness={0.55} roughness={0.5} />
      </mesh>
      <mesh position={[0, h + 0.24, 0]} castShadow>
        <boxGeometry args={[w + 0.08, 0.1, w + 0.08]} />
        <meshStandardMaterial color={RAIL_COLOR} metalness={0.6} roughness={0.4} />
      </mesh>
    </group>
  )
}

/** Прямой пролёт забора: цоколь + полотно-рабица + верхний/нижний рельс + столбы. */
function FenceRun({ x1, z1, x2, z2 }: { x1: number; z1: number; x2: number; z2: number }) {
  const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2
  const len = Math.hypot(x2 - x1, z2 - z1)
  const angle = Math.atan2(-(z2 - z1), x2 - x1)
  const n = Math.max(1, Math.round(len / 6))
  const posts: [number, number][] = []
  for (let i = 0; i <= n; i++) posts.push([x1 + ((x2 - x1) * i) / n, z1 + ((z2 - z1) * i) / n])
  return (
    <group>
      {/* бетонный цоколь по всей длине */}
      <mesh position={[cx, 0.22, cz]} rotation={[0, angle, 0]} castShadow receiveShadow>
        <boxGeometry args={[len, 0.44, 0.18]} />
        <meshStandardMaterial color={PLINTH_COLOR} roughness={0.95} />
      </mesh>
      {/* полотно-рабица — тонкая полупрозрачная тёмная панель */}
      <mesh position={[cx, FENCE_H / 2 + 0.5, cz]} rotation={[0, angle, 0]}>
        <boxGeometry args={[len, FENCE_H - 0.1, 0.04]} />
        <meshStandardMaterial color={PANEL_COLOR} metalness={0.5} roughness={0.55} transparent opacity={0.55} />
      </mesh>
      {/* нижний и верхний металлические рельсы */}
      <mesh position={[cx, 0.55, cz]} rotation={[0, angle, 0]}>
        <boxGeometry args={[len, 0.08, 0.1]} />
        <meshStandardMaterial color={RAIL_COLOR} metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[cx, FENCE_H + 0.35, cz]} rotation={[0, angle, 0]} castShadow>
        <boxGeometry args={[len, 0.12, 0.14]} />
        <meshStandardMaterial color={RAIL_COLOR} metalness={0.6} roughness={0.4} />
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

// ─── Пешеходная тропинка (тонкая, светлая — отличается от дорог) ──────────────
// Дороги (въезд + подъезд к парковке) вынесены в FlowLinks — здесь только пешеходная тропа.
const PATH_COLOR = '#b9b2a2'       // светлый песчано-серый (брусчатка/грунт), не асфальт
const PATH_W = 1.2                 // узкая: пешеходная, уже проезжей части
const PATH_Y = 0.045               // чуть выше газона (0.02), но ниже дорожного полотна (0.05)

/** Один прямой отрезок тропинки: тонкий светлый плоский квад (без осевой/бордюров). */
function PathSegment({ x1, z1, x2, z2 }: { x1: number; z1: number; x2: number; z2: number }) {
  const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2
  const len = Math.hypot(x2 - x1, z2 - z1)
  const angle = Math.atan2(-(z2 - z1), x2 - x1)
  return (
    <group position={[cx, PATH_Y, cz]} rotation={[0, angle, 0]}>
      {/* Плоский квад вдоль оси сегмента (как RoadSegment: группа крутит по Y, квад
          лежит горизонтально). Прежний одиночный Euler [-π/2,0,-angle] разворачивал
          сегменты неверно → «рваная» тропинка. Чуть длиннее — перекрытие стыков. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[len + PATH_W, PATH_W]} />
        <meshStandardMaterial color={PATH_COLOR} roughness={1} />
      </mesh>
    </group>
  )
}

/**
 * Пешеходная тропинка по списку точек XZ: тонкие светлые квады-сегменты с
 * квадратными «заплатками» на изломах (перекрывают стыки, скругляют углы).
 * Тоньше и светлее дорог, без жёлтой осевой и бордюров.
 */
function Footpath({ points }: { points: [number, number][] }) {
  return (
    <group>
      {points.slice(1).map(([x2, z2], i) => {
        const [x1, z1] = points[i]
        return <PathSegment key={`ps${i}`} x1={x1} z1={z1} x2={x2} z2={z2} />
      })}
      {points.slice(1, -1).map(([x, z], i) => (
        <mesh key={`pj${i}`} position={[x, PATH_Y, z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[PATH_W, PATH_W]} />
          <meshStandardMaterial color={PATH_COLOR} roughness={1} />
        </mesh>
      ))}
    </group>
  )
}

// ─── Деревья ─────────────────────────────────────────────────────────────────

/** Ствол дерева: конусовидный, слегка сужается кверху. */
function Trunk({ h, r, color }: { h: number; r: number; color: string }) {
  return (
    <mesh position={[0, h / 2, 0]} castShadow>
      <cylinderGeometry args={[r * 0.62, r, h, 7]} />
      <meshStandardMaterial color={color} roughness={1} />
    </mesh>
  )
}

/** Одна «лопасть» кроны — сфера/икосаэдр с индивидуальным тоном. */
function Leaf({ p, r, color, flat = 1 }: { p: [number, number, number]; r: number; color: string; flat?: number }) {
  return (
    <mesh position={p} scale={[1, flat, 1]} castShadow>
      <sphereGeometry args={[r, 8, 6]} />
      <meshStandardMaterial color={color} roughness={1} />
    </mesh>
  )
}

/** ДУБ: толстый сужающийся ствол с парой развилок, широкая округлая плотная крона. */
function Oak() {
  const branches: { p: [number, number, number]; rot: [number, number, number]; l: number }[] = [
    { p: [0.32, 1.55, 0.1], rot: [0, 0, -0.7], l: 0.9 },
    { p: [-0.3, 1.75, -0.15], rot: [0, 0, 0.75], l: 0.8 },
  ]
  // широкая округлая крона — перекрывающиеся сферы разного размера/тона
  const clusters: { p: [number, number, number]; r: number; c: string }[] = [
    { p: [0, 2.55, 0], r: 1.55, c: '#3f6b3a' },
    { p: [1.05, 2.25, 0.55], r: 0.95, c: '#37622f' },
    { p: [-1.0, 2.3, -0.5], r: 0.98, c: '#487a40' },
    { p: [0.45, 3.15, -0.65], r: 0.85, c: '#436f3c' },
    { p: [-0.55, 3.05, 0.7], r: 0.82, c: '#356030' },
    { p: [0.15, 2.15, 1.0], r: 0.78, c: '#446f3d' },
  ]
  return (
    <>
      <Trunk h={1.7} r={0.32} color="#5a4a36" />
      {branches.map((b, i) => (
        <mesh key={i} position={b.p} rotation={b.rot} castShadow>
          <cylinderGeometry args={[0.06, 0.13, b.l, 5]} />
          <meshStandardMaterial color="#5a4a36" roughness={1} />
        </mesh>
      ))}
      {clusters.map((c, i) => <Leaf key={i} p={c.p} r={c.r} color={c.c} />)}
    </>
  )
}

/** КЛЁН: тонкий ствол, высокая ярусная округлая крона, тёплый зелёный + осенние акценты. */
function Maple() {
  // слегка приплюснутые (flat<1) слои клёна, поднимаются ярусами
  const clusters: { p: [number, number, number]; r: number; c: string; flat: number }[] = [
    { p: [0, 2.35, 0], r: 1.25, c: '#5c8a3e', flat: 0.85 },
    { p: [0.7, 2.6, 0.35], r: 0.9, c: '#67974a', flat: 0.85 },
    { p: [-0.65, 2.7, -0.35], r: 0.88, c: '#548038', flat: 0.85 },
    { p: [0.2, 3.25, -0.2], r: 0.95, c: '#5c8a3e', flat: 0.8 },
    { p: [-0.35, 3.6, 0.25], r: 0.78, c: '#c07a2e', flat: 0.8 },  // осенний акцент
    { p: [0.5, 3.55, 0.35], r: 0.62, c: '#c98a3a', flat: 0.8 },   // осенний акцент
  ]
  return (
    <>
      <Trunk h={2.0} r={0.2} color="#6b5238" />
      {clusters.map((c, i) => <Leaf key={i} p={c.p} r={c.r} color={c.c} flat={c.flat} />)}
    </>
  )
}

/** Дерево заданной породы, масштаба и поворота (детерминированный по позиции). */
function Tree({ x, z, s, kind }: { x: number; z: number; s: number; kind: number }) {
  const rot = hash2(x, z) * Math.PI * 2
  return (
    <group position={[x, 0, z]} scale={s} rotation={[0, rot, 0]}>
      {kind === 0 ? <Oak /> : <Maple />}
    </group>
  )
}

/** Низкий куст/кустарник — клумба из нескольких сфер. */
function Bush({ x, z, s }: { x: number; z: number; s: number }) {
  const rot = hash2(x + 5.1, z - 2.3) * Math.PI * 2
  const clumps: { p: [number, number, number]; r: number; c: string }[] = [
    { p: [0, 0.42, 0], r: 0.5, c: '#43713b' },
    { p: [0.4, 0.34, 0.12], r: 0.38, c: '#4d7d44' },
    { p: [-0.35, 0.36, -0.1], r: 0.4, c: '#3c6534' },
    { p: [0.1, 0.5, -0.32], r: 0.34, c: '#4a7940' },
  ]
  return (
    <group position={[x, 0, z]} scale={s} rotation={[0, rot, 0]}>
      {clumps.map((c, i) => <Leaf key={i} p={c.p} r={c.r} color={c.c} flat={0.8} />)}
    </group>
  )
}

/** Пучок травы у забора/зданий — несколько тонких вертикальных «лезвий». */
function GrassTuft({ x, z }: { x: number; z: number }) {
  const rot = hash2(x - 1.7, z + 4.4) * Math.PI * 2
  const blades: { p: [number, number, number]; tilt: number; h: number }[] = [
    { p: [0, 0.18, 0], tilt: 0, h: 0.36 },
    { p: [0.1, 0.16, 0.06], tilt: 0.35, h: 0.3 },
    { p: [-0.09, 0.16, -0.05], tilt: -0.3, h: 0.28 },
    { p: [0.04, 0.15, -0.1], tilt: 0.2, h: 0.26 },
  ]
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      {blades.map((b, i) => (
        <mesh key={i} position={b.p} rotation={[0, 0, b.tilt]}>
          <coneGeometry args={[0.05, b.h, 4]} />
          <meshStandardMaterial color={i % 2 ? '#5c8a3e' : '#4f7d3a'} roughness={1} />
        </mesh>
      ))}
    </group>
  )
}

interface FacilityProps { nodes: SceneNode[] }

/**
 * Территория предприятия: газон с вариацией тона, забор по периметру
 * (авто-расширяется под здания), сторожевые вышки по углам, въездные ворота,
 * реалистичные лиственные деревья (дуб/клён), кусты и трава за оградой.
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

  // Рельсовые (северные) ворота. Всё детерминировано (без Math.random).
  //  • Северные ворота — РЕЛЬСОВЫЕ: центр на оси жд-спура (railSpur.x), проём = 2*gateHalf
  //    (рельс проходит сквозь зазор). Служебной дороги нет.
  //  • Въезд с главных (+X) ворот и подъезд к парковке ТЕПЕРЬ рисует FlowLinks — они
  //    влиты в его единую дорожную сеть, чтобы все стыки обрабатывались одной логикой
  //    (крест → кольцо, L → филе), без ad-hoc нахлёста поверх межцеховых дорог.
  const roads = useMemo(() => {
    // Рельсовые (северные) ворота — на оси спура; проём = 2*gateHalf.
    const spur = railSpur(minX, maxX, minZ, maxZ)
    const railGate = { x0: spur.x - spur.gateHalf, x1: spur.x + spur.gateHalf }
    return { railGate }
  }, [minX, maxX, minZ, maxZ])

  // Пешеходная тропинка идёт «ПО КРАЮ» вдоль ЮЖНОЙ кромки двора: от юго-восточной
  // части на запад, мимо ряда скамеек (они у z=maxZ-5), к ДАЛЬНЕЙ курилке в ЮЗ-углу
  // (smoke2 ≈ [minX+7, maxZ-9]). Юг свободен от дорог и жд-узла (тот на севере/западе),
  // поэтому тропа не режет двор и не пересекает пути.
  const footpath = useMemo(() => {
    const sz = maxZ - 6.5              // ось тропы вдоль южной кромки — перед скамейками
    const pts: [number, number][] = [
      [maxX - 16, maxZ - 8],           // старт: юго-восток двора (западнее парковки/ворот)
      [maxX - 26, sz],
      [(minX + maxX) / 2, sz],         // мимо южного ряда скамеек
      [minX + 16, sz],
      [minX + 8, maxZ - 8],            // финиш у дальней (ЮЗ) курилки
    ]
    // Смещаем точки прочь от footprint'ов цехов (радиус KEEP), затем ПРИЖИМАЕМ к южной
    // кромке (az в [gMid, maxZ-5.5] — севернее скамеек, южнее центра) и держим в ограде.
    const KEEP = 9
    const nudged = pts.map(([px, pz]) => {
      let ax = px, az = pz
      for (const n of nodes) {
        const dx = ax - n.position[0], dz = az - n.position[1]
        const d = Math.hypot(dx, dz)
        if (d > 0.001 && d < KEEP) {
          const push = (KEEP - d) / d
          ax += dx * push; az += dz * push
        }
      }
      ax = Math.min(maxX - 5, Math.max(minX + 5, ax))
      az = Math.min(maxZ - 5.5, Math.max(gMid, az))
      return [ax, az] as [number, number]
    })
    // Сглаживание Чайкина (2 итерации): «отталкивание» от цехов давало резкие изломы —
    // тропинка выглядела рваной/кривой. Скругляем внутренние вершины в плавную кривую,
    // концы сохраняем. Каждое ребро → две точки на 1/4 и 3/4 длины.
    const chaikin = (p: [number, number][]): [number, number][] => {
      if (p.length < 3) return p
      const out: [number, number][] = [p[0]]
      for (let k = 0; k < p.length - 1; k++) {
        const [ax, az] = p[k], [bx, bz] = p[k + 1]
        out.push([ax + (bx - ax) * 0.25, az + (bz - az) * 0.25])
        out.push([ax + (bx - ax) * 0.75, az + (bz - az) * 0.75])
      }
      out.push(p[p.length - 1])
      return out
    }
    return chaikin(chaikin(nudged))
  }, [minX, maxX, minZ, maxZ, gMid, nodes])

  // Газон: полосы «покоса» — крупные низкие квады чуть разного тона внутри ограды.
  const stripes = useMemo(() => {
    const w = maxX - minX + 8, d = maxZ - minZ + 8
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2
    const n = Math.max(4, Math.round(d / 7))
    const out: { p: [number, number, number]; size: [number, number]; c: string }[] = []
    for (let i = 0; i < n; i++) {
      const sz = d / n
      const z = minZ - 4 + sz * (i + 0.5)
      out.push({ p: [cx, 0.02, z], size: [w, sz], c: i % 2 ? GRASS_LIGHT : GRASS_DARK })
    }
    return { out, cx, cz, w, d }
  }, [minX, maxX, minZ, maxZ])

  // Деревья за оградой: смешанный ряд дуб/клён + редкие кусты. С ПРОВЕРКОЙ НАЛОЖЕНИЙ:
  //  • северная кромка — жд-узел, деревьев нет;
  //  • вокруг зданий цехов (крупные процесс-кластеры) — «пятна запрета»;
  //  так дерево не влезает в поезд, эстакаду или оборудование.
  const { trees, bushes } = useMemo(() => {
    let i = 1
    const band = () => 9 + hash(i++) * 8            // вынос дальше от забора/кластеров
    const scale = () => 0.85 + hash(i++) * 0.55     // ~3.5–5 ед. (ниже корпусов)
    const kind = () => (hash(i++) < 0.5 ? 0 : 1)    // 0 дуб · 1 клён
    const isBush = () => hash(i++) < 0.22
    const tr: [number, number, number, number][] = []
    const bs: [number, number, number][] = []
    const RAIL_Z = minZ - 2          // всё севернее верхней кромки занято жд-узлом
    const KEEP2 = 15 * 15            // радиус² запрета вокруг узла-цеха (крупный кластер)
    const blocked = (x: number, z: number) => {
      if (z < RAIL_Z) return true
      for (const n of nodes) {
        const dx = x - n.position[0], dz = z - n.position[1]
        if (dx * dx + dz * dz < KEEP2) return true
      }
      return false
    }
    const place = (x: number, z: number) => {
      if (blocked(x, z)) return
      if (isBush()) bs.push([x, z, 0.9 + hash(i++) * 0.7])
      else tr.push([x, z, scale(), kind()])
    }
    const nx = Math.max(6, Math.round((maxX - minX) / 7))
    const nz = Math.max(6, Math.round((maxZ - minZ) / 7))
    for (let k = 0; k <= nx; k++) {
      const x = minX + ((maxX - minX) * k) / nx + (hash(i++) - 0.5) * 4
      place(x, maxZ + band())        // север (minZ) отдан жд-узлу — деревьев там нет
    }
    for (let k = 0; k <= nz; k++) {
      const z = minZ + ((maxZ - minZ) * k) / nz + (hash(i++) - 0.5) * 4
      place(minX - band(), z)
      place(maxX + band(), z)
    }
    return { trees: tr, bushes: bs }
  }, [minX, maxX, minZ, maxZ, nodes])

  // Пучки травы и низкие кусты вдоль внутренней кромки забора.
  const tufts = useMemo(() => {
    let i = 500
    const out: [number, number][] = []
    const nx = Math.max(8, Math.round((maxX - minX) / 4))
    const nz = Math.max(8, Math.round((maxZ - minZ) / 4))
    const jit = () => (hash(i++) - 0.5) * 2.4
    for (let k = 0; k <= nx; k++) {
      const x = minX + ((maxX - minX) * k) / nx + jit()
      out.push([x, minZ + 1.6 + jit()])
      out.push([x, maxZ - 1.6 + jit()])
    }
    for (let k = 0; k <= nz; k++) {
      const z = minZ + ((maxZ - minZ) * k) / nz + jit()
      out.push([minX + 1.6 + jit(), z])
      out.push([maxX - 1.6 + jit(), z])
    }
    return out
  }, [minX, maxX, minZ, maxZ])

  return (
    <group>
      {/* Газон: базовая подложка + полосы покоса (чуть разный тон) */}
      <mesh position={[stripes.cx, 0.008, stripes.cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[stripes.w, stripes.d]} />
        <meshStandardMaterial color={GRASS_BASE} roughness={1} />
      </mesh>
      {stripes.out.map((s, i) => (
        <mesh key={i} position={s.p} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={s.size} />
          <meshStandardMaterial color={s.c} roughness={1} />
        </mesh>
      ))}

      {/* Въезд (+X ворота) и подъезд к парковке рисует FlowLinks (влиты в его единую
          дорожную сеть). С севера заходит рельсовый путь (RailYard) — служебной дороги нет. */}

      {/* Пешеходная тропинка: фронт двора → зона отдыха на востоке (тоньше/светлее дорог) */}
      <Footpath points={footpath} />

      {/* Забор: юг сплошной, север с проёмом рельсовых ворот, +X с проёмом гл. ворот */}
      <FenceRun x1={minX} z1={minZ} x2={roads.railGate.x0} z2={minZ} />
      <FenceRun x1={roads.railGate.x1} z1={minZ} x2={maxX} z2={minZ} />
      <FenceRun x1={minX} z1={maxZ} x2={maxX} z2={maxZ} />
      <FenceRun x1={minX} z1={minZ} x2={minX} z2={maxZ} />
      <FenceRun x1={maxX} z1={minZ} x2={maxX} z2={gate.z0} />
      <FenceRun x1={maxX} z1={gate.z1} x2={maxX} z2={maxZ} />

      {/* Ворота: усиленные столбы + верхняя балка-ферма */}
      <Post x={maxX} z={gate.z0} h={3.6} w={0.5} />
      <Post x={maxX} z={gate.z1} h={3.6} w={0.5} />
      <mesh position={[maxX, 3.7, gMid]} castShadow>
        <boxGeometry args={[0.3, 0.34, gate.z1 - gate.z0]} />
        <meshStandardMaterial color="#c87619" metalness={0.4} roughness={0.6} />
      </mesh>
      <mesh position={[maxX, 3.34, gMid]}>
        <boxGeometry args={[0.16, 0.16, gate.z1 - gate.z0 - 0.4]} />
        <meshStandardMaterial color={RAIL_COLOR} metalness={0.6} roughness={0.4} />
      </mesh>

      {/* Рельсовые (северные) ворота на оси жд-спура: те же усиленные столбы + балка,
          проём ориентирован вдоль X (сторона z=minZ); рельс проходит сквозь зазор. */}
      <Post x={roads.railGate.x0} z={minZ} h={3.6} w={0.5} />
      <Post x={roads.railGate.x1} z={minZ} h={3.6} w={0.5} />
      <mesh position={[(roads.railGate.x0 + roads.railGate.x1) / 2, 3.7, minZ]} castShadow>
        <boxGeometry args={[roads.railGate.x1 - roads.railGate.x0, 0.34, 0.3]} />
        <meshStandardMaterial color="#c87619" metalness={0.4} roughness={0.6} />
      </mesh>
      <mesh position={[(roads.railGate.x0 + roads.railGate.x1) / 2, 3.34, minZ]}>
        <boxGeometry args={[roads.railGate.x1 - roads.railGate.x0 - 0.4, 0.16, 0.16]} />
        <meshStandardMaterial color={RAIL_COLOR} metalness={0.6} roughness={0.4} />
      </mesh>

      {/* Вышки по углам */}
      <WatchTower x={minX + 1.5} z={minZ + 1.5} />
      <WatchTower x={maxX - 1.5} z={maxZ - 1.5} />

      {/* Деревья, кусты и трава за оградой */}
      {trees.map(([x, z, s, k], i) => <Tree key={`t${i}`} x={x} z={z} s={s} kind={k} />)}
      {bushes.map(([x, z, s], i) => <Bush key={`b${i}`} x={x} z={z} s={s} />)}
      {tufts.map(([x, z], i) => <GrassTuft key={`g${i}`} x={x} z={z} />)}

      {/* Декорации территории (КПП, шлагбаум, парковка, навесы, скамейки, курилки) */}
      <Decorations minX={minX} maxX={maxX} minZ={minZ} maxZ={maxZ} gMid={gMid} nodes={nodes} />

      {/* Жд-станция + сортировочная развязка + вагоны; магистраль уходит в даль */}
      <RailYard minX={minX} maxX={maxX} minZ={minZ} maxZ={maxZ} />
    </group>
  )
}
