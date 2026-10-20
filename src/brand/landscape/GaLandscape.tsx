/**
 * Заставка: 3D-ландшафт целевой функции и генетический алгоритм, ищущий
 * глобальный максимум. Фазы поколения: оценка → отбор → скрещивание → мутация.
 * Грузится лениво (окно входа интерактивно сразу); при reduced motion —
 * один статичный кадр сошедшегося состояния.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useTheme } from '../../shell/theme'
import { parseCssColor } from '../../features/plant-scene/themeColors'
import { DEFAULT_GA, initPopulation, makeLandscape, mulberry32, nextSigma, step, type Generation, type Genome, type Landscape } from './ga'
import { LandscapeHud, type HudState, PHASES } from './LandscapeHud'
import './landscape.css'

const SPAN = 1.25          // мировой полуразмер поля
const HEIGHT = 0.95        // масштаб высоты f → мир
const GRID = 112           // сетка поверхности
const GEN_SEC = 1.15       // длительность поколения
const MAX_GENS = 70
const HOLD_SEC = 2.4       // пауза на найденном максимуме перед новым ландшафтом
const N = DEFAULT_GA.popSize

interface Palette { bg: string; deep: string; verdigris: string; ochre: string; cinnabar: string; bone: string; isLight: boolean }

function cssColor(name: string, fallback: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return (raw && parseCssColor(raw)) || fallback
}

function readPalette(isLight: boolean): Palette {
  return {
    bg: cssColor('--bg-app', isLight ? '#f8f5ef' : '#0d0f16'),
    deep: cssColor('--ultramarine', '#4366e8'),
    verdigris: cssColor('--verdigris', '#58c8ad'),
    ochre: cssColor('--ochre', '#e9af41'),
    cinnabar: cssColor('--cinnabar', '#eb5e43'),
    bone: isLight ? cssColor('--text', '#171a24') : cssColor('--bone', '#f2eee6'),
    isLight,
  }
}

const toWorld = (g: { x: number; y: number }, ls: Landscape, out: THREE.Vector3, lift = 0.025) =>
  out.set(g.x * SPAN, ls.f(g.x, g.y) * HEIGHT + lift, g.y * SPAN)

/** Цвет высоты: глубокий ультрамарин → ярь-медянка → охра → киноварь у глобального пика. */
function heightColor(t: number, pal: Palette, out: THREE.Color) {
  const stops: Array<[number, string]> = [[0, pal.deep], [0.42, pal.verdigris], [0.72, pal.ochre], [1, pal.cinnabar]]
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1]
      const [t1, c1] = stops[i]
      return out.set(c0).lerp(new THREE.Color(c1), (t - t0) / (t1 - t0))
    }
  }
  return out.set(stops[stops.length - 1][1])
}

function buildSurface(ls: Landscape, pal: Palette): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(SPAN * 2, SPAN * 2, GRID, GRID)
  geo.rotateX(-Math.PI / 2)
  const pos = geo.attributes.position as THREE.BufferAttribute
  const colors = new Float32Array(pos.count * 3)
  const c = new THREE.Color()
  const dark = new THREE.Color(pal.bg)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / SPAN
    const z = pos.getZ(i) / SPAN
    const h = ls.f(x, z)
    pos.setY(i, h * HEIGHT)
    heightColor(Math.min(1, h / ls.fMax), pal, c)
    // низины уходят в фон — ландшафт «вырастает» из темноты
    c.lerp(dark, Math.max(0, 0.55 - h * 1.4) * (pal.isLight ? 0.4 : 1))
    c.toArray(colors, i * 3)
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.computeVertexNormals()
  return geo
}

interface Episode { ls: Landscape; rng: () => number; pop: Genome[]; sigma: number; best: number; stagnant: number; gen: Generation | null; done: boolean; history: Array<{ best: number; mean: number }> }

function newEpisode(seed: number): Episode {
  const ls = makeLandscape(seed)
  const rng = mulberry32(seed ^ 0x9e3779b9)
  const pop = initPopulation(ls, rng, N)
  return { ls, rng, pop, sigma: DEFAULT_GA.sigma0, best: Math.max(...pop.map((g) => g.fit)), stagnant: 0, gen: null, done: false, history: [] }
}

function advance(ep: Episode): void {
  const prev = ep.gen ? ep.gen.pop : ep.pop
  const g = step(ep.ls, ep.rng, prev, (ep.gen?.gen ?? 0) + 1, ep.sigma)
  ep.pop = prev
  ep.gen = g
  ep.stagnant = g.best.fit > ep.best + 1e-6 ? 0 : ep.stagnant + 1
  ep.best = Math.max(ep.best, g.best.fit)
  ep.sigma = nextSigma(ep.sigma, ep.stagnant)
  ep.history.push({ best: g.best.fit / ep.ls.fMax, mean: g.mean / ep.ls.fMax })
  ep.done = g.gen >= MAX_GENS || (g.best.fit >= ep.ls.fMax * 0.985 && ep.stagnant >= 3)
}

const ease = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t))

function Scene({ pal, onHud, still }: { pal: Palette; onHud: (h: HudState) => void; still: boolean }) {
  const seedRef = useRef(20251019)
  const [ep, setEp] = useState<Episode>(() => newEpisode(seedRef.current))
  const clock = useRef({ t: 0, hold: 0, lastPhase: -1 })
  const dots = useRef<THREE.InstancedMesh>(null)
  const links = useRef<THREE.LineSegments>(null)
  const trails = useRef<THREE.LineSegments>(null)
  const marker = useRef<THREE.Group>(null)
  const { camera, invalidate } = useThree()

  const surface = useMemo(() => buildSurface(ep.ls, pal), [ep, pal])
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), col: new THREE.Color(), q: new THREE.Quaternion(), s: new THREE.Vector3() }), [])
  const linkPos = useMemo(() => new Float32Array(N * 2 * 2 * 3), [])
  const trailPos = useMemo(() => new Float32Array(N * 2 * 3), [])
  const colOchre = useMemo(() => new THREE.Color(pal.ochre), [pal])
  const colBone = useMemo(() => new THREE.Color(pal.bone), [pal])
  const colCin = useMemo(() => new THREE.Color(pal.cinnabar), [pal])

  // Статичный кадр: прогон до сходимости и одна отрисовка.
  useEffect(() => {
    if (!still) return
    while (!ep.done) advance(ep)
    clock.current.t = 0.999
    invalidate()
  }, [still, ep, invalidate])

  useFrame((state, dt) => {
    const ck = clock.current
    if (!still) {
      // медленный облёт: ~1 оборот за 80 с
      const ang = state.clock.elapsedTime * (Math.PI * 2 / 80) + 0.6
      camera.position.set(Math.cos(ang) * 3.35, 2.45, Math.sin(ang) * 3.35)
      camera.lookAt(-0.35, 0.05, 0)
      if (ep.done) {
        ck.hold += dt
        if (ck.hold > HOLD_SEC) {
          seedRef.current += 7919
          ck.hold = 0; ck.t = 0
          setEp(newEpisode(seedRef.current))
          return
        }
      } else {
        ck.t += dt / GEN_SEC
        if (!ep.gen || ck.t >= 1) { advance(ep); ck.t = ep.gen && ck.t >= 1 ? ck.t - 1 : 0 }
      }
    } else {
      camera.position.set(Math.cos(0.6) * 3.35, 2.45, Math.sin(0.6) * 3.35)
      camera.lookAt(-0.35, 0.05, 0)
    }
    const g = ep.gen
    if (!g || !dots.current) return
    const t = ep.done ? 1 : ck.t
    const phase = t < 0.22 ? 0 : t < 0.42 ? 1 : t < 0.68 ? 2 : 3
    const tCross = ease((t - 0.42) / 0.26)
    const tMut = ease((t - 0.68) / 0.3)
    const prev = ep.pop
    const usedAsParent = new Set<number>()
    g.parents.forEach(([a, b]) => { usedAsParent.add(a); usedAsParent.add(b) })

    let li = 0
    let ti = 0
    for (let k = 0; k < N; k++) {
      const [pa, pb] = g.parents[k]
      const A = prev[pa]
      const pre = g.preMutation[k]
      const fin = g.pop[k]
      // позиция: до скрещивания — на месте родителя A; затем к точке потомка; затем мутация.
      if (phase <= 1) toWorld(prev[k], ep.ls, tmp.c)
      else if (phase === 2) { toWorld(A, ep.ls, tmp.a); toWorld(pre, ep.ls, tmp.b); tmp.c.lerpVectors(tmp.a, tmp.b, tCross) }
      else { toWorld(pre, ep.ls, tmp.a); toWorld(fin, ep.ls, tmp.b); tmp.c.lerpVectors(tmp.a, tmp.b, g.mutated[k] ? tMut : 1) }

      const fit = (phase <= 1 ? prev[k].fit : fin.fit) / ep.ls.fMax
      let scale = 0.75 + fit * 0.7
      if (phase === 0) scale *= 1 + 0.35 * Math.sin(t / 0.22 * Math.PI) * fit
      if (phase === 1) scale *= usedAsParent.has(k) ? 1.25 : 0.55
      tmp.s.setScalar(scale)
      tmp.m.compose(tmp.c, tmp.q, tmp.s)
      dots.current.setMatrixAt(k, tmp.m)
      tmp.col.copy(colBone).lerp(colOchre, Math.min(1, fit * 1.1))
      if (phase === 3 && g.mutated[k] && tMut < 1) tmp.col.lerp(colCin, 1 - tMut * 0.6)
      if (phase === 1 && !usedAsParent.has(k)) tmp.col.multiplyScalar(0.45)
      dots.current.setColorAt(k, tmp.col)

      // линии скрещивания: родители → потомок
      if (phase === 2 && k >= DEFAULT_GA.elite && k % 2 === 0) {
        toWorld(A, ep.ls, tmp.a); toWorld(prev[pb], ep.ls, tmp.b)
        tmp.a.toArray(linkPos, li); tmp.c.toArray(linkPos, li + 3); li += 6
        tmp.b.toArray(linkPos, li); tmp.c.toArray(linkPos, li + 3); li += 6
      }
      // след мутации: точка до → после
      if (phase === 3 && g.mutated[k]) {
        toWorld(pre, ep.ls, tmp.a)
        tmp.a.toArray(trailPos, ti); tmp.c.toArray(trailPos, ti + 3); ti += 6
      }
    }
    dots.current.instanceMatrix.needsUpdate = true
    if (dots.current.instanceColor) dots.current.instanceColor.needsUpdate = true
    if (links.current) {
      const geo = links.current.geometry
      ;(geo.attributes.position as THREE.BufferAttribute).needsUpdate = true
      geo.setDrawRange(0, li / 3)
    }
    if (trails.current) {
      const geo = trails.current.geometry
      ;(geo.attributes.position as THREE.BufferAttribute).needsUpdate = true
      geo.setDrawRange(0, ti / 3)
    }
    // лучшее найденное — охристый ▲ с лучом
    if (marker.current) {
      const best = g.pop.reduce((b, x) => (x.fit > b.fit ? x : b), g.pop[0])
      toWorld(best, ep.ls, tmp.a, 0)
      marker.current.position.copy(tmp.a)
      marker.current.rotation.y += dt * 0.8
    }
    if (phase !== ck.lastPhase || ep.done) {
      ck.lastPhase = phase
      onHud({
        phase: ep.done ? PHASES.length : phase,
        gen: g.gen,
        best: ep.best / ep.ls.fMax,
        mean: g.mean / ep.ls.fMax,
        sigma: g.sigma,
        history: ep.history.slice(),
        converged: ep.done,
      })
    }
  })

  return (
    <>
      <fog attach="fog" args={[pal.bg, 3.6, 7.2]} />
      <ambientLight intensity={pal.isLight ? 0.9 : 0.55} />
      <directionalLight position={[-2, 3.5, 1.5]} intensity={pal.isLight ? 1.1 : 1.35} />
      <directionalLight position={[2, 1.2, -2]} intensity={0.35} color={pal.deep} />
      <mesh geometry={surface}>
        <meshStandardMaterial vertexColors roughness={0.82} metalness={0.05} />
      </mesh>
      <mesh geometry={surface} position={[0, 0.002, 0]}>
        <meshBasicMaterial color={pal.bone} wireframe transparent opacity={pal.isLight ? 0.1 : 0.07} />
      </mesh>
      <instancedMesh ref={dots} args={[undefined, undefined, N]} frustumCulled={false}>
        <sphereGeometry args={[0.02, 14, 10]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <lineSegments ref={links} frustumCulled={false}>
        <bufferGeometry><bufferAttribute attach="attributes-position" args={[linkPos, 3]} /></bufferGeometry>
        <lineBasicMaterial color={pal.bone} transparent opacity={0.35} />
      </lineSegments>
      <lineSegments ref={trails} frustumCulled={false}>
        <bufferGeometry><bufferAttribute attach="attributes-position" args={[trailPos, 3]} /></bufferGeometry>
        <lineBasicMaterial color={pal.cinnabar} transparent opacity={0.9} toneMapped={false} />
      </lineSegments>
      <group ref={marker}>
        <mesh position={[0, 0.16, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.05, 0.11, 3]} />
          <meshBasicMaterial color={pal.ochre} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.08, 0]}>
          <cylinderGeometry args={[0.0035, 0.0035, 0.16, 6]} />
          <meshBasicMaterial color={pal.ochre} transparent opacity={0.7} />
        </mesh>
      </group>
    </>
  )
}

export default function GaLandscape() {
  const theme = useTheme()
  const isLight = theme === 'light'
  const pal = useMemo(() => readPalette(isLight), [isLight])
  const [hud, setHud] = useState<HudState | null>(null)
  const still = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true, [])
  const [hidden, setHidden] = useState(() => document.hidden)
  useEffect(() => {
    const on = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])

  return (
    <div className="ga-landscape" aria-hidden="false">
      <Canvas
        className="ga-landscape__canvas"
        dpr={[1, 1.75]}
        frameloop={still || hidden ? 'demand' : 'always'}
        camera={{ position: [2.2, 2.05, 1.5], fov: 38, near: 0.05, far: 20 }}
        gl={{ antialias: true, alpha: false, powerPreference: 'low-power' }}
        onCreated={({ gl }) => gl.setClearColor(pal.bg)}
      >
        <color attach="background" args={[pal.bg]} />
        <Scene pal={pal} onHud={setHud} still={still} />
      </Canvas>
      <div className="ga-landscape__vignette" aria-hidden="true" />
      {hud && <LandscapeHud hud={hud} />}
    </div>
  )
}
