import { ContactShadows, Grid, OrbitControls } from '@react-three/drei'

interface SceneEnvironmentProps {
  /** true — внутри цеха (закрытая площадка); false — открытая территория с травой. */
  indoor?: boolean
}

/**
 * Окружение сцены: открытая территория предприятия (трава) либо пол цеха,
 * мягкое дневное освещение и контактные тени.
 */
export function SceneEnvironment({ indoor = false }: SceneEnvironmentProps) {
  const sky      = indoor ? '#14181e' : '#9fb6cc'
  const ground   = indoor ? '#2b2f36' : '#3f5d3a'   // бетон цеха / газон
  const groundFar = indoor ? '#23272d' : '#2c4530'

  return (
    <>
      <color attach="background" args={[sky]} />
      <fog attach="fog" args={[sky, 70, 190]} />

      <hemisphereLight args={[indoor ? '#cfe0ff' : '#dff0ff', ground, indoor ? 0.5 : 0.75]} />
      <ambientLight intensity={indoor ? 0.3 : 0.45} />
      <directionalLight
        position={[30, 40, 18]}
        intensity={indoor ? 1.0 : 1.35}
        color="#fff6e8"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={0.5}
        shadow-camera-far={180}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
      />

      {/* Земля: газон территории или бетонный пол цеха */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[2, -0.02, -2]} receiveShadow>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color={ground} roughness={1} metalness={0} />
      </mesh>
      {/* Дальний оттенок для глубины */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[2, -0.03, -2]}>
        <ringGeometry args={[70, 200, 64]} />
        <meshBasicMaterial color={groundFar} />
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
        fadeDistance={120}
        fadeStrength={1.6}
      />

      <ContactShadows position={[0, 0.04, 0]} scale={120} far={45} blur={2.2} opacity={0.45}
                      color="#000000" resolution={1024} />

      <OrbitControls makeDefault target={[1, 1, 0]} enablePan
                     minDistance={8} maxDistance={120} maxPolarAngle={Math.PI / 2.1} />
    </>
  )
}
