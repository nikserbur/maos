import type { ObjectKind } from './types'

interface BuildingProps {
  kind: ObjectKind
  /** Цвет акцента по статусу (полоса на фасаде). */
  accent: string
}

const CONCRETE = '#9aa1a8'
const STEEL = '#7f8893'
const DARK = '#4a515a'
const RUST = '#8a6b5a'

/** Цветная статус-полоса на фасаде. */
function Band({ w, y, d, accent }: { w: number; y: number; d: number; accent: string }) {
  return (
    <mesh position={[0, y, d / 2 + 0.03]}>
      <boxGeometry args={[w * 0.85, 0.4, 0.06]} />
      <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.35} />
    </mesh>
  )
}

function Stack({ x, z, h, r = 0.5, banded = false }: { x: number; z: number; h: number; r?: number; banded?: boolean }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, h / 2, 0]} castShadow>
        <cylinderGeometry args={[r * 0.85, r, h, 16]} />
        <meshStandardMaterial color={banded ? '#b04a3a' : RUST} roughness={0.95} />
      </mesh>
      {banded && (
        <mesh position={[0, h * 0.7, 0]}>
          <cylinderGeometry args={[r * 0.88, r * 0.88, h * 0.18, 16]} />
          <meshStandardMaterial color="#e8e8e8" />
        </mesh>
      )}
    </group>
  )
}

/** Сырьевой двор: открытые штабели + козловой кран. */
function RawYard({ accent }: { accent: string }) {
  return (
    <group>
      <mesh position={[0, 0.25, 0]} receiveShadow><boxGeometry args={[10, 0.5, 7]} /><meshStandardMaterial color="#5a5f63" roughness={1} /></mesh>
      {/* боковые подпорные стенки */}
      {[-3.4, 3.4].map((z, i) => (
        <mesh key={i} position={[0, 1, z]}><boxGeometry args={[10, 1.6, 0.4]} /><meshStandardMaterial color={CONCRETE} /></mesh>
      ))}
      {/* штабели руды/кокса */}
      {[[-3, 0, 1.6, '#6b5448'], [0.2, 0, 2, '#3c3a38'], [3.2, 0, 1.5, '#7a6a52']].map(([x, z, r, c], i) => (
        <mesh key={i} position={[x as number, (r as number) * 0.6, z as number]} castShadow>
          <coneGeometry args={[r as number, (r as number) * 1.3, 14]} /><meshStandardMaterial color={c as string} roughness={1} />
        </mesh>
      ))}
      {/* козловой кран */}
      {[-4.2, 4.2].map((x, i) => (
        <mesh key={i} position={[x, 2.4, 0]}><boxGeometry args={[0.3, 4.8, 0.3]} /><meshStandardMaterial color={STEEL} metalness={0.4} /></mesh>
      ))}
      <mesh position={[0, 4.7, 0]} castShadow><boxGeometry args={[9, 0.4, 0.5]} /><meshStandardMaterial color={accent} metalness={0.3} /></mesh>
    </group>
  )
}

/** Аглодоменный цех: доменная печь + воздухонагреватели + литейный двор. */
function BlastFurnace({ accent }: { accent: string }) {
  return (
    <group>
      {/* литейный двор */}
      <mesh position={[0, 1.6, 0]} castShadow receiveShadow><boxGeometry args={[7, 3.2, 6]} /><meshStandardMaterial color={STEEL} roughness={0.85} /></mesh>
      <Band w={7} y={2.4} d={6} accent={accent} />
      {/* печь */}
      <mesh position={[-1, 5, 0]} castShadow><cylinderGeometry args={[1.3, 1.7, 9, 18]} /><meshStandardMaterial color={RUST} roughness={0.9} /></mesh>
      <mesh position={[-1, 9.7, 0]} castShadow><cylinderGeometry args={[0.8, 1.1, 1.8, 18]} /><meshStandardMaterial color="#5a4438" /></mesh>
      {/* воздухонагреватели */}
      {[1.6, 2.9, 4.2].map((x, i) => (
        <mesh key={i} position={[x, 4, -1.6]} castShadow><cylinderGeometry args={[0.7, 0.7, 7.5, 14]} /><meshStandardMaterial color="#9a8a6a" roughness={0.9} /></mesh>
      ))}
      <Stack x={3} z={2} h={6} r={0.45} />
    </group>
  )
}

/** Сталеплавильный цех: высокий пролёт + конвертер + труба. */
function SteelShop({ accent }: { accent: string }) {
  return (
    <group>
      <mesh position={[0, 3, 0]} castShadow receiveShadow><boxGeometry args={[8, 6, 6]} /><meshStandardMaterial color={STEEL} roughness={0.85} /></mesh>
      <Band w={8} y={4.4} d={6} accent={accent} />
      {/* фонарь крыши */}
      <mesh position={[0, 6.4, 0]}><boxGeometry args={[8.3, 0.8, 2.2]} /><meshStandardMaterial color="#bcd3e6" emissive="#7fa8c8" emissiveIntensity={0.25} /></mesh>
      {/* конвертер (наклонная груша) */}
      <group position={[3.5, 2, 3.2]} rotation={[0.5, 0, 0]}>
        <mesh castShadow><cylinderGeometry args={[1, 1.3, 2.4, 16]} /><meshStandardMaterial color="#6b6f72" metalness={0.3} roughness={0.6} /></mesh>
        <mesh position={[0, 1.4, 0]}><cylinderGeometry args={[0.5, 1, 0.8, 16]} /><meshStandardMaterial color="#3a3d40" /></mesh>
      </group>
      <Stack x={-3.4} z={-2} h={9} r={0.55} />
    </group>
  )
}

/** Прокатный цех: длинный низкий пролёт со светоаэрационным фонарём. */
function RollingMill({ accent }: { accent: string }) {
  return (
    <group>
      <mesh position={[0, 1.9, 0]} castShadow receiveShadow><boxGeometry args={[13, 3.8, 5]} /><meshStandardMaterial color={STEEL} roughness={0.85} /></mesh>
      <Band w={13} y={2.6} d={5} accent={accent} />
      {/* непрерывный фонарь по коньку */}
      <mesh position={[0, 4, 0]}><boxGeometry args={[13.2, 0.7, 1.5]} /><meshStandardMaterial color="#bcd3e6" emissive="#7fa8c8" emissiveIntensity={0.25} /></mesh>
      {/* вентиляционные дефлекторы */}
      {[-4.5, -1.5, 1.5, 4.5].map((x, i) => (
        <mesh key={i} position={[x, 4.5, 0]}><cylinderGeometry args={[0.28, 0.28, 0.6, 10]} /><meshStandardMaterial color={DARK} /></mesh>
      ))}
      {/* пристройка-бытовка */}
      <mesh position={[7.4, 1.4, 1.2]} castShadow><boxGeometry args={[2, 2.8, 3]} /><meshStandardMaterial color={CONCRETE} /></mesh>
    </group>
  )
}

/** Энергоцех: градирня + котельная + дымовая труба. */
function PowerPlant({ accent }: { accent: string }) {
  return (
    <group>
      {/* котельная */}
      <mesh position={[-1.5, 2.2, 0]} castShadow receiveShadow><boxGeometry args={[6, 4.4, 5]} /><meshStandardMaterial color={STEEL} roughness={0.85} /></mesh>
      <Band w={6} y={3} d={5} accent={accent} />
      {/* градирня (гиперболоид из двух конусов) */}
      <group position={[3.4, 0, 1]}>
        <mesh position={[0, 2.2, 0]} castShadow><cylinderGeometry args={[1.5, 2.4, 4.4, 24, 1, true]} /><meshStandardMaterial color="#b7bdc2" roughness={1} side={2} /></mesh>
        <mesh position={[0, 5.4, 0]} castShadow><cylinderGeometry args={[2, 1.5, 2, 24, 1, true]} /><meshStandardMaterial color="#b7bdc2" roughness={1} side={2} /></mesh>
      </group>
      <Stack x={-3.4} z={-1.6} h={10} r={0.55} banded />
    </group>
  )
}

/** Склад и сбыт: широкий ангар с воротами и погрузочной рампой. */
function Warehouse({ accent }: { accent: string }) {
  return (
    <group>
      <mesh position={[0, 2, 0]} castShadow receiveShadow><boxGeometry args={[11, 4, 7]} /><meshStandardMaterial color={CONCRETE} roughness={0.9} /></mesh>
      <mesh position={[0, 4.15, 0]} castShadow><boxGeometry args={[11.4, 0.4, 7.4]} /><meshStandardMaterial color={DARK} /></mesh>
      <Band w={11} y={3.4} d={7} accent={accent} />
      {/* погрузочные ворота */}
      {[-3.4, 0, 3.4].map((x, i) => (
        <mesh key={i} position={[x, 1.6, 3.52]}><boxGeometry args={[2.4, 3, 0.1]} /><meshStandardMaterial color="#39414a" metalness={0.4} /></mesh>
      ))}
      {/* рампа */}
      <mesh position={[0, 0.45, 4.6]}><boxGeometry args={[11, 0.9, 2]} /><meshStandardMaterial color="#6a7076" /></mesh>
      {/* световые фонари */}
      {[-0.25, 0.05, 0.35].map((f, i) => (
        <mesh key={i} position={[11 * f, 4.4, 0]}><boxGeometry args={[1.8, 0.4, 5]} /><meshStandardMaterial color="#bcd3e6" emissive="#7fa8c8" emissiveIntensity={0.2} /></mesh>
      ))}
    </group>
  )
}

function Generic({ accent }: { accent: string }) {
  return (
    <group>
      <mesh position={[0, 2.5, 0]} castShadow receiveShadow><boxGeometry args={[6, 5, 5]} /><meshStandardMaterial color={STEEL} roughness={0.85} /></mesh>
      <Band w={6} y={3.6} d={5} accent={accent} />
      <Stack x={2} z={-1.5} h={6} />
    </group>
  )
}

/**
 * Здание промплощадки. Силуэт распознаваемо различается по типу цеха
 * (домна / сталеплавильный / прокатный / энерго / сырьевой / склад).
 * Рисуется на верхнем уровне; внутри (drill-down) видно оборудование.
 */
export function Building({ kind, accent }: BuildingProps) {
  switch (kind) {
    case 'feedstock':    return <RawYard accent={accent} />
    case 'dryer':        return <BlastFurnace accent={accent} />
    case 'briquettes':   return <SteelShop accent={accent} />
    case 'pileizer':     return <RollingMill accent={accent} />
    case 'boiler':       return <PowerPlant accent={accent} />
    case 'wirehouse':    return <Warehouse accent={accent} />
    default:             return <Generic accent={accent} />
  }
}
