import { ContactShadows, Grid, OrbitControls } from '@react-three/drei'

/**
 * Освещение, фон и «пол» сцены в духе цифрового двойника Palantir:
 * тёмный фон, синяя сетка-блюпринт, мягкие контактные тени.
 */
export function SceneEnvironment() {
  return (
    <>
      <color attach="background" args={['#0d1014']} />
      <fog attach="fog" args={['#0d1014', 55, 150]} />

      <hemisphereLight args={['#cfe0ff', '#0d1014', 0.55]} />
      <ambientLight intensity={0.25} />
      <directionalLight
        position={[20, 30, 14]}
        intensity={1.1}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={0.5}
        shadow-camera-far={140}
        shadow-camera-left={-45}
        shadow-camera-right={45}
        shadow-camera-top={45}
        shadow-camera-bottom={-45}
      />

      <Grid
        infiniteGrid
        position={[0, 0, 0]}
        cellSize={1}
        cellThickness={0.6}
        cellColor="#252a31"
        sectionSize={10}
        sectionThickness={1}
        sectionColor="#2d72d2"
        fadeDistance={130}
        fadeStrength={1.5}
      />

      <ContactShadows
        position={[0, 0.02, 0]}
        scale={90}
        far={40}
        blur={2.4}
        opacity={0.5}
        color="#000000"
        resolution={1024}
      />

      <OrbitControls
        makeDefault
        target={[1, 1, 0]}
        enablePan
        minDistance={10}
        maxDistance={90}
        maxPolarAngle={Math.PI / 2.15}
      />
    </>
  )
}
