import { ContactShadows, Grid, OrbitControls } from '@react-three/drei'

interface SceneEnvironmentProps {
  /** true — внутри цеха (закрытая площадка); false — открытая территория с травой. */
  indoor?: boolean
  /** Габарит сцены (расстояние до самого дальнего объекта) — туман/тени под него. */
  extent?: number
}

/**
 * Окружение сцены: открытая территория предприятия (трава) либо пол цеха,
 * мягкое дневное освещение и контактные тени.
 */
export function SceneEnvironment({ indoor = false, extent = 60 }: SceneEnvironmentProps) {
  const sky    = indoor ? '#14181e' : '#b8d4e6'   // светлое небо
  const ground = indoor ? '#2b2f36' : '#4a6d45'   // бетон цеха / газон

  // Туман: завод по умолчанию чёткий (near ≈ за самым дальним цехом от камеры),
  // а земля растворяется в небе ЗАДОЛГО до края ground-плоскости — границ карты
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
      <color attach="background" args={[sky]} />
      <fog attach="fog" args={[sky, fogNear, fogFar]} />

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
        cellColor={indoor ? '#3a3f47' : '#46603f'}
        sectionSize={10}
        sectionThickness={1}
        sectionColor={indoor ? '#4a5562' : '#5b7a52'}
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
