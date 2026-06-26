import { useModel, preloadModel, type GroupProps } from './gltf'

const URL = '/models/briquettes.glb'

/** Участок брикетизации. */
export function Briquettes(props: GroupProps) {
  const { nodes, materials } = useModel(URL)
  return (
    <group {...props} dispose={null}>
      <mesh castShadow receiveShadow geometry={nodes.Cube_1.geometry} material={materials.Material} />
      <mesh castShadow receiveShadow geometry={nodes.Cube_2.geometry} material={materials['Материал']} />
      <mesh
        castShadow
        receiveShadow
        geometry={nodes.Cube_3.geometry}
        material={materials['Материал.001']}
      />
    </group>
  )
}

preloadModel(URL)
