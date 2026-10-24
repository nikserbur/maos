/**
 * Узнаваемые процедурные модели оборудования цеха (токарный/фрезерный/ЧПУ/пресс…).
 * Раньше станки рисовались абстрактными GLB-блоками зданий (kind), из-за чего
 * «токарный станок» выглядел как корпус прокатного цеха. Здесь — детализированные
 * архетипы станков из примитивов: станины, бабки, пульты с экранами, маховики,
 * СОЖ-баки, кабель-каналы, предупредительная разметка, вентиляция, опоры.
 *
 * Материалы без текстур: metalness/roughness читаются как крашеный металл —
 * дёшево и без suspense; равномерный заводской свет их не «пересвечивает».
 * Немного «износа» даём приподнятой roughness на станинах/литье и матовыми
 * резиновыми опорами — так корпус не выглядит как отлитая из пластика коробка.
 */
import type { StageStatus } from '../types'
import { useThemeColors } from '../themeColors'
import { useScenePalette, themed } from '../scenePalette'

/** Палитра станочных материалов (крашеный станочный металл: зелёный/синий + сталь). */
const useC = themed((pal) => ({
  body:    pal.green.m,   // станочно-зелёный (корпус, основной)
  bodyLt:  pal.green.l,   // светлее — литые узлы/бабки
  blue:    pal.blue.d,    // станочно-синий (шкафы/варианты корпуса)
  blueLt:  pal.blue.m,
  panel:   pal.n[7],      // светлые панели/кожухи
  steel:   pal.n[5],      // сталь (станина, направляющие)
  steelLt: pal.n[6],      // полированные направляющие/штоки
  cast:    pal.n[3],      // серый чугун (литьё, печь)
  dark:    pal.n[0],      // тёмный металл / резина
  guard:   pal.yellow.l,  // жёлтые ограждения/предупреждение
  glass:   pal.blue.m,    // остекление кожуха
  screen:  pal.teal.l,    // экран пульта (emissive)
  coolant: pal.teal.m,    // СОЖ
} as const))

type MP = { color: string; metalness?: number; roughness?: number }
/** Материал крашеного металла (по умолчанию — корпус). */
function mat(color: string, metalness = 0.55, roughness = 0.5): MP {
  return { color, metalness, roughness }
}

type Tri = [number, number, number]

/* ── Общие детали ─────────────────────────────────────────────────────────── */

/** Пульт управления: наклонная консоль с экраном, кнопками, кнопкой-грибком и стойкой. */
function ControlPanel({ x = 0, z = 0, ry = 0, on = true }: { x?: number; z?: number; ry?: number; on?: boolean }) {
  const pal = useScenePalette()
  const C = useC()
  return (
    <group position={[x, 0, z]} rotation={[0, ry, 0]}>
      <mesh position={[0, 0.35, 0]}><boxGeometry args={[0.16, 0.7, 0.16]} /><meshStandardMaterial {...mat(C.dark, 0.6, 0.5)} /></mesh>
      <mesh position={[0, 0.95, 0]} castShadow><boxGeometry args={[0.72, 0.6, 0.34]} /><meshStandardMaterial {...mat(C.body)} /></mesh>
      {/* козырёк с экраном */}
      <mesh position={[0, 1.32, 0.07]} rotation={[-0.5, 0, 0]} castShadow>
        <boxGeometry args={[0.66, 0.46, 0.09]} /><meshStandardMaterial {...mat(C.dark, 0.3, 0.4)} />
      </mesh>
      <mesh position={[0, 1.34, 0.13]} rotation={[-0.5, 0, 0]}>
        <planeGeometry args={[0.52, 0.34]} />
        <meshStandardMaterial color={C.screen} emissive={C.screen} emissiveIntensity={on ? 0.9 : 0.05} roughness={0.3} />
      </mesh>
      {/* ряд кнопок */}
      {[-0.2, -0.05, 0.1, 0.25].map((bx, i) => (
        <mesh key={i} position={[bx, 0.98, 0.18]}><cylinderGeometry args={[0.03, 0.03, 0.04, 8]} /><meshStandardMaterial color={i === 0 ? pal.red.m : i === 3 ? pal.green.m : C.steel} metalness={0.4} roughness={0.5} /></mesh>
      ))}
      {/* аварийный грибок E-STOP (красный на жёлтом) */}
      <mesh position={[0.27, 0.68, 0.18]}><cylinderGeometry args={[0.06, 0.06, 0.03, 12]} /><meshStandardMaterial color={C.guard} metalness={0.2} roughness={0.6} /></mesh>
      <mesh position={[0.27, 0.7, 0.19]}><cylinderGeometry args={[0.045, 0.05, 0.05, 12]} /><meshStandardMaterial color={pal.red.m} metalness={0.3} roughness={0.5} /></mesh>
    </group>
  )
}

/** Маячок состояния (цветная лампа-столбик). */
function StatusBeacon({ x = 0, y = 2, z = 0, color }: { x?: number; y?: number; z?: number; color: string }) {
  const C = useC()
  return (
    <group position={[x, y, z]}>
      <mesh position={[0, -0.18, 0]}><cylinderGeometry args={[0.03, 0.03, 0.2, 8]} /><meshStandardMaterial {...mat(C.dark, 0.5, 0.6)} /></mesh>
      <mesh><cylinderGeometry args={[0.09, 0.09, 0.22, 12]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.85} roughness={0.35} /></mesh>
    </group>
  )
}

/** Маховик (спицованное колесо) — подачи/зажимы. */
function Handwheel({ x = 0, y = 0, z = 0, r = 0.16 }: { x?: number; y?: number; z?: number; r?: number }) {
  const C = useC()
  return (
    <group position={[x, y, z]}>
      <mesh castShadow><torusGeometry args={[r, r * 0.2, 8, 18]} /><meshStandardMaterial {...mat(C.dark, 0.5, 0.5)} /></mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} rotation={[0, 0, i * (Math.PI / 3)]}><boxGeometry args={[r * 1.7, 0.035, 0.035]} /><meshStandardMaterial {...mat(C.steel, 0.7, 0.4)} /></mesh>
      ))}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.02]}><cylinderGeometry args={[0.04, 0.04, 0.12, 10]} /><meshStandardMaterial {...mat(C.steel, 0.8, 0.3)} /></mesh>
    </group>
  )
}

/** Жёлтая предупредительная полоса-накладка. */
function WarnStripe({ x = 0, y = 0, z = 0, w = 1, h = 0.1, rot = [0, 0, 0] as Tri }: { x?: number; y?: number; z?: number; w?: number; h?: number; rot?: Tri }) {
  const C = useC()
  return (
    <mesh position={[x, y, z]} rotation={rot}>
      <boxGeometry args={[w, h, 0.04]} /><meshStandardMaterial color={C.guard} metalness={0.2} roughness={0.6} />
    </mesh>
  )
}

/** Вентиляционные жалюзи (несколько тонких планок). */
function Vents({ x = 0, y = 0, z = 0, w = 0.5, n = 4 }: { x?: number; y?: number; z?: number; w?: number; n?: number }) {
  const C = useC()
  return (
    <group position={[x, y, z]}>
      {Array.from({ length: n }, (_, i) => (
        <mesh key={i} position={[0, (i - (n - 1) / 2) * 0.08, 0]}><boxGeometry args={[w, 0.03, 0.02]} /><meshStandardMaterial {...mat(C.dark, 0.4, 0.6)} /></mesh>
      ))}
    </group>
  )
}

/** Опоры-башмаки под станиной (4 шт.). */
function Feet({ w, d, r = 0.12 }: { w: number; d: number; r?: number }) {
  const C = useC()
  const hw = w / 2 - 0.2, hd = d / 2 - 0.2
  return (
    <>
      {([[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]] as [number, number][]).map(([x, z], i) => (
        <mesh key={i} position={[x, 0.06, z]}><cylinderGeometry args={[r, r * 1.2, 0.12, 12]} /><meshStandardMaterial {...mat(C.dark, 0.3, 0.85)} /></mesh>
      ))}
    </>
  )
}

/** Кабель-канал / гофрошланг (наклонная трубка). */
function Cable({ from, to, r = 0.05, color: colorProp }: { from: Tri; to: Tri; r?: number; color?: string }) {
  const C = useC()
  const color = colorProp ?? C.dark
  const mx = (from[0] + to[0]) / 2, my = (from[1] + to[1]) / 2, mz = (from[2] + to[2]) / 2
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2]
  const len = Math.hypot(dx, dy, dz)
  const yaw = Math.atan2(dx, dz)
  const pitch = Math.atan2(Math.hypot(dx, dz), dy)
  return (
    <mesh position={[mx, my, mz]} rotation={[pitch, yaw, 0]}>
      <cylinderGeometry args={[r, r, len, 8]} /><meshStandardMaterial {...mat(color, 0.2, 0.8)} />
    </mesh>
  )
}

/** Стальная станина/основание с фаской-цоколем (снизу чуть у́же — читается как отливка). */
function Base({ w, d, h = 0.5, color: colorProp }: { w: number; d: number; h?: number; color?: string }) {
  const C = useC()
  const color = colorProp ?? C.dark
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} /><meshStandardMaterial {...mat(color, 0.35, 0.65)} />
      </mesh>
      {/* цокольная плита-подошва */}
      <mesh position={[0, 0.045, 0]} receiveShadow>
        <boxGeometry args={[w + 0.12, 0.09, d + 0.12]} /><meshStandardMaterial {...mat(C.dark, 0.3, 0.8)} />
      </mesh>
    </group>
  )
}

/* ── Архетипы станков ─────────────────────────────────────────────────────── */

/** Токарный станок: станина, передняя/задняя бабка, патрон, суппорт, кожух, СОЖ, маховики. */
function Lathe({ beacon }: { beacon: string }) {
  const C = useC()
  return (
    <group>
      {/* тумбы-ножки + поддон для стружки */}
      <mesh position={[-1.1, 0.45, 0]} castShadow><boxGeometry args={[0.55, 0.9, 0.85]} /><meshStandardMaterial {...mat(C.body)} /></mesh>
      <mesh position={[1.1, 0.45, 0]} castShadow><boxGeometry args={[0.55, 0.9, 0.85]} /><meshStandardMaterial {...mat(C.body)} /></mesh>
      <mesh position={[0, 0.55, 0.15]} castShadow><boxGeometry args={[1.9, 0.35, 0.6]} /><meshStandardMaterial {...mat(C.dark, 0.3, 0.7)} /></mesh>
      <WarnStripe x={0} y={0.9} z={0.46} w={2.9} h={0.08} />
      {/* станина + призматические направляющие */}
      <mesh position={[0, 0.95, 0]} castShadow receiveShadow><boxGeometry args={[3, 0.28, 0.7]} /><meshStandardMaterial {...mat(C.cast, 0.55, 0.55)} /></mesh>
      <mesh position={[0, 1.12, 0.16]} castShadow><boxGeometry args={[2.9, 0.08, 0.12]} /><meshStandardMaterial {...mat(C.steelLt, 0.9, 0.2)} /></mesh>
      <mesh position={[0, 1.12, -0.05]} castShadow><boxGeometry args={[2.9, 0.08, 0.1]} /><meshStandardMaterial {...mat(C.steelLt, 0.9, 0.2)} /></mesh>
      {/* ходовой винт под направляющими */}
      <mesh position={[0, 1.0, 0.28]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.05, 0.05, 2.7, 10]} /><meshStandardMaterial {...mat(C.steel, 0.85, 0.3)} /></mesh>
      {/* передняя бабка + патрон с кулачками */}
      <mesh position={[-1.15, 1.45, 0]} castShadow><boxGeometry args={[0.75, 0.75, 0.8]} /><meshStandardMaterial {...mat(C.bodyLt)} /></mesh>
      <Vents x={-1.15} y={1.5} z={0.41} w={0.5} />
      <mesh position={[-0.72, 1.45, 0]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.3, 0.3, 0.24, 24]} /><meshStandardMaterial {...mat(C.steelLt, 0.9, 0.22)} /></mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[-0.6, 1.45, 0]} rotation={[i * (2 * Math.PI / 3), 0, 0]}><boxGeometry args={[0.06, 0.5, 0.08]} /><meshStandardMaterial {...mat(C.dark, 0.6, 0.4)} /></mesh>
      ))}
      {/* пруток в патроне */}
      <mesh position={[-0.35, 1.45, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.05, 0.05, 0.55, 12]} /><meshStandardMaterial {...mat(C.steelLt, 0.9, 0.2)} /></mesh>
      {/* суппорт + резцедержатель */}
      <mesh position={[0.1, 1.28, 0.05]} castShadow><boxGeometry args={[0.4, 0.35, 0.5]} /><meshStandardMaterial {...mat(C.bodyLt)} /></mesh>
      <mesh position={[0.1, 1.5, 0.05]}><boxGeometry args={[0.22, 0.16, 0.22]} /><meshStandardMaterial {...mat(C.steel, 0.7, 0.35)} /></mesh>
      {/* задняя бабка */}
      <mesh position={[1.1, 1.3, 0]} castShadow><boxGeometry args={[0.5, 0.5, 0.55]} /><meshStandardMaterial {...mat(C.bodyLt)} /></mesh>
      <mesh position={[0.72, 1.42, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.06, 0.06, 0.3, 12]} /><meshStandardMaterial {...mat(C.steelLt, 0.9, 0.2)} /></mesh>
      <Handwheel x={1.45} y={1.3} z={0} r={0.14} />
      <Handwheel x={0.35} y={1.15} z={0.3} r={0.13} />
      {/* защитный экран (стекло) на подъёмных стойках */}
      <mesh position={[-0.1, 1.6, -0.42]} castShadow><boxGeometry args={[1.8, 0.95, 0.05]} /><meshStandardMaterial color={C.glass} metalness={0.1} roughness={0.15} transparent opacity={0.5} /></mesh>
      <Cable from={[-1.4, 1.6, -0.3]} to={[-1.9, 0.9, -0.3]} />
      <ControlPanel x={1.75} z={0.25} ry={-0.35} />
      <StatusBeacon x={-1.15} y={2.1} color={beacon} />
    </group>
  )
}

/** Закрытый обрабатывающий центр (фрезерный/ЧПУ/лазер): кабина с окном, вытяжка, СОЖ-бак, пульт. */
function EnclosedCenter({ beacon, body: bodyProp, w = 2.4, tall = 2.3, laser = false }: { beacon: string; body?: string; w?: number; tall?: number; laser?: boolean }) {
  const pal = useScenePalette()
  const C = useC()
  const body = bodyProp ?? C.body
  return (
    <group>
      <Base w={w + 0.2} d={2} />
      <Feet w={w + 0.2} d={2} />
      {/* кабина + карниз-крыша (небольшой свес читается как «крышка», не куб) */}
      <mesh position={[0, tall / 2 + 0.5, 0]} castShadow receiveShadow><boxGeometry args={[w, tall, 1.9]} /><meshStandardMaterial {...mat(body)} /></mesh>
      <mesh position={[0, tall + 0.52, 0]} castShadow><boxGeometry args={[w + 0.12, 0.12, 2.02]} /><meshStandardMaterial {...mat(C.bodyLt)} /></mesh>
      {/* смотровое окно в двери + рамка */}
      <mesh position={[-w * 0.12, tall * 0.62, 0.98]}><boxGeometry args={[w * 0.52, tall * 0.42, 0.04]} /><meshStandardMaterial {...mat(C.dark, 0.5, 0.5)} /></mesh>
      <mesh position={[-w * 0.12, tall * 0.62, 1.0]}><boxGeometry args={[w * 0.46, tall * 0.36, 0.03]} /><meshStandardMaterial color={C.glass} metalness={0.1} roughness={0.15} transparent opacity={0.55} /></mesh>
      {/* стойка двери + ручка */}
      <mesh position={[w * 0.3, tall * 0.5, 0.97]} castShadow><boxGeometry args={[w * 0.34, tall * 0.9, 0.08]} /><meshStandardMaterial {...mat(C.bodyLt)} /></mesh>
      <mesh position={[w * 0.16, tall * 0.5, 1.02]}><boxGeometry args={[0.06, tall * 0.6, 0.06]} /><meshStandardMaterial {...mat(C.steel, 0.9, 0.3)} /></mesh>
      <WarnStripe x={0} y={0.55} z={0.96} w={w} h={0.1} />
      <Vents x={-w * 0.32} y={tall * 0.35} z={0.97} w={w * 0.28} n={5} />
      {/* верхняя вытяжка / кожух ЧПУ */}
      <mesh position={[0, tall + 0.85, 0]} castShadow><boxGeometry args={[w * 0.55, 0.5, 1]} /><meshStandardMaterial {...mat(C.panel, 0.3, 0.6)} /></mesh>
      {laser
        ? <>
            {/* резонатор + луч-указатель вниз */}
            <mesh position={[0, tall + 1.2, 0]} castShadow><boxGeometry args={[0.6, 0.5, 0.6]} /><meshStandardMaterial color={pal.red.m} metalness={0.5} roughness={0.4} /></mesh>
            <mesh position={[0, tall * 0.5 + 0.5, 0]}><cylinderGeometry args={[0.015, 0.015, tall, 6]} /><meshStandardMaterial color={pal.red.m} emissive={pal.red.m} emissiveIntensity={0.7} /></mesh>
          </>
        : <mesh position={[0, tall + 1.2, -0.2]} castShadow><cylinderGeometry args={[0.18, 0.18, 0.7, 12]} /><meshStandardMaterial {...mat(C.steel, 0.5, 0.5)} /></mesh>}
      {/* СОЖ-бак сбоку + патрубок */}
      <mesh position={[-w / 2 - 0.35, 0.75, 0.4]} castShadow><boxGeometry args={[0.55, 1.3, 0.9]} /><meshStandardMaterial {...mat(C.coolant, 0.4, 0.5)} /></mesh>
      <mesh position={[-w / 2 - 0.35, 1.45, 0.4]}><cylinderGeometry args={[0.06, 0.06, 0.14, 10]} /><meshStandardMaterial {...mat(C.dark, 0.4, 0.6)} /></mesh>
      <Cable from={[w / 2, tall * 0.7, 0.4]} to={[w / 2 + 0.55, 1.2, 0.4]} />
      <ControlPanel x={w / 2 + 0.55} z={-0.1} ry={-0.5} />
      <StatusBeacon x={-w * 0.35} y={tall + 1.15} color={beacon} />
    </group>
  )
}

/** Плоскошлифовальный станок: корпус, стол, магнитная плита, бабка с кожухом круга, маховики. */
function Grinder({ beacon }: { beacon: string }) {
  const C = useC()
  return (
    <group>
      <Base w={2.2} d={1.6} h={0.9} color={C.body} />
      <Feet w={2.2} d={1.6} />
      {/* стол + магнитная плита + заготовка */}
      <mesh position={[0, 1.05, 0]} castShadow><boxGeometry args={[1.9, 0.16, 1]} /><meshStandardMaterial {...mat(C.steelLt, 0.85, 0.25)} /></mesh>
      <mesh position={[0, 1.16, 0]} castShadow><boxGeometry args={[1.3, 0.08, 0.7]} /><meshStandardMaterial {...mat(C.dark, 0.6, 0.4)} /></mesh>
      <mesh position={[-0.2, 1.24, 0]}><boxGeometry args={[0.5, 0.1, 0.4]} /><meshStandardMaterial {...mat(C.steel, 0.8, 0.3)} /></mesh>
      {/* стойка бабки */}
      <mesh position={[0, 1.75, -0.5]} castShadow><boxGeometry args={[0.85, 1.4, 0.5]} /><meshStandardMaterial {...mat(C.bodyLt)} /></mesh>
      {/* кожух круга (жёлтый) + сам круг */}
      <mesh position={[0, 1.8, 0.05]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.44, 0.44, 0.32, 22]} /><meshStandardMaterial {...mat(C.guard, 0.4, 0.5)} /></mesh>
      <mesh position={[0, 1.55, 0.05]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.3, 0.3, 0.18, 22]} /><meshStandardMaterial {...mat(C.panel, 0.15, 0.85)} /></mesh>
      <mesh position={[0, 1.55, 0.05]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.1, 0.1, 0.2, 14]} /><meshStandardMaterial {...mat(C.steel, 0.8, 0.3)} /></mesh>
      <Handwheel x={1.05} y={1.0} z={0.3} r={0.16} />
      <Handwheel x={-1.05} y={1.0} z={0.3} r={0.14} />
      <WarnStripe x={0} y={0.9} z={0.81} w={2} h={0.09} />
      <ControlPanel x={1.55} z={0.1} ry={-0.45} />
      <StatusBeacon x={-0.95} y={1.7} color={beacon} />
    </group>
  )
}

/** Гибочный / гидравлический пресс: массивная C-рама, ползун, гидроцилиндр, стол-матрица, педаль. */
function Press({ beacon }: { beacon: string }) {
  const C = useC()
  return (
    <group>
      <Base w={2} d={1.6} h={0.7} />
      {/* колонны рамы */}
      <mesh position={[-0.8, 2, -0.1]} castShadow><boxGeometry args={[0.45, 3.4, 0.85]} /><meshStandardMaterial {...mat(C.blue)} /></mesh>
      <mesh position={[0.8, 2, -0.1]} castShadow><boxGeometry args={[0.45, 3.4, 0.85]} /><meshStandardMaterial {...mat(C.blue)} /></mesh>
      <mesh position={[0, 3.55, -0.1]} castShadow><boxGeometry args={[2.25, 0.75, 0.95]} /><meshStandardMaterial {...mat(C.blueLt)} /></mesh>
      {/* рёбра жёсткости на колоннах */}
      {[-0.8, 0.8].map((x, i) => (<mesh key={i} position={[x, 2, 0.34]}><boxGeometry args={[0.5, 3.2, 0.06]} /><meshStandardMaterial {...mat(C.blueLt, 0.5, 0.5)} /></mesh>))}
      {/* гидроцилиндр + шток */}
      <mesh position={[0, 3.1, 0.05]} castShadow><cylinderGeometry args={[0.28, 0.28, 0.7, 18]} /><meshStandardMaterial {...mat(C.cast, 0.6, 0.4)} /></mesh>
      <mesh position={[0, 2.75, 0.05]}><cylinderGeometry args={[0.1, 0.1, 0.4, 14]} /><meshStandardMaterial {...mat(C.steelLt, 0.9, 0.2)} /></mesh>
      {/* ползун (пуансон) */}
      <mesh position={[0, 2.4, 0.05]} castShadow><boxGeometry args={[1.55, 0.55, 0.55]} /><meshStandardMaterial {...mat(C.steel, 0.8, 0.35)} /></mesh>
      <mesh position={[0, 2.05, 0.05]}><boxGeometry args={[1.3, 0.16, 0.28]} /><meshStandardMaterial {...mat(C.steelLt, 0.85, 0.25)} /></mesh>
      {/* стол-матрица */}
      <mesh position={[0, 1.1, 0.05]} castShadow><boxGeometry args={[1.7, 0.3, 0.65]} /><meshStandardMaterial {...mat(C.dark, 0.6, 0.4)} /></mesh>
      <WarnStripe x={0} y={1.28} z={0.4} w={1.7} h={0.12} />
      {/* педаль */}
      <mesh position={[0, 0.28, 0.9]} castShadow><boxGeometry args={[0.5, 0.12, 0.35]} /><meshStandardMaterial {...mat(C.guard, 0.3, 0.6)} /></mesh>
      <Cable from={[0.8, 3.1, 0.3]} to={[0.8, 1.5, 0.5]} />
      <ControlPanel x={1.55} z={0.6} ry={-0.6} />
      <StatusBeacon x={0} y={4.0} color={beacon} />
    </group>
  )
}

/** Сварочный пост: стол, баллоны газа, аппарат с горелкой, вытяжка, защитная штора. */
function WeldStation({ beacon }: { beacon: string }) {
  const pal = useScenePalette()
  const C = useC()
  return (
    <group>
      <mesh position={[0, 0.85, 0]} castShadow><boxGeometry args={[1.8, 0.14, 1]} /><meshStandardMaterial {...mat(C.dark, 0.6, 0.5)} /></mesh>
      {([[-0.8, -0.4], [0.8, -0.4], [-0.8, 0.4], [0.8, 0.4]] as [number, number][]).map(([x, z], i) => (
        <mesh key={i} position={[x, 0.42, z]}><boxGeometry args={[0.1, 0.85, 0.1]} /><meshStandardMaterial {...mat(C.steel, 0.7, 0.4)} /></mesh>
      ))}
      {/* баллоны газа в стойке + вентили */}
      <mesh position={[-1.2, 0.8, -0.3]} castShadow><cylinderGeometry args={[0.2, 0.2, 1.6, 16]} /><meshStandardMaterial {...mat(pal.green.m, 0.5, 0.5)} /></mesh>
      <mesh position={[-0.85, 0.8, -0.3]} castShadow><cylinderGeometry args={[0.2, 0.2, 1.6, 16]} /><meshStandardMaterial {...mat(pal.orange.m, 0.5, 0.5)} /></mesh>
      <mesh position={[-1.2, 1.66, -0.3]}><cylinderGeometry args={[0.08, 0.1, 0.16, 12]} /><meshStandardMaterial {...mat(C.steel, 0.7, 0.4)} /></mesh>
      <mesh position={[-0.85, 1.66, -0.3]}><cylinderGeometry args={[0.08, 0.1, 0.16, 12]} /><meshStandardMaterial {...mat(C.steel, 0.7, 0.4)} /></mesh>
      <mesh position={[-1.02, 1.15, -0.3]}><boxGeometry args={[0.6, 0.08, 0.2]} /><meshStandardMaterial {...mat(C.dark, 0.5, 0.6)} /></mesh>
      {/* сварочный аппарат-инвертор + катушка проволоки */}
      <mesh position={[1.2, 0.5, -0.2]} castShadow><boxGeometry args={[0.6, 1, 0.55]} /><meshStandardMaterial {...mat(C.blue)} /></mesh>
      <mesh position={[1.2, 1.15, -0.2]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.18, 0.18, 0.14, 16]} /><meshStandardMaterial {...mat(C.dark, 0.4, 0.6)} /></mesh>
      <Vents x={1.2} y={0.6} z={0.08} w={0.4} n={4} />
      <Cable from={[1.0, 0.9, 0]} to={[0.2, 0.95, 0.2]} r={0.04} />
      {/* горелка на столе */}
      <mesh position={[0.2, 0.95, 0.2]} rotation={[0.3, 0, 0.4]}><cylinderGeometry args={[0.03, 0.05, 0.4, 10]} /><meshStandardMaterial {...mat(C.dark, 0.5, 0.5)} /></mesh>
      {/* вытяжной рукав */}
      <mesh position={[0.4, 1.8, -0.3]} rotation={[0.3, 0, 0]} castShadow><cylinderGeometry args={[0.18, 0.22, 1.4, 12]} /><meshStandardMaterial {...mat(C.steel, 0.4, 0.6)} /></mesh>
      {/* защитная штора */}
      <mesh position={[0, 1.4, -0.62]}><boxGeometry args={[1.9, 1.6, 0.05]} /><meshStandardMaterial color={pal.red.d} roughness={0.9} transparent opacity={0.7} /></mesh>
      <StatusBeacon x={1.2} y={1.15} color={beacon} />
    </group>
  )
}

/** Окрасочная камера: бокс с воротами-окном, вытяжные короба, фильтры. */
function PaintBooth({ beacon }: { beacon: string }) {
  const C = useC()
  return (
    <group>
      <mesh position={[0, 1.4, 0]} castShadow receiveShadow><boxGeometry args={[3, 2.8, 2.4]} /><meshStandardMaterial {...mat(C.panel, 0.2, 0.6)} /></mesh>
      {/* угловые стойки */}
      {([[-1.5, -1.2], [1.5, -1.2], [-1.5, 1.2], [1.5, 1.2]] as [number, number][]).map(([x, z], i) => (
        <mesh key={i} position={[x, 1.4, z]}><boxGeometry args={[0.12, 2.85, 0.12]} /><meshStandardMaterial {...mat(C.bodyLt)} /></mesh>
      ))}
      {/* ворота + окно + рамка */}
      <mesh position={[0, 1.3, 1.21]}><boxGeometry args={[2, 2.2, 0.06]} /><meshStandardMaterial {...mat(C.bodyLt, 0.3, 0.5)} /></mesh>
      <mesh position={[0, 1.5, 1.24]}><boxGeometry args={[1.62, 1.42, 0.03]} /><meshStandardMaterial {...mat(C.dark, 0.4, 0.5)} /></mesh>
      <mesh position={[0, 1.5, 1.26]}><planeGeometry args={[1.5, 1.3]} /><meshStandardMaterial color={C.glass} metalness={0.1} roughness={0.2} transparent opacity={0.5} /></mesh>
      <WarnStripe x={0} y={0.25} z={1.22} w={2.9} h={0.14} />
      {/* вытяжные короба + фильтры + факел вентиляции */}
      <mesh position={[-0.8, 3, 0]} castShadow><boxGeometry args={[0.6, 0.6, 1.6]} /><meshStandardMaterial {...mat(C.steel, 0.5, 0.5)} /></mesh>
      <mesh position={[0.8, 3, 0]} castShadow><boxGeometry args={[0.6, 0.6, 1.6]} /><meshStandardMaterial {...mat(C.steel, 0.5, 0.5)} /></mesh>
      <mesh position={[0, 3.35, 0]} castShadow><boxGeometry args={[2.4, 0.25, 1]} /><meshStandardMaterial {...mat(C.panel, 0.2, 0.7)} /></mesh>
      <mesh position={[0.8, 3.9, -0.4]} castShadow><cylinderGeometry args={[0.2, 0.22, 1.2, 14]} /><meshStandardMaterial {...mat(C.steel, 0.4, 0.6)} /></mesh>
      <StatusBeacon x={1.3} y={2.9} color={beacon} />
    </group>
  )
}

/** Сборочный стенд/верстак: столешница, перфопанель с инструментом, тиски, ящики, лампа. */
function AssemblyBench({ beacon }: { beacon: string }) {
  const pal = useScenePalette()
  const C = useC()
  return (
    <group>
      <mesh position={[0, 0.9, 0]} castShadow><boxGeometry args={[2.4, 0.14, 1.1]} /><meshStandardMaterial {...mat(pal.orange.m, 0.2, 0.7)} /></mesh>
      {([[-1.05, -0.45], [1.05, -0.45], [-1.05, 0.45], [1.05, 0.45]] as [number, number][]).map(([x, z], i) => (
        <mesh key={i} position={[x, 0.45, z]}><boxGeometry args={[0.1, 0.9, 0.1]} /><meshStandardMaterial {...mat(C.body)} /></mesh>
      ))}
      {/* перфопанель + полка + инструмент */}
      <mesh position={[0, 1.7, -0.5]} castShadow><boxGeometry args={[2.3, 1.3, 0.08]} /><meshStandardMaterial {...mat(C.blueLt, 0.3, 0.6)} /></mesh>
      <mesh position={[0, 1.35, -0.42]} castShadow><boxGeometry args={[2.1, 0.06, 0.22]} /><meshStandardMaterial {...mat(C.steel, 0.6, 0.4)} /></mesh>
      {[-0.6, -0.2, 0.3, 0.7].map((tx, i) => (
        <mesh key={i} position={[tx, 1.9 - (i % 2) * 0.12, -0.44]}><boxGeometry args={[0.05, 0.3, 0.05]} /><meshStandardMaterial {...mat(C.steel, 0.7, 0.4)} /></mesh>
      ))}
      {/* подвесная лампа-светильник над верстаком */}
      <mesh position={[-0.3, 2.05, -0.35]} rotation={[0.4, 0, 0]}><boxGeometry args={[0.5, 0.1, 0.18]} /><meshStandardMaterial color={pal.yellow.l} emissive={pal.yellow.l} emissiveIntensity={0.5} roughness={0.4} /></mesh>
      {/* тиски */}
      <mesh position={[0.7, 1.05, 0.1]} castShadow><boxGeometry args={[0.35, 0.25, 0.3]} /><meshStandardMaterial {...mat(C.steel, 0.7, 0.4)} /></mesh>
      <Handwheel x={0.95} y={1.1} z={0.1} r={0.1} />
      {/* тумба с ящиками */}
      <mesh position={[-0.8, 0.55, 0.1]} castShadow><boxGeometry args={[0.6, 0.7, 0.8]} /><meshStandardMaterial {...mat(C.blue)} /></mesh>
      {[0.75, 0.5, 0.25].map((y, i) => (<mesh key={i} position={[-0.8, y, 0.51]}><boxGeometry args={[0.5, 0.14, 0.04]} /><meshStandardMaterial {...mat(C.blueLt, 0.3, 0.5)} /></mesh>))}
      <StatusBeacon x={-1.1} y={2.4} color={beacon} />
    </group>
  )
}

/** Термическая печь: футерованный короб, дверь с окном, дымоход, пульт-шкаф. */
function Furnace({ beacon }: { beacon: string }) {
  const pal = useScenePalette()
  const C = useC()
  return (
    <group>
      <Base w={2.6} d={2.2} h={0.5} color={C.cast} />
      <mesh position={[0, 1.8, 0]} castShadow receiveShadow><boxGeometry args={[2.4, 2.4, 2]} /><meshStandardMaterial {...mat(C.cast, 0.25, 0.8)} /></mesh>
      {/* рёбра-стяжки корпуса (по граням) */}
      {[-0.8, 0.8].map((x, i) => (<mesh key={i} position={[x, 1.8, 1.01]}><boxGeometry args={[0.12, 2.4, 0.06]} /><meshStandardMaterial {...mat(C.dark, 0.5, 0.6)} /></mesh>))}
      {[0.62, 1.8, 2.98].map((y, i) => (<mesh key={`h${i}`} position={[0, y, 1.01]}><boxGeometry args={[2.4, 0.1, 0.05]} /><meshStandardMaterial {...mat(C.dark, 0.5, 0.6)} /></mesh>))}
      {/* дверь + окно (раскалённое) */}
      <mesh position={[0, 1.5, 1.03]} castShadow><boxGeometry args={[1.4, 1.5, 0.14]} /><meshStandardMaterial {...mat(C.dark, 0.5, 0.6)} /></mesh>
      <mesh position={[0, 1.7, 1.11]}><planeGeometry args={[0.4, 0.3]} /><meshStandardMaterial color={pal.orange.m} emissive={pal.orange.m} emissiveIntensity={0.9} /></mesh>
      <Handwheel x={0.5} y={1.1} z={1.12} r={0.16} />
      {/* дымоход + оголовок */}
      <mesh position={[0.8, 3.7, -0.6]} castShadow><cylinderGeometry args={[0.22, 0.24, 1.8, 16]} /><meshStandardMaterial {...mat(C.steel, 0.4, 0.6)} /></mesh>
      <mesh position={[0.8, 4.65, -0.6]}><cylinderGeometry args={[0.28, 0.24, 0.16, 16]} /><meshStandardMaterial {...mat(C.dark, 0.4, 0.7)} /></mesh>
      {/* шкаф автоматики */}
      <mesh position={[-1.6, 1.1, 0.4]} castShadow><boxGeometry args={[0.5, 1.8, 0.8]} /><meshStandardMaterial {...mat(C.blue)} /></mesh>
      <Vents x={-1.36} y={1.1} z={0.4} w={0.4} n={4} />
      <StatusBeacon x={-1} y={3.15} color={beacon} />
    </group>
  )
}

/** Гальваническая линия: ряд ванн с растворами, борт-отсосы, мостик. */
function GalvanicTanks({ beacon }: { beacon: string }) {
  const pal = useScenePalette()
  const C = useC()
  const tanks = [pal.teal.m, pal.blue.m, pal.yellow.m]
  return (
    <group>
      <Base w={3.4} d={1.5} h={0.4} />
      {tanks.map((c, i) => (
        <group key={i} position={[-1 + i, 0.9, 0]}>
          <mesh castShadow><boxGeometry args={[0.85, 1, 1.1]} /><meshStandardMaterial {...mat(C.steel, 0.6, 0.4)} /></mesh>
          <mesh position={[0, 0.46, 0]}><boxGeometry args={[0.72, 0.05, 0.95]} /><meshStandardMaterial color={c} emissive={c} emissiveIntensity={0.22} metalness={0.1} roughness={0.15} transparent opacity={0.85} /></mesh>
          {/* подвеска-штанга с деталями над ванной */}
          <mesh position={[0, 0.62, 0]}><boxGeometry args={[0.72, 0.05, 0.05]} /><meshStandardMaterial {...mat(C.steel, 0.7, 0.35)} /></mesh>
          {[-0.18, 0.18].map((dx, k) => (<mesh key={k} position={[dx, 0.5, 0]}><boxGeometry args={[0.05, 0.28, 0.12]} /><meshStandardMaterial {...mat(C.steelLt, 0.8, 0.3)} /></mesh>))}
          {/* борт-отсос */}
          <mesh position={[0, 0.5, -0.58]}><boxGeometry args={[0.85, 0.12, 0.12]} /><meshStandardMaterial {...mat(C.dark, 0.4, 0.6)} /></mesh>
        </group>
      ))}
      {/* мостик перемещения на рельсе */}
      <mesh position={[0, 1.7, 0]} castShadow><boxGeometry args={[3.2, 0.12, 0.2]} /><meshStandardMaterial {...mat(C.guard, 0.4, 0.5)} /></mesh>
      <mesh position={[0, 1.55, -0.55]}><boxGeometry args={[3.3, 0.06, 0.06]} /><meshStandardMaterial {...mat(C.steel, 0.7, 0.35)} /></mesh>
      <StatusBeacon x={-1.7} y={1.85} color={beacon} />
    </group>
  )
}

/** Испытательный стенд: колонны рамы, гидроцилиндр, образец, датчики, пульт. */
function TestRig({ beacon }: { beacon: string }) {
  const C = useC()
  return (
    <group>
      <Base w={1.8} d={1.6} h={0.6} />
      <mesh position={[-0.7, 2, 0]} castShadow><boxGeometry args={[0.35, 3, 0.35]} /><meshStandardMaterial {...mat(C.blue)} /></mesh>
      <mesh position={[0.7, 2, 0]} castShadow><boxGeometry args={[0.35, 3, 0.35]} /><meshStandardMaterial {...mat(C.blue)} /></mesh>
      <mesh position={[0, 3.4, 0]} castShadow><boxGeometry args={[1.7, 0.4, 0.5]} /><meshStandardMaterial {...mat(C.blueLt)} /></mesh>
      {/* гидроцилиндр + шток + захваты + образец */}
      <mesh position={[0, 2.5, 0]} castShadow><cylinderGeometry args={[0.22, 0.22, 1.1, 16]} /><meshStandardMaterial {...mat(C.cast, 0.6, 0.4)} /></mesh>
      <mesh position={[0, 1.6, 0]} castShadow><cylinderGeometry args={[0.08, 0.08, 0.9, 12]} /><meshStandardMaterial {...mat(C.steelLt, 0.9, 0.2)} /></mesh>
      <mesh position={[0, 1.35, 0]}><boxGeometry args={[0.3, 0.18, 0.3]} /><meshStandardMaterial {...mat(C.steel, 0.7, 0.35)} /></mesh>
      <mesh position={[0, 1.15, 0]} castShadow><boxGeometry args={[0.18, 0.3, 0.18]} /><meshStandardMaterial {...mat(C.dark, 0.6, 0.4)} /></mesh>
      <mesh position={[0, 0.9, 0]}><boxGeometry args={[0.3, 0.18, 0.3]} /><meshStandardMaterial {...mat(C.steel, 0.7, 0.35)} /></mesh>
      <Cable from={[0.35, 2.5, 0.1]} to={[1.2, 1.4, 0.3]} r={0.04} />
      <ControlPanel x={1.4} z={0.4} ry={-0.5} />
      <StatusBeacon x={0} y={3.85} color={beacon} />
    </group>
  )
}

/** Линия упаковки: рольганг-конвейер, ролики, обмоточная арка, коробки. */
function PackagingLine({ beacon }: { beacon: string }) {
  const pal = useScenePalette()
  const C = useC()
  return (
    <group>
      <mesh position={[0, 0.8, 0]} castShadow><boxGeometry args={[3.2, 0.18, 0.9]} /><meshStandardMaterial {...mat(C.dark, 0.4, 0.6)} /></mesh>
      {/* боковины рольганга */}
      {[-0.48, 0.48].map((z, i) => (<mesh key={i} position={[0, 0.9, z]}><boxGeometry args={[3.2, 0.16, 0.05]} /><meshStandardMaterial {...mat(C.blue, 0.4, 0.5)} /></mesh>))}
      {[-1.3, -0.65, 0, 0.65, 1.3].map((x, i) => (
        <mesh key={i} position={[x, 0.9, 0]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.1, 0.1, 0.9, 12]} /><meshStandardMaterial {...mat(C.steelLt, 0.85, 0.3)} /></mesh>
      ))}
      {([[-1.4, -0.4], [1.4, -0.4], [-1.4, 0.4], [1.4, 0.4]] as [number, number][]).map(([x, z], i) => (
        <mesh key={i} position={[x, 0.4, z]}><boxGeometry args={[0.1, 0.8, 0.1]} /><meshStandardMaterial {...mat(C.body)} /></mesh>
      ))}
      {/* обмоточная арка */}
      <mesh position={[0.4, 1.6, 0.62]} castShadow><boxGeometry args={[0.12, 1.6, 0.12]} /><meshStandardMaterial {...mat(C.guard, 0.4, 0.5)} /></mesh>
      <mesh position={[0.4, 1.6, -0.62]} castShadow><boxGeometry args={[0.12, 1.6, 0.12]} /><meshStandardMaterial {...mat(C.guard, 0.4, 0.5)} /></mesh>
      <mesh position={[0.4, 2.35, 0]} castShadow><boxGeometry args={[0.12, 0.12, 1.3]} /><meshStandardMaterial {...mat(C.guard, 0.4, 0.5)} /></mesh>
      {/* коробки на ленте + скотч-полоса */}
      <mesh position={[-0.7, 1.1, 0]} castShadow><boxGeometry args={[0.55, 0.5, 0.55]} /><meshStandardMaterial {...mat(pal.orange.l, 0.1, 0.8)} /></mesh>
      <mesh position={[-0.7, 1.36, 0]}><boxGeometry args={[0.56, 0.04, 0.14]} /><meshStandardMaterial {...mat(pal.orange.l, 0.05, 0.7)} /></mesh>
      <mesh position={[1.1, 1.1, 0]} castShadow><boxGeometry args={[0.5, 0.45, 0.5]} /><meshStandardMaterial {...mat(pal.orange.m, 0.1, 0.8)} /></mesh>
      <StatusBeacon x={1.5} y={1.15} color={beacon} />
    </group>
  )
}

/** Складской стеллаж: секции с паллетами и коробами. */
function StorageRack({ beacon }: { beacon: string }) {
  const pal = useScenePalette()
  const C = useC()
  const boxCols = [pal.orange.m, pal.blue.m, pal.green.m]
  return (
    <group>
      {[-1.3, 1.3].map((gx, gi) => (
        <group key={gi} position={[gx, 0, 0]}>
          {([[-0.7, -0.5], [0.7, -0.5], [-0.7, 0.5], [0.7, 0.5]] as [number, number][]).map(([sx, sz], j) => (
            <mesh key={j} position={[sx, 1.5, sz]}><boxGeometry args={[0.1, 3, 0.1]} /><meshStandardMaterial {...mat(pal.orange.m, 0.4, 0.5)} /></mesh>
          ))}
          {/* башмаки под стойками */}
          {([[-0.7, -0.5], [0.7, -0.5], [-0.7, 0.5], [0.7, 0.5]] as [number, number][]).map(([sx, sz], j) => (
            <mesh key={`f${j}`} position={[sx, 0.04, sz]}><boxGeometry args={[0.22, 0.08, 0.22]} /><meshStandardMaterial {...mat(C.dark, 0.3, 0.7)} /></mesh>
          ))}
          {/* поперечины */}
          {[0.75, 1.85, 2.9].map((y, k) => (
            <group key={k}>
              <mesh position={[0, y, -0.5]}><boxGeometry args={[1.5, 0.08, 0.08]} /><meshStandardMaterial {...mat(pal.orange.m, 0.4, 0.5)} /></mesh>
              <mesh position={[0, y, 0.5]}><boxGeometry args={[1.5, 0.08, 0.08]} /><meshStandardMaterial {...mat(pal.orange.m, 0.4, 0.5)} /></mesh>
            </group>
          ))}
          {/* грузы на полках */}
          {[0.8, 1.9].map((y, k) => (
            <mesh key={k} position={[(k % 2 ? 0.35 : -0.35), y + 0.32, 0]} castShadow><boxGeometry args={[0.7, 0.55, 0.85]} /><meshStandardMaterial {...mat(boxCols[(gi + k) % boxCols.length], 0.1, 0.8)} /></mesh>
          ))}
        </group>
      ))}
      <StatusBeacon x={0} y={3.2} color={beacon} />
    </group>
  )
}

/* ── Диспетчеризация ──────────────────────────────────────────────────────── */

export type MachineArch =
  | 'lathe' | 'mill' | 'grinder' | 'press' | 'weld' | 'paint'
  | 'assembly' | 'furnace' | 'laser' | 'galvanic' | 'test' | 'packaging' | 'rack' | 'cnc'

/** Определение архетипа станка по названию типа оборудования (НСИ). */
export function inferMachineArch(name: string): MachineArch {
  const n = (name || '').toLowerCase()
  if (/токарн|lathe/.test(n)) return 'lathe'
  if (/фрезер|mill|обраб.*центр|обрабатывающ/.test(n)) return 'mill'
  if (/шлифов|grind/.test(n)) return 'grinder'
  if (/пресс|гибочн|штампов|press|bend/.test(n)) return 'press'
  if (/сварочн|сварк|weld/.test(n)) return 'weld'
  if (/окрас|покрас|paint/.test(n)) return 'paint'
  if (/сбор|assembl/.test(n)) return 'assembly'
  if (/печь|термическ|термо|обжиг|закал|furnace|kiln/.test(n)) return 'furnace'
  if (/лазер|плазм|резк|laser|plasma|cut/.test(n)) return 'laser'
  if (/гальван|ванн|травлен|galvan|plating/.test(n)) return 'galvanic'
  if (/испытат|стенд|контрол|отк|test|qc/.test(n)) return 'test'
  if (/упаков|фасов|pack/.test(n)) return 'packaging'
  if (/склад|хранен|стеллаж|мтр|warehouse|storage|rack/.test(n)) return 'rack'
  return 'cnc'
}

/** Единый вход: рисует станок по архетипу; статус подсвечивает маячок. */
export function MachineModel({ arch, status }: { arch: MachineArch; status: StageStatus }) {
  const pal = useScenePalette()
  const C = useC()
  const colors = useThemeColors()
  // Цвет статуса — только у отклонений (▲ ТО, ■ авария); штатная работа и вывод — нейтральны.
  const beacon = status === 'setup' || status === 'down' ? colors.status[status] : colors.textMuted
  switch (arch) {
    case 'lathe':     return <Lathe beacon={beacon} />
    case 'mill':      return <EnclosedCenter beacon={beacon} body={C.body} />
    case 'laser':     return <EnclosedCenter beacon={beacon} body={pal.n[2]} w={2.6} tall={2.1} laser />
    case 'grinder':   return <Grinder beacon={beacon} />
    case 'press':     return <Press beacon={beacon} />
    case 'weld':      return <WeldStation beacon={beacon} />
    case 'paint':     return <PaintBooth beacon={beacon} />
    case 'assembly':  return <AssemblyBench beacon={beacon} />
    case 'furnace':   return <Furnace beacon={beacon} />
    case 'galvanic':  return <GalvanicTanks beacon={beacon} />
    case 'test':      return <TestRig beacon={beacon} />
    case 'packaging': return <PackagingLine beacon={beacon} />
    case 'rack':      return <StorageRack beacon={beacon} />
    default:          return <EnclosedCenter beacon={beacon} body={C.blue} />
  }
}
