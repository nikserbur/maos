import { useModel, preloadModel, type GroupProps } from './gltf'

const URL = '/models/dryer.glb'

/** Участок сушки лигнина. */
export function Dryer(props: GroupProps) {
  const { nodes, materials } = useModel(URL)
  return (
    <group {...props} dispose={null}>
      <group position={[0, 2.807, -9]} rotation={[-0.829, 0, 0]} scale={[1, 0.163, 2.931]}>
        <mesh castShadow receiveShadow geometry={nodes.Cube_1.geometry} material={materials.Material} />
        <mesh castShadow receiveShadow geometry={nodes.Cube_2.geometry} material={materials['Материал']} />
        <mesh
          castShadow
          receiveShadow
          geometry={nodes.Cube_3.geometry}
          material={materials['Материал.001']}
        />
      </group>
    </group>
  )
}

preloadModel(URL)
