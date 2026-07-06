const METAL = '#6a7076'
const POST = '#4c5550'
const WOOD = '#6b5436'
const ASPHALT = '#34383d'
const LINE = '#c7cdd2'
const LAMP_POLE = '#3a4148'
const SHRUB = '#3f6b3a'

/** Детерминированный псевдослучайный шум из числа (Math.random недоступен). */
const hash = (i: number) => { const s = Math.sin(i * 127.1 + 11.7) * 43758.5453; return s - Math.floor(s) }

/** Легковой автомобиль (декор парковки). */
function Car({ x, z, rot = 0, color }: { x: number; z: number; rot?: number; color: string }) {
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]} scale={0.62}>
      <mesh position={[0, 0.32, 0]} castShadow><boxGeometry args={[2, 0.42, 0.92]} /><meshStandardMaterial color={color} metalness={0.3} roughness={0.5} /></mesh>
      <mesh position={[-0.1, 0.66, 0]}><boxGeometry args={[1.1, 0.4, 0.84]} /><meshStandardMaterial color="#cfe2f2" emissive="#9cc0dd" emissiveIntensity={0.15} /></mesh>
      {[[0.6, 0.42], [0.6, -0.42], [-0.6, 0.42], [-0.6, -0.42]].map(([wx, wz], i) => (
        <mesh key={i} position={[wx, 0.18, wz]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.18, 0.18, 0.12, 10]} /><meshStandardMaterial color="#15171a" /></mesh>
      ))}
    </group>
  )
}

/** Колёса легкового авто (4 шт.). */
function Wheels({ wx, wz, r = 0.22 }: { wx: number; wz: number; r?: number }) {
  return (
    <>
      {[[wx, wz], [wx, -wz], [-wx, wz], [-wx, -wz]].map(([x, z], i) => (
        <group key={i} position={[x, r, z]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[r, r, 0.16, 14]} /><meshStandardMaterial color="#15171a" roughness={0.85} /></mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, z > 0 ? 0.085 : -0.085]}><cylinderGeometry args={[r * 0.5, r * 0.5, 0.04, 12]} /><meshStandardMaterial color="#c9ccd0" metalness={0.7} roughness={0.3} /></mesh>
        </group>
      ))}
    </>
  )
}

/** Красный родстер BMW Z4 — открытый двухместный (без крыши). */
function BmwZ4({ x, z, rot = 0 }: { x: number; z: number; rot?: number }) {
  const red = '#c8101c'
  const body = { color: red, metalness: 0.7, roughness: 0.22 }
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]} scale={0.72}>
      {/* нижний силовой кузов */}
      <mesh position={[0, 0.34, 0]} castShadow><boxGeometry args={[2.6, 0.3, 1.02]} /><meshStandardMaterial {...body} /></mesh>
      {/* длинный покатый капот */}
      <mesh position={[0.85, 0.5, 0]} castShadow><boxGeometry args={[1.0, 0.2, 0.98]} /><meshStandardMaterial {...body} /></mesh>
      <mesh position={[1.18, 0.42, 0]}><boxGeometry args={[0.3, 0.16, 0.96]} /><meshStandardMaterial {...body} /></mesh>
      {/* короткая высокая корма */}
      <mesh position={[-1.0, 0.56, 0]} castShadow><boxGeometry args={[0.65, 0.26, 1.0]} /><meshStandardMaterial {...body} /></mesh>
      {/* боковины кокпита */}
      {[0.46, -0.46].map((sz, i) => (
        <mesh key={i} position={[-0.25, 0.56, sz]}><boxGeometry args={[0.95, 0.24, 0.1]} /><meshStandardMaterial {...body} /></mesh>
      ))}
      {/* открытый салон */}
      <mesh position={[-0.25, 0.56, 0]}><boxGeometry args={[0.95, 0.18, 0.72]} /><meshStandardMaterial color="#17171a" /></mesh>
      {[0.18, -0.18].map((sz, i) => (
        <mesh key={i} position={[-0.4, 0.66, sz]}><boxGeometry args={[0.28, 0.26, 0.26]} /><meshStandardMaterial color="#2a2a2d" /></mesh>
      ))}
      {/* лобовое стекло — наклон назад (верх к салону) */}
      <mesh position={[0.05, 0.74, 0]} rotation={[0, 0, 0.55]}><boxGeometry args={[0.04, 0.34, 0.84]} /><meshStandardMaterial color="#acc6dd" transparent opacity={0.55} /></mesh>
      {/* две «ноздри» решётки BMW */}
      {[0.16, -0.16].map((gz, i) => (
        <mesh key={i} position={[1.33, 0.42, gz]}><boxGeometry args={[0.04, 0.16, 0.13]} /><meshStandardMaterial color="#1a1a1c" /></mesh>
      ))}
      {/* фары */}
      {[0.36, -0.36].map((hz, i) => (
        <mesh key={i} position={[1.3, 0.5, hz]}><boxGeometry args={[0.06, 0.1, 0.2]} /><meshStandardMaterial color="#eaf2ff" emissive="#cfe0ff" emissiveIntensity={0.5} /></mesh>
      ))}
      {/* задние фонари */}
      {[0.4, -0.4].map((tz, i) => (
        <mesh key={i} position={[-1.32, 0.54, tz]}><boxGeometry args={[0.05, 0.1, 0.22]} /><meshStandardMaterial color="#c01818" emissive="#c01818" emissiveIntensity={0.4} /></mesh>
      ))}
      <Wheels wx={0.82} wz={0.5} r={0.24} />
    </group>
  )
}

/** Белый кроссовер Omoda C5 с чёрной крышей (двухцветный). */
function OmodaC5({ x, z, rot = 0 }: { x: number; z: number; rot?: number }) {
  const white = '#f0f2f4'
  const body = { color: white, metalness: 0.35, roughness: 0.38 }
  const black = '#16181b'
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]} scale={0.72}>
      {/* чёрная нижняя защита/арки */}
      <mesh position={[0, 0.26, 0]}><boxGeometry args={[2.5, 0.32, 1.1]} /><meshStandardMaterial color="#1d1f22" roughness={0.9} /></mesh>
      {/* белый кузов */}
      <mesh position={[0, 0.52, 0]} castShadow><boxGeometry args={[2.4, 0.5, 1.04]} /><meshStandardMaterial {...body} /></mesh>
      {/* остеклённая надстройка (наклон к корме) */}
      <mesh position={[-0.1, 0.92, 0]}><boxGeometry args={[1.5, 0.44, 0.98]} /><meshStandardMaterial color="#2b3138" metalness={0.3} roughness={0.3} /></mesh>
      {/* чёрная крыша */}
      <mesh position={[0.05, 1.16, 0]} castShadow><boxGeometry args={[1.3, 0.12, 1.02]} /><meshStandardMaterial color={black} roughness={0.5} /></mesh>
      <mesh position={[-0.62, 1.08, 0]} rotation={[0, 0, 0.35]}><boxGeometry args={[0.5, 0.1, 1.0]} /><meshStandardMaterial color={black} roughness={0.5} /></mesh>
      {/* рейлинги */}
      {[0.42, -0.42].map((rz, i) => (
        <mesh key={i} position={[0.05, 1.24, rz]}><boxGeometry args={[1.2, 0.05, 0.05]} /><meshStandardMaterial color="#2a2d31" /></mesh>
      ))}
      {/* крупная решётка */}
      <mesh position={[1.22, 0.46, 0]}><boxGeometry args={[0.08, 0.34, 0.78]} /><meshStandardMaterial color="#202327" metalness={0.4} /></mesh>
      {/* фары (узкие) */}
      {[0.42, -0.42].map((hz, i) => (
        <mesh key={i} position={[1.2, 0.62, hz]}><boxGeometry args={[0.06, 0.08, 0.22]} /><meshStandardMaterial color="#eaf2ff" emissive="#cfe0ff" emissiveIntensity={0.5} /></mesh>
      ))}
      {/* сквозной задний фонарь */}
      <mesh position={[-1.22, 0.6, 0]}><boxGeometry args={[0.05, 0.1, 0.9]} /><meshStandardMaterial color="#c01818" emissive="#c01818" emissiveIntensity={0.4} /></mesh>
      <Wheels wx={0.78} wz={0.54} r={0.26} />
    </group>
  )
}

/** Парковка: асфальт + разметка стояночных мест + автомобили + фонари по кромке. */
function ParkingLot({ x, z }: { x: number; z: number }) {
  const cars = ['#3a6ea5', '#4c8a52', '#9a9ea3']
  const dividers: number[] = [-5, -3, -1, 1, 3, 5]
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[13, 7]} /><meshStandardMaterial color={ASPHALT} roughness={1} /></mesh>
      {/* тонкие белые разделители мест */}
      {dividers.map((mx, i) => (
        <mesh key={`d${i}`} position={[mx, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[0.1, 6.4]} /><meshBasicMaterial color={LINE} /></mesh>
      ))}
      {/* торцевые линии-упоры мест (сверху и снизу ряда) */}
      {[3.2, -3.2].map((cz, i) => (
        <mesh key={`c${i}`} position={[0, 0.05, cz]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[12.4, 0.1]} /><meshBasicMaterial color={LINE} /></mesh>
      ))}
      {/* BMW Z4 и Omoda C5 — на соседних размеченных местах */}
      <BmwZ4 x={-2} z={0} rot={Math.PI / 2} />
      <OmodaC5 x={0} z={0} rot={Math.PI / 2} />
      {/* прочие авто на остальных местах */}
      {cars.map((c, i) => <Car key={i} x={[2, 4, -4][i]} z={0} rot={Math.PI / 2} color={c} />)}
      {/* фонари по кромке парковки */}
      <StreetLamp x={-6.5} z={-4} rot={-Math.PI / 2} />
      <StreetLamp x={6.5} z={-4} rot={Math.PI / 2} />
    </group>
  )
}

/** КПП — пост охраны у ворот. */
function Kpp({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 1.4, 0]} castShadow receiveShadow><boxGeometry args={[2.6, 2.8, 2.6]} /><meshStandardMaterial color="#8a9088" roughness={0.85} /></mesh>
      <mesh position={[0, 2.95, 0]} castShadow><boxGeometry args={[3, 0.3, 3]} /><meshStandardMaterial color={POST} /></mesh>
      {/* остеклённая будка */}
      <mesh position={[0, 1.7, 1.32]}><boxGeometry args={[2, 1.4, 0.06]} /><meshStandardMaterial color="#bcd3e6" emissive="#7fa8c8" emissiveIntensity={0.3} /></mesh>
      <mesh position={[1.32, 1.7, 0]}><boxGeometry args={[0.06, 1.4, 2]} /><meshStandardMaterial color="#bcd3e6" emissive="#7fa8c8" emissiveIntensity={0.3} /></mesh>
      {/* дверь */}
      <mesh position={[-1.32, 1, 0]}><boxGeometry args={[0.06, 2, 0.9]} /><meshStandardMaterial color="#39414a" /></mesh>
    </group>
  )
}

/** Шлагбаум: стойка + полосатая стрела + противовес. */
function Boom({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.6, 0]} castShadow><boxGeometry args={[0.4, 1.2, 0.4]} /><meshStandardMaterial color="#d24a3a" metalness={0.2} /></mesh>
      {/* стрела поперёк проезда */}
      <mesh position={[0, 1.05, 2.4]} castShadow><boxGeometry args={[0.12, 0.12, 4.8]} /><meshStandardMaterial color="#e8e8e8" /></mesh>
      {[0.9, 2.0, 3.1, 4.2].map((dz, i) => (
        <mesh key={i} position={[0, 1.06, dz]}><boxGeometry args={[0.14, 0.14, 0.55]} /><meshStandardMaterial color="#d24a3a" /></mesh>
      ))}
      {/* противовес */}
      <mesh position={[0, 1.05, -0.6]}><boxGeometry args={[0.2, 0.2, 0.7]} /><meshStandardMaterial color="#2a2d31" /></mesh>
    </group>
  )
}

/** Навес с техникой (погрузчик под крышей). */
function Canopy({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      {[[-2.4, -1.6], [2.4, -1.6], [-2.4, 1.6], [2.4, 1.6]].map(([px, pz], i) => (
        <mesh key={i} position={[px, 1.4, pz]} castShadow><boxGeometry args={[0.2, 2.8, 0.2]} /><meshStandardMaterial color={POST} metalness={0.4} /></mesh>
      ))}
      <mesh position={[0, 2.9, 0]} castShadow><boxGeometry args={[5.6, 0.25, 4]} /><meshStandardMaterial color={METAL} metalness={0.3} roughness={0.6} /></mesh>
      {/* погрузчик */}
      <group position={[-0.4, 0, 0]}>
        <mesh position={[0, 0.6, 0]} castShadow><boxGeometry args={[1.6, 0.9, 1]} /><meshStandardMaterial color="#d8b24a" metalness={0.2} roughness={0.6} /></mesh>
        <mesh position={[0.5, 1.2, 0]}><boxGeometry args={[0.5, 0.7, 0.9]} /><meshStandardMaterial color="#33363a" /></mesh>
        <mesh position={[1.1, 0.7, 0]}><boxGeometry args={[0.2, 1.4, 0.9]} /><meshStandardMaterial color="#2a2d31" /></mesh>
        {[[0.5, 0.5], [0.5, -0.5], [-0.5, 0.5], [-0.5, -0.5]].map(([wx, wz], i) => (
          <mesh key={i} position={[wx, 0.25, wz]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.25, 0.25, 0.16, 10]} /><meshStandardMaterial color="#15171a" /></mesh>
        ))}
      </group>
    </group>
  )
}

/** Реалистичная парковая/промышленная скамейка: деревянные рейки на металлических опорах. */
function Bench({ x, z, rot = 0 }: { x: number; z: number; rot?: number }) {
  const wood = { color: WOOD, roughness: 0.95 }
  const frame = { color: METAL, metalness: 0.6, roughness: 0.4 }
  // сиденье — 3 тонкие рейки, спинка — 3 тонкие рейки
  const seatSlats: number[] = [-0.16, 0, 0.16]
  const backSlats: number[] = [0.62, 0.78, 0.94]
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]} scale={1.1}>
      {/* деревянные рейки сиденья */}
      {seatSlats.map((sz, i) => (
        <mesh key={`s${i}`} position={[0, 0.45, sz]} castShadow><boxGeometry args={[1.4, 0.06, 0.12]} /><meshStandardMaterial {...wood} /></mesh>
      ))}
      {/* деревянные рейки спинки (наклон назад) */}
      {backSlats.map((sy, i) => (
        <mesh key={`b${i}`} position={[0, sy, -0.24]} rotation={[0.12, 0, 0]} castShadow><boxGeometry args={[1.4, 0.11, 0.05]} /><meshStandardMaterial {...wood} /></mesh>
      ))}
      {/* металлические торцевые рамы/ноги */}
      {[-0.62, 0.62].map((lx, i) => (
        <group key={`f${i}`} position={[lx, 0, 0]}>
          <mesh position={[0, 0.22, 0.18]} castShadow><boxGeometry args={[0.07, 0.44, 0.07]} /><meshStandardMaterial {...frame} /></mesh>
          <mesh position={[0, 0.22, -0.24]} castShadow><boxGeometry args={[0.07, 0.44, 0.07]} /><meshStandardMaterial {...frame} /></mesh>
          {/* горизонтальная перемычка под сиденьем */}
          <mesh position={[0, 0.42, -0.03]}><boxGeometry args={[0.06, 0.06, 0.5]} /><meshStandardMaterial {...frame} /></mesh>
          {/* стойка спинки */}
          <mesh position={[0, 0.72, -0.28]} rotation={[0.12, 0, 0]}><boxGeometry args={[0.06, 0.62, 0.06]} /><meshStandardMaterial {...frame} /></mesh>
        </group>
      ))}
    </group>
  )
}

/** Уличный фонарь: столб + вынос + плафон со слабым свечением. */
function StreetLamp({ x, z, rot = 0 }: { x: number; z: number; rot?: number }) {
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      {/* база */}
      <mesh position={[0, 0.12, 0]} castShadow><cylinderGeometry args={[0.22, 0.28, 0.24, 10]} /><meshStandardMaterial color={POST} metalness={0.4} roughness={0.6} /></mesh>
      {/* столб */}
      <mesh position={[0, 1.55, 0]} castShadow><cylinderGeometry args={[0.09, 0.11, 3, 10]} /><meshStandardMaterial color={LAMP_POLE} metalness={0.5} roughness={0.5} /></mesh>
      {/* вынос-кронштейн */}
      <mesh position={[0.35, 3.02, 0]} castShadow><boxGeometry args={[0.8, 0.08, 0.08]} /><meshStandardMaterial color={LAMP_POLE} metalness={0.5} roughness={0.5} /></mesh>
      {/* плафон */}
      <mesh position={[0.72, 2.94, 0]} castShadow><boxGeometry args={[0.34, 0.16, 0.24]} /><meshStandardMaterial color="#2a2d31" metalness={0.4} roughness={0.5} /></mesh>
      <mesh position={[0.72, 2.86, 0]}><boxGeometry args={[0.28, 0.06, 0.18]} /><meshStandardMaterial color="#fff4d6" emissive="#ffe9ad" emissiveIntensity={0.9} /></mesh>
    </group>
  )
}

/** Велопарковка: рама-основание с несколькими U-образными дугами. */
function BikeRack({ x, z, rot = 0 }: { x: number; z: number; rot?: number }) {
  const bar = { color: METAL, metalness: 0.6, roughness: 0.4 }
  const arcs: number[] = [-0.9, -0.3, 0.3, 0.9]
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      {/* нижняя направляющая */}
      <mesh position={[0, 0.08, 0]}><boxGeometry args={[2.2, 0.08, 0.08]} /><meshStandardMaterial {...bar} /></mesh>
      {arcs.map((ax, i) => (
        <group key={i} position={[ax, 0, 0]}>
          <mesh position={[-0.16, 0.35, 0]}><boxGeometry args={[0.05, 0.7, 0.05]} /><meshStandardMaterial {...bar} /></mesh>
          <mesh position={[0.16, 0.35, 0]}><boxGeometry args={[0.05, 0.7, 0.05]} /><meshStandardMaterial {...bar} /></mesh>
          <mesh position={[0, 0.7, 0]}><boxGeometry args={[0.37, 0.05, 0.05]} /><meshStandardMaterial {...bar} /></mesh>
        </group>
      ))}
    </group>
  )
}

/** Кашпо/клумба с кустом. */
function Planter({ x, z, s = 1 }: { x: number; z: number; s?: number }) {
  return (
    <group position={[x, 0, z]} scale={s}>
      <mesh position={[0, 0.25, 0]} castShadow receiveShadow><boxGeometry args={[0.9, 0.5, 0.9]} /><meshStandardMaterial color="#7c6a52" roughness={0.9} /></mesh>
      <mesh position={[0, 0.72, 0]} castShadow><sphereGeometry args={[0.55, 9, 7]} /><meshStandardMaterial color={SHRUB} roughness={1} /></mesh>
      <mesh position={[0.3, 0.62, 0.22]} castShadow><sphereGeometry args={[0.34, 8, 6]} /><meshStandardMaterial color="#4c8a4a" roughness={1} /></mesh>
      <mesh position={[-0.28, 0.66, -0.2]} castShadow><sphereGeometry args={[0.3, 8, 6]} /><meshStandardMaterial color="#357a34" roughness={1} /></mesh>
    </group>
  )
}

/** Информационный щит / указатель. */
function SignBoard({ x, z, rot = 0 }: { x: number; z: number; rot?: number }) {
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      {[-0.55, 0.55].map((px, i) => (
        <mesh key={i} position={[px, 0.8, 0]} castShadow><cylinderGeometry args={[0.06, 0.06, 1.6, 8]} /><meshStandardMaterial color={POST} metalness={0.4} /></mesh>
      ))}
      <mesh position={[0, 1.5, 0]} castShadow><boxGeometry args={[1.5, 0.9, 0.08]} /><meshStandardMaterial color="#2b5c8a" metalness={0.2} roughness={0.6} /></mesh>
      <mesh position={[0, 1.5, 0.05]}><boxGeometry args={[1.3, 0.7, 0.02]} /><meshStandardMaterial color="#eef2f5" emissive="#c9d6df" emissiveIntensity={0.15} /></mesh>
    </group>
  )
}

/** Безопасный столбик-болард. */
function Bollard({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.4, 0]} castShadow><cylinderGeometry args={[0.1, 0.12, 0.8, 10]} /><meshStandardMaterial color="#d8b23a" metalness={0.3} roughness={0.5} /></mesh>
      <mesh position={[0, 0.62, 0]}><cylinderGeometry args={[0.105, 0.105, 0.12, 10]} /><meshStandardMaterial color="#1c1e20" roughness={0.8} /></mesh>
    </group>
  )
}

/** Ряд болардов вдоль пешеходной кромки. */
function BollardRow({ x, z, count = 4, gap = 1.2, rot = 0 }: { x: number; z: number; count?: number; gap?: number; rot?: number }) {
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      {Array.from({ length: count }, (_, i) => (
        <Bollard key={i} x={(i - (count - 1) / 2) * gap} z={0} />
      ))}
    </group>
  )
}

/** Остановка/навес автобусного типа: крыша на стойках + скамейка + боковая стенка. */
function BusShelter({ x, z, rot = 0 }: { x: number; z: number; rot?: number }) {
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      {/* стойки */}
      {[[-1.6, -0.7], [1.6, -0.7], [-1.6, 0.7], [1.6, 0.7]].map(([px, pz], i) => (
        <mesh key={i} position={[px, 1.15, pz]} castShadow><boxGeometry args={[0.1, 2.3, 0.1]} /><meshStandardMaterial color={POST} metalness={0.4} /></mesh>
      ))}
      {/* крыша */}
      <mesh position={[0, 2.35, 0]} castShadow><boxGeometry args={[3.6, 0.14, 1.8]} /><meshStandardMaterial color={METAL} metalness={0.3} roughness={0.6} /></mesh>
      {/* задняя остеклённая стенка */}
      <mesh position={[0, 1.3, -0.72]}><boxGeometry args={[3.4, 1.9, 0.05]} /><meshStandardMaterial color="#bcd3e6" emissive="#7fa8c8" emissiveIntensity={0.22} transparent opacity={0.7} /></mesh>
      {/* боковая остеклённая стенка */}
      <mesh position={[-1.62, 1.3, 0]}><boxGeometry args={[0.05, 1.9, 1.5]} /><meshStandardMaterial color="#bcd3e6" emissive="#7fa8c8" emissiveIntensity={0.22} transparent opacity={0.7} /></mesh>
      <Bench x={0} z={-0.4} />
    </group>
  )
}

/** Курилка: навес + скамейка + урна. */
function SmokingSpot({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      {[[-1.3, -1], [1.3, -1], [-1.3, 1], [1.3, 1]].map(([px, pz], i) => (
        <mesh key={i} position={[px, 1.1, pz]}><boxGeometry args={[0.12, 2.2, 0.12]} /><meshStandardMaterial color={POST} /></mesh>
      ))}
      <mesh position={[0, 2.25, 0]} castShadow><boxGeometry args={[3, 0.18, 2.6]} /><meshStandardMaterial color="#3f6b6e" metalness={0.2} roughness={0.7} /></mesh>
      <Bench x={0} z={-0.5} />
      {/* урна */}
      <mesh position={[1, 0.4, 0.6]}><cylinderGeometry args={[0.22, 0.18, 0.8, 12]} /><meshStandardMaterial color="#3a3d40" metalness={0.4} /></mesh>
    </group>
  )
}

interface DecorationsProps { minX: number; maxX: number; minZ: number; maxZ: number; gMid: number }

/** Декорации территории: размещаются в «дворовой» полосе между цехами и забором. */
export function Decorations({ minX, maxX, minZ, maxZ, gMid }: DecorationsProps) {
  return (
    <group>
      {/* Въездная группа у ворот (сторона +X) */}
      <Kpp x={maxX - 4.5} z={gMid + 4.5} />
      <Boom x={maxX - 5} z={gMid - 2.4} />
      <ParkingLot x={maxX - 13} z={minZ + 9} />

      {/* Навесы с техникой */}
      <Canopy x={maxX - 12} z={maxZ - 9} />
      <Canopy x={minX + 12} z={minZ + 9} />

      {/* Аллея фонарей вдоль пешеходной оси у офиса/въезда */}
      <StreetLamp x={maxX - 9} z={gMid + 8} rot={Math.PI} />
      <StreetLamp x={maxX - 9} z={gMid - 8} rot={Math.PI} />
      <StreetLamp x={maxX - 18} z={gMid + 8} rot={Math.PI} />

      {/* Скамейки — у офиса/въезда и вдоль дорожек, со слабым разбросом поворота */}
      <Bench x={maxX - 9} z={gMid + 5} rot={Math.PI / 2 + (hash(1) - 0.5) * 0.3} />
      <Bench x={maxX - 9} z={gMid - 5} rot={-Math.PI / 2 + (hash(2) - 0.5) * 0.3} />
      <Bench x={minX + 13} z={gMid} rot={Math.PI / 2 + (hash(3) - 0.5) * 0.3} />
      <Bench x={-8} z={maxZ - 6} rot={(hash(4) - 0.5) * 0.3} />
      <Bench x={9} z={maxZ - 6} rot={Math.PI + (hash(5) - 0.5) * 0.3} />

      {/* Велопарковка и указатель у входной зоны */}
      <BikeRack x={maxX - 15} z={gMid + 6} rot={Math.PI / 2} />
      <SignBoard x={maxX - 7} z={gMid + 7} rot={-Math.PI / 2 + 0.2} />

      {/* Кашпо/кусты для озеленения площадок */}
      <Planter x={maxX - 10.5} z={gMid + 3} />
      <Planter x={maxX - 10.5} z={gMid - 3} s={0.9} />
      <Planter x={minX + 15} z={gMid - 2} s={1.1} />
      <Planter x={-6} z={maxZ - 6} />

      {/* Болларды вдоль пешеходной кромки у ворот */}
      <BollardRow x={maxX - 8} z={gMid} count={5} gap={1.4} />

      {/* Остановка автобусного типа у въезда */}
      <BusShelter x={maxX - 20} z={gMid + 7} rot={Math.PI} />

      {/* Курилки */}
      <SmokingSpot x={minX + 12} z={maxZ - 8} />
      <SmokingSpot x={12} z={minZ + 8} />
    </group>
  )
}
