import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { SceneEdge, SceneNode } from './graph/sceneModel'

const ASPHALT = '#34383d'
const SHOULDER = '#54595f'
const LANE = '#c9b65a'
const KERB = '#b9bec4'
const ZEBRA = '#e7e9ec'
const ROAD_W = 2.4
const EPS = 0.6
// Дороги слоями с зазором ≥0.03 и выше площадок (0.03)/теней (0.008) — без z-fighting.
const Y_SHOULDER = 0.05, Y_ROAD = 0.085, Y_KERB = 0.1, Y_LANE = 0.12, Y_ZEBRA = 0.125

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

// ─────────────────────────────────────────────────────────────────────────────
//  МАРШРУТИЗАЦИЯ ТРАНСПОРТА («по правилам»): полилиния из точек [x,z].
//  Машина НИКОГДА не въезжает в габарит узла (edge-stop), объезжает островок
//  кольцевой развязки по дуге и проходит повороты плавным закруглением.
// ─────────────────────────────────────────────────────────────────────────────
type Pt = [number, number]

/** Внешний радиус узла: цех крупный (стоп у стены), станок мелкий. */
const nodeRadius = (n: SceneNode): number => (n.refType === 'shop' ? 8.5 : 3.0)

/** Кольцо развязки: по этому радиусу вокруг островка едет транспорт. */
const RING_R = 1.95
/** Радиус закругления обычного поворота (плавный филе). */
const TURN_R = 2.0
/** Смещение от осевой в свою полосу (правостороннее движение). */
const LANE_OFFSET = 0.62
/** Полуширина зоны пешеходного перехода (в ней транспорт тормозит). */
const CROSS_HALF = 1.4
/** Насколько сбрасывать скорость в зоне перехода (доля от базовой). */
const CROSS_SLOW = 0.4

const dist = (a: Pt, b: Pt): number => Math.hypot(b[0] - a[0], b[1] - a[1])

/** Дуга окружности от угла a0 до a1 (кратчайшим направлением), N точек. */
function arcPoints(cx: number, cz: number, r: number, a0: number, a1: number, steps: number): Pt[] {
  let d = a1 - a0
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  const out: Pt[] = []
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (d * i) / steps
    out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r])
  }
  return out
}

/**
 * Заменяет острый угол в вершине polyline[i] на дугу-филе радиуса r:
 * скругляет стык двух прямых участков квадратичной выборкой (Безье).
 */
function filletCorner(prev: Pt, corner: Pt, next: Pt, r: number, steps: number): Pt[] {
  const l1 = dist(prev, corner), l2 = dist(corner, next)
  const back = Math.min(r, l1 * 0.45, l2 * 0.45)
  if (back < 0.2) return [corner]
  const u1: Pt = [(prev[0] - corner[0]) / l1, (prev[1] - corner[1]) / l1]
  const u2: Pt = [(next[0] - corner[0]) / l2, (next[1] - corner[1]) / l2]
  const p0: Pt = [corner[0] + u1[0] * back, corner[1] + u1[1] * back]
  const p2: Pt = [corner[0] + u2[0] * back, corner[1] + u2[1] * back]
  const out: Pt[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, mt = 1 - t
    // Квадратичная Безье p0→corner→p2: гладкая касательная в стыке.
    out.push([
      mt * mt * p0[0] + 2 * mt * t * corner[0] + t * t * p2[0],
      mt * mt * p0[1] + 2 * mt * t * corner[1] + t * t * p2[1],
    ])
  }
  return out
}

/**
 * Если прямой участок p→q проходит рядом с центром развязки, разрезаем его на
 * подход-к-кольцу → дуга ВОКРУГ островка → отход, вместо проезда сквозь центр.
 */
function detourRoundabouts(p: Pt, q: Pt, rings: Pt[]): Pt[] {
  const seg: Pt = [q[0] - p[0], q[1] - p[1]]
  const segLen = Math.hypot(seg[0], seg[1])
  if (segLen < 1e-3) return [q]
  const dir: Pt = [seg[0] / segLen, seg[1] / segLen]
  // Ближайшая развязка на пути (проекция центра на отрезок внутри его длины).
  let best: { t: number; c: Pt } | null = null
  for (const c of rings) {
    const t = (c[0] - p[0]) * dir[0] + (c[1] - p[1]) * dir[1]
    if (t < RING_R || t > segLen - RING_R) continue
    const foot: Pt = [p[0] + dir[0] * t, p[1] + dir[1] * t]
    if (dist(foot, c) > RING_R + 0.6) continue
    if (!best || t < best.t) best = { t, c }
  }
  if (!best) return [q]
  const c = best.c
  // Точки подхода/отхода на дороге; углы снимаем от них → концы дуги лежат на кольце.
  const enter: Pt = [p[0] + dir[0] * (best.t - RING_R), p[1] + dir[1] * (best.t - RING_R)]
  const exit: Pt = [p[0] + dir[0] * (best.t + RING_R), p[1] + dir[1] * (best.t + RING_R)]
  const aEnter = Math.atan2(enter[1] - c[1], enter[0] - c[0])
  const aExit = Math.atan2(exit[1] - c[1], exit[0] - c[0])
  // Правостороннее движение: обходим островок той стороной, где он остаётся
  // СЛЕВА от машины. Знак поперечного смещения дороги (dir⟂·(c−enter)) задаёт
  // направление обхода — берём ПОЛУКРУГ (≈π) в нужную сторону, не петлю.
  const nrm: Pt = [-dir[1], dir[0]]                       // левый перпендикуляр к курсу
  const side = nrm[0] * (c[0] - enter[0]) + nrm[1] * (c[1] - enter[1])
  const ccw = side < 0                                    // остров слева → идём против ч.с.
  let d = aExit - aEnter
  while (d <= 0) d += 2 * Math.PI                          // d ∈ (0, 2π] (ход против ч.с.)
  const sweep = ccw ? d : d - 2 * Math.PI                 // по ч.с. → отрицательное приращение
  const ring = arcPoints(c[0], c[1], RING_R, aEnter, aEnter + sweep, 10)
  // enter → дуга (снапнута к кольцу) → exit → прямой хвост (рекурсия — вдруг ещё кольцо).
  const snappedExit: Pt = [c[0] + Math.cos(aExit) * RING_R, c[1] + Math.sin(aExit) * RING_R]
  return [enter, ...ring, ...detourRoundabouts(snappedExit, q, rings.filter((r) => r !== c))]
}

/**
 * Полный маршрут одного ребра: центр A → (Г-разводка) → центр B, затем
 * 1) обрезаем концы до КРАЯ узлов (edge-stop), 2) объезжаем развязки дугой,
 * 3) скругляем угол Г-разводки. Возврат — гладкая полилиния точек.
 */
function buildRoute(a: Pt, b: Pt, ra: number, rb: number, rings: Pt[]): Pt[] {
  // Г-образно как рисуются дороги: горизонталь от A, затем вертикаль к B.
  const corner: Pt = [b[0], a[1]]
  const horizFirst = Math.abs(b[0] - a[0]) >= 0.5 && Math.abs(b[1] - a[1]) >= 0.5
  const raw: Pt[] = horizFirst ? [a, corner, b] : [a, b]

  // Edge-stop: сдвигаем первую/последнюю точку к краю своего узла.
  const trimEnd = (from: Pt, toward: Pt, r: number): Pt => {
    const d = dist(from, toward)
    if (d < r + 0.3) return toward
    const t = r / d
    return [from[0] + (toward[0] - from[0]) * t, from[1] + (toward[1] - from[1]) * t]
  }
  raw[0] = trimEnd(a, raw[1], ra)
  raw[raw.length - 1] = trimEnd(b, raw[raw.length - 2], rb)

  // Скругляем внутренний угол Г-разводки.
  const cornered: Pt[] = horizFirst
    ? [raw[0], ...filletCorner(raw[0], raw[1], raw[2], TURN_R, 6), raw[2]]
    : raw

  // Объезд развязок на каждом прямом подотрезке.
  const out: Pt[] = [cornered[0]]
  for (let i = 1; i < cornered.length; i++) out.push(...detourRoundabouts(cornered[i - 1], cornered[i], rings))
  return out
}

/** Предрасчёт длины полилинии: суммарная длина + накопленные отметки. */
function measure(pts: Pt[]): { total: number; acc: number[] } {
  const acc = [0]
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + dist(pts[i - 1], pts[i]))
  return { total: acc[acc.length - 1], acc }
}

/** Точка, курс и единичная касательная (world XZ) на расстоянии s вдоль полилинии. */
function sampleAt(pts: Pt[], acc: number[], s: number): { p: Pt; yaw: number; tan: Pt } {
  const total = acc[acc.length - 1]
  const sc = Math.max(0, Math.min(total, s))
  let i = 1
  while (i < acc.length && acc[i] < sc) i++
  const i0 = i - 1, i1 = Math.min(i, pts.length - 1)
  const seg = acc[i1] - acc[i0] || 1
  const t = (sc - acc[i0]) / seg
  const p0 = pts[i0], p1 = pts[i1]
  const p: Pt = [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t]
  // Касательная по ходу возрастания s (для смещения в свою полосу).
  const dx = p1[0] - p0[0], dz = p1[1] - p0[1]
  const tl = Math.hypot(dx, dz) || 1
  const tan: Pt = [dx / tl, dz / tl]
  // Курс — по касательной (yaw для three: ось Z инвертирована).
  const yaw = Math.atan2(-dz, dx)
  return { p, yaw, tan }
}

/** Прерывистая осевая разметка вдоль отрезка (равные штрихи + разрывы). */
function DashedCenter({ cx, cz, along, horiz }: { cx: number; cz: number; along: number; horiz: boolean }) {
  const dash = 0.7, gap = 0.55, step = dash + gap
  const inner = Math.max(0, along - 1.4)
  const count = Math.max(0, Math.floor((inner + gap) / step))
  const start = -((count - 1) * step) / 2
  const size: [number, number] = horiz ? [dash, 0.13] : [0.13, dash]
  const dashes: number[] = []
  for (let i = 0; i < count; i++) dashes.push(start + i * step)
  return (
    <group>
      {dashes.map((o, i) => (
        <mesh key={i} position={[cx + (horiz ? o : 0), Y_LANE, cz + (horiz ? 0 : o)]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={size} /><meshBasicMaterial color={LANE} />
        </mesh>
      ))}
    </group>
  )
}

function RoadStrip({ cx, cz, w, d }: { cx: number; cz: number; w: number; d: number }) {
  const along = Math.max(w, d)
  const horiz = w >= d
  const shoulder: [number, number] = horiz ? [along, ROAD_W + 0.9] : [ROAD_W + 0.9, along]
  const road: [number, number] = horiz ? [along, ROAD_W] : [ROAD_W, along]
  // Бордюры (kerb) — тонкие светлые полосы по краям проезжей части.
  const kerb: [number, number] = horiz ? [along, 0.16] : [0.16, along]
  const kerbOff = ROAD_W / 2 + 0.08
  return (
    <group>
      <mesh position={[cx, Y_SHOULDER, cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={shoulder} /><meshStandardMaterial color={SHOULDER} roughness={1} />
      </mesh>
      <mesh position={[cx, Y_ROAD, cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={road} /><meshStandardMaterial color={ASPHALT} roughness={1} />
      </mesh>
      <mesh position={[cx + (horiz ? 0 : kerbOff), Y_KERB, cz + (horiz ? kerbOff : 0)]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={kerb} /><meshStandardMaterial color={KERB} roughness={0.9} />
      </mesh>
      <mesh position={[cx + (horiz ? 0 : -kerbOff), Y_KERB, cz + (horiz ? -kerbOff : 0)]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={kerb} /><meshStandardMaterial color={KERB} roughness={0.9} />
      </mesh>
      <DashedCenter cx={cx} cz={cz} along={along} horiz={horiz} />
    </group>
  )
}

/** Пешеходный переход «зебра» поперёк дороги у развязки. */
function Crossing({ x, z, horiz }: { x: number; z: number; horiz: boolean }) {
  const stripes = 5, sw = 0.22, sgap = 0.2, step = sw + sgap
  const start = -((stripes - 1) * step) / 2
  const size: [number, number] = horiz ? [sw, ROAD_W - 0.2] : [ROAD_W - 0.2, sw]
  const bars: number[] = []
  for (let i = 0; i < stripes; i++) bars.push(start + i * step)
  return (
    <group>
      {bars.map((o, i) => (
        <mesh key={i} position={[x + (horiz ? o : 0), Y_ZEBRA, z + (horiz ? 0 : o)]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={size} /><meshBasicMaterial color={ZEBRA} />
        </mesh>
      ))}
    </group>
  )
}

/**
 * Кольцевая развязка: асфальтовое кольцо + бордюр + ring-разметка + островок.
 * На улице островок газонный с плантером/деревцем; в цехе — бетонный.
 */
function Roundabout({ x, z, indoor }: { x: number; z: number; indoor?: boolean }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, Y_ROAD, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <ringGeometry args={[1.3, 2.6, 36]} /><meshStandardMaterial color={ASPHALT} roughness={1} />
      </mesh>
      {/* Внешняя и внутренняя кольцевая разметка. */}
      <mesh position={[0, Y_LANE, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.5, 2.6, 36]} /><meshBasicMaterial color={indoor ? '#c7cdd2' : LANE} />
      </mesh>
      <mesh position={[0, Y_LANE, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.3, 1.4, 36]} /><meshBasicMaterial color={indoor ? '#c7cdd2' : LANE} />
      </mesh>
      {/* Бордюр-кольцо островка. */}
      <mesh position={[0, Y_KERB, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.18, 1.3, 32]} /><meshStandardMaterial color={KERB} roughness={0.9} />
      </mesh>
      {/* Островок: газон/бетон. */}
      <mesh position={[0, 0.12, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.18, 28]} /><meshStandardMaterial color={indoor ? '#6a7076' : '#3f5d3a'} roughness={1} />
      </mesh>
      {!indoor && (
        <group>
          {/* Плантер (низкий бетонный борт) + деревце. */}
          <mesh position={[0, 0.22, 0]} castShadow>
            <cylinderGeometry args={[0.62, 0.66, 0.24, 18]} /><meshStandardMaterial color="#8d8f93" roughness={0.95} />
          </mesh>
          <mesh position={[0, 0.34, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.55, 18]} /><meshStandardMaterial color="#4a7a41" roughness={1} />
          </mesh>
          <mesh position={[0, 0.62, 0]} castShadow>
            <cylinderGeometry args={[0.07, 0.09, 0.5, 8]} /><meshStandardMaterial color="#6b4a2b" roughness={0.9} />
          </mesh>
          <mesh position={[0, 1.1, 0]} castShadow>
            <coneGeometry args={[0.5, 1, 8]} /><meshStandardMaterial color="#4d7d44" roughness={1} />
          </mesh>
        </group>
      )}
    </group>
  )
}

/** Цветовые варианты грузовика (детерминированно по индексу). */
const CAB_COLORS = ['#e9edf0', '#c33636', '#2f6fb0'] as const
const TRAILER_COLORS = ['#eef1f3', '#c2c7cc'] as const

/** Готовый маршрут для одной машины: полилиния + метрика + зоны переходов. */
interface VehicleRoute {
  pts: Pt[]
  acc: number[]
  total: number
  /** Отметки s (вдоль маршрута), рядом с которыми надо притормозить. */
  crossS: number[]
  speed: number
  variant: number
}

/** Модуль скорости с плавным замедлением у пешеходных переходов. */
function crossFactor(s: number, crossS: number[]): number {
  let near = Infinity
  for (const cs of crossS) near = Math.min(near, Math.abs(s - cs))
  if (near >= CROSS_HALF) return 1
  // Косинусный колокол: 1 на границе зоны → CROSS_SLOW в центре → 1 на выходе.
  const k = 0.5 + 0.5 * Math.cos((1 - near / CROSS_HALF) * Math.PI)
  return CROSS_SLOW + (1 - CROSS_SLOW) * k
}

// ─────────────────────────────────────────────────────────────────────────────
//  ВЗАИМНОЕ ИЗБЕГАНИЕ СТОЛКНОВЕНИЙ: машина «видит» другие в конусе по курсу и
//  тормозит, если впереди в её полосе кто-то есть. Попутную — держит дистанцию
//  (следование); встречную/поперечную, сошедшуюся в мою полосу, разрешаем
//  приоритетом (кто-то один уступает) — без вечного клинча.
// ─────────────────────────────────────────────────────────────────────────────
/** Дальность «взгляда» вперёд по курсу (м). */
const LOOKAHEAD = 5.0
/** Дистанция полной остановки между центрами (габарит фуры ≈ 2.3). */
const STOP_GAP = 2.3
/** Поперечный допуск «та же полоса»: встречка в своей полосе (≈1.24) не считается. */
const LANE_HALF = 0.9
/** Сколько стоять до «крипа», чтобы исключить редкий клинч 3+ машин (с). */
const STUCK_T = 2.5
/** Скорость «крипа» при разблокировке клинча (доля базовой). */
const CREEP = 0.4

/**
 * Множитель скорости 0..1 из-за впередиидущих. 1 — свободно, 0 — стоп.
 * Считаем только машины ВПЕРЕДИ (по курсу) и в своей полосе (узкий конус).
 * Попутную — тормозим всегда (следование). Встречную/поперечную, сошедшуюся в
 * мою полосу, — уступаю лишь при меньшем приоритете (i < j → приоритет мой).
 */
function brakeFactor(i: number, poses: Pt[], heads: Pt[]): number {
  const pi = poses[i], hi = heads[i]
  let minGap = Infinity
  for (let j = 0; j < poses.length; j++) {
    if (j === i) continue
    const rx = poses[j][0] - pi[0], rz = poses[j][1] - pi[1]
    const ahead = rx * hi[0] + rz * hi[1]                  // продольно (впереди > 0)
    if (ahead <= 0.05 || ahead > LOOKAHEAD) continue
    const lat = Math.abs(-rx * hi[1] + rz * hi[0])         // поперечно к курсу
    if (lat > LANE_HALF) continue
    const sameDir = heads[j][0] * hi[0] + heads[j][1] * hi[1] > 0.25
    if (!sameDir && i < j) continue                        // конфликт, но приоритет мой
    if (ahead < minGap) minGap = ahead
  }
  if (minGap === Infinity) return 1
  if (minGap <= STOP_GAP) return 0
  return Math.min(1, (minGap - STOP_GAP) / (LOOKAHEAD - STOP_GAP))
}

/**
 * Флот транспорта одной сцены. Симулируем ВСЕ машины в одном кадре, чтобы они
 * «видели» друг друга: сперва снимаем позы (точка + смещение в полосу + курс),
 * затем по ним считаем торможение и продвигаем каждую. Пинг-понг вдоль полилинии.
 */
function VehicleFleet({ routes, indoor }: { routes: VehicleRoute[]; indoor?: boolean }) {
  const groupRefs = useRef<(THREE.Group | null)[]>([])
  const sRef = useRef<number[]>([])
  const dirRef = useRef<number[]>([])
  const stuckRef = useRef<number[]>([])
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)                       // защита от скачка при возврате во вкладку
    const n = routes.length
    if (sRef.current.length !== n) {
      // Стартовые фазы разнесены по маршруту (детерминированно) — без кучи на старте.
      sRef.current = routes.map((r, i) => ((i * 0.41) % 1) * r.total)
      dirRef.current = routes.map(() => 1)
      stuckRef.current = routes.map(() => 0)
    }
    // Пасс 1: текущие позы всех машин (для взаимного «зрения»).
    const poses: Pt[] = new Array(n)
    const heads: Pt[] = new Array(n)
    for (let i = 0; i < n; i++) {
      const r = routes[i]
      if (r.total < 1) { poses[i] = [1e4, 1e4]; heads[i] = [1, 0]; continue }
      const { p, tan } = sampleAt(r.pts, r.acc, sRef.current[i])
      const dir = dirRef.current[i]
      const mx = tan[0] * dir, mz = tan[1] * dir
      poses[i] = [p[0] - mz * LANE_OFFSET, p[1] + mx * LANE_OFFSET]
      heads[i] = [mx, mz]
    }
    // Пасс 2: торможение по впередиидущим + продвижение + поза.
    for (let i = 0; i < n; i++) {
      const g = groupRefs.current[i]
      const r = routes[i]
      if (!g || r.total < 1) continue
      let f = Math.min(crossFactor(sRef.current[i], r.crossS), brakeFactor(i, poses, heads))
      // Разблокировка редкого клинча: слишком долго стоим → короткий «крип».
      if (f < 0.05) { stuckRef.current[i] += dt; if (stuckRef.current[i] > STUCK_T) f = CREEP }
      else stuckRef.current[i] = 0
      sRef.current[i] += dirRef.current[i] * r.speed * f * dt
      if (sRef.current[i] >= r.total) { sRef.current[i] = r.total; dirRef.current[i] = -1 }
      else if (sRef.current[i] <= 0) { sRef.current[i] = 0; dirRef.current[i] = 1 }
      const { p, yaw, tan } = sampleAt(r.pts, r.acc, sRef.current[i])
      const dir = dirRef.current[i]
      const mx = tan[0] * dir, mz = tan[1] * dir
      g.position.set(p[0] - mz * LANE_OFFSET, 0.06, p[1] + mx * LANE_OFFSET)
      g.rotation.y = dir > 0 ? yaw : yaw + Math.PI
    }
  })
  return (
    <group>
      {routes.map((r, i) => (
        <group key={i} ref={(el) => { groupRefs.current[i] = el }} scale={indoor ? 0.85 : 1.05}>
          {indoor ? <ForkliftModel /> : <Lorry variant={r.variant} />}
        </group>
      ))}
    </group>
  )
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

/** Колесо грузовика (тёмная шина + светлый диск). */
function TruckWheel({ position }: { position: [number, number, number] }) {
  return (
    <group position={position} rotation={[Math.PI / 2, 0, 0]}>
      <mesh castShadow><cylinderGeometry args={[0.19, 0.19, 0.13, 12]} /><meshStandardMaterial color="#15171a" roughness={0.85} /></mesh>
      <mesh position={[0, 0.07, 0]}><cylinderGeometry args={[0.09, 0.09, 0.02, 10]} /><meshStandardMaterial color="#9aa0a6" metalness={0.5} roughness={0.5} /></mesh>
    </group>
  )
}

/** Седельная фура: кабина (стекло/фары/решётка/колёса) + короб-полуприцеп (двери/фонари). */
function Lorry({ variant }: { variant: number }) {
  const cab = CAB_COLORS[variant % CAB_COLORS.length]
  const trailer = TRAILER_COLORS[Math.floor(variant / CAB_COLORS.length) % TRAILER_COLORS.length]
  // Кабина спереди (по +X = направление движения), прицеп сзади.
  return (
    <group position={[0, 0.02, 0]}>
      {/* Рама. */}
      <mesh position={[-0.1, 0.2, 0]}><boxGeometry args={[2.3, 0.12, 0.62]} /><meshStandardMaterial color="#23262b" /></mesh>

      {/* --- Кабина --- */}
      <mesh position={[0.82, 0.5, 0]} castShadow><boxGeometry args={[0.6, 0.56, 0.66]} /><meshStandardMaterial color={cab} metalness={0.3} roughness={0.5} /></mesh>
      {/* Лобовое стекло. */}
      <mesh position={[1.08, 0.58, 0]}><boxGeometry args={[0.1, 0.32, 0.56]} /><meshStandardMaterial color="#1c2a3a" metalness={0.5} roughness={0.25} /></mesh>
      {/* Решётка. */}
      <mesh position={[1.13, 0.3, 0]}><boxGeometry args={[0.05, 0.24, 0.5]} /><meshStandardMaterial color="#3a3d42" metalness={0.4} roughness={0.6} /></mesh>
      {/* Бампер. */}
      <mesh position={[1.14, 0.16, 0]}><boxGeometry args={[0.07, 0.1, 0.6]} /><meshStandardMaterial color="#2a2d31" metalness={0.4} roughness={0.5} /></mesh>
      {/* Фары. */}
      <mesh position={[1.15, 0.28, 0.22]}><boxGeometry args={[0.04, 0.1, 0.12]} /><meshStandardMaterial color="#ffe9a8" emissive="#ffd36b" emissiveIntensity={0.9} /></mesh>
      <mesh position={[1.15, 0.28, -0.22]}><boxGeometry args={[0.04, 0.1, 0.12]} /><meshStandardMaterial color="#ffe9a8" emissive="#ffd36b" emissiveIntensity={0.9} /></mesh>

      {/* --- Короб-полуприцеп --- */}
      <mesh position={[-0.52, 0.62, 0]} castShadow><boxGeometry args={[1.36, 0.78, 0.66]} /><meshStandardMaterial color={trailer} roughness={0.7} metalness={0.1} /></mesh>
      {/* Задние двери (панель). */}
      <mesh position={[-1.21, 0.62, 0]}><boxGeometry args={[0.04, 0.72, 0.6]} /><meshStandardMaterial color="#b7bcc1" roughness={0.7} /></mesh>
      {/* Задние фонари. */}
      <mesh position={[-1.23, 0.34, 0.24]}><boxGeometry args={[0.03, 0.1, 0.08]} /><meshStandardMaterial color="#c22" emissive="#c22" emissiveIntensity={0.7} /></mesh>
      <mesh position={[-1.23, 0.34, -0.24]}><boxGeometry args={[0.03, 0.1, 0.08]} /><meshStandardMaterial color="#c22" emissive="#c22" emissiveIntensity={0.7} /></mesh>

      {/* --- Колёса: передняя ось кабины + две задние оси прицепа --- */}
      <TruckWheel position={[0.8, 0.16, 0.34]} />
      <TruckWheel position={[0.8, 0.16, -0.34]} />
      <TruckWheel position={[-0.55, 0.16, 0.34]} />
      <TruckWheel position={[-0.55, 0.16, -0.34]} />
      <TruckWheel position={[-0.95, 0.16, 0.34]} />
      <TruckWheel position={[-0.95, 0.16, -0.34]} />
    </group>
  )
}

interface FlowLinksProps { nodes: SceneNode[]; edges: SceneEdge[]; indoor?: boolean }

/** Единая ортогональная дорожная сеть: дедуп-отрезки + развязки + транспорт. */
export function FlowLinks({ nodes, edges, indoor }: FlowLinksProps) {
  const { hSegs, vSegs, roundabouts, routes } = useMemo(() => {
    const net = buildNetwork(nodes, edges)
    const pos: Record<string, Pt> = {}
    const rad: Record<string, number> = {}
    for (const n of nodes) { pos[n.id] = n.position; rad[n.id] = nodeRadius(n) }
    const rings: Pt[] = net.roundabouts

    // Маршрут на КАЖДОЕ ребро: от края узла A до края узла B, «по правилам».
    // Отбираем самые длинные (до 8), чтобы не было толкучки, — детерминированно.
    const built = edges
      .map((e, i) => {
        const a = pos[e.from], b = pos[e.to]
        if (!a || !b) return null
        const pts = buildRoute(a, b, rad[e.from] ?? 3, rad[e.to] ?? 3, rings)
        const { total, acc } = measure(pts)
        if (total < 6) return null
        // Отметки s, где маршрут проходит зебру: зебра лежит кольцом ~3.1 от
        // центра развязки (см. crossings ниже) — тормозим на подходе/отходе.
        const crossS: number[] = []
        const ZEBRA_BAND: [number, number] = [2.4, 3.8]
        for (const [rx, rz] of rings) {
          for (let k = 1; k < pts.length; k++) {
            const dPrev = dist(pts[k - 1], [rx, rz]), dCur = dist(pts[k], [rx, rz])
            const lo = Math.min(dPrev, dCur), hi = Math.max(dPrev, dCur)
            // Отрезок пересекает полосу зебры → отметка ~в середине пересечения.
            if (hi >= ZEBRA_BAND[0] && lo <= ZEBRA_BAND[1]) crossS.push((acc[k - 1] + acc[k]) / 2)
          }
        }
        // Скорость чуть варьируем по индексу (детерминированно), без Math.random.
        const speed = (indoor ? 2.6 : 3.4) + (i % 3) * 0.7
        return { pts, acc, total, crossS, variant: i, speed } as VehicleRoute
      })
      .filter((r): r is VehicleRoute => r !== null)
      .sort((p, q) => q.total - p.total)
      .slice(0, 8)
    return { ...net, routes: built }
  }, [nodes, edges, indoor])

  // Зебры у развязок: по одной поперёк каждого проходящего через узел рукава.
  const crossings = useMemo(() => {
    const list: { x: number; z: number; horiz: boolean }[] = []
    const off = 3.1
    for (const [rx, rz] of roundabouts) {
      for (const h of hSegs) {
        if (Math.abs(h.z - rz) > EPS) continue
        if (rx - off > h.x0 + 0.5) list.push({ x: rx - off, z: rz, horiz: true })
        if (rx + off < h.x1 - 0.5) list.push({ x: rx + off, z: rz, horiz: true })
      }
      for (const v of vSegs) {
        if (Math.abs(v.x - rx) > EPS) continue
        if (rz - off > v.z0 + 0.5) list.push({ x: rx, z: rz - off, horiz: false })
        if (rz + off < v.z1 - 0.5) list.push({ x: rx, z: rz + off, horiz: false })
      }
    }
    return list
  }, [roundabouts, hSegs, vSegs])

  return (
    <group>
      {hSegs.map((h, i) => <RoadStrip key={`h${i}`} cx={(h.x0 + h.x1) / 2} cz={h.z} w={h.x1 - h.x0} d={0} />)}
      {vSegs.map((v, i) => <RoadStrip key={`v${i}`} cx={v.x} cz={(v.z0 + v.z1) / 2} w={0} d={v.z1 - v.z0} />)}
      {!indoor && crossings.map((c, i) => <Crossing key={`c${i}`} x={c.x} z={c.z} horiz={c.horiz} />)}
      {roundabouts.map(([x, z], i) => <Roundabout key={`r${i}`} x={x} z={z} indoor={indoor} />)}
      <VehicleFleet routes={routes} indoor={indoor} />
    </group>
  )
}
