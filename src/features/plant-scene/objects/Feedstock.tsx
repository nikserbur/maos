import { useModel, preloadModel, type GroupProps } from './gltf'

const URL = '/models/feedstock.glb'

/** Добыча и подвоз сырья (лигнин). */
export function Feedstock(props: GroupProps) {
  const { nodes, materials } = useModel(URL)
  return (
    <group {...props} dispose={null}>
      <mesh
        castShadow
        receiveShadow
        geometry={nodes.Cube001.geometry}
        material={materials.Material}
        position={[4.321 - 2, -0.001, -0.024 + 3]}
      />
      <mesh
        castShadow
        receiveShadow
        geometry={nodes.Cube002.geometry}
        material={materials.Material}
        position={[0.002 - 2, -0.025, -6.663 + 3]}
      />
      <mesh
        castShadow
        receiveShadow
        geometry={nodes.Cube003.geometry}
        material={materials.Material}
        position={[4.323 - 2, -0.026, -6.687 + 3]}
      />
      <mesh
        castShadow
        receiveShadow
        geometry={nodes.Cube_1.geometry}
        material={materials.Material}
        position={[4.323 - 6.35, -0.026, -6.687 + 9.66]}
      />
      <mesh
        castShadow
        receiveShadow
        geometry={nodes.Cube_2.geometry}
        material={materials['Материал.001']}
        position={[4.323 - 6.35, -0.026, -6.687 + 9.66]}
      />
    </group>
  )
}

preloadModel(URL)
