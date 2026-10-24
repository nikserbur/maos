import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { SimTaskDto } from '../../lib/api'
import { slotForEntity } from '../../ui/charts/palette'
import { useThemeColors } from './themeColors'
import { useScenePalette } from './scenePalette'

/**
 * Слой симуляции поверх 3D-схемы (X2 P-36, P-39). У каждого обозначения одна работа:
 *  - кольцо — загрузка объекта за последние 8 модельных часов, одноцветная шкала в 3 шага
 *    (--chart-8 → --chart-1), не прозрачность; выше 85 % — ▲ над объектом (читается и в сером);
 *  - ящики — партии в очереди (нейтральные), фигурки — рабочие (--text-secondary);
 *  - партии в пути — цвет изделия по справочнику (slotForEntity), как на Ганте «Плана»; седьмое
 *    и далее изделие — «прочие» (--chart-8), без деления по модулю.
 * Анимация на паузе (или «меньше движения») — время само не идёт, двигается ползунком.
 */
export interface SimState {
  tasks: SimTaskDto[]
  makespan: number
  t: number          // модельное время, ч
  playing: boolean
  speed: number      // модельных часов за секунду реального времени
  rev: number        // инкремент при загрузке новых задач → слой пересобирает индексы
}

export function createSimState(): SimState {
  return { tasks: [], makespan: 0, t: 0, playing: false, speed: 24, rev: 0 }
}

interface Transfer { from: string; to: string; t0: number; t1: number; color: number }
const DOT_POOL = 80
const WORKER_POOL = 40
const MAX_CRATES = 160      // общий пул «накопившихся батчей» (instanced)
const CRATES_PER_NODE = 8   // максимум ящиков в стопке у одного узла
/** Окно загрузки кольца, модельных часов. */
const LOAD_WINDOW = 8
/** Шаги шкалы загрузки: ниже 50 % · 50–85 % · от 85 % (▲). */
const STEP_MID = 0.5
const STEP_HOT = 0.85
/** Индекс цвета «прочих» в палитре партий (--chart-8). */
const OTHER = 7

// Переиспользуемые temp-объекты для инстансинга (не аллоцируем в кадре).
const _m4 = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _v = new THREE.Vector3()
const _s = new THREE.Vector3()

interface SimNode { id: string; position: [number, number]; refType?: 'shop' | 'machine' | 'factory' }

interface Index {
  rev: number; nodes: unknown
  byNode: Map<string, SimTaskDto[]>; maxDur: Map<string, number>; cap: Map<string, number>
  transfers: Transfer[]; workers: Array<{ id: string; tasks: SimTaskDto[] }>; ready: Map<SimTaskDto, number>
}

/** Загрузка узла за окно [t − W, t]: занятые станко-часы / (W × станков). */
function windowLoad(arr: ReadonlyArray<SimTaskDto>, t: number, maxDur: number, cap: number): number {
  let lo = 0, hi = arr.length - 1
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (arr[mid].start > t) hi = mid - 1; else lo = mid + 1 }
  const from = t - LOAD_WINDOW
  let busy = 0
  for (let k = lo - 1; k >= 0 && arr[k].start >= from - maxDur; k--) {
    busy += Math.max(0, Math.min(arr[k].end, t) - Math.max(arr[k].start, from))
  }
  return Math.min(1, busy / (LOAD_WINDOW * Math.max(1, cap)))
}

export function SimulationLayer({ sim, nodes, machineShop, productIds, still }: {
  sim: React.MutableRefObject<SimState>
  nodes: SimNode[]
  machineShop: Map<string, string>
  /** Изделия справочника — порядок слотов цвета партий. */
  productIds: ReadonlyArray<string>
  /** Анимация на паузе: время не идёт само. */
  still: boolean
}) {
  const pal = useScenePalette()
  const ringsRef = useRef<Array<THREE.Mesh | null>>([])
  const marksRef = useRef<Array<THREE.Mesh | null>>([])
  const dotsRef = useRef<Array<THREE.Mesh | null>>([])
  const workersRef = useRef<Array<THREE.Group | null>>([])
  const cratesRef = useRef<THREE.InstancedMesh>(null)
  const idx = useRef<Index>({ rev: -1, nodes: null, byNode: new Map(), maxDur: new Map(), cap: new Map(), transfers: [], workers: [], ready: new Map() })
  const posOf = useRef<Map<string, [number, number]>>(new Map())
  const isShop = useRef<Set<string>>(new Set())
  const colors = useThemeColors()
  const steps = useMemo(() => {
    const low = new THREE.Color(colors.chart[OTHER]), high = new THREE.Color(colors.chart[0])
    return [low, low.clone().lerp(high, 0.5), high]
  }, [colors])
  // Палитра партий: слоты --chart-1…6 и «прочие» --chart-8 как THREE.Color (в кадре только copy()).
  const batchColors = useMemo(() => colors.chart.map((c) => new THREE.Color(c)), [colors])
  const universe = useRef(productIds)
  universe.current = productIds
  const stillRef = useRef(still)
  stillRef.current = still

  useFrame((_, delta) => {
    const s = sim.current
    const nodeIds = new Set(nodes.map((n) => n.id))
    const nodeOf = (machineId: string): string | null => {
      if (nodeIds.has(machineId)) return machineId
      const shop = machineShop.get(machineId)
      return shop && nodeIds.has(shop) ? shop : null
    }
    if (idx.current.rev !== s.rev || idx.current.nodes !== nodes) idx.current = buildIndex(s, nodes, nodeOf, machineShop, universe.current, posOf, isShop)
    const posFor = (machineId: string): [number, number] | undefined => {
      const nid = nodeOf(machineId); return nid ? posOf.current.get(nid) : undefined
    }
    const shopLevelOf = (machineId: string): boolean => {
      const nid = nodeOf(machineId); return nid ? isShop.current.has(nid) : false
    }

    // Ход модельного времени — только когда анимация не на паузе.
    if (s.playing && !stillRef.current) {
      s.t += delta * s.speed
      if (s.t >= s.makespan) { s.t = s.makespan; s.playing = false }
    }
    const t = s.t

    // Кольцо загрузки (3 шага одного оттенка) и ▲ выше 85 %.
    nodes.forEach((n, i) => {
      const ring = ringsRef.current[i]
      const mark = marksRef.current[i]
      const arr = idx.current.byNode.get(n.id)
      const load = arr && arr.length ? windowLoad(arr, t, idx.current.maxDur.get(n.id) ?? 0, idx.current.cap.get(n.id) ?? 1) : 0
      if (ring) {
        ring.visible = load > 0.01
        if (ring.visible) (ring.material as THREE.MeshBasicMaterial).color.copy(steps[load >= STEP_HOT ? 2 : load >= STEP_MID ? 1 : 0])
      }
      if (mark) mark.visible = load >= STEP_HOT
    })

    // Очереди: партии, готовые к операции, но ждущие станок (ready ≤ t < start) — стопка ящиков.
    const crates = cratesRef.current
    if (crates) {
      let ci = 0
      _q.identity()
      for (const [nid, arr] of idx.current.byNode) {
        if (ci >= MAX_CRATES) break
        let q = 0
        for (const task of arr) {
          const r = idx.current.ready.get(task)
          if (r !== undefined && r <= t && t < task.start) q++
          if (q >= CRATES_PER_NODE) break
        }
        const p = q ? posOf.current.get(nid) : undefined
        if (!p) continue
        const shop = isShop.current.has(nid)
        const off = shop ? 8.2 : 2.6
        const sz = shop ? 1.15 : 0.62
        for (let k = 0; k < q && ci < MAX_CRATES; k++) {
          _v.set(p[0] - off + (k % 2) * (sz + 0.12), sz / 2 + Math.floor(k / 2) * (sz + 0.06), p[1] + off * 0.55)
          _s.setScalar(sz)
          _m4.compose(_v, _q, _s)
          crates.setMatrixAt(ci++, _m4)
        }
      }
      crates.count = ci
      crates.instanceMatrix.needsUpdate = true
    }

    // Партии в пути: Г-путь по «дорогам»; на уровне площадки дуга выше зданий.
    let d = 0
    for (const tr of idx.current.transfers) {
      if (d >= DOT_POOL) break
      if (t < tr.t0 || t > tr.t1) continue
      const p0 = posFor(tr.from), p1 = posFor(tr.to)
      if (!p0 || !p1 || (p0[0] === p1[0] && p0[1] === p1[1])) continue
      const mesh = dotsRef.current[d]
      if (!mesh) { d++; continue }
      const f = (t - tr.t0) / Math.max(1e-6, tr.t1 - tr.t0)
      const mx = f < 0.5 ? p0[0] + (p1[0] - p0[0]) * (f / 0.5) : p1[0]
      const mz = f < 0.5 ? p0[1] : p0[1] + (p1[1] - p0[1]) * ((f - 0.5) / 0.5)
      const arc = shopLevelOf(tr.from) || shopLevelOf(tr.to) ? 2.6 : 0.9
      mesh.position.set(mx, 1.3 + Math.sin(f * Math.PI) * arc, mz)
      ;(mesh.material as THREE.MeshStandardMaterial).color.copy(batchColors[tr.color] ?? batchColors[OTHER])
      mesh.visible = true
      d++
    }
    for (; d < DOT_POOL; d++) { const m = dotsRef.current[d]; if (m) m.visible = false }

    // Рабочие: у станка активной операции; при переходе — идут по Г-дорожке.
    idx.current.workers.forEach((w, wi) => {
      const g = workersRef.current[wi]
      if (!g) return
      let cur: SimTaskDto | null = null, next: SimTaskDto | null = null
      for (let i = 0; i < w.tasks.length; i++) {
        if (w.tasks[i].start <= t) { cur = w.tasks[i]; next = w.tasks[i + 1] ?? null } else break
      }
      const pc = cur ? posFor(cur.machine_id) : undefined
      if (!cur || !pc) { g.visible = false; return }
      let px = pc[0], pz = pc[1]
      const pn = t > cur.end && next ? posFor(next.machine_id) : undefined
      if (next && pn && (pn[0] !== pc[0] || pn[1] !== pc[1])) {
        const f = Math.min(1, (t - cur.end) / Math.max(1e-6, next.start - cur.end))
        if (f < 0.5) { px = pc[0] + (pn[0] - pc[0]) * (f / 0.5) } else { px = pn[0]; pz = pc[1] + (pn[1] - pc[1]) * ((f - 0.5) / 0.5) }
      }
      const off = (shopLevelOf(cur.machine_id) ? 7.4 : 1.6) + (wi % 3) * 0.55
      g.position.set(px + off, 0, pz - off * 0.4)
      g.visible = true
    })
  })

  return (
    <group>
      {nodes.map((n, i) => {
        const shop = n.refType === 'shop'
        return (
          <group key={n.id} position={[n.position[0], 0, n.position[1]]}>
            {/* Кольцо загрузки: у цеха — вокруг здания (r≈8), у станка — компактное. */}
            <mesh ref={(m) => { ringsRef.current[i] = m }} position={[0, 0.18, 0]} rotation={[-Math.PI / 2, 0, 0]} visible={false} renderOrder={3}>
              <ringGeometry args={shop ? [7.6, 8.6, 48] : [2.1, 2.8, 32]} />
              <meshBasicMaterial color={steps[0]} transparent opacity={0.9} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
            {/* ▲ перегрузки: трёхгранная пирамида над объектом — форма, а не цвет. */}
            <mesh ref={(m) => { marksRef.current[i] = m }} position={[0, shop ? 14 : 5, 0]} visible={false}>
              <coneGeometry args={shop ? [1.4, 2.4, 3] : [0.6, 1.1, 3]} />
              <meshBasicMaterial color={steps[2]} />
            </mesh>
          </group>
        )
      })}
      <instancedMesh ref={cratesRef} args={[undefined, undefined, MAX_CRATES]} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={colors.textMuted} roughness={0.8} />
      </instancedMesh>
      {Array.from({ length: DOT_POOL }, (_, i) => (
        <mesh key={i} ref={(m) => { dotsRef.current[i] = m }} visible={false}>
          <sphereGeometry args={[0.45, 10, 10]} />
          <meshStandardMaterial color={pal.n[8]} emissiveIntensity={0.4} />
        </mesh>
      ))}
      {Array.from({ length: WORKER_POOL }, (_, i) => (
        <group key={i} ref={(g) => { workersRef.current[i] = g }} visible={false}>
          <mesh position={[0, 0.85, 0]}>
            <capsuleGeometry args={[0.28, 0.9, 4, 8]} />
            <meshStandardMaterial color={colors.textSecondary} />
          </mesh>
          <mesh position={[0, 1.75, 0]}>
            <sphereGeometry args={[0.26, 10, 10]} />
            <meshStandardMaterial color={colors.textSecondary} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

/** Индексы плана для текущего уровня: задачи по узлам, ёмкость узла, переходы партий, рабочие. */
function buildIndex(
  s: SimState, nodes: SimNode[], nodeOf: (machineId: string) => string | null, machineShop: Map<string, string>,
  universe: ReadonlyArray<string>, posOf: { current: Map<string, [number, number]> }, isShop: { current: Set<string> },
): Index {
  // Локальные накопители сборки индекса (не общее состояние) — push ради O(n) на тысячах задач.
  const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]) }
  const byNode = new Map<string, SimTaskDto[]>()
  for (const t of s.tasks) {
    const nid = nodeOf(t.machine_id)
    if (nid) push(byNode, nid, t)
  }
  const maxDur = new Map<string, number>()
  byNode.forEach((arr, nid) => {
    arr.sort((a, b) => a.start - b.start)
    maxDur.set(nid, arr.reduce((m, x) => Math.max(m, x.end - x.start), 0))
  })
  // Ёмкость узла: станок — 1, цех — число его станков.
  const cap = new Map<string, number>()
  machineShop.forEach((shop) => cap.set(shop, (cap.get(shop) ?? 0) + 1))
  // Цвет изделия: слот справочника; без справочника — изделия плана.
  const products = [...new Set(s.tasks.map((t) => t.product_id))]
  const ids = universe.length ? universe : products
  const colorOf = new Map(products.map((p) => {
    const slot = slotForEntity('product', p, ids)
    return [p, slot.other ? OTHER : slot.slot] as const
  }))
  const byOrder = new Map<number, SimTaskDto[]>()
  for (const t of s.tasks) push(byOrder, t.order_idx, t)
  const transfers: Transfer[] = []
  const ready = new Map<SimTaskDto, number>()
  byOrder.forEach((arr) => {
    arr.sort((a, b) => a.start - b.start)
    arr.forEach((task, i) => ready.set(task, i === 0 ? task.start : arr[i - 1].end))
    for (let i = 0; i + 1 < arr.length && transfers.length < 4000; i++) {
      const a = arr[i], b = arr[i + 1]
      if (a.machine_id !== b.machine_id && b.start >= a.end - 1e-6)
        transfers.push({ from: a.machine_id, to: b.machine_id, t0: a.end, t1: Math.max(b.start, a.end + 0.25), color: colorOf.get(a.product_id) ?? OTHER })
    }
  })
  const byWorker = new Map<string, SimTaskDto[]>()
  for (const t of s.tasks) if (t.worker_id) push(byWorker, t.worker_id, t)
  const workers = [...byWorker.entries()].slice(0, WORKER_POOL)
    .map(([id, tasks]) => ({ id, tasks: [...tasks].sort((a, b) => a.start - b.start) }))
  posOf.current = new Map(nodes.map((n) => [n.id, n.position]))
  isShop.current = new Set(nodes.filter((n) => n.refType === 'shop').map((n) => n.id))
  return { rev: s.rev, nodes, byNode, maxDur, cap, transfers, workers, ready }
}
