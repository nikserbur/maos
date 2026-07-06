import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { SimTaskDto } from '../../lib/api'

/** Общее изменяемое состояние симуляции: панель (DOM) пишет, слой (R3F) читает
 *  в useFrame — без React-ререндеров на каждый кадр. */
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

interface Transfer { from: string; to: string; t0: number; t1: number; hue: number }
const DOT_POOL = 80
const WORKER_POOL = 40
const MAX_CRATES = 160      // общий пул «накопившихся батчей» (instanced)
const CRATES_PER_NODE = 8   // максимум ящиков в стопке у одного узла

// Переиспользуемые temp-объекты для инстансинга (не аллоцируем в кадре).
const _m4 = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _v = new THREE.Vector3()
const _s = new THREE.Vector3()

interface SimNode { id: string; position: [number, number]; refType?: 'shop' | 'machine' }

/** Слой поверх 3D-схемы: подсветка занятых узлов (станков ИЛИ цехов на площадке),
 *  очереди-батчи (стопки ящиков), партии и рабочие на маршрутах. На уровне
 *  площадки станки проецируются на свой цех — видно, какие цеха работают. */
export function SimulationLayer({ sim, nodes, machineShop }: {
  sim: React.MutableRefObject<SimState>
  nodes: SimNode[]
  machineShop: Map<string, string>
}) {
  const ringsRef = useRef<Array<THREE.Mesh | null>>([])
  const dotsRef = useRef<Array<THREE.Mesh | null>>([])
  const workersRef = useRef<Array<THREE.Group | null>>([])
  const cratesRef = useRef<THREE.InstancedMesh>(null)
  const idx = useRef<{
    rev: number; nodes: unknown; byNode: Map<string, SimTaskDto[]>; transfers: Transfer[]
    workers: Array<{ id: string; tasks: SimTaskDto[] }>
    ready: Map<SimTaskDto, number>       // момент готовности партии к операции (конец предыдущей)
  }>({ rev: -1, nodes: null, byNode: new Map(), transfers: [], workers: [], ready: new Map() })
  const posOf = useRef<Map<string, [number, number]>>(new Map())
  const isShop = useRef<Set<string>>(new Set())

  useFrame((_, delta) => {
    const s = sim.current
    // id узла текущего уровня для операции: сам станок ИЛИ его цех (на площадке).
    const nodeIds = new Set(nodes.map((n) => n.id))
    const nodeOf = (machineId: string): string | null => {
      if (nodeIds.has(machineId)) return machineId
      const shop = machineShop.get(machineId)
      return shop && nodeIds.has(shop) ? shop : null
    }
    // Пересборка индексов при загрузке нового плана ИЛИ смене уровня (nodes).
    if (idx.current.rev !== s.rev || idx.current.nodes !== nodes) {
      const bm = new Map<string, SimTaskDto[]>()
      for (const t of s.tasks) {
        const nid = nodeOf(t.machine_id)
        if (!nid) continue
        if (!bm.has(nid)) bm.set(nid, [])
        bm.get(nid)!.push(t)
      }
      bm.forEach((arr) => arr.sort((a, b) => a.start - b.start))
      // Материальный поток + готовность партий: цепочка операций заказа по времени.
      const byOrder = new Map<number, SimTaskDto[]>()
      for (const t of s.tasks) {
        if (!byOrder.has(t.order_idx)) byOrder.set(t.order_idx, [])
        byOrder.get(t.order_idx)!.push(t)
      }
      const transfers: Transfer[] = []
      const ready = new Map<SimTaskDto, number>()
      byOrder.forEach((arr, oi) => {
        arr.sort((a, b) => a.start - b.start)
        for (let i = 0; i < arr.length; i++) {
          // партия «готова» к операции i, когда закончилась предыдущая операция цепочки
          ready.set(arr[i], i === 0 ? arr[i].start : arr[i - 1].end)
        }
        for (let i = 0; i + 1 < arr.length && transfers.length < 4000; i++) {
          const a = arr[i], b = arr[i + 1]
          if (a.machine_id !== b.machine_id && b.start >= a.end - 1e-6)
            transfers.push({ from: a.machine_id, to: b.machine_id,
                             t0: a.end, t1: Math.max(b.start, a.end + 0.25), hue: (oi * 47) % 360 })
        }
      })
      // Рабочие: последовательность их операций во времени (для перемещения фигурок).
      const byWorker = new Map<string, SimTaskDto[]>()
      for (const t of s.tasks) {
        if (!t.worker_id) continue
        if (!byWorker.has(t.worker_id)) byWorker.set(t.worker_id, [])
        byWorker.get(t.worker_id)!.push(t)
      }
      const workers = [...byWorker.entries()]
        .slice(0, WORKER_POOL)
        .map(([id, tasks]) => ({ id, tasks: tasks.sort((a, b) => a.start - b.start) }))

      idx.current = { rev: s.rev, nodes, byNode: bm, transfers, workers, ready }
      const pm = new Map<string, [number, number]>()
      const shopSet = new Set<string>()
      for (const n of nodes) {
        pm.set(n.id, n.position)
        if (n.refType === 'shop') shopSet.add(n.id)
      }
      posOf.current = pm
      isShop.current = shopSet
    }
    // Позиция операции: узел станка ИЛИ его цех (на площадке) — общая для колец/партий/рабочих.
    const posFor = (machineId: string): [number, number] | undefined => {
      const nid = nodeOf(machineId); return nid ? posOf.current.get(nid) : undefined
    }
    const shopLevelOf = (machineId: string): boolean => {
      const nid = nodeOf(machineId); return nid ? isShop.current.has(nid) : false
    }

    // Ход модельного времени.
    if (s.playing) {
      s.t += delta * s.speed
      if (s.t >= s.makespan) { s.t = s.makespan; s.playing = false }
    }
    const t = s.t

    // Подсветка занятых узлов: станок — если идёт операция; цех — если занят любой
    // из его станков. Для цеха интенсивность растёт с числом занятых станков.
    nodes.forEach((n, i) => {
      const mesh = ringsRef.current[i]
      if (!mesh) return
      const arr = idx.current.byNode.get(n.id)
      let busy = 0
      if (arr && arr.length) {
        // сканируем окно вокруг бинарного поиска — интервалы могут пересекаться
        let lo = 0, hi = arr.length - 1
        while (lo <= hi) {
          const mid = (lo + hi) >> 1
          if (arr[mid].start > t) hi = mid - 1
          else lo = mid + 1
        }
        for (let k = Math.max(0, lo - 24); k < Math.min(arr.length, lo + 4); k++)
          if (arr[k].start <= t && t < arr[k].end) busy++
      }
      mesh.visible = busy > 0
      if (busy > 0) {
        const pulse = 1 + 0.1 * Math.sin(performance.now() / 200 + i)
        mesh.scale.setScalar(pulse)
        const mat = mesh.material as THREE.MeshBasicMaterial
        // цех с большим числом занятых станков светится плотнее
        mat.opacity = Math.min(0.95, 0.45 + busy * 0.12)
      }
    })

    // Очереди-батчи: партии, ГОТОВЫЕ к операции, но ждущие станок (ready ≤ t < start)
    // — копятся стопкой ящиков у узла. Один InstancedMesh на все узлы.
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
        if (!q) continue
        const p = posOf.current.get(nid)
        if (!p) continue
        const shop = isShop.current.has(nid)
        const off = shop ? 8.2 : 2.6          // стопка рядом с узлом, не под зданием
        const sz = shop ? 1.15 : 0.62
        for (let k = 0; k < q && ci < MAX_CRATES; k++) {
          const col = k % 2, row = Math.floor(k / 2)
          _v.set(p[0] - off + col * (sz + 0.12), sz / 2 + row * (sz + 0.06), p[1] + off * 0.55)
          _s.setScalar(sz)
          _m4.compose(_v, _q, _s)
          crates.setMatrixAt(ci++, _m4)
        }
      }
      crates.count = ci
      crates.instanceMatrix.needsUpdate = true
    }

    // Движущиеся партии: Г-путь по «дорогам»; на уровне площадки дуга выше зданий.
    let d = 0
    for (const tr of idx.current.transfers) {
      if (d >= DOT_POOL) break
      if (t < tr.t0 || t > tr.t1) continue
      const p0 = posFor(tr.from), p1 = posFor(tr.to)
      if (!p0 || !p1 || (p0[0] === p1[0] && p0[1] === p1[1])) continue   // один узел → нет движения
      const mesh = dotsRef.current[d]
      if (!mesh) { d++; continue }
      const f = (t - tr.t0) / Math.max(1e-6, tr.t1 - tr.t0)
      let mx: number, mz: number
      if (f < 0.5) { const u = f / 0.5; mx = p0[0] + (p1[0] - p0[0]) * u; mz = p0[1] }
      else { const u = (f - 0.5) / 0.5; mx = p1[0]; mz = p0[1] + (p1[1] - p0[1]) * u }
      const arc = shopLevelOf(tr.from) || shopLevelOf(tr.to) ? 2.6 : 0.9
      mesh.position.set(mx, 1.3 + Math.sin(f * Math.PI) * arc, mz)
      ;(mesh.material as THREE.MeshStandardMaterial).color.setHSL(tr.hue / 360, 0.75, 0.55)
      mesh.visible = true
      d++
    }
    for (; d < DOT_POOL; d++) { const m = dotsRef.current[d]; if (m) m.visible = false }

    // Рабочие-человечки: у станка активной операции; при переходе — идут по Г-дорожке.
    idx.current.workers.forEach((w, wi) => {
      if (wi >= WORKER_POOL) return
      const g = workersRef.current[wi]
      if (!g) return
      let cur: SimTaskDto | null = null, next: SimTaskDto | null = null
      for (let i = 0; i < w.tasks.length; i++) {
        if (w.tasks[i].start <= t) { cur = w.tasks[i]; next = w.tasks[i + 1] ?? null }
        else break
      }
      if (!cur) { g.visible = false; return }
      const pc = posFor(cur.machine_id)
      if (!pc) { g.visible = false; return }
      let px = pc[0], pz = pc[1]
      if (t > cur.end && next) {
        const pn = posFor(next.machine_id)
        if (pn && (pn[0] !== pc[0] || pn[1] !== pc[1])) {
          const f = Math.min(1, (t - cur.end) / Math.max(1e-6, next.start - cur.end))
          if (f < 0.5) { const u = f / 0.5; px = pc[0] + (pn[0] - pc[0]) * u; pz = pc[1] }
          else { const u = (f - 0.5) / 0.5; px = pn[0]; pz = pc[1] + (pn[1] - pc[1]) * u }
        }
      }
      // Смещение от центра узла: у цеха — к кромке здания (иначе фигурка внутри коробки).
      const off = (shopLevelOf(cur.machine_id) ? 7.4 : 1.6) + (wi % 3) * 0.55
      g.position.set(px + off, 0, pz - off * 0.4)
      g.visible = true
    })
  })

  return (
    <group>
      {/* Кольца занятости: у цеха — вокруг здания (r≈8), у станка — компактное. */}
      {nodes.map((n, i) => {
        const shop = n.refType === 'shop'
        return (
          <mesh key={n.id} ref={(m) => { ringsRef.current[i] = m }}
                position={[n.position[0], 0.18, n.position[1]]}
                rotation={[-Math.PI / 2, 0, 0]} visible={false} renderOrder={3}>
            <ringGeometry args={shop ? [7.6, 8.5, 48] : [2.1, 2.7, 32]} />
            <meshBasicMaterial color="#f5a623" transparent opacity={0.85}
                               depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
        )
      })}
      {/* Стопки «накопившихся батчей» (очереди) — единый инстанс-пул. */}
      <instancedMesh ref={cratesRef} args={[undefined, undefined, MAX_CRATES]} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#c9964a" roughness={0.8} />
      </instancedMesh>
      {Array.from({ length: DOT_POOL }, (_, i) => (
        <mesh key={i} ref={(m) => { dotsRef.current[i] = m }} visible={false}>
          <sphereGeometry args={[0.45, 10, 10]} />
          <meshStandardMaterial color="#ffffff" emissiveIntensity={0.4} />
        </mesh>
      ))}
      {/* Рабочие-человечки: капсула (тело) + сфера (голова) + каска. */}
      {Array.from({ length: WORKER_POOL }, (_, i) => (
        <group key={i} ref={(g) => { workersRef.current[i] = g }} visible={false}>
          <mesh position={[0, 0.85, 0]}>
            <capsuleGeometry args={[0.28, 0.9, 4, 8]} />
            <meshStandardMaterial color="#2ea3f2" />
          </mesh>
          <mesh position={[0, 1.75, 0]}>
            <sphereGeometry args={[0.26, 10, 10]} />
            <meshStandardMaterial color="#ffd7a8" />
          </mesh>
          <mesh position={[0, 1.92, 0]}>
            <sphereGeometry args={[0.24, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#f2b21e" />
          </mesh>
        </group>
      ))}
    </group>
  )
}
