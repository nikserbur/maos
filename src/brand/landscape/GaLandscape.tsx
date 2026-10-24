/**
 * Заставка: 3D-ландшафт целевой функции (плоскость из супер-мини точек,
 * уходящая за край экрана) и генетический алгоритм. Параметры ГА — через HUD.
 * Ленивая загрузка; при reduced motion — один статичный кадр сходимости.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useTheme } from '../../shell/theme'
import { useAnimationPaused } from '../../ui/motion'
import { parseCssColor } from '../../features/plant-scene/themeColors'
import {
  DEFAULT_GA, initPopulation, makeLandscape, mulberry32, nextSigma, step,
  type GaParams, type Generation, type Genome, type Landscape,
} from './ga'
import { LandscapeHud, type GaLiveParams, type HudState, PHASES, DEFAULT_LIVE } from './LandscapeHud'
import './landscape.css'

const SPAN = 1.35          // полуразмер ландшафта: пики остаются в кадре
const FIELD = 3.2          // плоскость точек шире кадра — без обрезки края
const HEIGHT = 0.95
const DOT_RES = 360
const HOLD_SEC = 2.4

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

const toWorld = (g: { x: number; y: number }, ls: Landscape, out: THREE.Vector3, lift = 0.018) =>
  out.set(g.x * SPAN, ls.f(g.x, g.y) * HEIGHT + lift, g.y * SPAN)

/** Цвет высоты: глубокий ультрамарин → ярь-медянка → охра → киноварь у пика. */
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

/**
 * Плоскость точек шире кадра (FIELD). Высоты ландшафта только в SPAN;
 * снаружи — плоский «пол», чтобы пики не уезжали за экран, а обрезки не было.
 */
function buildDotField(ls: Landscape, pal: Palette): THREE.BufferGeometry {
  const n = (DOT_RES + 1) * (DOT_RES + 1)
  const positions = new Float32Array(n * 3)
  const colors = new Float32Array(n * 3)
  const c = new THREE.Color()
  const dark = new THREE.Color(pal.bg)
  let i = 0
  for (let iz = 0; iz <= DOT_RES; iz++) {
    for (let ix = 0; ix <= DOT_RES; ix++) {
      const jx = ((ix * 1103515245 + iz * 12345) >>> 0) / 4294967296
      const jz = ((iz * 1664525 + ix * 1013904223) >>> 0) / 4294967296
      const u = (ix + (jx - 0.5) * 0.72) / DOT_RES
      const v = (iz + (jz - 0.5) * 0.72) / DOT_RES
      const x = (u * 2 - 1) * FIELD
      const z = (v * 2 - 1) * FIELD
      const nx = x / SPAN
      const nz = z / SPAN
      const r = Math.max(Math.abs(nx), Math.abs(nz))
      // f только в домене; за краем — сглаживание в плоскость
      const qx = Math.max(-1.05, Math.min(1.05, nx))
      const qz = Math.max(-1.05, Math.min(1.05, nz))
      let h = ls.f(qx, qz)
      if (r > 1) {
        const t = Math.min(1, (r - 1) / 0.4)
        h *= (1 - t) * (1 - t)
      }
      positions[i * 3] = x
      positions[i * 3 + 1] = h * HEIGHT
      positions[i * 3 + 2] = z
      heightColor(Math.min(1, h / ls.fMax), pal, c)
      const edge = Math.max(Math.abs(x), Math.abs(z)) / FIELD
      const fade = Math.max(0, (edge - 0.52) / 0.48)
      c.lerp(dark, pal.isLight ? 0.36 : 0.5)
      c.lerp(dark, Math.max(0, 0.55 - h * 1.1) * (pal.isLight ? 0.3 : 0.6))
      c.lerp(dark, fade * (pal.isLight ? 0.68 : 0.88))
      c.toArray(colors, i * 3)
      i++
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geo
}

function toGaParams(live: GaLiveParams): GaParams {
  return {
    ...DEFAULT_GA,
    popSize: live.popSize,
    mutationRate: live.mutationRate,
    sigma0: live.sigma0,
    elite: live.elite,
    tournament: live.tournament,
    blxAlpha: live.blxAlpha,
  }
}

interface Episode {
  ls: Landscape
  rng: () => number
  pop: Genome[]
  sigma: number
  best: number
  stagnant: number
  gen: Generation | null
  done: boolean
  history: Array<{ best: number; mean: number }>
  params: GaParams
  maxGens: number
}

function newEpisode(seed: number, live: GaLiveParams): Episode {
  const params = toGaParams(live)
  const ls = makeLandscape(seed)
  const rng = mulberry32(seed ^ 0x9e3779b9)
  const pop = initPopulation(ls, rng, params.popSize)
  return {
    ls, rng, pop, params, maxGens: live.maxGens,
    sigma: params.sigma0,
    best: Math.max(...pop.map((g) => g.fit)),
    stagnant: 0, gen: null, done: false, history: [],
  }
}

function advance(ep: Episode): void {
  const prev = ep.gen ? ep.gen.pop : ep.pop
  const g = step(ep.ls, ep.rng, prev, (ep.gen?.gen ?? 0) + 1, ep.sigma, ep.params)
  ep.pop = prev
  ep.gen = g
  ep.stagnant = g.best.fit > ep.best + 1e-6 ? 0 : ep.stagnant + 1
  ep.best = Math.max(ep.best, g.best.fit)
  ep.sigma = nextSigma(ep.sigma, ep.stagnant, ep.params)
  ep.history.push({ best: g.best.fit / ep.ls.fMax, mean: g.mean / ep.ls.fMax })
  ep.done = g.gen >= ep.maxGens || (g.best.fit >= ep.ls.fMax * 0.985 && ep.stagnant >= 3)
}

const ease = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t))

function Scene({
  pal, live, onHud, still, restartKey,
}: {
  pal: Palette
  live: GaLiveParams
  onHud: (h: HudState) => void
  still: boolean
  restartKey: number
}) {
  const seedRef = useRef(20251019)
  const liveRef = useRef(live)
  liveRef.current = live
  const [ep, setEp] = useState<Episode>(() => newEpisode(seedRef.current, live))
  const clock = useRef({ t: 0, hold: 0, lastPhase: -1 })
  const dots = useRef<THREE.InstancedMesh>(null)
  const links = useRef<THREE.LineSegments>(null)
  const trails = useRef<THREE.LineSegments>(null)
  const marker = useRef<THREE.Group>(null)
  const { camera, invalidate } = useThree()

  useEffect(() => {
    if (restartKey === 0) return
    seedRef.current += 7919
    clock.current = { t: 0, hold: 0, lastPhase: -1 }
    setEp(newEpisode(seedRef.current, liveRef.current))
  }, [restartKey])

  const field = useMemo(() => buildDotField(ep.ls, pal), [ep.ls, pal])
  const N = ep.params.popSize
  const tmp = useMemo(() => ({
    m: new THREE.Matrix4(), a: new THREE.Vector3(), b: new THREE.Vector3(),
    c: new THREE.Vector3(), col: new THREE.Color(), q: new THREE.Quaternion(), s: new THREE.Vector3(),
  }), [])
  const linkPos = useMemo(() => new Float32Array(96 * 2 * 2 * 3), [])
  const trailPos = useMemo(() => new Float32Array(96 * 2 * 3), [])
  const colWhite = useMemo(() => new THREE.Color('#ffffff'), [])
  const colCin = useMemo(() => new THREE.Color(pal.cinnabar), [pal])

  useEffect(() => {
    if (!still) return
    while (!ep.done) advance(ep)
    clock.current.t = 0.999
    invalidate()
  }, [still, ep, invalidate])

  useFrame((state, dt) => {
    const ck = clock.current
    const genSec = liveRef.current.genSec
    if (!still) {
      const ang = state.clock.elapsedTime * (Math.PI * 2 / 90) + 0.55
      camera.position.set(Math.cos(ang) * 3.15, 2.35, Math.sin(ang) * 3.15)
      camera.lookAt(0, 0.2, 0)
      if (ep.done) {
        ck.hold += dt
        if (ck.hold > HOLD_SEC) {
          seedRef.current += 7919
          ck.hold = 0; ck.t = 0
          setEp(newEpisode(seedRef.current, liveRef.current))
          return
        }
      } else {
        ck.t += dt / genSec
        if (!ep.gen || ck.t >= 1) { advance(ep); ck.t = ep.gen && ck.t >= 1 ? ck.t - 1 : 0 }
      }
    } else {
      camera.position.set(Math.cos(0.55) * 3.15, 2.35, Math.sin(0.55) * 3.15)
      camera.lookAt(0, 0.2, 0)
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
    const popN = Math.min(N, g.pop.length)
    for (let k = 0; k < popN; k++) {
      const [pa, pb] = g.parents[k]
      const A = prev[pa]
      const pre = g.preMutation[k]
      const fin = g.pop[k]
      if (phase <= 1) toWorld(prev[k], ep.ls, tmp.c)
      else if (phase === 2) { toWorld(A, ep.ls, tmp.a); toWorld(pre, ep.ls, tmp.b); tmp.c.lerpVectors(tmp.a, tmp.b, tCross) }
      else { toWorld(pre, ep.ls, tmp.a); toWorld(fin, ep.ls, tmp.b); tmp.c.lerpVectors(tmp.a, tmp.b, g.mutated[k] ? tMut : 1) }

      const fit = (phase <= 1 ? prev[k].fit : fin.fit) / ep.ls.fMax
      let scale = 0.55 + fit * 0.55
      if (phase === 0) scale *= 1 + 0.3 * Math.sin(t / 0.22 * Math.PI) * fit
      if (phase === 1) scale *= usedAsParent.has(k) ? 1.2 : 0.5
      tmp.s.setScalar(scale)
      tmp.m.compose(tmp.c, tmp.q, tmp.s)
      dots.current.setMatrixAt(k, tmp.m)
      tmp.col.copy(colWhite)
      if (phase === 3 && g.mutated[k] && tMut < 1) tmp.col.lerp(colCin, 1 - tMut * 0.5)
      if (phase === 1 && !usedAsParent.has(k)) tmp.col.multiplyScalar(0.5)
      dots.current.setColorAt(k, tmp.col)

      if (phase === 2 && k >= ep.params.elite && k % 2 === 0) {
        toWorld(A, ep.ls, tmp.a); toWorld(prev[pb], ep.ls, tmp.b)
        tmp.a.toArray(linkPos, li); tmp.c.toArray(linkPos, li + 3); li += 6
        tmp.b.toArray(linkPos, li); tmp.c.toArray(linkPos, li + 3); li += 6
      }
      if (phase === 3 && g.mutated[k]) {
        toWorld(pre, ep.ls, tmp.a)
        tmp.a.toArray(trailPos, ti); tmp.c.toArray(trailPos, ti + 3); ti += 6
      }
    }
    for (let k = popN; k < 96; k++) {
      tmp.s.setScalar(0)
      tmp.m.compose(tmp.c.set(0, -10, 0), tmp.q, tmp.s)
      dots.current.setMatrixAt(k, tmp.m)
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

  const pointMat = useMemo(() => new THREE.PointsMaterial({
    size: pal.isLight ? 0.012 : 0.014,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: pal.isLight ? 0.46 : 0.58,
    depthWrite: false,
    toneMapped: false,
  }), [pal])

  return (
    <>
      <fog attach="fog" args={[pal.bg, 3.8, 8.5]} />
      <ambientLight intensity={pal.isLight ? 0.85 : 0.5} />
      <directionalLight position={[-2, 3.5, 1.5]} intensity={pal.isLight ? 0.9 : 1.1} />
      <directionalLight position={[2, 1.2, -2]} intensity={0.28} color={pal.deep} />
      <points geometry={field} frustumCulled={false}>
        <primitive object={pointMat} attach="material" />
      </points>
      <instancedMesh ref={dots} args={[undefined, undefined, 96]} frustumCulled={false}>
        <sphereGeometry args={[0.007, 8, 6]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <lineSegments ref={links} frustumCulled={false}>
        <bufferGeometry><bufferAttribute attach="attributes-position" args={[linkPos, 3]} /></bufferGeometry>
        <lineBasicMaterial color={pal.bone} transparent opacity={0.28} />
      </lineSegments>
      <lineSegments ref={trails} frustumCulled={false}>
        <bufferGeometry><bufferAttribute attach="attributes-position" args={[trailPos, 3]} /></bufferGeometry>
        <lineBasicMaterial color={pal.cinnabar} transparent opacity={0.85} toneMapped={false} />
      </lineSegments>
      <group ref={marker}>
        <mesh position={[0, 0.12, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.035, 0.08, 3]} />
          <meshBasicMaterial color={pal.ochre} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.06, 0]}>
          <cylinderGeometry args={[0.0025, 0.0025, 0.12, 6]} />
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
  const [live, setLive] = useState<GaLiveParams>(DEFAULT_LIVE)
  const [restartKey, setRestartKey] = useState(0)
  const still = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true, [])
  // «Пауза анимации» (HUD) — общая для бесконечных анимаций; при «меньше движения» по умолчанию на паузе.
  const [paused] = useAnimationPaused()
  const [hidden, setHidden] = useState(() => document.hidden)
  useEffect(() => {
    const on = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])

  const onParams = useCallback((next: GaLiveParams) => {
    setLive(next)
    setRestartKey((k) => k + 1)
  }, [])

  return (
    <div className="ga-landscape" aria-hidden="false">
      <Canvas
        className="ga-landscape__canvas"
        dpr={[1, 1.75]}
        frameloop={still || hidden || paused ? 'demand' : 'always'}
        camera={{ position: [2.2, 2.2, 1.6], fov: 42, near: 0.05, far: 28 }}
        gl={{ antialias: true, alpha: false, powerPreference: 'low-power' }}
        onCreated={({ gl }) => gl.setClearColor(pal.bg)}
      >
        <color attach="background" args={[pal.bg]} />
        <Scene pal={pal} live={live} onHud={setHud} still={still} restartKey={restartKey} />
      </Canvas>
      <div className="ga-landscape__vignette" aria-hidden="true" />
      {hud && <LandscapeHud hud={hud} params={live} onParams={onParams} />}
    </div>
  )
}
