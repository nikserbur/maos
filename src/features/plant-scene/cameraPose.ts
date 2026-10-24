/**
 * Кадр камеры схемы (X2 P-31) — чистая геометрия без three.js (тестируемо):
 *  - границы уровня по P5–P95 координат узлов (один выброс не уменьшает станки до точек);
 *  - ракурс: вытянутый цех (стороны > 2:1) — перпендикулярно длинной оси под 55°;
 *  - дистанция вписывания по углам коробки уровня в базисе камеры;
 *  - кэш позиции камеры по уровням: уход сохраняет, возврат восстанавливает (без чёрного экрана);
 *  - камера всегда не ниже цели + 2.
 */

export type Vec3 = readonly [number, number, number]

export interface LevelBounds {
  cx: number
  cz: number
  /** Полуширина (X) и полуглубина (Z) рамки уровня. */
  hw: number
  hd: number
  /** Радиус описывающей сферы (с запасом и высотой объектов). */
  radius: number
}

export interface Pose {
  position: Vec3
  target: Vec3
}

/** Высота объектов цеха — рамка узлов плоская, станки и здания объёмные. */
export const OBJECT_HEIGHT = 3.5
const EMPTY_HALF = 12
const MIN_HALF = 4
const PAD = 2
/** Ракурс по умолчанию (≈ 28° над горизонтом, по диагонали). */
export const DEFAULT_DIR: Vec3 = normalize([0.6, 0.47, 0.65])
/** Угол возвышения для вытянутого цеха. */
const ELONGATED_ELEVATION_DEG = 55
const ELONGATED_RATIO = 2
/** Камера не ниже цели на столько единиц. */
export const MIN_LIFT = 2

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

/** Квантиль отсортированного ряда с линейной интерполяцией. */
export function quantile(sorted: ReadonlyArray<number>, p: number): number {
  if (sorted.length === 0) return 0
  const at = (sorted.length - 1) * Math.min(1, Math.max(0, p))
  const lo = Math.floor(at)
  const hi = Math.ceil(at)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo)
}

/** Рамка уровня по P5–P95 позиций узлов (+ отступ под габарит объекта), запас `margin`. */
export function levelBounds(nodes: ReadonlyArray<{ position: readonly [number, number] }>, margin = 0.15): LevelBounds {
  if (nodes.length === 0) {
    return { cx: 0, cz: 0, hw: EMPTY_HALF, hd: EMPTY_HALF, radius: Math.hypot(EMPTY_HALF, EMPTY_HALF) * (1 + margin) }
  }
  const xs = nodes.map((n) => n.position[0]).sort((a, b) => a - b)
  const zs = nodes.map((n) => n.position[1]).sort((a, b) => a - b)
  const [x0, x1] = [quantile(xs, 0.05), quantile(xs, 0.95)]
  const [z0, z1] = [quantile(zs, 0.05), quantile(zs, 0.95)]
  const hw = Math.max(MIN_HALF, (x1 - x0) / 2 + PAD)
  const hd = Math.max(MIN_HALF, (z1 - z0) / 2 + PAD)
  return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, hw, hd, radius: Math.hypot(hw, hd, OBJECT_HEIGHT / 2) * (1 + margin) }
}

/** Направление от цели к камере: вытянутый цех — поперёк длинной оси под 55°, иначе по умолчанию. */
export function viewDirection(b: Pick<LevelBounds, 'hw' | 'hd'>): Vec3 {
  const long = Math.max(b.hw, b.hd)
  const short = Math.max(1e-6, Math.min(b.hw, b.hd))
  if (long / short <= ELONGATED_RATIO) return DEFAULT_DIR
  const el = (ELONGATED_ELEVATION_DEG * Math.PI) / 180
  const flat = Math.cos(el)
  // Длинная ось X → смотрим вдоль Z; длинная Z → вдоль X.
  return b.hw >= b.hd ? normalize([0, Math.sin(el), flat]) : normalize([flat, Math.sin(el), 0])
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

/**
 * Дистанция, на которой коробка уровня (±hw × высота × ±hd) целиком входит в кадр перспективной
 * камеры, смотрящей из направления `dir`: каждый угол проецируется на базис камеры.
 */
export function fitBoxDistance(b: Pick<LevelBounds, 'hw' | 'hd'>, dir: Vec3, vFovDeg: number, aspect: number, margin = 0.15): number {
  const vHalf = (vFovDeg * Math.PI) / 360
  const tanV = Math.tan(vHalf)
  const tanH = tanV * Math.max(0.1, aspect)
  const fwd: Vec3 = [-dir[0], -dir[1], -dir[2]]
  const right = normalize(cross(fwd, [0, 1, 0]))
  const up = cross(right, fwd)
  const hw = b.hw * (1 + margin)
  const hd = b.hd * (1 + margin)
  let need = 0
  for (const sx of [-1, 1]) for (const sy of [0, 1]) for (const sz of [-1, 1]) {
    const c: Vec3 = [sx * hw, sy * OBJECT_HEIGHT, sz * hd]
    const depth = dot(c, dir)
    need = Math.max(need, depth + Math.abs(dot(c, right)) / tanH, depth + Math.abs(dot(c, up)) / tanV)
  }
  return need
}

/** Поза вписывания уровня: цель — центр рамки на высоте 1, камера — по направлению и дистанции. */
export function fitPose(b: LevelBounds, dir: Vec3, distance: number): Pose {
  const target: Vec3 = [b.cx, 1, b.cz]
  return guardPose({ target, position: [target[0] + dir[0] * distance, target[1] + dir[1] * distance, target[2] + dir[2] * distance] })
}

/** Камера не ниже цели + MIN_LIFT (под полом — чёрный экран). */
export function guardPose(p: Pose): Pose {
  const minY = p.target[1] + MIN_LIFT
  return p.position[1] >= minY ? p : { ...p, position: [p.position[0], minY, p.position[2]] }
}

/** Кэш поз по уровням: новый Map с позой уровня `key` (исходный не меняется). */
export function withPose(cache: ReadonlyMap<string, Pose>, key: string, pose: Pose): ReadonlyMap<string, Pose> {
  const next = new Map(cache)
  next.set(key, guardPose(pose))
  return next
}
