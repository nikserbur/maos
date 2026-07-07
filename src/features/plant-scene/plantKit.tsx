/**
 * plantKit — переиспользуемая библиотека «чистой изометрии» технологического
 * оборудования нефтеперерабатывающего / металлургического завода для уличного
 * уровня «площадка».
 *
 * Всё построено из примитивов three (box/cylinder/sphere/cone/torus/ring/plane)
 * и ТОЛЬКО <meshStandardMaterial>. Никаких текстур, картинок, внешних моделей,
 * анимации компоновки и покадровых аллокаций. Любая вариативность —
 * детерминированная (хэш от числовых аргументов); Math.random/Date не
 * используются.
 *
 * Структура: сначала ЗАФИКСИРОВАННАЯ ПАЛИТРА и материал-хелпер `M`, затем ОБЩИЕ
 * ДЕТАЛИ (перила, площадки, лестницы, лестницы-клетки, штуцеры, вентили,
 * отводы), затем все компоненты ОБОРУДОВАНИЯ, переиспользующие общие детали.
 *
 * Каждый компонент принимает числовые размеры с разумными значениями по
 * умолчанию и рендерит <group>; позиции типизированы как [number,number,number].
 * Сплошная геометрия получает castShadow (площадки/подошвы — ещё receiveShadow).
 */
import type { ReactNode } from 'react'

type Vec3 = [number, number, number]

/* ──────────────────────────────────────────────────────────────────────────
   ЗАФИКСИРОВАННАЯ ПАЛИТРА (clean-isometric). Не «плыть» от этих семейств.
   ────────────────────────────────────────────────────────────────────────── */
const C = {
  // Резервуары / ёмкости / сферы
  tankWhite:  '#eceae4',
  tankSilver: '#d7dade',
  tankCream:  '#e7e0d2',
  tankBlue:   '#cdd9e2',
  // Полированная сталь колонн/аппаратов
  polished:   '#c9ced6',
  // Конструктивная сталь (рамы, лестницы, перила, опоры, сёдла, ноги)
  steelMid:   '#7c848c',
  steelDark:  '#3b424a',
  // Технологические трубы (цветовая кодировка)
  pipeBlue:   '#3f7cc0',
  pipeOrange: '#e0863a',
  pipeYellow: '#e2b93a',
  pipeGreen:  '#4f9e6a',
  pipeGray:   '#9aa1a8',
  // Бетон (подошвы, плинтусы, обваловка, дороги)
  concreteLt: '#b7bbc0',
  concreteMd: '#6a7076',
  // Фасады
  facadeWhite: '#e8e6e0',
  facadeGray:  '#c2bcb2',
  facadeOrange:'#d98b45',
  // Освещённые окна
  glass:      '#223240',
  glassGlow:  '#e0b64a',
  frame:      '#444b53',
  // Безопасность / полосатые трубы
  red:        '#c23a2f',
  // Кровля
  roof:       '#3d444d',
  hvac:       '#9aa1a8',
} as const

/**
 * `M` — материал-хелпер. Каждое поле возвращает набор пропсов, которые
 * раскладываются прямо в <meshStandardMaterial {...M.tankWhite()} />. Держит
 * материалы слегка чистыми/глянцевыми ради «3D-render» вида; без текстур.
 */
export const M = {
  tankWhite:  () => ({ color: C.tankWhite,  roughness: 0.5,  metalness: 0.15 }),
  tankSilver: () => ({ color: C.tankSilver, roughness: 0.5,  metalness: 0.15 }),
  tankCream:  () => ({ color: C.tankCream,  roughness: 0.5,  metalness: 0.15 }),
  tankBlue:   () => ({ color: C.tankBlue,   roughness: 0.5,  metalness: 0.15 }),
  polished:   () => ({ color: C.polished,   roughness: 0.35, metalness: 0.4 }),
  steel:      () => ({ color: C.steelMid,   roughness: 0.55, metalness: 0.35 }),
  steelDark:  () => ({ color: C.steelDark,  roughness: 0.55, metalness: 0.35 }),
  pipeBlue:   () => ({ color: C.pipeBlue,   roughness: 0.45, metalness: 0.35 }),
  pipeOrange: () => ({ color: C.pipeOrange, roughness: 0.45, metalness: 0.35 }),
  pipeYellow: () => ({ color: C.pipeYellow, roughness: 0.45, metalness: 0.35 }),
  pipeGreen:  () => ({ color: C.pipeGreen,  roughness: 0.45, metalness: 0.35 }),
  pipeGray:   () => ({ color: C.pipeGray,   roughness: 0.45, metalness: 0.35 }),
  concreteLt: () => ({ color: C.concreteLt, roughness: 0.95 }),
  concreteMd: () => ({ color: C.concreteMd, roughness: 0.95 }),
  facadeWhite:() => ({ color: C.facadeWhite, roughness: 0.8 }),
  facadeGray: () => ({ color: C.facadeGray,  roughness: 0.8 }),
  facadeOrange:() => ({ color: C.facadeOrange, roughness: 0.8 }),
  window:     (glow = 0.5) => ({
    color: C.glass, emissive: C.glassGlow, emissiveIntensity: glow,
    roughness: 0.2, metalness: 0.3,
  }),
  frame:      () => ({ color: C.frame, roughness: 0.55, metalness: 0.3 }),
  red:        () => ({ color: C.red, roughness: 0.5, metalness: 0.1 }),
  roof:       () => ({ color: C.roof, roughness: 0.9 }),
  hvac:       () => ({ color: C.hvac, roughness: 0.6, metalness: 0.25 }),
} as const

/** Цвета технологических труб по индексу — для параллельных ниток. */
const PIPE_COLORS = [C.pipeBlue, C.pipeOrange, C.pipeYellow, C.pipeGreen, C.pipeGray] as const

/** Детерминированный хэш 0..1 из числового seed и ключа. */
function hash01(seed: number, key: number): number {
  const s = Math.sin(seed * 12.9898 + key * 78.233) * 43758.5453
  return s - Math.floor(s)
}

/* ──────────────────────────────────────────────────────────────────────────
   ОБЩИЕ ДЕТАЛИ. Определяются один раз и переиспользуются везде — именно это
   делает сцену похожей на настоящий завод.
   ────────────────────────────────────────────────────────────────────────── */

/**
 * Прямое перильное ограждение вдоль оси X: верхний прогон + промежуточный
 * (kick) прогон + вертикальные стойки примерно каждую 1 единицу. Локально —
 * поручень идёт вдоль X, площадка ниже по Y.
 */
export function Railing({
  len, h = 0.95, position = [0, 0, 0], rotation = [0, 0, 0],
}: { len: number; h?: number; position?: Vec3; rotation?: [number, number, number] }) {
  const n = Math.max(2, Math.round(len))
  const posts = Array.from({ length: n + 1 }, (_, i) => -len / 2 + (i / n) * len)
  return (
    <group position={position} rotation={rotation}>
      <mesh position={[0, h, 0]} castShadow>
        <boxGeometry args={[len, 0.05, 0.05]} /><meshStandardMaterial {...M.steel()} />
      </mesh>
      <mesh position={[0, h * 0.5, 0]}>
        <boxGeometry args={[len, 0.04, 0.04]} /><meshStandardMaterial {...M.steel()} />
      </mesh>
      {posts.map((x, i) => (
        <mesh key={i} position={[x, h / 2, 0]}>
          <boxGeometry args={[0.045, h, 0.045]} /><meshStandardMaterial {...M.steel()} />
        </mesh>
      ))}
    </group>
  )
}

/**
 * Прямоугольная площадка: тонкий настил + перила по периметру. Настил получает
 * receiveShadow (на него ложатся тени оборудования).
 */
export function Platform({
  w, d, h = 0.95, position = [0, 0, 0],
}: { w: number; d: number; h?: number; position?: Vec3 }) {
  return (
    <group position={position}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[w, 0.08, d]} /><meshStandardMaterial {...M.steel()} />
      </mesh>
      <Railing len={w} h={h} position={[0, 0, d / 2]} />
      <Railing len={w} h={h} position={[0, 0, -d / 2]} />
      <Railing len={d} h={h} position={[w / 2, 0, 0]} rotation={[0, Math.PI / 2, 0]} />
      <Railing len={d} h={h} position={[-w / 2, 0, 0]} rotation={[0, Math.PI / 2, 0]} />
    </group>
  )
}

/**
 * Кольцевая площадка вокруг круглой колонны/аппарата: тор-настил + кольцевые
 * перила (стойки по окружности + тор-поручень).
 */
export function RingPlatform({
  r, h = 0.95, width = 0.7, position = [0, 0, 0],
}: { r: number; h?: number; width?: number; position?: Vec3 }) {
  const rr = r + width / 2
  const n = Math.max(8, Math.round(rr * 3))
  const posts = Array.from({ length: n }, (_, i) => (i / n) * Math.PI * 2)
  return (
    <group position={position}>
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <torusGeometry args={[rr, width / 2, 6, Math.max(16, n)]} />
        <meshStandardMaterial {...M.steel()} />
      </mesh>
      <mesh position={[0, h, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[rr + width / 2 - 0.03, 0.025, 6, Math.max(16, n)]} />
        <meshStandardMaterial {...M.steel()} />
      </mesh>
      {posts.map((a, i) => (
        <mesh key={i} position={[Math.cos(a) * (rr + width / 2 - 0.03), h / 2, Math.sin(a) * (rr + width / 2 - 0.03)]}>
          <boxGeometry args={[0.04, h, 0.04]} /><meshStandardMaterial {...M.steel()} />
        </mesh>
      ))}
    </group>
  )
}

/**
 * Вертикальная лестница-клетка (caged ladder): два боковых рельса + перекладины
 * + защитные обручи (несколько торов). Прижимается к аппарату/стене; основание
 * в локальном (0,0,0), поднимается вверх на h, «лицом» на +Z.
 */
export function CagedLadder({
  h, position = [0, 0, 0], rotation = [0, 0, 0],
}: { h: number; position?: Vec3; rotation?: [number, number, number] }) {
  const rungN = Math.max(3, Math.round(h / 0.3))
  const hoopN = Math.max(2, Math.round(h / 1.2))
  const width = 0.42
  return (
    <group position={position} rotation={rotation}>
      {[-width / 2, width / 2].map((x, i) => (
        <mesh key={i} position={[x, h / 2, 0]} castShadow>
          <boxGeometry args={[0.04, h, 0.04]} /><meshStandardMaterial {...M.steel()} />
        </mesh>
      ))}
      {Array.from({ length: rungN }, (_, i) => (
        <mesh key={`r${i}`} position={[0, (i + 0.5) * (h / rungN), 0]}>
          <boxGeometry args={[width, 0.03, 0.03]} /><meshStandardMaterial {...M.steel()} />
        </mesh>
      ))}
      {Array.from({ length: hoopN }, (_, i) => (
        <mesh key={`h${i}`} position={[0, (i + 1) * (h / (hoopN + 1)), 0.18]} rotation={[0, Math.PI / 2, Math.PI / 2]}>
          <torusGeometry args={[0.3, 0.02, 6, 12, Math.PI]} />
          <meshStandardMaterial {...M.steel()} />
        </mesh>
      ))}
    </group>
  )
}

/**
 * Маршевая (зигзаг) лестница: короткие марши, меняющие направление на
 * промежуточных площадках, прижаты к стене/аппарату. Косоуры + наружный
 * поручень. Не единый диагональный пролёт. Локально: основание в (0,0,0),
 * поднимается на h; марши идут вдоль X, вынос по +Z.
 */
export function SwitchbackStair({
  h, w = 1.0, position = [0, 0, 0], rotation = [0, 0, 0],
}: { h: number; w?: number; position?: Vec3; rotation?: [number, number, number] }) {
  const flights = Math.max(2, Math.round(h / 1.6))
  const rise = h / flights
  const run = w * 1.6
  const proj = 0.3 + w / 2
  const railH = 0.95
  const zL = proj - w / 2 + 0.05   // косоур/поручень ближней стороны
  const zR = proj + w / 2 - 0.05   // …и дальней стороны
  return (
    <group position={position} rotation={rotation}>
      {Array.from({ length: flights }, (_, f) => {
        const goRight = f % 2 === 0
        const y0 = f * rise
        const startX = goRight ? -run / 2 : run / 2
        const dir = goRight ? 1 : -1
        const steps = Math.max(3, Math.round(rise / 0.22))
        const stepRun = run / steps
        const stepRise = rise / steps
        const midX = startX + dir * run / 2
        const diag = Math.hypot(run, rise)
        const pitch = Math.atan2(rise, run)
        return (
          <group key={f}>
            {/* ступени */}
            {Array.from({ length: steps }, (_, s) => (
              <mesh key={s} position={[startX + dir * (s + 0.5) * stepRun, y0 + (s + 1) * stepRise, proj]} castShadow>
                <boxGeometry args={[stepRun + 0.02, 0.05, w]} /><meshStandardMaterial {...M.steel()} />
              </mesh>
            ))}
            {/* косоуры обеих сторон */}
            {[zL, zR].map((z, i) => (
              <mesh key={`str${i}`} position={[midX, y0 + rise / 2, z]} rotation={[0, 0, dir * pitch]}>
                <boxGeometry args={[diag, 0.14, 0.06]} /><meshStandardMaterial {...M.steelDark()} />
              </mesh>
            ))}
            {/* поручни обеих сторон */}
            {[zL, zR].map((z, i) => (
              <mesh key={`rail${i}`} position={[midX, y0 + rise / 2 + railH, z]} rotation={[0, 0, dir * pitch]}>
                <boxGeometry args={[diag, 0.045, 0.045]} /><meshStandardMaterial {...M.steel()} />
              </mesh>
            ))}
            {/* стойки перил (балясины) через ступень, обе стороны */}
            {Array.from({ length: steps }, (_, s) => (s % 2 === 0 ? (
              [zL, zR].map((z, i) => (
                <mesh key={`post${s}-${i}`} position={[startX + dir * (s + 0.5) * stepRun, y0 + (s + 1) * stepRise + railH / 2, z]} castShadow>
                  <boxGeometry args={[0.04, railH, 0.04]} /><meshStandardMaterial {...M.steel()} />
                </mesh>
              ))
            ) : null))}
            {/* опорная колонна под маршем (чтобы не «висел») */}
            {f > 0 && (
              <mesh position={[startX, y0 / 2, proj]} castShadow>
                <boxGeometry args={[0.1, y0, 0.1]} /><meshStandardMaterial {...M.steelDark()} />
              </mesh>
            )}
            {/* промежуточная площадка с ограждением + опора до земли */}
            {f < flights - 1 && (
              <group position={[startX + dir * (run / 2 + w / 2), y0 + rise, proj]}>
                <mesh castShadow receiveShadow><boxGeometry args={[w, 0.08, w]} /><meshStandardMaterial {...M.steel()} /></mesh>
                {[[-w / 2, -w / 2], [w / 2, -w / 2], [w / 2, w / 2], [-w / 2, w / 2]].map(([px, pz], i) => (
                  <mesh key={`lp${i}`} position={[px, railH / 2, pz]} castShadow><boxGeometry args={[0.05, railH, 0.05]} /><meshStandardMaterial {...M.steel()} /></mesh>
                ))}
                <mesh position={[0, railH, w / 2 - 0.02]}><boxGeometry args={[w, 0.045, 0.045]} /><meshStandardMaterial {...M.steel()} /></mesh>
                <mesh position={[0, -(y0 + rise) / 2, 0]} castShadow><boxGeometry args={[0.12, y0 + rise, 0.12]} /><meshStandardMaterial {...M.steelDark()} /></mesh>
              </group>
            )}
          </group>
        )
      })}
    </group>
  )
}

/**
 * Штуцер (nozzle): короткий фланцевый патрубок (цилиндр + фланец-диск),
 * торчащий из аппарата. `dir` задаёт ориентацию: '+x'|'-x'|'+z'|'-z'.
 */
export function Nozzle({
  dir = '+z', r = 0.12, len = 0.4, position = [0, 0, 0],
}: { dir?: '+x' | '-x' | '+z' | '-z'; r?: number; len?: number; position?: Vec3 }) {
  const rot: [number, number, number] =
    dir === '+z' ? [Math.PI / 2, 0, 0]
    : dir === '-z' ? [-Math.PI / 2, 0, 0]
    : dir === '+x' ? [0, 0, -Math.PI / 2]
    : [0, 0, Math.PI / 2]
  return (
    <group position={position} rotation={rot}>
      <mesh position={[0, len / 2, 0]} castShadow>
        <cylinderGeometry args={[r, r, len, 10]} /><meshStandardMaterial {...M.steel()} />
      </mesh>
      <mesh position={[0, len, 0]}>
        <cylinderGeometry args={[r * 1.5, r * 1.5, 0.05, 10]} /><meshStandardMaterial {...M.steel()} />
      </mesh>
    </group>
  )
}

/**
 * Вентиль (valve): корпус на линии трубы + маховик (тор) на штоке. По умолчанию
 * маховик смотрит вверх; локально труба идёт вдоль X.
 */
export function Valve({
  r = 0.14, position = [0, 0, 0], color = C.pipeBlue,
}: { r?: number; position?: Vec3; color?: string }) {
  return (
    <group position={position}>
      <mesh castShadow>
        <boxGeometry args={[r * 1.6, r * 1.8, r * 1.8]} />
        <meshStandardMaterial color={color} roughness={0.45} metalness={0.35} />
      </mesh>
      <mesh position={[0, r * 1.6, 0]}>
        <cylinderGeometry args={[0.03, 0.03, r * 1.4, 8]} /><meshStandardMaterial {...M.steel()} />
      </mesh>
      <mesh position={[0, r * 2.3, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[r * 0.9, 0.025, 6, 14]} /><meshStandardMaterial {...M.steel()} />
      </mesh>
    </group>
  )
}

/**
 * Отвод (elbow) на 90°: труба поворачивает от горизонтали вниз к грунту двумя
 * цилиндрами (горизонтальный + вертикальный) с четвертью тора в углу. Локально
 * горизонтальная часть идёт вдоль +X на высоте y, вертикаль уходит вниз в
 * точке x=0.
 */
export function PipeElbow({
  r = 0.12, y = 3, run = 0.8, position = [0, 0, 0], color = C.pipeBlue,
}: { r?: number; y?: number; run?: number; position?: Vec3; color?: string }) {
  const mat = { color, roughness: 0.45, metalness: 0.35 }
  return (
    <group position={position}>
      <mesh position={[run / 2, y, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[r, r, run, 12]} /><meshStandardMaterial {...mat} />
      </mesh>
      <mesh position={[0, y - r, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[r, r, 8, 12, Math.PI / 2]} /><meshStandardMaterial {...mat} />
      </mesh>
      <mesh position={[0, (y - r) / 2, 0]} castShadow>
        <cylinderGeometry args={[r, r, y - r, 12]} /><meshStandardMaterial {...mat} />
      </mesh>
    </group>
  )
}

/* ──────────────────────────────────────────────────────────────────────────
   ОБОРУДОВАНИЕ.
   ────────────────────────────────────────────────────────────────────────── */

/**
 * 1. Ректификационная колонна: высокий тонкий цилиндр (полир. сталь), несколько
 * бандажных колец, купольный верх (полусфера), бетонная «юбка», 3-4 кольцевые
 * площадки с перилами, лестница-клетка, штуцеры, верхняя вент-труба.
 */
export function DistillationColumn({
  h = 8, r = 0.7, position = [0, 0, 0],
}: { h?: number; r?: number; position?: Vec3 }) {
  const skirtH = h * 0.12
  const bodyY = skirtH
  const bodyH = h - skirtH
  const rings = 4
  const platforms = 3
  return (
    <group position={position}>
      <mesh position={[0, skirtH / 2, 0]} castShadow>
        <cylinderGeometry args={[r * 1.05, r * 1.1, skirtH, 20]} /><meshStandardMaterial {...M.concreteMd()} />
      </mesh>
      <mesh position={[0, bodyY + bodyH / 2, 0]} castShadow>
        <cylinderGeometry args={[r, r, bodyH, 24]} /><meshStandardMaterial {...M.polished()} />
      </mesh>
      {Array.from({ length: rings }, (_, i) => (
        <mesh key={`b${i}`} position={[0, bodyY + (i + 1) * (bodyH / (rings + 1)), 0]}>
          <cylinderGeometry args={[r + 0.05, r + 0.05, 0.12, 24]} /><meshStandardMaterial {...M.steel()} />
        </mesh>
      ))}
      <mesh position={[0, bodyY + bodyH, 0]} castShadow>
        <sphereGeometry args={[r, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial {...M.polished()} />
      </mesh>
      {Array.from({ length: platforms }, (_, i) => (
        <RingPlatform key={`p${i}`} r={r} position={[0, bodyY + (i + 1) * (bodyH / (platforms + 1)), 0]} />
      ))}
      <CagedLadder h={bodyH} position={[0, bodyY, r + 0.04]} />
      <Nozzle dir="+x" position={[r, bodyY + bodyH * 0.3, 0]} />
      <Nozzle dir="-x" position={[-r, bodyY + bodyH * 0.6, 0]} />
      <mesh position={[0, bodyY + bodyH + r + 0.5, 0]} castShadow>
        <cylinderGeometry args={[0.08, 0.08, 1, 8]} /><meshStandardMaterial {...M.steel()} />
      </mesh>
    </group>
  )
}

/**
 * 2. Сферический резервуар (Horton): белая сфера на 8 стальных ногах, разведённых
 * к бетонному кольцевому фундаменту, экваториальный обход (тор + перила),
 * верхняя площадка + короткая лестница-клетка.
 */
export function SphereVessel({ r = 1.6, position = [0, 0, 0] }: { r?: number; position?: Vec3 }) {
  const legN = 8
  const legH = r * 0.9
  const cy = legH + r
  const foundR = r * 0.95
  return (
    <group position={position}>
      <mesh position={[0, 0.12, 0]} receiveShadow>
        <cylinderGeometry args={[foundR + 0.3, foundR + 0.35, 0.24, 24]} /><meshStandardMaterial {...M.concreteLt()} />
      </mesh>
      {Array.from({ length: legN }, (_, i) => {
        const a = (i / legN) * Math.PI * 2
        const topR = r * 0.72
        const tx = Math.cos(a) * topR, tz = Math.sin(a) * topR
        const bx = Math.cos(a) * foundR, bz = Math.sin(a) * foundR
        const mx = (tx + bx) / 2, mz = (tz + bz) / 2
        const spread = foundR - topR
        const legLen = Math.hypot(cy, spread)
        // Наклон ноги: разворот вокруг Y к радиусу + отклонение наружу по X.
        return (
          <mesh key={i} position={[mx, cy / 2, mz]} rotation={[0, -a, Math.atan2(spread, cy)]} castShadow>
            <cylinderGeometry args={[0.07, 0.07, legLen, 8]} /><meshStandardMaterial {...M.steel()} />
          </mesh>
        )
      })}
      <mesh position={[0, cy, 0]} castShadow>
        <sphereGeometry args={[r, 28, 20]} /><meshStandardMaterial {...M.tankWhite()} />
      </mesh>
      <mesh position={[0, cy, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[r + 0.05, 0.05, 6, 28]} /><meshStandardMaterial {...M.steel()} />
      </mesh>
      <RingPlatform r={r + 0.05} width={0.5} position={[0, cy - 0.5, 0]} />
      <Platform w={r} d={r} position={[0, cy + r - 0.05, 0]} />
      <CagedLadder h={r} position={[0, cy, r + 0.02]} />
    </group>
  )
}

/**
 * 3. Вертикальный резервуар хранения: белый цилиндр, пологая коническая крыша,
 * перила по верхней кромке, наружная маршевая лестница, боковой штуцер/лаз.
 */
export function StorageTank({
  r = 2, h = 3, position = [0, 0, 0],
}: { r?: number; h?: number; position?: Vec3 }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.1, 0]} receiveShadow>
        <cylinderGeometry args={[r + 0.25, r + 0.3, 0.2, 28]} /><meshStandardMaterial {...M.concreteLt()} />
      </mesh>
      <mesh position={[0, 0.2 + h / 2, 0]} castShadow>
        <cylinderGeometry args={[r, r, h, 28]} /><meshStandardMaterial {...M.tankWhite()} />
      </mesh>
      <mesh position={[0, 0.2 + h + r * 0.18, 0]} castShadow>
        <coneGeometry args={[r + 0.03, r * 0.36, 28]} /><meshStandardMaterial {...M.tankSilver()} />
      </mesh>
      <mesh position={[0, 0.2 + h, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[r, 0.03, 6, 28]} /><meshStandardMaterial {...M.steel()} />
      </mesh>
      <SwitchbackStair h={h + 0.2} w={0.8} position={[0, 0, r + 0.05]} />
      <Nozzle dir="+x" position={[r, 0.2 + h * 0.4, 0]} r={0.16} len={0.35} />
      <Nozzle dir="+z" position={[0, 0.2 + h * 0.55, r]} r={0.22} len={0.25} />
    </group>
  )
}

/**
 * Резервуарный парк: несколько StorageTank в низкой бетонной обваловке.
 */
export function TankFarm({
  n = 3, r = 1.6, h = 3, gap = 1.2, position = [0, 0, 0],
}: { n?: number; r?: number; h?: number; gap?: number; position?: Vec3 }) {
  const step = r * 2 + gap
  const span = (n - 1) * step
  const bundR = span / 2 + r + 0.8
  return (
    <group position={position}>
      <mesh position={[0, 0.05, 0]} receiveShadow>
        <boxGeometry args={[span + r * 2 + 1.6, 0.1, r * 2 + 1.6]} /><meshStandardMaterial {...M.concreteLt()} />
      </mesh>
      {[-1, 1].map((s, i) => (
        <mesh key={`bz${i}`} position={[0, 0.35, s * (r + 0.7)]} castShadow>
          <boxGeometry args={[bundR * 2, 0.5, 0.3]} /><meshStandardMaterial {...M.concreteMd()} />
        </mesh>
      ))}
      {[-1, 1].map((s, i) => (
        <mesh key={`bx${i}`} position={[s * (span / 2 + r + 0.6), 0.35, 0]} castShadow>
          <boxGeometry args={[0.3, 0.5, r * 2 + 1.4]} /><meshStandardMaterial {...M.concreteMd()} />
        </mesh>
      ))}
      {Array.from({ length: n }, (_, i) => (
        <StorageTank key={i} r={r} h={h + hash01(n * 7 + r, i) * 0.6} position={[-span / 2 + i * step, 0.1, 0]} />
      ))}
    </group>
  )
}

/**
 * 4. Горизонтальный аппарат (drum): горизонтальный цилиндр с полусферическими
 * днищами на 2 бетонных сёдлах + штуцеры + короткая лестница-клетка.
 */
export function HorizontalDrum({
  len = 3, r = 0.6, position = [0, 0, 0],
}: { len?: number; r?: number; position?: Vec3 }) {
  const cy = r + 0.5
  return (
    <group position={position}>
      <mesh position={[0, cy, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[r, r, len, 20]} /><meshStandardMaterial {...M.tankSilver()} />
      </mesh>
      {[-len / 2, len / 2].map((x, i) => (
        <mesh key={i} position={[x, cy, 0]} rotation={[0, 0, x > 0 ? -Math.PI / 2 : Math.PI / 2]} castShadow>
          <sphereGeometry args={[r, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial {...M.tankSilver()} />
        </mesh>
      ))}
      {[-len * 0.28, len * 0.28].map((x, i) => (
        <group key={`sd${i}`} position={[x, 0, 0]}>
          <mesh position={[0, (cy - r) / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.4, cy - r, r * 2]} /><meshStandardMaterial {...M.concreteMd()} />
          </mesh>
        </group>
      ))}
      <Nozzle dir="+z" position={[0, cy + r, 0]} />
      <Nozzle dir="+z" position={[-len * 0.3, cy + r * 0.7, 0]} r={0.09} len={0.3} />
      <CagedLadder h={cy + r} position={[len / 2 - 0.2, 0, r + 0.1]} />
    </group>
  )
}

/**
 * 5. Реактор: толстая вертикальная ёмкость с коническим низом, купольным верхом,
 * опорной «юбкой», 2 кольцевые площадки + штуцеры.
 */
export function Reactor({
  h = 4, r = 1.1, position = [0, 0, 0],
}: { h?: number; r?: number; position?: Vec3 }) {
  const skirtH = h * 0.22
  const coneH = r * 0.9
  const bodyH = h - skirtH - coneH
  const bodyY = skirtH + coneH
  return (
    <group position={position}>
      <mesh position={[0, skirtH / 2, 0]} castShadow>
        <cylinderGeometry args={[r * 0.85, r * 0.9, skirtH, 20]} /><meshStandardMaterial {...M.concreteMd()} />
      </mesh>
      <mesh position={[0, skirtH + coneH / 2, 0]} castShadow>
        <coneGeometry args={[r, coneH, 20, 1, true]} /><meshStandardMaterial {...M.polished()} side={2} />
      </mesh>
      <mesh position={[0, bodyY + bodyH / 2, 0]} castShadow>
        <cylinderGeometry args={[r, r, bodyH, 24]} /><meshStandardMaterial {...M.polished()} />
      </mesh>
      <mesh position={[0, bodyY + bodyH, 0]} castShadow>
        <sphereGeometry args={[r, 22, 14, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial {...M.polished()} />
      </mesh>
      <RingPlatform r={r} position={[0, bodyY + bodyH * 0.35, 0]} />
      <RingPlatform r={r} position={[0, bodyY + bodyH * 0.8, 0]} />
      <Nozzle dir="+x" position={[r, bodyY + bodyH * 0.5, 0]} />
      <Nozzle dir="+z" position={[0, bodyY + bodyH + r - 0.1, 0]} />
      <CagedLadder h={bodyH} position={[0, bodyY, r + 0.04]} />
    </group>
  )
}

/**
 * 6. Эстакада труб: приподнятые портальные рамы (колонны + верхняя балка) каждые
 * ~4 ед, несущие N параллельных цветокодированных труб, с отводами к грунту на
 * одном конце и парой вентилей.
 */
export function PipeBridge({
  len = 12, pipes = 4, y = 3, position = [0, 0, 0],
}: { len?: number; pipes?: number; y?: number; position?: Vec3 }) {
  const bays = Math.max(2, Math.round(len / 4))
  const spacing = 0.32
  const offs = Array.from({ length: pipes }, (_, i) => (i - (pipes - 1) / 2) * spacing)
  return (
    <group position={position}>
      {Array.from({ length: bays + 1 }, (_, i) => {
        const x = -len / 2 + i * (len / bays)
        return (
          <group key={i} position={[x, 0, 0]}>
            {[-0.5, 0.5].map((s, j) => (
              <mesh key={j} position={[0, y / 2, s * (spacing * pipes / 2 + 0.3)]} castShadow>
                <boxGeometry args={[0.14, y, 0.14]} /><meshStandardMaterial {...M.steel()} />
              </mesh>
            ))}
            <mesh position={[0, y + 0.08, 0]} castShadow>
              <boxGeometry args={[0.16, 0.16, spacing * pipes + 0.6]} /><meshStandardMaterial {...M.steel()} />
            </mesh>
          </group>
        )
      })}
      {offs.map((z, i) => (
        <mesh key={`p${i}`} position={[0, y + 0.22, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.11, 0.11, len, 12]} />
          <meshStandardMaterial color={PIPE_COLORS[i % PIPE_COLORS.length]} roughness={0.45} metalness={0.35} />
        </mesh>
      ))}
      {offs.slice(0, 2).map((z, i) => (
        <PipeElbow key={`e${i}`} y={y + 0.22} run={0.8} position={[len / 2, 0, z]} color={PIPE_COLORS[i % PIPE_COLORS.length]} />
      ))}
      <Valve position={[-len * 0.2, y + 0.22, offs[0]]} color={PIPE_COLORS[0]} />
      <Valve position={[len * 0.15, y + 0.22, offs[Math.min(2, pipes - 1)]]} color={PIPE_COLORS[Math.min(2, PIPE_COLORS.length - 1)]} />
    </group>
  )
}

/**
 * 7. Наземная эстакада труб: низкие опоры-«лежни», несущие 2-3 цветные трубы на
 * высоте ~0.6, с вентилями.
 */
export function GroundPipeRack({
  len = 8, pipes = 3, y = 0.6, position = [0, 0, 0],
}: { len?: number; pipes?: number; y?: number; position?: Vec3 }) {
  const sleepers = Math.max(2, Math.round(len / 3))
  const spacing = 0.3
  const offs = Array.from({ length: pipes }, (_, i) => (i - (pipes - 1) / 2) * spacing)
  return (
    <group position={position}>
      {Array.from({ length: sleepers }, (_, i) => {
        const x = -len / 2 + (i + 0.5) * (len / sleepers)
        return (
          <mesh key={i} position={[x, y - 0.1, 0]} castShadow>
            <boxGeometry args={[0.2, 0.2, spacing * pipes + 0.4]} /><meshStandardMaterial {...M.steelDark()} />
          </mesh>
        )
      })}
      {offs.map((z, i) => (
        <mesh key={`p${i}`} position={[0, y, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.1, 0.1, len, 12]} />
          <meshStandardMaterial color={PIPE_COLORS[i % PIPE_COLORS.length]} roughness={0.45} metalness={0.35} />
        </mesh>
      ))}
      <Valve position={[len * 0.2, y, offs[0]]} r={0.11} color={PIPE_COLORS[0]} />
    </group>
  )
}

/**
 * 8. Градирня (гиперболоидная): оболочка из двух сложенных открытых усечённых
 * цилиндров (широкое основание → узкая талия → раструб верха) + нижнее кольцо
 * воздухозаборных жалюзи (планки) + верхний обод; опционально — очень слабый
 * диск «пара».
 */
export function CoolingTower({
  r = 2.4, h = 5, steam = true, position = [0, 0, 0],
}: { r?: number; h?: number; steam?: boolean; position?: Vec3 }) {
  const waist = r * 0.6
  const topR = r * 0.78
  const lowerH = h * 0.62
  const upperH = h - lowerH
  const louverN = 16
  return (
    <group position={position}>
      <mesh position={[0, lowerH / 2, 0]} castShadow>
        <cylinderGeometry args={[waist, r, lowerH, 32, 1, true]} /><meshStandardMaterial {...M.concreteLt()} side={2} />
      </mesh>
      <mesh position={[0, lowerH + upperH / 2, 0]} castShadow>
        <cylinderGeometry args={[topR, waist, upperH, 32, 1, true]} /><meshStandardMaterial {...M.concreteLt()} side={2} />
      </mesh>
      <mesh position={[0, lowerH + upperH, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[topR, 0.06, 6, 32]} /><meshStandardMaterial {...M.concreteMd()} />
      </mesh>
      {Array.from({ length: louverN }, (_, i) => {
        const a = (i / louverN) * Math.PI * 2
        return (
          <mesh key={i} position={[Math.cos(a) * r * 0.98, 0.4, Math.sin(a) * r * 0.98]} rotation={[0, -a, 0]}>
            <boxGeometry args={[0.06, 0.8, (r * 2 * Math.PI) / louverN * 0.8]} /><meshStandardMaterial {...M.steelDark()} />
          </mesh>
        )
      })}
      {steam && (
        <mesh position={[0, h + 0.4, 0]}>
          <cylinderGeometry args={[topR * 0.85, topR * 0.6, 0.15, 24]} />
          <meshStandardMaterial color="#f2f4f6" transparent opacity={0.12} roughness={1} />
        </mesh>
      )}
    </group>
  )
}

/**
 * 9. Дымовая труба: высокий слегка сужающийся цилиндр в чередующихся красно-белых
 * полосах + тёмный колпак + небольшая площадка доступа. `flare` — вариант факела
 * с решётчатой «клеткой» на кончике.
 */
export function Chimney({
  h = 8, r = 0.5, striped = true, flare = false, position = [0, 0, 0],
}: { h?: number; r?: number; striped?: boolean; flare?: boolean; position?: Vec3 }) {
  const bands = striped ? Math.max(4, Math.round(h / 1.2)) : 1
  const bandH = h / bands
  return (
    <group position={position}>
      {Array.from({ length: bands }, (_, i) => {
        const t = i / bands
        const rb = r * (1 - t * 0.25)
        const rt = r * (1 - (i + 1) / bands * 0.25)
        const white = i % 2 === 1
        return (
          <mesh key={i} position={[0, (i + 0.5) * bandH, 0]} castShadow>
            <cylinderGeometry args={[rt, rb, bandH, 20]} />
            <meshStandardMaterial {...(striped ? (white ? M.tankWhite() : M.red()) : M.polished())} />
          </mesh>
        )
      })}
      <mesh position={[0, h + 0.1, 0]}>
        <cylinderGeometry args={[r * 0.78, r * 0.78, 0.2, 20]} /><meshStandardMaterial {...M.roof()} />
      </mesh>
      <RingPlatform r={r * 0.85} width={0.4} position={[0, h * 0.82, 0]} />
      {flare && (
        <group position={[0, h + 0.4, 0]}>
          {Array.from({ length: 6 }, (_, i) => {
            const a = (i / 6) * Math.PI * 2
            return (
              <mesh key={i} position={[Math.cos(a) * r * 0.7, 0.4, Math.sin(a) * r * 0.7]}>
                <boxGeometry args={[0.03, 0.8, 0.03]} /><meshStandardMaterial {...M.steel()} />
              </mesh>
            )
          })}
          <mesh position={[0, 0.85, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[r * 0.7, 0.025, 6, 12]} /><meshStandardMaterial {...M.steel()} />
          </mesh>
        </group>
      )}
    </group>
  )
}

/**
 * 10. Воздухонагреватели (blast-furnace stoves): ряд высоких купольных цилиндров,
 * связанных верхним трубным коллектором — для металлургических кластеров.
 */
export function HotStoves({
  n = 3, r = 1, h = 5, gap = 0.6, position = [0, 0, 0],
}: { n?: number; r?: number; h?: number; gap?: number; position?: Vec3 }) {
  const step = r * 2 + gap
  const span = (n - 1) * step
  return (
    <group position={position}>
      {Array.from({ length: n }, (_, i) => {
        const x = -span / 2 + i * step
        return (
          <group key={i} position={[x, 0, 0]}>
            <mesh position={[0, 0.12, 0]} receiveShadow>
              <cylinderGeometry args={[r + 0.2, r + 0.25, 0.24, 20]} /><meshStandardMaterial {...M.concreteLt()} />
            </mesh>
            <mesh position={[0, 0.24 + h / 2, 0]} castShadow>
              <cylinderGeometry args={[r, r, h, 22]} /><meshStandardMaterial {...M.tankSilver()} />
            </mesh>
            <mesh position={[0, 0.24 + h, 0]} castShadow>
              <sphereGeometry args={[r, 22, 14, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial {...M.tankSilver()} />
            </mesh>
            <CagedLadder h={h} position={[0, 0.24, r + 0.04]} />
          </group>
        )
      })}
      <mesh position={[0, 0.24 + h + r * 0.5, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.28, 0.28, span + r, 16]} /><meshStandardMaterial {...M.pipeGray()} />
      </mesh>
      {Array.from({ length: n }, (_, i) => {
        const x = -span / 2 + i * step
        return (
          <mesh key={i} position={[x, 0.24 + h + r * 0.25, 0]} castShadow>
            <cylinderGeometry args={[0.16, 0.16, r * 0.7, 12]} /><meshStandardMaterial {...M.pipeGray()} />
          </mesh>
        )
      })}
    </group>
  )
}

/**
 * Сетка светящихся окон на фасаде (лицом на +Z, в плоскости XY). rows×cols
 * маленьких панелей в рамах с эмиссивным «тёплым» стеклом.
 */
function WindowGrid({
  w, h, rows, cols, glow = 0.5,
}: { w: number; h: number; rows: number; cols: number; glow?: number }) {
  const cw = w / cols, ch = h / rows
  const panes: ReactNode[] = []
  for (let ry = 0; ry < rows; ry++) {
    for (let cx = 0; cx < cols; cx++) {
      const px = -w / 2 + (cx + 0.5) * cw
      const py = -h / 2 + (ry + 0.5) * ch
      panes.push(
        <group key={`${ry}_${cx}`} position={[px, py, 0]}>
          <mesh position={[0, 0, 0.02]}>
            <boxGeometry args={[cw * 0.94, ch * 0.94, 0.06]} /><meshStandardMaterial {...M.frame()} />
          </mesh>
          <mesh position={[0, 0, 0.05]}>
            <boxGeometry args={[cw * 0.78, ch * 0.78, 0.03]} /><meshStandardMaterial {...M.window(glow)} />
          </mesh>
        </group>,
      )
    }
  }
  return <>{panes}</>
}

/**
 * 11. Здание операторной/управления: чистый белый/серый параллелепипед, СЕТКА
 * светящихся окон, плоская кровля с парапетом + 2-3 HVAC-блока (с дисками
 * вентиляторов) + лестничная башня (вертикальная рама + маршевая лестница) сбоку,
 * вход с козырьком.
 */
export function ControlBuilding({
  w = 6, d = 4, h = 4, position = [0, 0, 0],
}: { w?: number; d?: number; h?: number; position?: Vec3 }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.1, 0]} receiveShadow>
        <boxGeometry args={[w + 0.6, 0.2, d + 0.6]} /><meshStandardMaterial {...M.concreteLt()} />
      </mesh>
      <mesh position={[0, 0.2 + h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} /><meshStandardMaterial {...M.facadeWhite()} />
      </mesh>
      {([[d / 2 + 0.02, 0], [-d / 2 - 0.02, Math.PI]] as Array<[number, number]>).map(([z, ry], i) => (
        <group key={i} position={[0, 0.2 + h / 2, z]} rotation={[0, ry, 0]}>
          <WindowGrid w={w * 0.82} h={h * 0.6} rows={2} cols={Math.max(4, Math.round(w / 1.3))} />
        </group>
      ))}
      <mesh position={[0, 0.2 + h + 0.15, 0]}>
        <boxGeometry args={[w + 0.2, 0.3, d + 0.2]} /><meshStandardMaterial {...M.facadeGray()} />
      </mesh>
      <mesh position={[0, 0.2 + h + 0.05, 0]}>
        <boxGeometry args={[w - 0.3, 0.1, d - 0.3]} /><meshStandardMaterial {...M.roof()} />
      </mesh>
      {[-w * 0.25, 0, w * 0.25].map((x, i) => (
        <group key={i} position={[x, 0.2 + h + 0.2, (i % 2 ? 0.6 : -0.6)]}>
          <mesh position={[0, 0.25, 0]} castShadow><boxGeometry args={[0.9, 0.5, 0.9]} /><meshStandardMaterial {...M.hvac()} /></mesh>
          <mesh position={[0, 0.52, 0]}><cylinderGeometry args={[0.3, 0.3, 0.08, 14]} /><meshStandardMaterial {...M.roof()} /></mesh>
        </group>
      ))}
      <group position={[w / 2 + 0.5, 0, -d * 0.2]}>
        {[[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]].map(([cx, cz], i) => (
          <mesh key={i} position={[cx, (0.2 + h + 0.4) / 2, cz]} castShadow>
            <boxGeometry args={[0.1, 0.2 + h + 0.4, 0.1]} /><meshStandardMaterial {...M.steel()} />
          </mesh>
        ))}
        <SwitchbackStair h={h} w={0.8} position={[0, 0, 0.55]} />
      </group>
      <group position={[0, 0, d / 2 + 0.04]}>
        <mesh position={[0, 1.1, 0.1]} castShadow><boxGeometry args={[1.4, 2.2, 0.12]} /><meshStandardMaterial {...M.frame()} /></mesh>
        <mesh position={[0, 1.1, 0.16]}><boxGeometry args={[1.15, 1.95, 0.05]} /><meshStandardMaterial {...M.window(0.35)} /></mesh>
        <mesh position={[0, 2.35, 0.7]} castShadow><boxGeometry args={[2.2, 0.1, 1.1]} /><meshStandardMaterial {...M.facadeGray()} /></mesh>
      </group>
    </group>
  )
}

/**
 * 12. Группа силосов: ряд высоких цилиндров, у каждого — конический бункер-низ на
 * ногах, верхняя галерея (короб-мостик), связывающая их, боковая лестница-клетка.
 */
export function SiloGroup({
  n = 4, r = 1, h = 5, gap = 0.5, position = [0, 0, 0],
}: { n?: number; r?: number; h?: number; gap?: number; position?: Vec3 }) {
  const step = r * 2 + gap
  const span = (n - 1) * step
  const hopperH = r * 0.9
  const legH = r * 0.6
  const bodyY = legH + hopperH
  return (
    <group position={position}>
      {Array.from({ length: n }, (_, i) => {
        const x = -span / 2 + i * step
        return (
          <group key={i} position={[x, 0, 0]}>
            {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], j) => (
              <mesh key={j} position={[sx * r * 0.6, legH / 2, sz * r * 0.6]} castShadow>
                <boxGeometry args={[0.1, legH, 0.1]} /><meshStandardMaterial {...M.steel()} />
              </mesh>
            ))}
            <mesh position={[0, legH + hopperH / 2, 0]} castShadow>
              <coneGeometry args={[r, hopperH, 20]} /><meshStandardMaterial {...M.steel()} />
            </mesh>
            <mesh position={[0, bodyY + h / 2, 0]} castShadow>
              <cylinderGeometry args={[r, r, h, 22]} /><meshStandardMaterial {...M.tankSilver()} />
            </mesh>
            <mesh position={[0, bodyY + h, 0]} castShadow>
              <cylinderGeometry args={[r, r, 0.1, 22]} /><meshStandardMaterial {...M.steel()} />
            </mesh>
            {i === 0 && <CagedLadder h={h} position={[0, bodyY, r + 0.04]} />}
          </group>
        )
      })}
      <group position={[0, bodyY + h + 0.35, 0]}>
        <mesh castShadow><boxGeometry args={[span + r, 0.5, r * 1.4]} /><meshStandardMaterial {...M.steel()} /></mesh>
        <Railing len={span + r} h={0.7} position={[0, 0.25, r * 0.7]} />
        <Railing len={span + r} h={0.7} position={[0, 0.25, -r * 0.7]} />
      </group>
    </group>
  )
}

/**
 * 13. Наклонная конвейерная галерея: длинный закрытый прямоугольный короб на
 * A-образных опорах, идущий от грунта вверх к башне/верху силоса — классический
 * конвейер подачи сырья.
 */
export function ConveyorGallery({
  len = 8, rise = 4, position = [0, 0, 0],
}: { len?: number; rise?: number; position?: Vec3 }) {
  const angle = Math.atan2(rise, len)
  const diag = Math.hypot(len, rise)
  const supports = Math.max(2, Math.round(len / 3))
  return (
    <group position={position}>
      <mesh position={[len / 2, rise / 2, 0]} rotation={[0, 0, angle]} castShadow>
        <boxGeometry args={[diag, 0.9, 1]} /><meshStandardMaterial {...M.steel()} />
      </mesh>
      <mesh position={[len / 2, rise / 2 + 0.3, 0.51]} rotation={[0, 0, angle]}>
        <boxGeometry args={[diag, 0.3, 0.02]} /><meshStandardMaterial {...M.window(0.25)} />
      </mesh>
      {Array.from({ length: supports }, (_, i) => {
        const t = (i + 0.5) / supports
        const cx = t * len
        const cy = t * rise
        return (
          <group key={i} position={[cx, 0, 0]}>
            {[-0.5, 0.5].map((s, j) => (
              <mesh key={j} position={[s * cy * 0.18, cy / 2, s * 0.45]} rotation={[0, 0, s * 0.12]} castShadow>
                <boxGeometry args={[0.12, cy, 0.12]} /><meshStandardMaterial {...M.steelDark()} />
              </mesh>
            ))}
          </group>
        )
      })}
    </group>
  )
}

/**
 * 14. Промышленный корпус (steel hall): длинный цех, двускатная ИЛИ пилообразная
 * (sawtooth) кровля, лента окон в рамах, фонарь на коньке, 1-2 дымовые трубы +
 * наземная эстакада труб вдоль одной стены.
 */
export function SteelHall({
  w = 10, d = 7, h = 5, sawtooth = false, position = [0, 0, 0],
}: { w?: number; d?: number; h?: number; sawtooth?: boolean; position?: Vec3 }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.1, 0]} receiveShadow>
        <boxGeometry args={[w + 0.5, 0.2, d + 0.5]} /><meshStandardMaterial {...M.concreteLt()} />
      </mesh>
      <mesh position={[0, 0.2 + h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} /><meshStandardMaterial {...M.facadeGray()} />
      </mesh>
      {([[d / 2 + 0.02, 0], [-d / 2 - 0.02, Math.PI]] as Array<[number, number]>).map(([z, ry], i) => (
        <group key={i} position={[0, 0.2 + h * 0.62, z]} rotation={[0, ry, 0]}>
          <WindowGrid w={w * 0.86} h={h * 0.32} rows={1} cols={Math.max(6, Math.round(w / 1.2))} glow={0.4} />
        </group>
      ))}
      {!sawtooth && (
        <>
          <mesh position={[0, 0.2 + h + 0.7, 0]} rotation={[0, 0, Math.PI / 2]} scale={[1.4, 1, (d + 0.3) / 0.866]} castShadow>
            <cylinderGeometry args={[0.5, 0.5, w + 0.3, 3]} /><meshStandardMaterial {...M.roof()} />
          </mesh>
          <mesh position={[0, 0.2 + h + 1.05, 0]}>
            <boxGeometry args={[w * 0.6, 0.4, 0.8]} /><meshStandardMaterial {...M.window(0.3)} />
          </mesh>
        </>
      )}
      {sawtooth && [-3, 0, 3].map((x, i) => (
        <group key={i} position={[x, 0.2 + h + 0.5, 0]}>
          <mesh rotation={[0, 0, Math.PI / 2]} scale={[1.4, 1, (d - 0.2) / 0.866]} castShadow>
            <cylinderGeometry args={[0.5, 0.5, 2.4, 3]} /><meshStandardMaterial {...M.roof()} />
          </mesh>
          <mesh position={[-0.9, 0.1, 0]} rotation={[0, 0, 0.5]}>
            <boxGeometry args={[0.05, 1, d - 0.5]} /><meshStandardMaterial {...M.window(0.35)} />
          </mesh>
        </group>
      ))}
      <Chimney h={3} r={0.35} position={[w * 0.35, 0.2 + h, -d * 0.3]} />
      <Chimney h={2.4} r={0.28} striped={false} position={[w * 0.25, 0.2 + h, -d * 0.35]} />
      <GroundPipeRack len={w * 0.8} pipes={3} position={[0, 0, d / 2 + 0.6]} />
    </group>
  )
}

/**
 * 15. Подстанция: ряд трансформаторных боксов (с рёбрами) + вводные изоляторы
 * (стопки дисков) + решётчатый A-портал + провода (тонкие цепные цилиндры).
 */
export function Substation({
  w = 4, d = 3, n = 2, position = [0, 0, 0],
}: { w?: number; d?: number; n?: number; position?: Vec3 }) {
  const step = w / n
  return (
    <group position={position}>
      <mesh position={[0, 0.05, 0]} receiveShadow>
        <boxGeometry args={[w + 1, 0.1, d + 1]} /><meshStandardMaterial {...M.concreteMd()} />
      </mesh>
      {Array.from({ length: n }, (_, i) => {
        const x = -w / 2 + (i + 0.5) * step
        return (
          <group key={i} position={[x, 0, -d * 0.2]}>
            <mesh position={[0, 0.9, 0]} castShadow>
              <boxGeometry args={[step * 0.7, 1.6, d * 0.5]} /><meshStandardMaterial {...M.hvac()} />
            </mesh>
            {Array.from({ length: 5 }, (_, f) => (
              <mesh key={f} position={[step * 0.36, 0.9, -d * 0.25 + f * (d * 0.5 / 5)]}>
                <boxGeometry args={[0.05, 1.5, 0.03]} /><meshStandardMaterial {...M.steel()} />
              </mesh>
            ))}
            {[-0.3, 0, 0.3].map((bx, b) => (
              <group key={b} position={[bx * step, 1.7, 0]}>
                {[0, 1, 2].map((k) => (
                  <mesh key={k} position={[0, 0.15 + k * 0.18, 0]}>
                    <cylinderGeometry args={[0.1 - k * 0.02, 0.12 - k * 0.02, 0.14, 10]} />
                    <meshStandardMaterial color="#d8d4cc" roughness={0.6} metalness={0.1} />
                  </mesh>
                ))}
              </group>
            ))}
          </group>
        )
      })}
      {[-1, 1].map((s, i) => (
        <group key={i} position={[s * w * 0.4, 0, d * 0.35]}>
          {[-0.25, 0.25].map((lx, j) => (
            <mesh key={j} position={[lx, 1.6, 0]} rotation={[0, 0, s * lx * 0.08]} castShadow>
              <boxGeometry args={[0.1, 3.2, 0.1]} /><meshStandardMaterial {...M.steel()} />
            </mesh>
          ))}
          <mesh position={[0, 3.2, 0]}><boxGeometry args={[0.9, 0.12, 0.12]} /><meshStandardMaterial {...M.steel()} /></mesh>
        </group>
      ))}
      {[-0.3, 0, 0.3].map((z, i) => (
        <mesh key={i} position={[0, 3.05, z * d]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.02, 0.02, w * 0.8, 6]} /><meshStandardMaterial {...M.steelDark()} />
        </mesh>
      ))}
    </group>
  )
}
