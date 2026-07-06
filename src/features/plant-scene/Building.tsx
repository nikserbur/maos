import type { ObjectKind } from './types'

interface BuildingProps {
  kind: ObjectKind
  /** Цвет акцента по статусу (полоса на фасаде). */
  accent: string
}

/* Единая палитра промплощадки: приглушённые фасады, тёмные шиферные крыши,
   стеклянные ленты с лёгкой подсветкой — аккуратный low-poly индустриальный парк. */
const ROOF   = '#3d444d'
const TRIM   = '#59616b'
const PLINTH = '#6a7076'
const GLASS  = '#274050'
const GLOW   = '#7fb2d6'
const DOOR   = '#38556b'

/** Ленточное остекление на длинных фасадах (спереди и сзади). */
function WinBand({ w, y, d, h = 0.7 }: { w: number; y: number; d: number; h?: number }) {
  return (
    <>
      {[d / 2 + 0.04, -d / 2 - 0.04].map((z, i) => (
        <mesh key={i} position={[0, y, z]}>
          <boxGeometry args={[w * 0.86, h, 0.06]} />
          <meshStandardMaterial color={GLASS} emissive={GLOW} emissiveIntensity={0.16} roughness={0.35} metalness={0.2} />
        </mesh>
      ))}
    </>
  )
}

/** Секционные ворота. */
function RollerDoor({ x, z, w = 2.2, h = 2.6, ry = 0 }: { x: number; z: number; w?: number; h?: number; ry?: number }) {
  return (
    <group position={[x, h / 2, z]} rotation={[0, ry, 0]}>
      <mesh><boxGeometry args={[w, h, 0.08]} /><meshStandardMaterial color={DOOR} metalness={0.35} roughness={0.55} /></mesh>
      {[0.25, 0.5, 0.75].map((f, i) => (
        <mesh key={i} position={[0, h * (f - 0.5), 0.05]}><boxGeometry args={[w * 0.94, 0.05, 0.02]} /><meshStandardMaterial color="#2a3d4d" /></mesh>
      ))}
    </group>
  )
}

/** Тонкая статус-полоса над воротами/входом. */
function Band({ w, y, d, accent }: { w: number; y: number; d: number; accent: string }) {
  return (
    <mesh position={[0, y, d / 2 + 0.05]}>
      <boxGeometry args={[w * 0.9, 0.22, 0.05]} />
      <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.45} />
    </mesh>
  )
}

/** Цоколь-плита под зданием (аккуратная кромка). */
function Plinth({ w, d }: { w: number; d: number }) {
  return (
    <mesh position={[0, 0.12, 0]} receiveShadow>
      <boxGeometry args={[w + 0.6, 0.24, d + 0.6]} />
      <meshStandardMaterial color={PLINTH} roughness={0.95} />
    </mesh>
  )
}

/** Крышные блоки (вентустановки/кондиционеры) — оживляют плоскую кровлю. */
function RoofUnits({ y, xs, z = 0 }: { y: number; xs: number[]; z?: number }) {
  return (
    <>
      {xs.map((x, i) => (
        <group key={i} position={[x, y, z + (i % 2 ? 1.1 : -1)]}>
          <mesh castShadow><boxGeometry args={[1, 0.6, 1]} /><meshStandardMaterial color="#828a93" metalness={0.25} roughness={0.6} /></mesh>
          <mesh position={[0, 0.34, 0]}><cylinderGeometry args={[0.32, 0.32, 0.1, 12]} /><meshStandardMaterial color="#4a525b" /></mesh>
        </group>
      ))}
    </>
  )
}

/** Треугольная призма (двускатная крыша / зуб шеда): цилиндр с 3 гранями. */
function Prism({ w, h, len, y, x = 0, z = 0, color = ROOF }: {
  w: number; h: number; len: number; y: number; x?: number; z?: number; color?: string
}) {
  return (
    <mesh position={[x, y, z]} rotation={[0, 0, Math.PI / 2]} scale={[h / 0.5, 1, w / 0.866]} castShadow>
      <cylinderGeometry args={[0.5, 0.5, len, 3]} />
      <meshStandardMaterial color={color} roughness={0.9} flatShading />
    </mesh>
  )
}

/* ── Склад / логистика: светлый ангар с рампой и тремя воротами ─────────────── */
function Warehouse({ accent }: { accent: string }) {
  const W = 12, D = 8, H = 4.2
  return (
    <group>
      <Plinth w={W} d={D} />
      <mesh position={[0, H / 2 + 0.2, 0]} castShadow receiveShadow>
        <boxGeometry args={[W, H, D]} /><meshStandardMaterial color="#d6d3cc" roughness={0.85} />
      </mesh>
      {/* парапет и кровля */}
      <mesh position={[0, H + 0.32, 0]}><boxGeometry args={[W + 0.3, 0.28, D + 0.3]} /><meshStandardMaterial color={TRIM} /></mesh>
      <mesh position={[0, H + 0.48, 0]}><boxGeometry args={[W - 0.4, 0.08, D - 0.4]} /><meshStandardMaterial color={ROOF} /></mesh>
      {[-3.4, 0, 3.4].map((x, i) => <RollerDoor key={i} x={x} z={D / 2 + 0.02} />)}
      <Band w={W} y={3.4} d={D} accent={accent} />
      <WinBand w={W} y={3.4} d={-0.12} h={0.55} />
      {/* погрузочная рампа */}
      <mesh position={[0, 0.5, D / 2 + 1.1]} receiveShadow><boxGeometry args={[W - 1, 1, 1.9]} /><meshStandardMaterial color="#7b828a" roughness={0.95} /></mesh>
      {/* офисный блок на углу */}
      <group position={[-W / 2 + 1.6, 0, -D / 2 + 1.4]}>
        <mesh position={[0, H + 0.9, 0]} castShadow><boxGeometry args={[3, 1.4, 2.6]} /><meshStandardMaterial color="#c2bcb2" /></mesh>
        <mesh position={[0, H + 0.9, 1.34]}><boxGeometry args={[2.6, 0.6, 0.06]} /><meshStandardMaterial color={GLASS} emissive={GLOW} emissiveIntensity={0.16} /></mesh>
      </group>
      <RoofUnits y={H + 0.75} xs={[2, 4.5]} />
    </group>
  )
}

/* ── Механосборочный корпус: шедовая (пилообразная) крыша с фонарями ────────── */
function SawtoothMill({ accent }: { accent: string }) {
  const W = 12, D = 8.5, H = 3.8
  const teeth = [-4.5, -1.5, 1.5, 4.5]
  return (
    <group>
      <Plinth w={W} d={D} />
      <mesh position={[0, H / 2 + 0.2, 0]} castShadow receiveShadow>
        <boxGeometry args={[W, H, D]} /><meshStandardMaterial color="#cfc4ae" roughness={0.85} />
      </mesh>
      {/* зубья шеда + стеклянные фонари на крутых гранях */}
      {teeth.map((x, i) => (
        <group key={i}>
          <Prism w={2.9} h={1.35} len={D - 0.3} y={H + 0.2 + 0.62} x={x} />
          <mesh position={[x - 1.05, H + 0.2 + 0.7, 0]} rotation={[0, 0, 0.42]}>
            <boxGeometry args={[0.06, 1.15, D - 0.9]} />
            <meshStandardMaterial color={GLASS} emissive={GLOW} emissiveIntensity={0.22} roughness={0.3} />
          </mesh>
        </group>
      ))}
      <WinBand w={W} y={2.6} d={D} />
      <Band w={W} y={3.55} d={D} accent={accent} />
      <RollerDoor x={W / 2 + 0.02} z={0} w={2.4} h={2.8} ry={Math.PI / 2} />
      {/* пара тонких вытяжных труб */}
      {[[-5, -3], [-3.6, -3.4]].map(([x, z], i) => (
        <mesh key={i} position={[x, H + 1.6, z]} castShadow>
          <cylinderGeometry args={[0.16, 0.2, 2.6, 10]} /><meshStandardMaterial color={TRIM} metalness={0.4} roughness={0.5} />
        </mesh>
      ))}
    </group>
  )
}

/* ── Высокий пролёт (заготовка/сварка): двускатный корпус + пристройка ──────── */
function HighBay({ accent }: { accent: string }) {
  const W = 10, D = 7.5, H = 5.6
  return (
    <group>
      <Plinth w={W} d={D} />
      <mesh position={[0, H / 2 + 0.2, 0]} castShadow receiveShadow>
        <boxGeometry args={[W, H, D]} /><meshStandardMaterial color="#aebbc7" roughness={0.85} />
      </mesh>
      <Prism w={D + 0.4} h={1.5} len={W + 0.3} y={H + 0.2 + 0.68} />
      {/* световой фонарь по коньку */}
      <mesh position={[0, H + 1.65, 0]}><boxGeometry args={[W * 0.7, 0.5, 1.1]} /><meshStandardMaterial color={GLASS} emissive={GLOW} emissiveIntensity={0.2} /></mesh>
      {/* клересторий под карнизом + кирпичный трим */}
      <WinBand w={W} y={H - 0.85} d={D} />
      <mesh position={[0, 1.15, D / 2 + 0.03]}><boxGeometry args={[W * 0.98, 2.3, 0.05]} /><meshStandardMaterial color="#a86a58" roughness={0.9} /></mesh>
      <RollerDoor x={0} z={D / 2 + 0.06} w={3} h={3.4} />
      <Band w={W} y={4.1} d={D} accent={accent} />
      {/* двухэтажная пристройка */}
      <group position={[W / 2 + 1.15, 0, -1]}>
        <mesh position={[0, 1.5, 0]} castShadow><boxGeometry args={[2.3, 3, 4.5]} /><meshStandardMaterial color="#d6d3cc" /></mesh>
        <mesh position={[0, 3.1, 0]}><boxGeometry args={[2.4, 0.16, 4.6]} /><meshStandardMaterial color={TRIM} /></mesh>
        {[0.9, 2.2].map((y, i) => (
          <mesh key={i} position={[1.18, y, 0]}><boxGeometry args={[0.05, 0.6, 3.8]} /><meshStandardMaterial color={GLASS} emissive={GLOW} emissiveIntensity={0.16} /></mesh>
        ))}
      </group>
    </group>
  )
}

/* ── Термический/гальванический: корпус + печной блок + труба + ресиверы ────── */
function ThermalPlant({ accent }: { accent: string }) {
  const W = 9, D = 7, H = 4.6
  return (
    <group>
      <Plinth w={W + 2} d={D} />
      <mesh position={[-1, H / 2 + 0.2, 0]} castShadow receiveShadow>
        <boxGeometry args={[W, H, D]} /><meshStandardMaterial color="#c2bcb2" roughness={0.85} />
      </mesh>
      <mesh position={[-1, H + 0.32, 0]}><boxGeometry args={[W + 0.3, 0.26, D + 0.3]} /><meshStandardMaterial color={TRIM} /></mesh>
      <WinBand w={W} y={3.2} d={D} />
      <Band w={W - 2} y={3.9} d={D} accent={accent} />
      {/* печной блок — кирпичный, чуть выше корпуса */}
      <mesh position={[4.2, 2.9, -0.6]} castShadow><boxGeometry args={[3.4, 5.8, 4.2]} /><meshStandardMaterial color="#a86a58" roughness={0.92} /></mesh>
      <mesh position={[4.2, 5.95, -0.6]}><boxGeometry args={[3.6, 0.3, 4.4]} /><meshStandardMaterial color={TRIM} /></mesh>
      {/* бетонная труба с тёмным кольцом */}
      <group position={[4.6, 0, 2.2]}>
        <mesh position={[0, 4, 0]} castShadow><cylinderGeometry args={[0.42, 0.55, 8, 14]} /><meshStandardMaterial color="#9aa1a8" roughness={0.95} /></mesh>
        <mesh position={[0, 6.4, 0]}><cylinderGeometry args={[0.46, 0.46, 0.7, 14]} /><meshStandardMaterial color="#5b616a" /></mesh>
      </group>
      {/* газоход печь→труба */}
      <mesh position={[4.4, 4.6, 0.9]} rotation={[0.5, 0, 0]}><cylinderGeometry args={[0.24, 0.24, 2.8, 10]} /><meshStandardMaterial color={TRIM} metalness={0.4} /></mesh>
      {/* горизонтальные ресиверы на опорах */}
      {[-0.4, 1.6].map((z, i) => (
        <group key={i} position={[-4.6, 0.85, z]}>
          <mesh rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.55, 0.55, 2.6, 14]} /><meshStandardMaterial color="#b9c4cf" metalness={0.35} roughness={0.45} /></mesh>
          {[-0.8, 0.8].map((x, j) => (
            <mesh key={j} position={[x, -0.45, 0]}><boxGeometry args={[0.2, 0.8, 0.9]} /><meshStandardMaterial color={PLINTH} /></mesh>
          ))}
        </group>
      ))}
    </group>
  )
}

/* ── Литейный: корпус + башня печи + наклонная галерея ──────────────────────── */
function FoundryTower({ accent }: { accent: string }) {
  const W = 9, D = 7, H = 4.8
  return (
    <group>
      <Plinth w={W} d={D} />
      <mesh position={[-0.8, H / 2 + 0.2, 0]} castShadow receiveShadow>
        <boxGeometry args={[W, H, D]} /><meshStandardMaterial color="#c2bcb2" roughness={0.85} />
      </mesh>
      <Prism w={D + 0.3} h={1.2} len={W + 0.2} y={H + 0.2 + 0.55} x={-0.8} />
      <WinBand w={W - 1.5} y={3.3} d={D} />
      <Band w={W - 2} y={4} d={D} accent={accent} />
      {/* башня печи */}
      <group position={[4.1, 0, -0.8]}>
        <mesh position={[0, 3.6, 0]} castShadow><cylinderGeometry args={[1.15, 1.45, 7.2, 16]} /><meshStandardMaterial color="#8a6b5a" roughness={0.9} /></mesh>
        <mesh position={[0, 7.4, 0]} castShadow><cylinderGeometry args={[0.7, 1, 1.4, 16]} /><meshStandardMaterial color="#5a4438" /></mesh>
      </group>
      {/* наклонная галерея подачи шихты */}
      <mesh position={[1.4, 3.6, 2.4]} rotation={[0, 0.35, 0.62]} castShadow>
        <boxGeometry args={[7.5, 0.7, 1]} /><meshStandardMaterial color={TRIM} metalness={0.3} roughness={0.6} />
      </mesh>
    </group>
  )
}

/* ── Производственно-административный корпус: 2 этажа, ленточные окна ───────── */
function OfficeBlock({ accent }: { accent: string }) {
  const W = 10, D = 7, H = 5.6
  return (
    <group>
      <Plinth w={W} d={D} />
      <mesh position={[0, H / 2 + 0.2, 0]} castShadow receiveShadow>
        <boxGeometry args={[W, H, D]} /><meshStandardMaterial color="#d6d3cc" roughness={0.85} />
      </mesh>
      <mesh position={[0, H + 0.32, 0]}><boxGeometry args={[W + 0.3, 0.26, D + 0.3]} /><meshStandardMaterial color={TRIM} /></mesh>
      <WinBand w={W} y={1.9} d={D} h={0.85} />
      <WinBand w={W} y={4.1} d={D} h={0.85} />
      {/* межэтажный пояс */}
      <mesh position={[0, 3, D / 2 + 0.03]}><boxGeometry args={[W * 0.98, 0.35, 0.04]} /><meshStandardMaterial color={TRIM} /></mesh>
      {/* вход с козырьком */}
      <mesh position={[0, 1.1, D / 2 + 0.06]}><boxGeometry args={[1.6, 2.2, 0.08]} /><meshStandardMaterial color={GLASS} emissive={GLOW} emissiveIntensity={0.25} /></mesh>
      <mesh position={[0, 2.4, D / 2 + 0.55]} castShadow><boxGeometry args={[2.6, 0.14, 1.2]} /><meshStandardMaterial color={TRIM} /></mesh>
      <Band w={W} y={H - 0.35} d={D} accent={accent} />
      {/* техэтаж на крыше */}
      <mesh position={[-2.4, H + 1, -1]} castShadow><boxGeometry args={[2.6, 1.3, 2.6]} /><meshStandardMaterial color="#b6b0a6" /></mesh>
      <RoofUnits y={H + 0.75} xs={[1.6, 3.4]} />
    </group>
  )
}

/* ── Резервуарный парк: вертикальные ёмкости в обваловке + трубная обвязка ──── */
function TankFarm({ accent }: { accent: string }) {
  const tanks: Array<[number, number, number, number, string]> = [
    [-3.2, -1.6, 1.9, 4.6, '#b9c4cf'], [1.2, -1.6, 1.9, 4.6, '#c9cfd6'],
    [-3.2, 2.6, 1.5, 3.6, '#d6d3cc'], [0.9, 2.6, 1.5, 3.6, '#b9c4cf'],
  ]
  return (
    <group>
      <Plinth w={11.4} d={8.4} />
      {/* обваловка по периметру */}
      {[[-0, -4.5, 11.6, 0.5], [0, 4.5, 11.6, 0.5]].map(([x, z, w, d], i) => (
        <mesh key={`h${i}`} position={[x, 0.5, z]} castShadow><boxGeometry args={[w, 0.7, d]} /><meshStandardMaterial color={PLINTH} roughness={1} /></mesh>
      ))}
      {[[-5.8, 0, 0.5, 9.4], [5.8, 0, 0.5, 9.4]].map(([x, z, w, d], i) => (
        <mesh key={`v${i}`} position={[x, 0.5, z]} castShadow><boxGeometry args={[w, 0.7, d]} /><meshStandardMaterial color={PLINTH} roughness={1} /></mesh>
      ))}
      {tanks.map(([x, z, r, h, c], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, h / 2 + 0.24, 0]} castShadow>
            <cylinderGeometry args={[r, r, h, 20]} /><meshStandardMaterial color={c} metalness={0.3} roughness={0.5} />
          </mesh>
          <mesh position={[0, h + 0.28, 0]}><cylinderGeometry args={[r * 0.99, r * 0.99, 0.16, 20]} /><meshStandardMaterial color={TRIM} /></mesh>
          {/* лестница-полоса */}
          <mesh position={[r - 0.02, h / 2 + 0.24, 0]}><boxGeometry args={[0.1, h, 0.4]} /><meshStandardMaterial color={TRIM} /></mesh>
        </group>
      ))}
      {/* трубная обвязка между ёмкостями */}
      <mesh position={[-1, 0.7, -1.6]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.14, 0.14, 4.4, 10]} /><meshStandardMaterial color={accent} metalness={0.4} /></mesh>
      <mesh position={[-1.1, 0.7, 2.6]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.14, 0.14, 4.2, 10]} /><meshStandardMaterial color={TRIM} metalness={0.4} /></mesh>
    </group>
  )
}

/* ── Энергоблок: корпус + градирня (гиперболоид) + тонкая труба ─────────────── */
function CoolingPlant({ accent }: { accent: string }) {
  const W = 8, D = 6.5, H = 4.4
  return (
    <group>
      <Plinth w={W + 3} d={D} />
      <mesh position={[-1.8, H / 2 + 0.2, 0]} castShadow receiveShadow>
        <boxGeometry args={[W, H, D]} /><meshStandardMaterial color="#aebbc7" roughness={0.85} />
      </mesh>
      <mesh position={[-1.8, H + 0.3, 0]}><boxGeometry args={[W + 0.3, 0.24, D + 0.3]} /><meshStandardMaterial color={TRIM} /></mesh>
      <WinBand w={W} y={3} d={D} />
      <Band w={W - 2} y={3.7} d={D} accent={accent} />
      {/* градирня */}
      <group position={[4.1, 0, 0.4]}>
        <mesh position={[0, 2.3, 0]} castShadow><cylinderGeometry args={[1.6, 2.5, 4.6, 24, 1, true]} /><meshStandardMaterial color="#aeb4ba" roughness={1} side={2} /></mesh>
        <mesh position={[0, 5.6, 0]} castShadow><cylinderGeometry args={[2.1, 1.6, 2, 24, 1, true]} /><meshStandardMaterial color="#aeb4ba" roughness={1} side={2} /></mesh>
      </group>
      {/* тонкая бетонная труба */}
      <group position={[-5.2, 0, -2]}>
        <mesh position={[0, 3.4, 0]} castShadow><cylinderGeometry args={[0.35, 0.46, 6.8, 12]} /><meshStandardMaterial color="#9aa1a8" roughness={0.95} /></mesh>
        <mesh position={[0, 5.4, 0]}><cylinderGeometry args={[0.38, 0.38, 0.55, 12]} /><meshStandardMaterial color="#5b616a" /></mesh>
      </group>
    </group>
  )
}

/* ── Арочный ангар: полуцилиндрический свод, без труб ───────────────────────── */
function ArchHangar({ accent }: { accent: string }) {
  const R = 3.4, L = 11
  return (
    <group>
      <Plinth w={L} d={R * 2} />
      {/* свод: половина цилиндра осью вдоль X */}
      <mesh position={[0, 0.24, 0]} rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow>
        <cylinderGeometry args={[R, R, L, 26, 1, true, 0, Math.PI]} />
        <meshStandardMaterial color="#cfc4ae" roughness={0.85} side={2} />
      </mesh>
      {/* торцы */}
      {[L / 2, -L / 2].map((x, i) => (
        <mesh key={i} position={[x, 0.24, 0]} rotation={[0, (i ? -1 : 1) * Math.PI / 2, 0]}>
          <circleGeometry args={[R, 26, 0, Math.PI]} />
          <meshStandardMaterial color="#c2bcb2" roughness={0.9} side={2} />
        </mesh>
      ))}
      {/* ворота на торце + статус-полоса */}
      <RollerDoor x={L / 2 + 0.04} z={0} w={2.6} h={2.6} ry={Math.PI / 2} />
      <mesh position={[L / 2 + 0.06, 3.1, 0]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[2.4, 0.22, 0.05]} /><meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.45} />
      </mesh>
      {/* световой гребень по коньку */}
      <mesh position={[0, R + 0.14, 0]}><boxGeometry args={[L * 0.72, 0.24, 0.7]} /><meshStandardMaterial color={GLASS} emissive={GLOW} emissiveIntensity={0.2} /></mesh>
    </group>
  )
}

/* ── Ангар с трубами: двускатный корпус + три заводские трубы ───────────────── */
function PipeShed({ accent }: { accent: string }) {
  const W = 10.5, D = 7.5, H = 4
  return (
    <group>
      <Plinth w={W} d={D} />
      <mesh position={[0, H / 2 + 0.2, 0]} castShadow receiveShadow>
        <boxGeometry args={[W, H, D]} /><meshStandardMaterial color="#c2bcb2" roughness={0.85} />
      </mesh>
      <Prism w={D + 0.3} h={1.25} len={W + 0.25} y={H + 0.2 + 0.56} />
      <WinBand w={W} y={2.7} d={D} />
      <Band w={W} y={3.5} d={D} accent={accent} />
      <RollerDoor x={-2.8} z={D / 2 + 0.03} w={2.4} h={2.7} />
      {/* три трубы разной высоты с тёмными кольцами */}
      {[[3.4, -2.2, 4.2], [2.2, -2.6, 3.4], [4.4, -1.2, 2.8]].map(([x, z, h], i) => (
        <group key={i} position={[x, H + 0.2, z]}>
          <mesh position={[0, h / 2, 0]} castShadow><cylinderGeometry args={[0.3, 0.38, h, 12]} /><meshStandardMaterial color="#8b929a" metalness={0.35} roughness={0.6} /></mesh>
          <mesh position={[0, h * 0.8, 0]}><cylinderGeometry args={[0.33, 0.33, 0.3, 12]} /><meshStandardMaterial color="#4a525b" /></mesh>
        </group>
      ))}
    </group>
  )
}

/* ── Сырьевой двор: штабели + козловой кран ─────────────────────────────────── */
function RawYard({ accent }: { accent: string }) {
  return (
    <group>
      <mesh position={[0, 0.25, 0]} receiveShadow><boxGeometry args={[10, 0.5, 7]} /><meshStandardMaterial color="#5a5f63" roughness={1} /></mesh>
      {[-3.4, 3.4].map((z, i) => (
        <mesh key={i} position={[0, 1, z]}><boxGeometry args={[10, 1.6, 0.4]} /><meshStandardMaterial color="#9aa1a8" /></mesh>
      ))}
      {[[-3, 0, 1.6, '#6b5448'], [0.2, 0, 2, '#3c3a38'], [3.2, 0, 1.5, '#7a6a52']].map(([x, z, r, c], i) => (
        <mesh key={i} position={[x as number, (r as number) * 0.6, z as number]} castShadow>
          <coneGeometry args={[r as number, (r as number) * 1.3, 14]} /><meshStandardMaterial color={c as string} roughness={1} />
        </mesh>
      ))}
      {[-4.2, 4.2].map((x, i) => (
        <mesh key={i} position={[x, 2.4, 0]}><boxGeometry args={[0.3, 4.8, 0.3]} /><meshStandardMaterial color={TRIM} metalness={0.4} /></mesh>
      ))}
      <mesh position={[0, 4.7, 0]} castShadow><boxGeometry args={[9, 0.4, 0.5]} /><meshStandardMaterial color={accent} metalness={0.3} /></mesh>
    </group>
  )
}

/** Каталог моделей зданий цеха — для выбора в панели редактора схемы. */
export const SHOP_MODELS: Array<{ kind: ObjectKind; label: string }> = [
  { kind: 'pileizer',     label: 'Шедовый корпус (пилообразная крыша)' },
  { kind: 'briquettes',   label: 'Высокий пролёт (двускатный)' },
  { kind: 'wirehouse',    label: 'Склад-ангар (без труб)' },
  { kind: 'cleaningarea', label: 'Ангар с трубами' },
  { kind: 'finecleaning', label: 'Арочный ангар' },
  { kind: 'marketing',    label: 'Административно-произв. корпус' },
  { kind: 'boiler',       label: 'Термический корпус (печь + труба)' },
  { kind: 'transformer',  label: 'Энергоблок (градирня)' },
  { kind: 'dryer',        label: 'Литейная башня' },
  { kind: 'sale',         label: 'Резервуарный парк' },
  { kind: 'feedstock',    label: 'Сырьевой двор (штабели + кран)' },
]

/**
 * Здание промплощадки. Все 11 видов различимы: ангары с трубами и без, шед,
 * арочный свод, резервуары, градирня, печные корпуса. Вид цеха выбирается
 * в редакторе схемы (org_units.kind) или назначается по роли из названия.
 */
export function Building({ kind, accent }: BuildingProps) {
  switch (kind) {
    case 'feedstock':    return <RawYard accent={accent} />
    case 'dryer':        return <FoundryTower accent={accent} />
    case 'briquettes':   return <HighBay accent={accent} />
    case 'pileizer':     return <SawtoothMill accent={accent} />
    case 'boiler':       return <ThermalPlant accent={accent} />
    case 'wirehouse':    return <Warehouse accent={accent} />
    case 'sale':         return <TankFarm accent={accent} />
    case 'transformer':  return <CoolingPlant accent={accent} />
    case 'finecleaning': return <ArchHangar accent={accent} />
    case 'cleaningarea': return <PipeShed accent={accent} />
    default:             return <OfficeBlock accent={accent} />
  }
}
