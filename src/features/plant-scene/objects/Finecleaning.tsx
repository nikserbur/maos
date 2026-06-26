import { useModel, preloadModel, type GroupProps } from './gltf'

const URL = '/models/finecleaning.glb'

/** Участок тонкой очистки. */
export function Finecleaning(props: GroupProps) {
  const { nodes, materials } = useModel(URL)
  return (
    <group {...props} dispose={null}>
      <mesh
        castShadow
        receiveShadow
        geometry={nodes.Cube_1.geometry}
        material={materials.Material}
        position={[0, 1.531, 11.7]}
        scale={[1, 1.515, 0.643]}
      />
      <mesh
        castShadow
        receiveShadow
        geometry={nodes.Cube_2.geometry}
        material={materials['Материал.001']}
        position={[0, 1.531, 11.7]}
        scale={[1, 1.515, 0.643]}
      />
      <mesh
        castShadow
        receiveShadow
        geometry={nodes.Cube_3.geometry}
        material={materials['Материал.002']}
        position={[0, 1.531, 11.7]}
        scale={[1, 1.515, 0.643]}
      />
    </group>
  )
}

preloadModel(URL)
