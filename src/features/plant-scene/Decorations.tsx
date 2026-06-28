const METAL = '#6a7076'
const POST = '#4c5550'
const WOOD = '#6b5436'
const ASPHALT = '#34383d'

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

/** Парковка: асфальт + разметка + ряд машин. */
function ParkingLot({ x, z }: { x: number; z: number }) {
  const cars = ['#b5483a', '#3a6ea5', '#d8b24a', '#4c8a52', '#9a9ea3', '#7a5aa0']
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[12, 7]} /><meshStandardMaterial color={ASPHALT} roughness={1} /></mesh>
      {[-5, -3, -1, 1, 3, 5].map((mx, i) => (
        <mesh key={i} position={[mx, 0.05, -0.3]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[0.12, 5]} /><meshBasicMaterial color="#c7cdd2" /></mesh>
      ))}
      {cars.map((c, i) => <Car key={i} x={-5 + i * 2} z={-1.2} rot={Math.PI / 2} color={c} />)}
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

/** Скамейка. */
function Bench({ x, z, rot = 0 }: { x: number; z: number; rot?: number }) {
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]} scale={1.1}>
      <mesh position={[0, 0.45, 0]}><boxGeometry args={[1.6, 0.1, 0.5]} /><meshStandardMaterial color={WOOD} roughness={1} /></mesh>
      <mesh position={[0, 0.75, -0.22]}><boxGeometry args={[1.6, 0.5, 0.08]} /><meshStandardMaterial color={WOOD} roughness={1} /></mesh>
      {[-0.7, 0.7].map((lx, i) => (
        <mesh key={i} position={[lx, 0.22, 0]}><boxGeometry args={[0.1, 0.44, 0.5]} /><meshStandardMaterial color={POST} /></mesh>
      ))}
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

      {/* Скамейки */}
      <Bench x={minX + 13} z={gMid} rot={Math.PI / 2} />
      <Bench x={-8} z={maxZ - 6} />
      <Bench x={9} z={maxZ - 6} />

      {/* Курилки */}
      <SmokingSpot x={minX + 12} z={maxZ - 8} />
      <SmokingSpot x={12} z={minZ + 8} />
    </group>
  )
}
