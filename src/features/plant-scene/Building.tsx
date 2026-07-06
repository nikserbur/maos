import type { ObjectKind } from './types'
import {
  M,
  Railing,
  GroundPipeRack,
  PipeBridge,
  Valve,
  Chimney,
  CoolingTower,
  HotStoves,
  SiloGroup,
  ConveyorGallery,
  SteelHall,
  Substation,
  ControlBuilding,
  DistillationColumn,
  Reactor,
  HorizontalDrum,
  SphereVessel,
  StorageTank,
  TankFarm,
} from './plantKit'

interface BuildingProps {
  kind: ObjectKind
  /** Цвет акцента по статусу (полоса/маяк на кластере). */
  accent: string
}

/* ──────────────────────────────────────────────────────────────────────────
   Building — каждый организационный «здание» теперь читается как настоящий
   технологический КЛАСТЕР нефтепереработки/металлургии: 3–8 единиц
   оборудования из plantKit на общей светло-бетонной подошве, с хотя бы одной
   высокой вертикальной доминантой (колонна/труба/градирня), чтобы силуэт
   читался как завод. Статусный `accent` выражается на каждом кластере
   светящейся статус-полосой/маяком.

   Только три примитива + <meshStandardMaterial>; вся геометрия оборудования
   импортируется из plantKit (здесь не переизобретается). Никаких текстур.
   ────────────────────────────────────────────────────────────────────────── */

/** Светло-бетонная подошва кластера (плита с лёгкой кромкой). */
function Pad({ w, d }: { w: number; d: number }) {
  return (
    <group>
      <mesh position={[0, 0.06, 0]} receiveShadow>
        <boxGeometry args={[w, 0.12, d]} /><meshStandardMaterial {...M.concreteLt()} />
      </mesh>
      <mesh position={[0, 0.14, 0]} receiveShadow>
        <boxGeometry args={[w - 0.5, 0.06, d - 0.5]} /><meshStandardMaterial {...M.concreteMd()} />
      </mesh>
    </group>
  )
}

/**
 * Статусный маяк-полоса: приподнятая светящаяся полоса на столбике у кромки
 * подошвы — единая читаемая точка статуса кластера (цвет = accent).
 */
function StatusBeacon({ x, z, w = 2.2, y = 1.4, accent }: { x: number; z: number; w?: number; y?: number; accent: string }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, y / 2, 0]} castShadow>
        <boxGeometry args={[0.12, y, 0.12]} /><meshStandardMaterial {...M.steel()} />
      </mesh>
      <mesh position={[0, y + 0.18, 0]}>
        <boxGeometry args={[w, 0.32, 0.14]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.55} roughness={0.4} metalness={0.15} />
      </mesh>
      <mesh position={[0, y + 0.18, 0.09]}>
        <boxGeometry args={[w + 0.1, 0.06, 0.02]} /><meshStandardMaterial {...M.steelDark()} />
      </mesh>
    </group>
  )
}

/** Штабель-конус сырья (насыпь). */
function Stockpile({ x, z, r, color, roughness = 0.95 }: { x: number; z: number; r: number; color: string; roughness?: number }) {
  return (
    <mesh position={[x, r * 0.55, z]} castShadow>
      <coneGeometry args={[r, r * 1.1, 16]} /><meshStandardMaterial color={color} roughness={roughness} />
    </mesh>
  )
}

/* ── Двор сырья: силосы + конвейерная галерея + насыпь + козловой портал ────── */
function FeedstockYard({ accent }: { accent: string }) {
  return (
    <group>
      <Pad w={13} d={9.5} />
      <SiloGroup n={4} r={0.95} h={5} gap={0.5} position={[-2.6, 0.14, -2]} />
      {/* конвейер подачи от штабеля к силосам */}
      <ConveyorGallery len={7.5} rise={5.2} position={[-6, 0.14, 2.6]} />
      {/* штабели сырья на открытой площадке */}
      <Stockpile x={3.6} z={2.4} r={1.5} color="#6a7076" />
      <Stockpile x={5.6} z={0.2} r={1.1} color="#6b5448" />
      {/* козловой портал (кран) над штабелями */}
      <group position={[4.4, 0.14, 1.2]}>
        {[-3, 3].map((z, i) => (
          <mesh key={i} position={[0, 2.4, z]} castShadow><boxGeometry args={[0.3, 4.8, 0.3]} /><meshStandardMaterial {...M.steel()} /></mesh>
        ))}
        <mesh position={[0, 4.8, 0]} castShadow><boxGeometry args={[0.4, 0.4, 6.4]} /><meshStandardMaterial {...M.steel()} /></mesh>
        <Railing len={6.4} h={0.5} position={[0, 5, 0]} rotation={[0, Math.PI / 2, 0]} />
      </group>
      <StatusBeacon x={-6} z={-4} accent={accent} />
    </group>
  )
}

/* ── Литейный/домна: воздухонагреватели + печь-реактор + галерея + труба ────── */
function FoundryCluster({ accent }: { accent: string }) {
  return (
    <group>
      <Pad w={13} d={9} />
      {/* каупера (воздухонагреватели) */}
      <HotStoves n={3} r={0.95} h={5.2} gap={0.6} position={[-3.4, 0.14, 2] } />
      {/* доменная печь как высокий реактор-аппарат */}
      <Reactor h={7.2} r={1.35} position={[2.4, 0.14, -1]} />
      {/* наклонный конвейер загрузки шихты */}
      <ConveyorGallery len={6.5} rise={5.4} position={[5.4, 0.14, 2.4]} />
      {/* газоход печь → труба */}
      <PipeBridge len={7} pipes={3} y={4.6} position={[-0.4, 0.14, -3]} />
      {/* высокая дымовая труба (доминанта) */}
      <Chimney h={9.5} r={0.5} striped position={[-5, 0.14, -3.2]} />
      <StatusBeacon x={5.2} z={-3.4} accent={accent} />
    </group>
  )
}

/* ── Термический/энергоблок: котельный корпус + труба + градирня + подстанция ── */
function BoilerCluster({ accent }: { accent: string }) {
  return (
    <group>
      <Pad w={13.5} d={9.5} />
      {/* котельный корпус */}
      <SteelHall w={7} d={5.5} h={5} position={[-3, 0.14, -1.4]} />
      {/* высокая полосатая труба (доминанта) */}
      <Chimney h={10} r={0.5} striped position={[-6, 0.14, 2.6]} />
      {/* градирня */}
      <CoolingTower r={2.1} h={5.4} position={[3.6, 0.14, -1]} />
      {/* магистраль пара котёл → градирня */}
      <PipeBridge len={7.5} pipes={4} y={3.4} position={[0.4, 0.14, 3]} />
      {/* распределительная подстанция */}
      <Substation w={3.6} d={2.6} n={2} position={[5.2, 0.14, 3]} />
      <StatusBeacon x={-6} z={-3.6} accent={accent} />
    </group>
  )
}

/* ── Заготовительно-сварочный: высокий пролёт + 2 трубы + эстакада + друмы ───── */
function HighBayCluster({ accent }: { accent: string }) {
  return (
    <group>
      <Pad w={13} d={9} />
      {/* высокий сварочно-заготовительный пролёт */}
      <SteelHall w={8.5} d={6} h={6.4} position={[-1.4, 0.14, -1.2]} />
      {/* две дымовые трубы (доминанты) */}
      <Chimney h={8.5} r={0.45} striped position={[-5.2, 0.14, 2.8]} />
      <Chimney h={6.4} r={0.38} striped={false} position={[-4, 0.14, 3.4]} />
      {/* наземная трубная эстакада вдоль корпуса */}
      <GroundPipeRack len={9} pipes={4} position={[0, 0.14, 3.4]} />
      {/* горизонтальные ресиверы */}
      <HorizontalDrum len={3.2} r={0.6} position={[4.6, 0.14, -1]} />
      <HorizontalDrum len={2.6} r={0.5} position={[4.6, 0.14, 1.6]} />
      <StatusBeacon x={5.4} z={-3.4} accent={accent} />
    </group>
  )
}

/* ── Механосборочный/прокат: длинный шедовый пролёт + труба + эстакада + конвейер ─ */
function RollingMillCluster({ accent }: { accent: string }) {
  return (
    <group>
      <Pad w={14} d={9} />
      {/* длинный прокатный пролёт с пилообразной кровлей */}
      <SteelHall w={11} d={5.5} h={4.6} sawtooth position={[0, 0.14, -1.4]} />
      {/* дымовая труба (доминанта) */}
      <Chimney h={8} r={0.42} striped position={[-6, 0.14, 2.8]} />
      {/* наземная эстакада труб вдоль стены */}
      <GroundPipeRack len={10} pipes={3} position={[0, 0.14, 2.6]} />
      {/* конвейер отгрузки проката */}
      <ConveyorGallery len={6} rise={3.6} position={[5.6, 0.14, 3]} />
      <StatusBeacon x={-6} z={-3.6} accent={accent} />
    </group>
  )
}

/* ── Печь/арочный (тонкая очистка): 2 колонны + реактор + эстакада + друмы ────── */
function ProcessCluster({ accent }: { accent: string }) {
  return (
    <group>
      <Pad w={13} d={9} />
      {/* две ректификационные колонны (доминанты) */}
      <DistillationColumn h={9} r={0.7} position={[-3.6, 0.14, -1.6]} />
      <DistillationColumn h={7.5} r={0.6} position={[-1.6, 0.14, -2.2]} />
      {/* реактор */}
      <Reactor h={4.6} r={1.05} position={[2.4, 0.14, -0.8]} />
      {/* технологическая эстакада между аппаратами */}
      <PipeBridge len={9} pipes={5} y={3.6} position={[0, 0.14, 2.4]} />
      {/* горизонтальные аппараты-ресиверы */}
      <HorizontalDrum len={3} r={0.55} position={[4.6, 0.14, 2.6]} />
      <HorizontalDrum len={2.4} r={0.45} position={[4.6, 0.14, 0.4]} />
      <StatusBeacon x={-5.6} z={3.4} accent={accent} />
    </group>
  )
}

/* ── Подстанция/энергоблок: градирня + подстанция + операторная + эстакада ───── */
function SubstationCluster({ accent }: { accent: string }) {
  return (
    <group>
      <Pad w={13} d={9.5} />
      {/* градирня (доминанта) */}
      <CoolingTower r={2.2} h={5.6} position={[-3.4, 0.14, -1]} />
      {/* открытая подстанция */}
      <Substation w={4.5} d={3} n={3} position={[3.4, 0.14, -1.4]} />
      {/* здание управления энергоблоком */}
      <ControlBuilding w={5} d={3.4} h={3.6} position={[3, 0.14, 3]} />
      {/* магистральная эстакада */}
      <PipeBridge len={8} pipes={4} y={3.2} position={[-1, 0.14, 3.4]} />
      <StatusBeacon x={-5.6} z={-3.8} accent={accent} />
    </group>
  )
}

/* ── Склад: чистый ангар + погрузочная рампа/навес + пара резервуаров + эстакада ─ */
function WarehouseCluster({ accent }: { accent: string }) {
  return (
    <group>
      <Pad w={13.5} d={9.5} />
      {/* чистый складской корпус */}
      <SteelHall w={9} d={6} h={5} position={[-1.6, 0.14, -1.4]} />
      {/* погрузочная рампа + навес-козырёк перед корпусом */}
      <group position={[-1.6, 0.14, 3]}>
        <mesh position={[0, 0.5, 0]} receiveShadow><boxGeometry args={[8, 1, 1.8]} /><meshStandardMaterial {...M.concreteMd()} /></mesh>
        <mesh position={[0, 3.4, 0.2]} castShadow><boxGeometry args={[8.4, 0.14, 2.4]} /><meshStandardMaterial {...M.roof()} /></mesh>
        {[-3.6, 0, 3.6].map((x, i) => (
          <mesh key={i} position={[x, 1.8, 1.1]} castShadow><boxGeometry args={[0.16, 3.4, 0.16]} /><meshStandardMaterial {...M.steel()} /></mesh>
        ))}
      </group>
      {/* пара вертикальных резервуаров сбоку */}
      <StorageTank r={1.4} h={3} position={[5, 0.14, -2]} />
      <StorageTank r={1.2} h={2.6} position={[5, 0.14, 1]} />
      {/* наземная эстакада к резервуарам */}
      <GroundPipeRack len={5} pipes={3} position={[3, 0.14, -0.5]} />
      <StatusBeacon x={-6} z={-3.6} accent={accent} />
    </group>
  )
}

/* ── Резервуарный парк/отгрузка: TankFarm + сферы в обваловке + манифольд ─────── */
function SaleCluster({ accent }: { accent: string }) {
  return (
    <group>
      <Pad w={14} d={9.5} />
      {/* резервуарный парк (4 вертикальных резервуара в обваловке) */}
      <TankFarm n={4} r={1.5} h={3.2} gap={1} position={[-1.4, 0.14, -1.6]} />
      {/* пара сферических резервуаров */}
      <SphereVessel r={1.5} position={[4.4, 0.14, -1.6]} />
      <SphereVessel r={1.2} position={[4.4, 0.14, 2]} />
      {/* трубный манифольд отгрузки + вентили */}
      <GroundPipeRack len={11} pipes={4} position={[0, 0.14, 3.4]} />
      <Valve position={[-3, 0.6, 3.4]} r={0.14} />
      <Valve position={[0, 0.6, 3.4]} r={0.14} />
      <Valve position={[3, 0.6, 3.4]} r={0.14} />
      <StatusBeacon x={-6} z={-3.8} accent={accent} />
    </group>
  )
}

/* ── Корпус/АСУ: операторная + входная площадь + колонны позади ──────────────── */
function MarketingCluster({ accent }: { accent: string }) {
  return (
    <group>
      <Pad w={13} d={9} />
      {/* административно-управляющий корпус со светящейся сеткой окон */}
      <ControlBuilding w={7} d={4.5} h={4.4} position={[-1, 0.14, 1.4]} />
      {/* входная площадь перед корпусом */}
      <mesh position={[-1, 0.2, 4.4]} receiveShadow><boxGeometry args={[7.5, 0.08, 2.4]} /><meshStandardMaterial {...M.concreteMd()} /></mesh>
      {[-3.4, 1.4].map((x, i) => (
        <mesh key={i} position={[x, 0.9, 4.4]} castShadow><boxGeometry args={[0.3, 1.4, 0.3]} /><meshStandardMaterial {...M.steel()} /></mesh>
      ))}
      {/* технологические колонны за корпусом (силуэт завода) */}
      <DistillationColumn h={8} r={0.6} position={[3.6, 0.14, -2.6]} />
      <DistillationColumn h={6.5} r={0.5} position={[5.2, 0.14, -2]} />
      <StatusBeacon x={-5.6} z={-3.4} accent={accent} />
    </group>
  )
}

/* ── Обработка/трубная эстакада: колонны + сфера + большая сеть эстакад + реактор ─ */
function PipeworkCluster({ accent }: { accent: string }) {
  return (
    <group>
      <Pad w={13.5} d={9.5} />
      {/* ректификационные колонны (доминанты) */}
      <DistillationColumn h={8.5} r={0.7} position={[-4, 0.14, -1.6]} />
      <DistillationColumn h={7} r={0.55} position={[-2.2, 0.14, -2.4]} />
      {/* сферический резервуар */}
      <SphereVessel r={1.5} position={[4.2, 0.14, -1.4]} />
      {/* реактор */}
      <Reactor h={4.4} r={1} position={[1.2, 0.14, 1] } />
      {/* большая сеть трубных эстакад (крест) */}
      <PipeBridge len={10} pipes={5} y={3.8} position={[0, 0.14, 3.2]} />
      <group position={[-4.4, 0.14, 1.4]} rotation={[0, Math.PI / 2, 0]}>
        <PipeBridge len={7} pipes={3} y={3} />
      </group>
      <StatusBeacon x={5.2} z={3.4} accent={accent} />
    </group>
  )
}

/** Каталог моделей зданий цеха — для выбора в панели редактора схемы. */
export const SHOP_MODELS: Array<{ kind: ObjectKind; label: string }> = [
  { kind: 'pileizer',     label: 'Механосборочный/прокат (длинный шедовый пролёт)' },
  { kind: 'briquettes',   label: 'Заготовительно-сварочный (высокий пролёт)' },
  { kind: 'wirehouse',    label: 'Склад (ангар + рампа + резервуары)' },
  { kind: 'cleaningarea', label: 'Обработка (колонны + трубная эстакада)' },
  { kind: 'finecleaning', label: 'Тонкая очистка (колонны + реактор)' },
  { kind: 'marketing',    label: 'Административный корпус / АСУ' },
  { kind: 'boiler',       label: 'Термический/энергоблок (котёл + труба + градирня)' },
  { kind: 'transformer',  label: 'Подстанция/энергоблок (градирня + РУ)' },
  { kind: 'dryer',        label: 'Литейный/домна (каупера + печь + труба)' },
  { kind: 'sale',         label: 'Резервуарный парк / отгрузка' },
  { kind: 'feedstock',    label: 'Двор сырья (силосы + конвейер + кран)' },
]

/**
 * Здание промплощадки. Каждый вид — самостоятельный технологический кластер из
 * оборудования plantKit на светло-бетонной подошве, с высокой вертикальной
 * доминантой и светящимся статусным маяком (accent). Вид цеха выбирается в
 * редакторе схемы (org_units.kind) или назначается по роли из названия.
 */
export function Building({ kind, accent }: BuildingProps) {
  switch (kind) {
    case 'feedstock':    return <FeedstockYard accent={accent} />
    case 'dryer':        return <FoundryCluster accent={accent} />
    case 'briquettes':   return <HighBayCluster accent={accent} />
    case 'pileizer':     return <RollingMillCluster accent={accent} />
    case 'boiler':       return <BoilerCluster accent={accent} />
    case 'wirehouse':    return <WarehouseCluster accent={accent} />
    case 'sale':         return <SaleCluster accent={accent} />
    case 'transformer':  return <SubstationCluster accent={accent} />
    case 'finecleaning': return <ProcessCluster accent={accent} />
    case 'cleaningarea': return <PipeworkCluster accent={accent} />
    default:             return <MarketingCluster accent={accent} />
  }
}
