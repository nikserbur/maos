import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { ContactShadows, Grid, OrbitControls } from '@react-three/drei'
import { useThemeColors, type ThemeColors } from './themeColors'

interface SceneEnvironmentProps {
  /** true — внутри цеха (закрытая площадка); false — открытая территория с травой. */
  indoor?: boolean
  /** Габарит сцены (расстояние до самого дальнего объекта) — туман/тени под него. */
  extent?: number
}

/**
 * Декоративные цвета земли/сетки (материалы 3D, AUDIT §5 — исключение из правила токенов).
 * В тёмной теме газон глубже и спокойнее, чтобы не спорить с сумеречным небом.
 */
const GROUND = {
  dark: { lawn: '#3d5640', lawnCell: '#40573f', lawnSection: '#4f6b4a' },
  light: { lawn: '#4a6d45', lawnCell: '#46603f', lawnSection: '#5b7a52' },
  floor: '#2b2f36', floorCell: '#3a3f47', floorSection: '#4a5562',
} as const

/** Небо = вертикальный градиент по направлению взгляда: горизонт = туман = --bg-app. */
interface SkyPalette { horizon: THREE.Color; glow: THREE.Color; zenith: THREE.Color }

function skyPalette(c: ThemeColors, indoor: boolean): SkyPalette {
  const horizon = new THREE.Color(c.bgApp)
  const ultra = new THREE.Color(c.ultramarine)
  if (c.theme === 'dark') {
    // Сумерки «ink-ультрамарин»: чуть светлее и синее над горизонтом, глубже к зениту.
    const glow = horizon.clone().lerp(ultra, indoor ? 0.04 : 0.14)
    const zenith = horizon.clone().lerp(ultra, 0.1).multiplyScalar(0.62)
    return { horizon, glow, zenith }
  }
  // Светлая тема: бумажный горизонт, яркое нейтральное небо с лёгкой синевой к зениту.
  const glow = horizon.clone().lerp(new THREE.Color(c.bone), 0.4)
  const zenith = horizon.clone().lerp(ultra, indoor ? 0.08 : 0.2)
  return { horizon, glow, zenith }
}

const SKY_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`
const SKY_FRAG = /* glsl */ `
  uniform vec3 uHorizon;
  uniform vec3 uGlow;
  uniform vec3 uZenith;
  varying vec3 vWorld;
  void main() {
    float h = normalize(vWorld - cameraPosition).y;
    vec3 col = mix(uHorizon, uGlow, smoothstep(0.0, 0.10, h));
    col = mix(col, uZenith, smoothstep(0.06, 0.62, h));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`
/** Радиус купола < far камеры (1500) − maxDistance OrbitControls: купол не обрезается. */
const SKY_RADIUS = 900

/** Купол неба: один draw call, без работы в кадре; униформы меняются только при смене темы. */
function SkyDome({ palette }: { palette: SkyPalette }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uHorizon: { value: new THREE.Color() },
          uGlow: { value: new THREE.Color() },
          uZenith: { value: new THREE.Color() },
        },
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    [],
  )
  useEffect(() => {
    material.uniforms.uHorizon.value.copy(palette.horizon)
    material.uniforms.uGlow.value.copy(palette.glow)
    material.uniforms.uZenith.value.copy(palette.zenith)
  }, [material, palette])
  useEffect(() => () => material.dispose(), [material])

  return (
    <mesh renderOrder={-1000} frustumCulled={false} material={material}>
      <sphereGeometry args={[SKY_RADIUS, 32, 16]} />
    </mesh>
  )
}

/**
 * Окружение сцены: открытая территория предприятия (трава) либо пол цеха,
 * мягкое освещение и контактные тени. Небо/туман следуют теме (горизонт = --bg-app),
 * чтобы 3D-двойник сидел ВНУТРИ интерфейса, а не в отдельном «мире».
 */
export function SceneEnvironment({ indoor = false, extent = 60 }: SceneEnvironmentProps) {
  const colors = useThemeColors()
  const palette = useMemo(() => skyPalette(colors, indoor), [colors, indoor])
  const lawn = GROUND[colors.theme]
  const ground = indoor ? GROUND.floor : lawn.lawn
  const horizon = colors.bgApp

  // Туман: завод по умолчанию чёткий (near ≈ за самым дальним цехом от камеры),
  // а земля растворяется в горизонте ЗАДОЛГО до края ground-плоскости — границ карты
  // не видно, горизонт «бесконечный».
  const fogNear = extent * (indoor ? 1.6 : 2.1)
  const fogFar  = extent * (indoor ? 3.6 : 4.2)
  // Тени плотно вокруг застройки — растянутый масштаб давал радиальные «мазки».
  const shadowScale = Math.min(200, extent * 1.7)
  // Ортокамера тени ПЛОТНО облегает сцену: раньше огромный frustum (extent+20,
  // far=220) при 2048² давал ~19 тексел/ед → «частокол» акне на станках в цехе.
  // Тесный frustum + far под геометрию + 4096² резко поднимают плотность теней.
  const shadowRange = indoor ? extent * 1.04 : extent + 20
  const shadowFar   = 70 + extent * 1.7

  return (
    <>
      <color attach="background" args={[horizon]} />
      <fog attach="fog" args={[horizon, fogNear, fogFar]} />
      <SkyDome palette={palette} />

      {/* В цехе — РОВНЫЙ свет (ряды верхних ламп), почти без теней: яркие
          hemisphere+ambient. На улице — солнечный ключевой свет с тенями. */}
      <hemisphereLight args={[indoor ? '#dfe8f5' : '#eaf4ff', ground, indoor ? 0.85 : 0.9]} />
      <ambientLight intensity={indoor ? 0.6 : 0.45} />
      {/* Направленный свет с картой теней — ТОЛЬКО на улице. В цехе карта теней
          давала «частокол» акне на тёмном полу под скользящим углом; заводской
          цех освещён равномерно, поэтому indoor тени не строим вовсе. Внутри
          оставляем слабый направленный свет БЕЗ теней — только для объёма граней. */}
      {indoor ? (
        <directionalLight position={[24, 34, 16]} intensity={0.5} color="#fff6e8" />
      ) : (
        <directionalLight
          position={[30, 40, 18]}
          intensity={1.35}
          color="#fff6e8"
          castShadow
          shadow-mapSize={[4096, 4096]}
          shadow-bias={-0.0002}
          shadow-normalBias={0.05}
          shadow-camera-near={0.5}
          shadow-camera-far={shadowFar}
          shadow-camera-left={-shadowRange}
          shadow-camera-right={shadowRange}
          shadow-camera-top={shadowRange}
          shadow-camera-bottom={-shadowRange}
        />
      )}

      {/* Земля: огромная плоскость. В цехе НЕ приёмник теней (иначе два почти
          компланарных приёмника — пол цеха и эта земля — давали муар). */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[2, -0.02, -2]} receiveShadow={!indoor}>
        <planeGeometry args={[3000, 3000]} />
        <meshStandardMaterial color={ground} roughness={1} metalness={0} />
      </mesh>

      <Grid
        infiniteGrid
        position={[0, 0, 0]}
        cellSize={1}
        cellThickness={0.5}
        cellColor={indoor ? GROUND.floorCell : lawn.lawnCell}
        sectionSize={10}
        sectionThickness={1}
        sectionColor={indoor ? GROUND.floorSection : lawn.lawnSection}
        fadeDistance={extent * 2.2}
        fadeStrength={1.6}
      />

      {/* Мягкая контактная тень строго под застройкой — ТОЛЬКО на улице: в цехе
          её блюр-мазки на тёмном полу выглядели как «лаги» теней. y=0.008 — ниже
          дорог/площадок (иначе z-fighting). */}
      {!indoor && (
        <ContactShadows position={[0, 0.008, 0]} scale={shadowScale} far={22} blur={1.8} opacity={0.32}
                        color="#000000" resolution={512} />
      )}

      <OrbitControls makeDefault target={[1, 1, 0]} enablePan
                     minDistance={8} maxDistance={Math.max(indoor ? 110 : 170, extent * 2.3)}
                     maxPolarAngle={Math.PI / 2.1} />
    </>
  )
}
