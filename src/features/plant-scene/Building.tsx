import type { ObjectKind } from './types'

/** Категория здания по типу узла — задаёт силуэт и пропорции. */
type Cat = 'warehouse' | 'hall' | 'office' | 'substation'

const CATEGORY: Record<ObjectKind, Cat> = {
  feedstock:    'warehouse',
  wirehouse:    'warehouse',
  sale:         'warehouse',
  cleaningarea: 'hall',
  dryer:        'hall',
  boiler:       'hall',
  finecleaning: 'hall',
  briquettes:   'hall',
  pileizer:     'hall',
  transformer:  'substation',
  marketing:    'office',
}

const WALL = { warehouse: '#9aa1a8', hall: '#7f8893', office: '#aeb9c4', substation: '#888f86' }
const ROOF = { warehouse: '#5b6168', hall: '#444b54', office: '#3f4a57', substation: '#4a514c' }

interface BuildingProps {
  kind: ObjectKind
  /** Цвет акцента по статусу (полоса/маркер на здании). */
  accent: string
}

/**
 * Крупное здание промплощадки (цех/склад/корпус/подстанция). Рисуется на
 * верхнем уровне схемы вместо модели оборудования — оборудование видно при
 * заходе внутрь (drill-down). Габариты намеренно большие (грузовик мельче).
 */
export function Building({ kind, accent }: BuildingProps) {
  const cat = CATEGORY[kind] ?? 'hall'
  const wall = WALL[cat], roof = ROOF[cat]

  // Базовые габариты по категории (ширина X, высота Y, глубина Z).
  const dims: Record<Cat, [number, number, number]> = {
    warehouse: [7, 3.8, 5],
    hall:      [6, 5, 5],
    office:    [4.5, 5.5, 4],
    substation:[5, 2.6, 4],
  }
  const [w, h, d] = dims[cat]

  return (
    <group>
      {/* корпус */}
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={wall} roughness={0.85} metalness={0.1} />
      </mesh>
      {/* плоская кровля с парапетом */}
      <mesh position={[0, h + 0.15, 0]} castShadow>
        <boxGeometry args={[w + 0.4, 0.4, d + 0.4]} />
        <meshStandardMaterial color={roof} roughness={0.9} />
      </mesh>
      {/* цветная статус-полоса по фасаду */}
      <mesh position={[0, h * 0.78, d / 2 + 0.03]}>
        <boxGeometry args={[w * 0.92, 0.45, 0.06]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.35} />
      </mesh>

      {cat === 'warehouse' && (
        <group>
          {/* большие раздвижные ворота */}
          <mesh position={[0, 2, d / 2 + 0.04]}>
            <boxGeometry args={[w * 0.5, 4, 0.1]} />
            <meshStandardMaterial color="#3b4148" metalness={0.4} roughness={0.6} />
          </mesh>
          {/* рёбра ангара */}
          {[-0.3, 0, 0.3].map((f, i) => (
            <mesh key={i} position={[w * f, h + 0.4, 0]}>
              <boxGeometry args={[0.25, 0.3, d + 0.4]} />
              <meshStandardMaterial color={roof} />
            </mesh>
          ))}
        </group>
      )}

      {cat === 'hall' && (
        <group>
          {/* дымовая труба */}
          <mesh position={[w * 0.32, h + 2.2, -d * 0.25]} castShadow>
            <cylinderGeometry args={[0.5, 0.65, 4.5, 16]} />
            <meshStandardMaterial color="#8a6b5a" roughness={0.95} />
          </mesh>
          <mesh position={[w * 0.32, h + 4.4, -d * 0.25]}>
            <cylinderGeometry args={[0.55, 0.55, 0.4, 16]} />
            <meshStandardMaterial color="#5a4438" />
          </mesh>
          {/* фонари верхнего света (skylights) */}
          {[-0.25, 0.05, 0.35].map((f, i) => (
            <mesh key={i} position={[w * f, h + 0.45, 0]}>
              <boxGeometry args={[w * 0.18, 0.5, d * 0.7]} />
              <meshStandardMaterial color="#bcd3e6" emissive="#7fa8c8" emissiveIntensity={0.25} />
            </mesh>
          ))}
          {/* ворота цеха */}
          <mesh position={[0, 2.1, d / 2 + 0.04]}>
            <boxGeometry args={[w * 0.32, 4.2, 0.1]} />
            <meshStandardMaterial color="#39414a" metalness={0.4} roughness={0.6} />
          </mesh>
        </group>
      )}

      {cat === 'office' && (
        <group>
          {/* ряды окон */}
          {[0.25, 0.5, 0.75].map((fy, r) =>
            [-0.3, -0.1, 0.1, 0.3].map((fx, c) => (
              <mesh key={`${r}-${c}`} position={[w * fx, h * fy, d / 2 + 0.03]}>
                <boxGeometry args={[w * 0.13, h * 0.12, 0.05]} />
                <meshStandardMaterial color="#cfe2f2" emissive="#9cc0dd" emissiveIntensity={0.3} />
              </mesh>
            )),
          )}
          {/* входной козырёк */}
          <mesh position={[0, 2.4, d / 2 + 0.5]}>
            <boxGeometry args={[w * 0.4, 0.2, 1]} />
            <meshStandardMaterial color={roof} />
          </mesh>
        </group>
      )}

      {cat === 'substation' && (
        <group>
          {/* трансформаторные блоки */}
          {[-1.6, 1.6].map((x, i) => (
            <mesh key={i} position={[x, 1, d / 2 - 0.5]} castShadow>
              <boxGeometry args={[1.8, 2, 1.6]} />
              <meshStandardMaterial color="#6f7670" metalness={0.3} roughness={0.7} />
            </mesh>
          ))}
          {/* изоляторы/опоры */}
          {[-2.4, -0.8, 0.8, 2.4].map((x, i) => (
            <mesh key={i} position={[x, h + 1.2, -d * 0.3]}>
              <cylinderGeometry args={[0.12, 0.12, 2.4, 8]} />
              <meshStandardMaterial color="#cfd4d8" />
            </mesh>
          ))}
        </group>
      )}
    </group>
  )
}
