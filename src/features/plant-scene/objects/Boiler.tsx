import { useModel, preloadModel, type GroupProps } from './gltf'

const URL = '/models/boiler.glb'

/** Котельная — источник тепла для участка сушки. */
export function Boiler(props: GroupProps) {
  const { nodes, materials } = useModel(URL)
  return (
    <group {...props} dispose={null}>
      <mesh
        castShadow
        receiveShadow
        geometry={nodes.Cube_1.geometry}
        position={[0, 2.587, 0]}
        scale={[6.019, 2.574, 2.733]}
        material={materials.Material}
      />
      <mesh
        castShadow
        receiveShadow
        geometry={nodes.Cube_2.geometry}
        position={[0, 2.587, 0]}
        scale={[6.019, 2.574, 2.733]}
        material={materials['Материал']}
      />
      <mesh
        castShadow
        receiveShadow
        geometry={nodes.Cube_3.geometry}
        position={[0, 2.587, 0]}
        scale={[6.019, 2.574, 2.733]}
        material={materials['Материал.003']}
      />
      <mesh
        castShadow
        receiveShadow
        geometry={nodes.Cube_4.geometry}
        position={[0, 2.587, 0]}
        scale={[6.019, 2.574, 2.733]}
        material={materials['Материал.004']}
      />
    </group>
  )
}

preloadModel(URL)
