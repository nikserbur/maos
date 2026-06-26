import { useModel, preloadModel, type GroupProps } from './gltf'

const URL = '/models/wirehouse.glb'

/** Склад готовой продукции. */
export function Wirehouse(props: GroupProps) {
  const { nodes, materials } = useModel(URL)
  return (
    <group {...props} dispose={null}>
      <mesh
        castShadow
        receiveShadow
        scale={[5, 1, 5]}
        position={[0, -1, 0]}
        geometry={nodes.Cube_1.geometry}
        material={materials.Material}
      />
      <mesh
        castShadow
        receiveShadow
        scale={[5, 1, 5]}
        position={[0, -1, 0]}
        geometry={nodes.Cube_2.geometry}
        material={materials['Материал.001']}
      />
      <mesh
        castShadow
        receiveShadow
        scale={[5, 1, 5]}
        position={[0, -1, 0]}
        geometry={nodes.Cube_3.geometry}
        material={materials['Материал.002']}
      />
    </group>
  )
}

preloadModel(URL)
