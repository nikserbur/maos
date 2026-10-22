import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { SceneEdge, SceneNode } from './graph/sceneModel'
import { parkingSpot } from './siteLayout'
import { useScenePalette, themed } from './scenePalette'

// Отступ забора/периметра от крайних цехов (совпадает с MARGIN в Facility) — по нему
// вычисляем габариты площадки, чтобы въездная дорога дошла ровно до +X-ворот.
const MARGIN = 16

// Тротуар: светлый бетон, приподнятый бордюр вдоль обеих сторон проезжей части.
const WALK_W = 0.5          // ширина полосы тротуара
const WALK_H = 0.2          // высота бордюра (приподнят над асфальтом)
const ROAD_W = 2.4
const EPS = 0.6
// Радиус скругления угла проезжей части (совпадает с TURN_R маршрутов ниже).
const CORNER_R = 2.0
// Развязка: внешний радиус асфальтового кольца (см. Roundabout ниже). Подходящие
// прямые концы (асфальт + тротуар) ретрактим ЗА него, иначе они лезут внутрь кольца.
const ROUND_OUTER_R = 2.6
// Насколько от центра развязки должен заканчиваться прямой конец (асфальт/тротуар):
// строго дальше внешнего радиуса кольца — без нахлёста на кольцевой асфальт.
const ROUND_TRIM = 2.95
// Внешний пешеходный бордюр-кольцо развязки: радиусы полосы (чисто вне RING_R=1.95,
// по которому едет транспорт, и вне асфальтового кольца 2.6).
const ROUND_WALK_RIN = 2.72, ROUND_WALK_ROUT = 3.06
// Полуширина разрыва тротуара СКВОЗНОЙ дороги в устье T-съезда (отворотки): чуть
// шире поперечного габарита ветки с бордюрами (≈ walkOff+борт), чтобы устье было
// открыто и бордюр магистрали не перегораживал заезд.
const TEE_GAP = ROAD_W / 2 + WALK_W + 0.4
// Дороги слоями с зазором ≥0.03 и выше площадок (0.03)/теней (0.008) — без z-fighting.
const Y_SHOULDER = 0.05, Y_ROAD = 0.085, Y_KERB = 0.1, Y_LANE = 0.12, Y_ZEBRA = 0.125
// Центр box-тротуара: низ ≈ уровень площадки (0.03), верх ≈ 0.23 → бордюр ~0.15 над асфальтом.
const Y_WALK = 0.03 + WALK_H / 2

interface HSeg { z: number; x0: number; x1: number }
interface VSeg { x: number; z0: number; z1: number }
/** Угловой стык двух ортогональных участков: центр филе + квадрант дуги. */
interface Corner { cx: number; cz: number; a0: number }

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

  // Въезд и подъезд к парковке — вливаем в ТУ ЖЕ сеть ДО слияния/развязок/углов,
  // чтобы их стыки обрабатывались единой логикой (крест → кольцо, L → филе), а не
  // ложились поверх межцеховых дорог случайным нахлёстом (жалоба «дороги странно
  // пересекаются»). Раньше их рисовал Facility отдельными ad-hoc дорогами.
  if (nodes.length) {
    let mnX = Infinity, mxX = -Infinity, mnZ = Infinity, mxZ = -Infinity
    for (const n of nodes) {
      const [nx, nz] = n.position
      mnX = Math.min(mnX, nx); mxX = Math.max(mxX, nx)
      mnZ = Math.min(mnZ, nz); mxZ = Math.max(mxZ, nz)
    }
    const minX = mnX - MARGIN, maxX = mxX + MARGIN, minZ = mnZ - MARGIN, maxZ = mxZ + MARGIN
    const gMid = (minZ + maxZ) / 2
    // Точка стыка въезда с сетью: X цеха, ЛЕЖАЩЕГО БЛИЖЕ ВСЕГО к оси z=gMid (так въезд
    // встречает межцеховую сеть), иначе центр площадки по X.
    let junctionX = (minX + maxX) / 2
    let bestDz = Infinity
    for (const n of nodes) {
      const dz = Math.abs(n.position[1] - gMid)
      if (dz < bestDz) { bestDz = dz; junctionX = n.position[0] }
    }
    // Въезд: горизонталь вдоль оси ворот от точки стыка до +X-кромки (ворота).
    addH(gMid, junctionX, maxX)
    // Подъезд к парковке: вертикальная ветка от оси въезда к стоянке, стоп ~4 не доезжая
    // до лота (со стороны, обращённой к оси gMid, откуда подходим).
    const pk = parkingSpot(minX, maxX, minZ, maxZ, nodes)
    const pkEndZ = pk.z < gMid ? pk.z + 4 : pk.z - 4
    addV(pk.x, gMid, pkEndZ)
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

  // Классификация узлов пересечения по степени:
  //  • крест (степень 4, обе оси сквозные) → КОЛЬЦЕВАЯ развязка (островок);
  //  • T-узел (степень 3: одна дорога сквозная, вторая упирается концом — врезка/
  //    отворотка, напр. въезд с ворот или подъезд к парковке) → ПРОСТОЙ СЪЕЗД без
  //    островка. Пользователь: «не должно быть кругового — только отворотка».
  const seen = new Set<string>()
  const roundabouts: [number, number][] = []
  const tees: [number, number][] = []
  for (const h of hSegs) for (const v of vSegs) {
    const x = v.x, z = h.z
    if (!(x >= h.x0 - EPS && x <= h.x1 + EPS && z >= v.z0 - EPS && z <= v.z1 + EPS)) continue
    const hArms = (x > h.x0 + EPS ? 1 : 0) + (x < h.x1 - EPS ? 1 : 0)
    const vArms = (z > v.z0 + EPS ? 1 : 0) + (z < v.z1 - EPS ? 1 : 0)
    const deg = hArms + vArms
    if (deg < 3) continue
    const key = `${Math.round(x)},${Math.round(z)}`
    if (seen.has(key)) continue
    seen.add(key)
    if (deg >= 4) roundabouts.push([x, z])   // крест → кольцо
    else tees.push([x, z])                    // T → отворотка (без островка)
  }

  // Угловые стыки (L-повороты): конец H-участка совпал с концом V-участка, при
  // этом это НЕ перекрёсток-развязка. Такой узел скругляем филе-дугой, иначе
  // асфальт «ломается» под прямым углом (жалоба пользователя).
  const isJunction = (x: number, z: number): boolean =>
    roundabouts.some(([rx, rz]) => Math.abs(rx - x) < EPS && Math.abs(rz - z) < EPS) ||
    tees.some(([tx, tz]) => Math.abs(tx - x) < EPS && Math.abs(tz - z) < EPS)
  const cornerSeen = new Set<string>()
  const corners: Corner[] = []
  for (const h of hSegs) for (const v of vSegs) {
    // dirH/dirV — куда УХОДЯТ участки от угла (по X / по Z).
    for (const [hx, dirH] of [[h.x0, +1], [h.x1, -1]] as const) {
      if (Math.abs(hx - v.x) > EPS) continue
      for (const [vz, dirV] of [[v.z0, +1], [v.z1, -1]] as const) {
        if (Math.abs(vz - h.z) > EPS) continue
        const x = v.x, z = h.z
        if (isJunction(x, z)) continue
        const key = `${Math.round(x)},${Math.round(z)}`
        if (cornerSeen.has(key)) continue
        cornerSeen.add(key)
        // Центр дуги — на пересечении осевых обоих участков, смещён на радиус в
        // сторону, куда уходят участки: осевая-дуга касается обеих осевых линий.
        corners.push({ cx: x + dirH * CORNER_R, cz: z + dirV * CORNER_R, a0: cornerStartAngle(dirH, dirV) })
      }
    }
  }
  return { hSegs, vSegs, roundabouts, corners, tees }
}

/**
 * Стартовый угол thetaStart для ringGeometry (90°-квадрант, положительный sweep),
 * скругляющий угол-стык. Ring рисуется в локальной XY, повёрнутой на −π/2 по X:
 * локальный угол θ → world-XZ (cos θ, −sin θ), т.е. world-угол = −θ. Квадрант
 * должен накрыть касательные к обеим кромкам: world-направления (−dirH,0) и
 * (0,−dirV). Ниже — thetaStart для каждого из 4 расположений угла.
 */
function cornerStartAngle(dirH: number, dirV: number): number {
  // θ-старт 90°-квадранта (касательные к H- и V-кромкам ограничивают дугу):
  if (dirH > 0 && dirV > 0) return Math.PI / 2        // касания θ=π/2 и θ=π → [π/2, π]
  if (dirH < 0 && dirV > 0) return 0                  // касания θ=0 и θ=π/2 → [0, π/2]
  if (dirH < 0 && dirV < 0) return -Math.PI / 2       // касания θ=−π/2 и θ=0 → [−π/2, 0]
  return -Math.PI                                     // dirH>0 && dirV<0 → касания θ=−π и θ=−π/2 → [−π, −π/2]
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
  const pal = useScenePalette()
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
          <planeGeometry args={size} /><meshBasicMaterial color={pal.yellow.l} />
        </mesh>
      ))}
    </group>
  )
}

/**
 * Приподнятый тротуар (бетонный борт) вдоль ОДНОЙ стороны прямого участка.
 * Box высотой WALK_H со «шляпкой» верхней грани — читается как бордюр-пешеходка.
 * len — длина полосы по оси участка (уже с вычетом углов), off — смещение от осевой.
 */
function WalkStrip({ cx, cz, len, off, horiz }: { cx: number; cz: number; len: number; off: number; horiz: boolean }) {
  const pal = useScenePalette()
  if (len < 0.4) return null
  const size: [number, number, number] = horiz ? [len, WALK_H, WALK_W] : [WALK_W, WALK_H, len]
  return (
    <mesh position={[cx + (horiz ? 0 : off), Y_WALK, cz + (horiz ? off : 0)]} castShadow receiveShadow>
      <boxGeometry args={size} /><meshStandardMaterial color={pal.n[6]} roughness={0.92} />
    </mesh>
  )
}

/** Тип конца прямого участка: примыкает к скруглённому углу, к развязке, либо
 *  «обычный» стык (крест/T) — от этого зависит величина ретракта асфальта/бордюра. */
type EndKind = 'corner' | 'round' | 'plain'

/**
 * Прямой участок дороги: обочина + асфальт + осевая + приподнятый тротуар по
 * обеим сторонам. Каждый конец классифицирован (loKind/hiKind):
 *  • 'corner' — тротуар отступает РОВНО на CORNER_R (стыкуется с дугой WalkArc
 *    без зазора/нахлёста), асфальт держит лёгкий нахлёст под филе CornerPatch.
 *  • 'round'  — асфальт И тротуар отступают на ROUND_TRIM (≈2.95), т.е. за
 *    внешний радиус кольца (2.6): ничего не лезет внутрь развязки.
 *  • 'plain'  — тротуар отступает на wTrim (анти-мерцание у креста/T), асфальт
 *    держит нахлёст под перекрёсток (тот же цвет — стык невидим).
 * cutLo/cutHi (вырез угла = CORNER_R) сохранены как публичные пропсы.
 */
function RoadStrip({ cx, cz, w, d, cutLo = 0, cutHi = 0, loKind = 'plain', hiKind = 'plain', gaps = [] }: { cx: number; cz: number; w: number; d: number; cutLo?: number; cutHi?: number; loKind?: EndKind; hiKind?: EndKind; gaps?: [number, number][] }) {
  const pal = useScenePalette()
  const horiz = w >= d
  const full = Math.max(w, d)
  const wTrim = ROAD_W / 2 + 0.4
  // Ретракт асфальта/обочины на каждом конце: у угла — лёгкий нахлёст под филе,
  // у развязки — строго за внешний радиус кольца, иначе — нет ретракта (нахлёст
  // под перекрёсток невидим, тот же цвет).
  const aLo = loKind === 'round' ? ROUND_TRIM : loKind === 'corner' ? cutLo * 0.85 : 0
  const aHi = hiKind === 'round' ? ROUND_TRIM : hiKind === 'corner' ? cutHi * 0.85 : 0
  const along = Math.max(0.1, full - aLo - aHi)
  const center = -full / 2 + aLo + along / 2
  const shoulder: [number, number] = horiz ? [along, ROAD_W + 0.9] : [ROAD_W + 0.9, along]
  const road: [number, number] = horiz ? [along, ROAD_W] : [ROAD_W, along]
  const acx = cx + (horiz ? center : 0), acz = cz + (horiz ? 0 : center)
  // Ретракт тротуара на каждом конце: у угла — РОВНО CORNER_R (концы бордюра ложатся
  // точно на концы дуги WalkArc), у развязки — ROUND_TRIM (за кольцо), иначе — wTrim
  // (бордюр не выходит на проезжую часть креста и не накладывается на бордюр пересекающей
  // дороги — это давало мерцание/«лаги» тротуаров в узлах).
  const wLo = loKind === 'corner' ? CORNER_R : loKind === 'round' ? ROUND_TRIM : wTrim
  const wHi = hiKind === 'corner' ? CORNER_R : hiKind === 'round' ? ROUND_TRIM : wTrim
  const walkOff = ROAD_W / 2 + WALK_W / 2 + 0.06
  // Тротуар в абсолютных координатах вдоль оси участка (world X для horiz, world Z
  // для vert). Разбиваем на подотрезки, вырезая проёмы gaps — так бордюр не идёт
  // сквозь развязку, стоящую В СЕРЕДИНЕ пролёта (совпад. H+V пересечение).
  const base = horiz ? cx : cz
  const lo = base - full / 2 + wLo
  const hi = base + full / 2 - wHi
  const walkSpans: [number, number][] = subtractGaps(lo, hi, gaps)
  return (
    <group>
      <mesh position={[acx, Y_SHOULDER, acz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={shoulder} /><meshStandardMaterial color={pal.n[2]} roughness={1} />
      </mesh>
      <mesh position={[acx, Y_ROAD, acz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={road} /><meshStandardMaterial color={pal.n[1]} roughness={1} />
      </mesh>
      {walkSpans.map(([s0, s1], i) => {
        const len = s1 - s0, mid = (s0 + s1) / 2
        const scx = horiz ? mid : cx, scz = horiz ? cz : mid
        return (
          <group key={i}>
            <WalkStrip cx={scx} cz={scz} len={len} off={+walkOff} horiz={horiz} />
            <WalkStrip cx={scx} cz={scz} len={len} off={-walkOff} horiz={horiz} />
          </group>
        )
      })}
      <DashedCenter cx={acx} cz={acz} along={along} horiz={horiz} />
    </group>
  )
}

/** Вырезает интервалы gaps из [lo,hi], возвращает оставшиеся подотрезки (для разрыва
 *  тротуара вокруг развязки в середине пролёта). Отрезки короче 0.4 отбрасываем. */
function subtractGaps(lo: number, hi: number, gaps: [number, number][]): [number, number][] {
  let spans: [number, number][] = [[lo, hi]]
  for (const [g0, g1] of gaps) {
    const next: [number, number][] = []
    for (const [s0, s1] of spans) {
      if (g1 <= s0 || g0 >= s1) { next.push([s0, s1]); continue }   // проём вне подотрезка
      if (g0 > s0) next.push([s0, g0])                              // хвост слева
      if (g1 < s1) next.push([g1, s1])                              // хвост справа
    }
    spans = next
  }
  return spans.filter(([s0, s1]) => s1 - s0 > 0.4)
}

/**
 * Приподнятый тротуар вдоль ДУГИ радиуса r (θ∈[a0, a0+π/2]): короткие box-звенья
 * по дуге, каждое повёрнуто по касательной — читается как непрерывный бордюр,
 * стыкующийся с прямыми участками. Локальный θ → world-XZ (cos θ, −sin θ).
 */
function WalkArc({ r, a0, color: colorProp }: { r: number; a0: number; color?: string }) {
  const pal = useScenePalette()
  const color = colorProp ?? pal.n[6]
  const links = 7
  const step = Math.PI / 2 / links
  const segLen = r * step + 0.06                        // лёгкий нахлёст звеньев
  const items: { x: number; z: number; ry: number }[] = []
  for (let i = 0; i < links; i++) {
    const th = a0 + (i + 0.5) * step
    const x = Math.cos(th) * r, z = -Math.sin(th) * r    // локальный θ → world (X, −Z)
    // Касательная world T=(−sinθ, −cosθ); ось +X box'а выставляем вдоль T:
    // rotation.y=ry даёт +X → (cos ry, 0, −sin ry) ⇒ ry = atan2(cosθ, −sinθ).
    const ry = Math.atan2(Math.cos(th), -Math.sin(th))
    items.push({ x, z, ry })
  }
  return (
    <group>
      {items.map((it, i) => (
        <mesh key={i} position={[it.x, Y_WALK, it.z]} rotation={[0, it.ry, 0]} castShadow receiveShadow>
          <boxGeometry args={[segLen, WALK_H, WALK_W]} /><meshStandardMaterial color={color} roughness={0.92} />
        </mesh>
      ))}
    </group>
  )
}

/**
 * Скруглённый угол L-поворота: обочина/асфальт-филе (четверть-кольцо) + осевая
 * по дуге + приподнятые тротуары по внешней (выпуклой) и внутренней (вогнутой)
 * дугам. Радиус осевой = CORNER_R (совпадает с TURN_R маршрутов) — асфальт
 * непрерывен на повороте, машины идут ровно по дуге.
 */
function CornerPatch({ cx, cz, a0 }: Corner) {
  const pal = useScenePalette()
  const HW = ROAD_W / 2
  const rIn = CORNER_R - HW, rOut = CORNER_R + HW
  const seg = 14
  const wr = HW + WALK_W / 2 + 0.06                     // радиус-смещение осевой тротуара
  return (
    <group position={[cx, 0, cz]}>
      {/* Обочина-филе (шире асфальта). */}
      <mesh position={[0, Y_SHOULDER, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <ringGeometry args={[Math.max(0, rIn - 0.45), rOut + 0.45, seg, 1, a0, Math.PI / 2]} />
        <meshStandardMaterial color={pal.n[2]} roughness={1} />
      </mesh>
      {/* Асфальт-филе. */}
      <mesh position={[0, Y_ROAD, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <ringGeometry args={[Math.max(0, rIn), rOut, seg, 1, a0, Math.PI / 2]} />
        <meshStandardMaterial color={pal.n[1]} roughness={1} />
      </mesh>
      {/* Осевая: тонкое кольцо-дуга (жёлтая), чуть короче квадранта. */}
      <mesh position={[0, Y_LANE, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[CORNER_R - 0.065, CORNER_R + 0.065, seg, 1, a0 + 0.14, Math.PI / 2 - 0.28]} />
        <meshBasicMaterial color={pal.yellow.l} />
      </mesh>
      {/* Приподнятый тротуар: внешняя и (если помещается) внутренняя дуги. */}
      <WalkArc r={CORNER_R + wr} a0={a0} />
      {rIn - wr - WALK_W / 2 > 0.02 && <WalkArc r={CORNER_R - wr} a0={a0} />}
    </group>
  )
}

/** Пешеходный переход «зебра» поперёк дороги у развязки. */
function Crossing({ x, z, horiz }: { x: number; z: number; horiz: boolean }) {
  const pal = useScenePalette()
  const stripes = 5, sw = 0.22, sgap = 0.2, step = sw + sgap
  const start = -((stripes - 1) * step) / 2
  const size: [number, number] = horiz ? [sw, ROAD_W - 0.2] : [ROAD_W - 0.2, sw]
  const bars: number[] = []
  for (let i = 0; i < stripes; i++) bars.push(start + i * step)
  return (
    <group>
      {bars.map((o, i) => (
        <mesh key={i} position={[x + (horiz ? o : 0), Y_ZEBRA, z + (horiz ? 0 : o)]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={size} /><meshBasicMaterial color={pal.n[8]} />
        </mesh>
      ))}
    </group>
  )
}

/**
 * Внешний пешеходный бордюр-кольцо развязки с ПРОЁМАМИ под дорожные рукава.
 * arms — единичные world-направления рукавов (dx,dz) от центра. Ring рисуется в
 * локальной XY (rotation.x=−π/2): world-угол рукава θ=atan2(−dz, dx). Между
 * соседними рукавами кладём дугу-звено бордюра, пропуская сектор ±gapHalf вокруг
 * каждого рукава (там дорога входит в кольцо). Если рукавов нет — сплошное кольцо.
 */
function RoundWalkRing({ arms }: { arms: [number, number][] }) {
  const pal = useScenePalette()
  const TAU = Math.PI * 2
  // Угловой полураствор проёма на радиусе бордюра: должен превышать поперечный вынос
  // тротуара входящей дороги (walkOff + полширины борта), иначе диагональные звенья
  // столкнулись бы с концами прямых бордюров. Небольшой запас 0.15.
  const gapHalf = Math.atan2(ROAD_W / 2 + WALK_W / 2 + 0.06 + WALK_W / 2 + 0.15, ROUND_WALK_RIN)
  const spans: { start: number; len: number }[] = []
  if (arms.length === 0) {
    spans.push({ start: 0, len: TAU })
  } else {
    const th = arms.map(([dx, dz]) => ((Math.atan2(-dz, dx) % TAU) + TAU) % TAU).sort((p, q) => p - q)
    for (let i = 0; i < th.length; i++) {
      const a = th[i] + gapHalf                       // конец текущего проёма
      const bNext = th[(i + 1) % th.length] + (i + 1 === th.length ? TAU : 0)
      const b = bNext - gapHalf                        // начало следующего проёма
      const len = b - a
      if (len > 0.05) spans.push({ start: a, len })    // видимая дуга-звено бордюра
    }
  }
  return (
    <group>
      {spans.map((s, i) => (
        <mesh key={i} position={[0, Y_WALK, 0]} rotation={[-Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <ringGeometry args={[ROUND_WALK_RIN, ROUND_WALK_ROUT, 40, 1, s.start, s.len]} />
          <meshStandardMaterial color={pal.n[6]} roughness={0.92} />
        </mesh>
      ))}
    </group>
  )
}

/**
 * Кольцевая развязка: асфальтовое кольцо + бордюр + ring-разметка + островок +
 * внешний пешеходный бордюр-кольцо (RoundWalkRing) с проёмами под рукава — так
 * у развязки непрерывная пешеходная граница, как у прямых участков.
 * На улице островок газонный с плантером/деревцем; в цехе — бетонный.
 */
function Roundabout({ x, z, indoor, arms = [] }: { x: number; z: number; indoor?: boolean; arms?: [number, number][] }) {
  const pal = useScenePalette()
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, Y_ROAD, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <ringGeometry args={[1.3, ROUND_OUTER_R, 36]} /><meshStandardMaterial color={pal.n[1]} roughness={1} />
      </mesh>
      {/* Внешний пешеходный бордюр-кольцо с проёмами под дорожные рукава. */}
      <RoundWalkRing arms={arms} />
      {/* Внешняя и внутренняя кольцевая разметка. */}
      <mesh position={[0, Y_LANE, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.5, 2.6, 36]} /><meshBasicMaterial color={indoor ? pal.n[7] : pal.yellow.l} />
      </mesh>
      <mesh position={[0, Y_LANE, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.3, 1.4, 36]} /><meshBasicMaterial color={indoor ? pal.n[7] : pal.yellow.l} />
      </mesh>
      {/* Бордюр-кольцо островка. */}
      <mesh position={[0, Y_KERB, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.18, 1.3, 32]} /><meshStandardMaterial color={pal.n[6]} roughness={0.9} />
      </mesh>
      {/* Островок: приподнятый газон (улица) или плоский бетон (цех). */}
      {indoor ? (
        <mesh position={[0, 0.12, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[1.18, 28]} /><meshStandardMaterial color={pal.n[3]} roughness={1} />
        </mesh>
      ) : (
        <mesh position={[0, 0.14, 0]} receiveShadow castShadow>
          <cylinderGeometry args={[1.14, 1.18, 0.28, 30]} /><meshStandardMaterial color={pal.green.m} roughness={1} />
        </mesh>
      )}
      {!indoor && (
        <group>
          {/* Мягкий газонный купол — островок читается объёмным, а не плоским пятном. */}
          <mesh position={[0, 0.28, 0]} scale={[1, 0.42, 1]} castShadow receiveShadow>
            <sphereGeometry args={[1.0, 22, 12]} /><meshStandardMaterial color={pal.green.m} roughness={1} />
          </mesh>
          {/* Кольцо декоративного кустарника/цветов по краю купола. */}
          {Array.from({ length: 10 }, (_, k) => {
            const a = (k / 10) * Math.PI * 2
            const c = k % 3 === 0 ? pal.orange.m : k % 3 === 1 ? pal.green.m : pal.red.m
            return (
              <mesh key={`s${k}`} position={[Math.cos(a) * 0.82, 0.4, Math.sin(a) * 0.82]} castShadow>
                <sphereGeometry args={[0.2, 8, 6]} /><meshStandardMaterial color={c} roughness={1} />
              </mesh>
            )
          })}
          {/* Аккуратное деревце по центру: ствол + округлая многосферная крона (не конус). */}
          <mesh position={[0, 0.78, 0]} castShadow>
            <cylinderGeometry args={[0.08, 0.11, 0.8, 8]} /><meshStandardMaterial color={pal.orange.m} roughness={0.95} />
          </mesh>
          {([[0, 1.28, 0, 0.5], [0.34, 1.12, 0.16, 0.36], [-0.32, 1.16, -0.14, 0.34], [0.12, 1.5, -0.18, 0.3]] as const).map(([px, py, pz, r], k) => (
            <mesh key={`c${k}`} position={[px, py, pz]} castShadow>
              <sphereGeometry args={[r, 8, 6]} /><meshStandardMaterial color={k === 3 ? pal.orange.m : pal.green.m} roughness={1} />
            </mesh>
          ))}
        </group>
      )}
    </group>
  )
}

/** Цветовые варианты грузовика (детерминированно по индексу). */
const useCabColors = themed((pal) => ([pal.n[8], pal.red.m, pal.blue.m] as const))
const useTrailerColors = themed((pal) => ([pal.n[8], pal.n[6]] as const))

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
  const pal = useScenePalette()
  return (
    <group position={[0, 0.05, 0]}>
      <mesh position={[0, 0.5, 0]} castShadow><boxGeometry args={[1.4, 0.7, 0.9]} /><meshStandardMaterial color={pal.yellow.l} metalness={0.2} roughness={0.6} /></mesh>
      <mesh position={[0.35, 1.15, 0]}><boxGeometry args={[0.55, 0.6, 0.8]} /><meshStandardMaterial color={pal.n[1]} /></mesh>
      <mesh position={[0.85, 0.7, 0]}><boxGeometry args={[0.12, 1.4, 0.7]} /><meshStandardMaterial color={pal.n[1]} /></mesh>
      <mesh position={[1.1, 0.2, 0.18]}><boxGeometry args={[0.6, 0.08, 0.1]} /><meshStandardMaterial color={pal.n[0]} /></mesh>
      <mesh position={[1.1, 0.2, -0.18]}><boxGeometry args={[0.6, 0.08, 0.1]} /><meshStandardMaterial color={pal.n[0]} /></mesh>
      {[[0.45, 0.45], [0.45, -0.45], [-0.45, 0.45], [-0.45, -0.45]].map(([wx, wz], i) => (
        <mesh key={i} position={[wx, 0.22, wz]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.22, 0.22, 0.16, 10]} /><meshStandardMaterial color={pal.n[0]} /></mesh>
      ))}
    </group>
  )
}

/** Колесо грузовика (тёмная шина + светлый диск). */
function TruckWheel({ position }: { position: [number, number, number] }) {
  const pal = useScenePalette()
  return (
    <group position={position} rotation={[Math.PI / 2, 0, 0]}>
      <mesh castShadow><cylinderGeometry args={[0.19, 0.19, 0.13, 12]} /><meshStandardMaterial color={pal.n[0]} roughness={0.85} /></mesh>
      <mesh position={[0, 0.07, 0]}><cylinderGeometry args={[0.09, 0.09, 0.02, 10]} /><meshStandardMaterial color={pal.n[5]} metalness={0.5} roughness={0.5} /></mesh>
    </group>
  )
}

/** Седельная фура: кабина (стекло/фары/решётка/колёса) + короб-полуприцеп (двери/фонари). */
function Lorry({ variant }: { variant: number }) {
  const pal = useScenePalette()
  const CAB_COLORS = useCabColors()
  const TRAILER_COLORS = useTrailerColors()
  const cab = CAB_COLORS[variant % CAB_COLORS.length]
  const trailer = TRAILER_COLORS[Math.floor(variant / CAB_COLORS.length) % TRAILER_COLORS.length]
  // Кабина спереди (по +X = направление движения), прицеп сзади.
  return (
    <group position={[0, 0.02, 0]}>
      {/* Рама. */}
      <mesh position={[-0.1, 0.2, 0]}><boxGeometry args={[2.3, 0.12, 0.62]} /><meshStandardMaterial color={pal.n[0]} /></mesh>

      {/* --- Кабина --- */}
      <mesh position={[0.82, 0.5, 0]} castShadow><boxGeometry args={[0.6, 0.56, 0.66]} /><meshStandardMaterial color={cab} metalness={0.3} roughness={0.5} /></mesh>
      {/* Лобовое стекло. */}
      <mesh position={[1.08, 0.58, 0]}><boxGeometry args={[0.1, 0.32, 0.56]} /><meshStandardMaterial color={pal.n[1]} metalness={0.5} roughness={0.25} /></mesh>
      {/* Решётка. */}
      <mesh position={[1.13, 0.3, 0]}><boxGeometry args={[0.05, 0.24, 0.5]} /><meshStandardMaterial color={pal.n[1]} metalness={0.4} roughness={0.6} /></mesh>
      {/* Бампер. */}
      <mesh position={[1.14, 0.16, 0]}><boxGeometry args={[0.07, 0.1, 0.6]} /><meshStandardMaterial color={pal.n[1]} metalness={0.4} roughness={0.5} /></mesh>
      {/* Фары. */}
      <mesh position={[1.15, 0.28, 0.22]}><boxGeometry args={[0.04, 0.1, 0.12]} /><meshStandardMaterial color={pal.yellow.l} emissive={pal.yellow.l} emissiveIntensity={0.9} /></mesh>
      <mesh position={[1.15, 0.28, -0.22]}><boxGeometry args={[0.04, 0.1, 0.12]} /><meshStandardMaterial color={pal.yellow.l} emissive={pal.yellow.l} emissiveIntensity={0.9} /></mesh>

      {/* --- Короб-полуприцеп --- */}
      <mesh position={[-0.52, 0.62, 0]} castShadow><boxGeometry args={[1.36, 0.78, 0.66]} /><meshStandardMaterial color={trailer} roughness={0.7} metalness={0.1} /></mesh>
      {/* Задние двери (панель). */}
      <mesh position={[-1.21, 0.62, 0]}><boxGeometry args={[0.04, 0.72, 0.6]} /><meshStandardMaterial color={pal.n[6]} roughness={0.7} /></mesh>
      {/* Задние фонари. */}
      <mesh position={[-1.23, 0.34, 0.24]}><boxGeometry args={[0.03, 0.1, 0.08]} /><meshStandardMaterial color={pal.red.d} emissive={pal.red.d} emissiveIntensity={0.7} /></mesh>
      <mesh position={[-1.23, 0.34, -0.24]}><boxGeometry args={[0.03, 0.1, 0.08]} /><meshStandardMaterial color={pal.red.d} emissive={pal.red.d} emissiveIntensity={0.7} /></mesh>

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
  const { hSegs, vSegs, roundabouts, corners, tees, routes } = useMemo(() => {
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

  // Подрезка концов участков под скруглённые углы + классификация КАЖДОГО конца
  // (corner/round/plain) + рукава каждой развязки — всё для бесшовной стыковки
  // тротуаров: у угла бордюр отступает ровно на CORNER_R (стык с WalkArc), у
  // развязки — за её внешний радиус (не лезет внутрь кольца).
  const { hCuts, vCuts, hEnds, vEnds, roundArms, hGaps, vGaps } = useMemo(() => {
    const hCuts = hSegs.map(() => [0, 0])
    const vCuts = vSegs.map(() => [0, 0])
    const hEnds = hSegs.map(() => ['plain', 'plain'] as [EndKind, EndKind])
    const vEnds = vSegs.map(() => ['plain', 'plain'] as [EndKind, EndKind])
    // Проёмы в тротуаре вокруг развязки, стоящей В СЕРЕДИНЕ пролёта участка.
    const hGaps: [number, number][][] = hSegs.map(() => [])
    const vGaps: [number, number][][] = vSegs.map(() => [])
    // У каждого угла центр смещён на (dirH·R, dirV·R) от стыка. Знаки dir задаёт
    // a0 (cornerStartAngle) — перебираем 4 варианта и восстанавливаем стык (jx,jz).
    for (const c of corners) {
      for (const dh of [+1, -1] as const) for (const dv of [+1, -1] as const) {
        const jx = c.cx - dh * CORNER_R, jz = c.cz - dv * CORNER_R
        if (cornerStartAngle(dh, dv) !== c.a0) continue
        hSegs.forEach((h, i) => {
          if (Math.abs(h.z - jz) > EPS) return
          if (Math.abs(h.x0 - jx) < EPS) { hCuts[i][0] = CORNER_R; hEnds[i][0] = 'corner' }
          else if (Math.abs(h.x1 - jx) < EPS) { hCuts[i][1] = CORNER_R; hEnds[i][1] = 'corner' }
        })
        vSegs.forEach((v, i) => {
          if (Math.abs(v.x - jx) > EPS) return
          if (Math.abs(v.z0 - jz) < EPS) { vCuts[i][0] = CORNER_R; vEnds[i][0] = 'corner' }
          else if (Math.abs(v.z1 - jz) < EPS) { vCuts[i][1] = CORNER_R; vEnds[i][1] = 'corner' }
        })
      }
    }
    // Концы, упирающиеся в развязку: тот конец, что совпал с центром кольца [rx,rz].
    // Рукава развязки (world-направления входящих дорог) — для проёмов в бордюр-кольце.
    const roundArms: [number, number][][] = roundabouts.map(() => [])
    roundabouts.forEach(([rx, rz], ri) => {
      const arms = roundArms[ri]
      const push = (dx: number, dz: number) => { if (!arms.some(([ax, az]) => ax === dx && az === dz)) arms.push([dx, dz]) }
      hSegs.forEach((h, i) => {
        if (Math.abs(h.z - rz) > EPS) return
        if (Math.abs(h.x0 - rx) < EPS) { hEnds[i][0] = 'round'; push(+1, 0) }   // дорога уходит на +X
        else if (Math.abs(h.x1 - rx) < EPS) { hEnds[i][1] = 'round'; push(-1, 0) }
        else if (rx > h.x0 + EPS && rx < h.x1 - EPS) {                          // развязка внутри пролёта
          push(+1, 0); push(-1, 0)
          hGaps[i].push([rx - ROUND_TRIM, rx + ROUND_TRIM])                    // разрыв тротуара
        }
      })
      vSegs.forEach((v, i) => {
        if (Math.abs(v.x - rx) > EPS) return
        if (Math.abs(v.z0 - rz) < EPS) { vEnds[i][0] = 'round'; push(0, +1) }   // дорога уходит на +Z
        else if (Math.abs(v.z1 - rz) < EPS) { vEnds[i][1] = 'round'; push(0, -1) }
        else if (rz > v.z0 + EPS && rz < v.z1 - EPS) {
          push(0, +1); push(0, -1)
          vGaps[i].push([rz - ROUND_TRIM, rz + ROUND_TRIM])
        }
      })
    })
    // T-съезды (отворотки): островка НЕТ. У СКВОЗНОЙ дороги (узел в середине её
    // пролёта) разрываем тротуар в устье съезда, чтобы заезд был открыт. Ветка,
    // упирающаяся концом, остаётся 'plain' — её бордюр и так отступает от устья,
    // а асфальт без ретракта продолжается в магистраль (бесшовный съезд).
    for (const [tx, tz] of tees) {
      hSegs.forEach((h, i) => {
        if (Math.abs(h.z - tz) > EPS) return
        if (tx > h.x0 + EPS && tx < h.x1 - EPS) hGaps[i].push([tx - TEE_GAP, tx + TEE_GAP])
      })
      vSegs.forEach((v, i) => {
        if (Math.abs(v.x - tx) > EPS) return
        if (tz > v.z0 + EPS && tz < v.z1 - EPS) vGaps[i].push([tz - TEE_GAP, tz + TEE_GAP])
      })
    }
    return { hCuts, vCuts, hEnds, vEnds, roundArms, hGaps, vGaps }
  }, [hSegs, vSegs, corners, roundabouts, tees])

  return (
    <group>
      {hSegs.map((h, i) => <RoadStrip key={`h${i}`} cx={(h.x0 + h.x1) / 2} cz={h.z} w={h.x1 - h.x0} d={0} cutLo={hCuts[i][0]} cutHi={hCuts[i][1]} loKind={hEnds[i][0]} hiKind={hEnds[i][1]} gaps={hGaps[i]} />)}
      {vSegs.map((v, i) => <RoadStrip key={`v${i}`} cx={v.x} cz={(v.z0 + v.z1) / 2} w={0} d={v.z1 - v.z0} cutLo={vCuts[i][0]} cutHi={vCuts[i][1]} loKind={vEnds[i][0]} hiKind={vEnds[i][1]} gaps={vGaps[i]} />)}
      {corners.map((c, i) => <CornerPatch key={`k${i}`} cx={c.cx} cz={c.cz} a0={c.a0} />)}
      {!indoor && crossings.map((c, i) => <Crossing key={`c${i}`} x={c.x} z={c.z} horiz={c.horiz} />)}
      {roundabouts.map(([x, z], i) => <Roundabout key={`r${i}`} x={x} z={z} indoor={indoor} arms={roundArms[i]} />)}
      <VehicleFleet routes={routes} indoor={indoor} />
    </group>
  )
}
