/**
 * Железнодорожная станция + сортировочная развязка предприятия (уровень площадки, 3D).
 * Вдоль дальней кромки территории: магистраль (уходит в туман — «в даль»), два
 * сортировочных пути, НАСТОЯЩИЕ стрелочные переводы (остряки + крестовина + переводной
 * механизм), тепловоз с составом вагонов (полувагон/цистерна/крытый), тупиковый упор,
 * станция с платформой и навесом. Масштаб уменьшен — читается как реальный жд-узел.
 */
import { useMemo } from 'react'
import { railSpur } from './siteLayout'
import { useScenePalette } from './scenePalette'

const GAUGE = 1.4          // колея (уменьшена под масштаб сцены)
const OVER = GAUGE + 0.55  // ширина шпалы

/** Прямой путь вдоль оси X: балласт + 2 рельса + шпалы (шпалы можно ограничить видимой зоной). */
function Track({ z, x0, x1, tieX0, tieX1 }: { z: number; x0: number; x1: number; tieX0?: number; tieX1?: number }) {
  const pal = useScenePalette()
  const len = x1 - x0
  const cx = (x0 + x1) / 2
  const t0 = tieX0 ?? x0
  const t1 = tieX1 ?? x1
  const nTies = Math.min(80, Math.max(0, Math.floor((t1 - t0) / 1.7)))
  const tiePos = useMemo(() => Array.from({ length: nTies }, (_, i) => t0 + 0.8 + (i * (t1 - t0)) / Math.max(1, nTies)), [t0, t1, nTies])
  return (
    <group>
      <mesh position={[cx, 0.05, z]} receiveShadow>
        <boxGeometry args={[len, 0.1, OVER + 0.5]} />
        <meshStandardMaterial color={pal.n[1]} roughness={1} />
      </mesh>
      {tiePos.map((tx, i) => (
        <mesh key={i} position={[tx, 0.11, z]} castShadow>
          <boxGeometry args={[0.2, 0.1, OVER]} />
          <meshStandardMaterial color={pal.n[1]} roughness={1} />
        </mesh>
      ))}
      {[-GAUGE / 2, GAUGE / 2].map((dz, i) => (
        <mesh key={i} position={[cx, 0.19, z + dz]} castShadow>
          <boxGeometry args={[len, 0.1, 0.08]} />
          <meshStandardMaterial color={pal.n[5]} metalness={0.75} roughness={0.35} />
        </mesh>
      ))}
    </group>
  )
}

/** Прямой путь вдоль оси Z (спур на территорию): балласт + 2 рельса (x±GAUGE/2) + шпалы поперёк (вдоль X). */
function TrackZ({ x, z0, z1 }: { x: number; z0: number; z1: number }) {
  const pal = useScenePalette()
  const len = z1 - z0
  const cz = (z0 + z1) / 2
  const nTies = Math.min(40, Math.max(0, Math.floor((z1 - z0) / 1.7)))
  const tiePos = useMemo(() => Array.from({ length: nTies }, (_, i) => z0 + 0.8 + (i * (z1 - z0)) / Math.max(1, nTies)), [z0, z1, nTies])
  return (
    <group>
      <mesh position={[x, 0.05, cz]} receiveShadow>
        <boxGeometry args={[OVER + 0.5, 0.1, len]} />
        <meshStandardMaterial color={pal.n[1]} roughness={1} />
      </mesh>
      {tiePos.map((tz, i) => (
        <mesh key={i} position={[x, 0.11, tz]} castShadow>
          <boxGeometry args={[OVER, 0.1, 0.2]} />
          <meshStandardMaterial color={pal.n[1]} roughness={1} />
        </mesh>
      ))}
      {[-GAUGE / 2, GAUGE / 2].map((dx, i) => (
        <mesh key={i} position={[x + dx, 0.19, cz]} castShadow>
          <boxGeometry args={[0.08, 0.1, len]} />
          <meshStandardMaterial color={pal.n[5]} metalness={0.75} roughness={0.35} />
        </mesh>
      ))}
    </group>
  )
}

/**
 * Балласт + шпалы вдоль ДУГИ (поворотная кривая спура). Рельсы кривой кладутся
 * отдельно сегментами RailSeg — тут добавляем подстилающий балласт (хорды дуги) и
 * поперечные РАДИАЛЬНЫЕ шпалы по центральной оси, иначе у кривой были «голые»
 * рельсы без шпал (жалоба пользователя). Балласт/шпалы — под рельсами (y=0.05/0.11).
 */
function CurvedTrackBed({ cx, cz, r, a0, a1, seg = 8 }: { cx: number; cz: number; r: number; a0: number; a1: number; seg?: number }) {
  const pal = useScenePalette()
  const bed = useMemo(() => {
    const ballast: { x: number; z: number; ang: number; len: number }[] = []
    const ties: { x: number; z: number; ry: number }[] = []
    for (let i = 0; i < seg; i++) {
      const t0 = a0 + (i / seg) * (a1 - a0), t1 = a0 + ((i + 1) / seg) * (a1 - a0)
      const x0 = cx + r * Math.cos(t0), z0 = cz + r * Math.sin(t0)
      const x1 = cx + r * Math.cos(t1), z1 = cz + r * Math.sin(t1)
      ballast.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, ang: Math.atan2(-(z1 - z0), x1 - x0), len: Math.hypot(x1 - x0, z1 - z0) + 0.1 })
      const tm = (t0 + t1) / 2
      ties.push({ x: cx + r * Math.cos(tm), z: cz + r * Math.sin(tm), ry: -tm })   // ось шпалы — радиально
    }
    return { ballast, ties }
  }, [cx, cz, r, a0, a1, seg])
  return (
    <group>
      {bed.ballast.map((b, i) => (
        <mesh key={`bb${i}`} position={[b.x, 0.05, b.z]} rotation={[0, b.ang, 0]} receiveShadow>
          <boxGeometry args={[b.len, 0.1, OVER + 0.5]} />
          <meshStandardMaterial color={pal.n[1]} roughness={1} />
        </mesh>
      ))}
      {bed.ties.map((t, i) => (
        <mesh key={`bt${i}`} position={[t.x, 0.11, t.z]} rotation={[0, t.ry, 0]} castShadow>
          <boxGeometry args={[OVER, 0.1, 0.2]} />
          <meshStandardMaterial color={pal.n[1]} roughness={1} />
        </mesh>
      ))}
    </group>
  )
}

/** Один рельс-сегмент между двумя точками XZ (для расходящихся путей стрелки). */
function RailSeg({ x1, z1, x2, z2 }: { x1: number; z1: number; x2: number; z2: number }) {
  const pal = useScenePalette()
  const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2
  const len = Math.hypot(x2 - x1, z2 - z1)
  const ang = Math.atan2(-(z2 - z1), x2 - x1)
  return (
    <mesh position={[cx, 0.19, cz]} rotation={[0, ang, 0]} castShadow>
      <boxGeometry args={[len, 0.1, 0.08]} />
      <meshStandardMaterial color={pal.n[5]} metalness={0.75} roughness={0.35} />
    </mesh>
  )
}

/** Стрелочный перевод (стрелка): расходящаяся пара рельсов (2 сегмента = «кривая»),
 *  крестовина и переводной механизм с рычагом сбоку. */
function Switch({ x, z, dz, len = 7 }: { x: number; z: number; dz: number; len?: number }) {
  const pal = useScenePalette()
  const zt = z + dz
  const mid = x + len * 0.5
  const midZ = z + dz * 0.42
  return (
    <group>
      <RailSeg x1={x} z1={z - GAUGE / 2} x2={mid} z2={midZ - GAUGE / 2} />
      <RailSeg x1={mid} z1={midZ - GAUGE / 2} x2={x + len} z2={zt - GAUGE / 2} />
      <RailSeg x1={x} z1={z + GAUGE / 2} x2={mid} z2={midZ + GAUGE / 2} />
      <RailSeg x1={mid} z1={midZ + GAUGE / 2} x2={x + len} z2={zt + GAUGE / 2} />
      {/* крестовина (frog) */}
      <mesh position={[x + len * 0.6, 0.2, z + dz * 0.5]} rotation={[0, -Math.atan2(dz, len), 0]} castShadow>
        <boxGeometry args={[1.1, 0.12, 0.42]} />
        <meshStandardMaterial color={pal.n[3]} metalness={0.6} roughness={0.5} />
      </mesh>
      {/* переводной механизм: тумба + круглый указатель + рычаг */}
      <group position={[x + 0.5, 0, z - GAUGE / 2 - 0.85]}>
        <mesh position={[0, 0.32, 0]} castShadow><boxGeometry args={[0.36, 0.64, 0.36]} /><meshStandardMaterial color={pal.orange.m} metalness={0.3} roughness={0.7} /></mesh>
        <mesh position={[0, 0.78, 0]} castShadow><cylinderGeometry args={[0.24, 0.24, 0.07, 12]} /><meshStandardMaterial color={pal.n[7]} /></mesh>
        <mesh position={[0.22, 0.5, 0]} rotation={[0, 0, 0.5]} castShadow><boxGeometry args={[0.05, 0.6, 0.05]} /><meshStandardMaterial color={pal.n[1]} /></mesh>
      </group>
    </group>
  )
}

/** Колёсная тележка (2 оси) под подвижным составом. */
function Bogie({ x }: { x: number }) {
  const pal = useScenePalette()
  return (
    <group position={[x, 0.3, 0]}>
      {[-0.45, 0.45].map((dx, i) =>
        [-GAUGE / 2, GAUGE / 2].map((dz, j) => (
          <mesh key={`${i}-${j}`} position={[dx, 0, dz]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.25, 0.25, 0.1, 14]} />
            <meshStandardMaterial color={pal.n[1]} metalness={0.5} roughness={0.6} />
          </mesh>
        )),
      )}
      <mesh position={[0, 0.02, 0]}><boxGeometry args={[1.25, 0.16, GAUGE - 0.1]} /><meshStandardMaterial color={pal.n[1]} metalness={0.4} roughness={0.7} /></mesh>
    </group>
  )
}

/** Буфера/сцепка на торце единицы состава. */
function Buffers({ L }: { L: number }) {
  const pal = useScenePalette()
  return (
    <>
      {[-L / 2 - 0.05, L / 2 + 0.05].map((bx, i) => (
        <mesh key={i} position={[bx, 0.5, 0]} castShadow><boxGeometry args={[0.12, 0.24, 0.8]} /><meshStandardMaterial color={pal.n[0]} /></mesh>
      ))}
    </>
  )
}

type WagonType = 'gondola' | 'tank' | 'box'
/** Грузовой вагон (уменьшенный масштаб): полувагон / цистерна / крытый. */
function Wagon({ x, z, type, color }: { x: number; z: number; type: WagonType; color: string }) {
  const pal = useScenePalette()
  const L = 5.8
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.5, 0]} castShadow receiveShadow><boxGeometry args={[L, 0.2, 1.9]} /><meshStandardMaterial color={pal.n[1]} metalness={0.4} roughness={0.7} /></mesh>
      <Bogie x={-L / 2 + 0.95} />
      <Bogie x={L / 2 - 0.95} />
      <Buffers L={L} />
      {type === 'gondola' && (
        <group position={[0, 1.12, 0]}>
          <mesh position={[0, 0, 0.9]} castShadow><boxGeometry args={[L - 0.3, 1.05, 0.1]} /><meshStandardMaterial color={color} roughness={0.85} metalness={0.3} /></mesh>
          <mesh position={[0, 0, -0.9]} castShadow><boxGeometry args={[L - 0.3, 1.05, 0.1]} /><meshStandardMaterial color={color} roughness={0.85} metalness={0.3} /></mesh>
          <mesh position={[L / 2 - 0.15, 0, 0]} castShadow><boxGeometry args={[0.1, 1.05, 1.8]} /><meshStandardMaterial color={color} roughness={0.85} metalness={0.3} /></mesh>
          <mesh position={[-L / 2 + 0.15, 0, 0]} castShadow><boxGeometry args={[0.1, 1.05, 1.8]} /><meshStandardMaterial color={color} roughness={0.85} metalness={0.3} /></mesh>
          <mesh position={[0, -0.15, 0]}><boxGeometry args={[L - 0.6, 0.68, 1.6]} /><meshStandardMaterial color={pal.n[1]} roughness={1} /></mesh>
        </group>
      )}
      {type === 'tank' && (
        <group position={[0, 1.3, 0]}>
          <mesh rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.82, 0.82, L - 0.4, 18]} /><meshStandardMaterial color={color} metalness={0.6} roughness={0.4} /></mesh>
          <mesh position={[0, 0.85, 0]} castShadow><boxGeometry args={[0.5, 0.24, 0.5]} /><meshStandardMaterial color={pal.n[1]} /></mesh>
        </group>
      )}
      {type === 'box' && (
        <group position={[0, 1.28, 0]}>
          <mesh castShadow receiveShadow><boxGeometry args={[L - 0.3, 1.65, 1.9]} /><meshStandardMaterial color={color} roughness={0.8} metalness={0.2} /></mesh>
          <mesh position={[0.3, 0, 0.98]}><boxGeometry args={[1.5, 1.25, 0.06]} /><meshStandardMaterial color={pal.n[1]} roughness={0.7} /></mesh>
          <mesh position={[0, 0.92, 0]}><boxGeometry args={[L - 0.2, 0.14, 2.05]} /><meshStandardMaterial color={pal.n[2]} roughness={0.7} /></mesh>
        </group>
      )}
    </group>
  )
}

/** Магистральный тепловоз: рама на 2 тележках, длинный капот, кабина со стёклами, фары. */
function Locomotive({ x, z, color: colorProp }: { x: number; z: number; color?: string }) {
  const pal = useScenePalette()
  const color = colorProp ?? pal.red.d
  const L = 7.6
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.5, 0]} castShadow receiveShadow><boxGeometry args={[L, 0.24, 2.2]} /><meshStandardMaterial color={pal.n[1]} metalness={0.4} roughness={0.7} /></mesh>
      <Bogie x={-L / 2 + 1.2} />
      <Bogie x={L / 2 - 1.2} />
      <Buffers L={L} />
      {/* капот */}
      <mesh position={[-0.9, 1.32, 0]} castShadow><boxGeometry args={[L - 3.6, 1.45, 2.0]} /><meshStandardMaterial color={color} metalness={0.35} roughness={0.55} /></mesh>
      {/* кабина */}
      <mesh position={[L / 2 - 1.4, 1.6, 0]} castShadow><boxGeometry args={[2.0, 1.95, 2.1]} /><meshStandardMaterial color={color} metalness={0.35} roughness={0.55} /></mesh>
      <mesh position={[L / 2 - 1.4, 2.62, 0]} castShadow><boxGeometry args={[2.15, 0.14, 2.2]} /><meshStandardMaterial color={pal.n[1]} /></mesh>
      {/* стёкла кабины */}
      <mesh position={[L / 2 - 0.46, 1.9, 0]}><boxGeometry args={[0.06, 0.8, 1.6]} /><meshStandardMaterial color={pal.blue.l} metalness={0.4} roughness={0.2} emissive={pal.n[1]} emissiveIntensity={0.4} /></mesh>
      {[1.06, -1.06].map((dz, i) => (
        <mesh key={i} position={[L / 2 - 1.4, 1.9, dz]}><boxGeometry args={[1.4, 0.8, 0.06]} /><meshStandardMaterial color={pal.blue.l} metalness={0.4} roughness={0.2} emissive={pal.n[1]} emissiveIntensity={0.35} /></mesh>
      ))}
      {/* вентиляция на капоте */}
      <mesh position={[-1.6, 2.12, 0]} castShadow><boxGeometry args={[0.5, 0.28, 0.6]} /><meshStandardMaterial color={pal.n[1]} /></mesh>
      {/* фары */}
      {[0.55, -0.55].map((dz, i) => (
        <mesh key={i} position={[-L / 2 + 0.02, 1.05, dz]}><boxGeometry args={[0.08, 0.22, 0.22]} /><meshStandardMaterial color={pal.yellow.l} emissive={pal.yellow.l} emissiveIntensity={0.9} /></mesh>
      ))}
      {/* жёлтая предупредительная полоса на носу */}
      <mesh position={[-L / 2 + 0.03, 0.78, 0]}><boxGeometry args={[0.04, 0.42, 2.0]} /><meshStandardMaterial color={pal.yellow.l} /></mesh>
    </group>
  )
}

/** Тупиковый упор в конце пути. */
function BufferStop({ x, z }: { x: number; z: number }) {
  const pal = useScenePalette()
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.45, 0]} castShadow><boxGeometry args={[0.5, 0.9, GAUGE + 0.3]} /><meshStandardMaterial color={pal.red.d} metalness={0.3} roughness={0.7} /></mesh>
      <mesh position={[0, 0.78, 0]}><boxGeometry args={[0.6, 0.2, GAUGE + 0.5]} /><meshStandardMaterial color={pal.yellow.l} /></mesh>
    </group>
  )
}

/** Здание вокзала/поста с платформой и навесом. Всё вынесено на ДАЛЬНЮЮ (−z) сторону
 *  от главного пути, чтобы не пересекаться с составом на сортировочных путях (+z). */
function Station({ x, z }: { x: number; z: number }) {
  const pal = useScenePalette()
  const P = -(GAUGE / 2 + 1.7)   // платформа/навес — на −z
  const B = -(GAUGE / 2 + 3.4)   // здание ещё дальше
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.28, P]} receiveShadow castShadow>
        <boxGeometry args={[16, 0.56, 2.6]} />
        <meshStandardMaterial color={pal.n[4]} roughness={0.95} />
      </mesh>
      <group position={[-4.5, 0, B]}>
        <mesh position={[0, 1.7, 0]} castShadow receiveShadow><boxGeometry args={[6, 3.4, 3.0]} /><meshStandardMaterial color={pal.yellow.l} roughness={0.85} /></mesh>
        <mesh position={[0, 3.6, 0]} castShadow><boxGeometry args={[6.5, 0.4, 3.5]} /><meshStandardMaterial color={pal.orange.d} roughness={0.9} /></mesh>
        {[-1.8, -0.6, 0.6, 1.8].map((wx, i) => (
          <mesh key={i} position={[wx, 1.85, 1.52]}><boxGeometry args={[0.8, 1.1, 0.06]} /><meshStandardMaterial color={pal.blue.l} metalness={0.3} roughness={0.2} emissive={pal.n[1]} emissiveIntensity={0.4} /></mesh>
        ))}
      </group>
      <group position={[3, 0, P]}>
        {[-5, -1.7, 1.7, 5].map((px, i) => (
          <mesh key={i} position={[px, 1.5, 0]} castShadow><cylinderGeometry args={[0.1, 0.1, 2.8, 8]} /><meshStandardMaterial color={pal.n[2]} metalness={0.5} roughness={0.5} /></mesh>
        ))}
        <mesh position={[0, 3.0, -0.4]} castShadow><boxGeometry args={[12, 0.18, 2.8]} /><meshStandardMaterial color={pal.n[3]} metalness={0.3} roughness={0.7} /></mesh>
      </group>
    </group>
  )
}

/** Полный жд-узел вдоль дальней кромки площадки; магистраль уходит в даль (в туман). */
export function RailYard({ minX, maxX, minZ, maxZ }: { minX: number; maxX: number; minZ: number; maxZ: number }) {
  const pal = useScenePalette()
  const zMain = minZ - 11
  const zSide1 = zMain + 3      // путь с составом (сторона площадки)
  const zSide2 = zMain + 6      // короткий пустой отсыл
  const cx = (minX + maxX) / 2
  const farL = minX - 75
  const farR = maxX + 75

  // Спур (ответвление на территорию завода): ось sp.x, уходит +z до sp.endZ (недалеко внутрь).
  const sp = railSpur(minX, maxX, minZ, maxZ)
  const curveR = 5               // радиус поворотной кривой (стрелка side1 → спур)
  const spurJoinZ = zSide1 + curveR   // точка схода на прямую ось спура (после четвертькруга)
  // Остряк (throat) стрелки: на пути side1, западнее оси спура на радиус кривой.
  const throatX = sp.x - curveR

  // Поворотная кривая (четвертькруг) от side1 к оси спура: центр дуги (throatX, spurJoinZ),
  // угол θ идёт от −π/2 (касательная +X у остряка) до 0 (касательная +Z у оси спура).
  // Два рельса — на радиусах R∓GAUGE/2 (внутренний/внешний), 4 хорды = плавная кривая.
  const curveRails = useMemo(() => {
    const cxA = throatX, czA = spurJoinZ
    const chords = 4
    const railPts = (radius: number) =>
      Array.from({ length: chords + 1 }, (_, i) => {
        const t = -Math.PI / 2 + (i / chords) * (Math.PI / 2)
        return { x: cxA + radius * Math.cos(t), z: czA + radius * Math.sin(t) }
      })
    return { inner: railPts(curveR - GAUGE / 2), outer: railPts(curveR + GAUGE / 2) }
  }, [throatX, spurJoinZ])

  // Состав на side1: тепловоз (cx−13) + 4 вагона; последний заканчивается ~cx+16.
  const wagons = useMemo(() => {
    const types: WagonType[] = ['gondola', 'tank', 'box', 'gondola']
    const colors = [pal.orange.m, pal.n[4], pal.red.d, pal.blue.m]
    return types.map((t, i) => ({ x: cx - 6 + i * 6.4, z: zSide1, type: t, color: colors[i % colors.length] }))
  }, [cx, zSide1, pal])

  return (
    <group>
      {/* Магистраль — уходит далеко за площадку (шпалы только в видимой зоне) */}
      <Track z={zMain} x0={farL} x1={farR} tieX0={cx - 45} tieX1={cx + 45} />
      {/* Путь с составом */}
      <Track z={zSide1} x0={cx - 27} x1={cx + 28} />
      {/* Короткий отсыл (пустой), ответвляется ПОСЛЕ состава */}
      <Track z={zSide2} x0={cx + 18} x1={cx + 32} />
      {/* Стрелка магистраль→side1 (до тепловоза) */}
      <Switch x={cx - 26} z={zMain} dz={zSide1 - zMain} />
      {/* Стрелка side1→side2 (за последним вагоном, ~cx+16) */}
      <Switch x={cx + 18} z={zSide1} dz={zSide2 - zSide1} />
      {/* Тупиковые упоры */}
      <BufferStop x={cx + 28} z={zSide1} />
      <BufferStop x={cx + 32} z={zSide2} />
      {/* Тепловоз + состав */}
      <Locomotive x={cx - 13} z={zSide1} />
      {wagons.map((w, i) => <Wagon key={i} {...w} />)}
      {/* Станция — на ДАЛЬНЕЙ стороне магистрали, X вне зоны состава по глубине */}
      <Station x={cx - 4} z={zMain} />

      {/* ── СПУР: ответвление жд-путей на территорию завода (не дорога) ──
          Отходит от пути с составом (side1), плавно поворачивает на +z и уходит
          НЕДАЛЕКО внутрь площадки, заканчиваясь тупиком под погрузку. */}
      {/* Стрелочный перевод на side1: остряки + крестовина + переводной механизм */}
      <Switch x={throatX} z={zSide1} dz={0.9} len={2.6} />
      {/* Балласт + шпалы под поворотной кривой (иначе кривая — «голые» рельсы без шпал) */}
      <CurvedTrackBed cx={throatX} cz={spurJoinZ} r={curveR} a0={-Math.PI / 2} a1={0} />
      {/* Поворотная кривая (четвертькруг): рельсы плавно перетекают из E-W пути side1
          в N-S ось спура — без резкого прямого угла (4 хорды на каждый рельс) */}
      {curveRails.inner.slice(0, -1).map((p, i) => (
        <RailSeg key={`ci${i}`} x1={p.x} z1={p.z} x2={curveRails.inner[i + 1].x} z2={curveRails.inner[i + 1].z} />
      ))}
      {curveRails.outer.slice(0, -1).map((p, i) => (
        <RailSeg key={`co${i}`} x1={p.x} z1={p.z} x2={curveRails.outer[i + 1].x} z2={curveRails.outer[i + 1].z} />
      ))}
      {/* Прямой путь спура вдоль Z: от точки схода кривой до тупика внутри завода */}
      <TrackZ x={sp.x} z0={spurJoinZ} z1={sp.endZ} />
      {/* Тупиковый упор в конце спура (торец под погрузку на автотранспорт);
          повёрнут на 90° — путь идёт вдоль Z, стенка упора смотрит вдоль Z */}
      <group position={[sp.x, 0, sp.endZ]} rotation={[0, Math.PI / 2, 0]}>
        <BufferStop x={0} z={0} />
      </group>
    </group>
  )
}
