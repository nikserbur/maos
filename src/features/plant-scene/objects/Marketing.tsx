import { useModel, preloadModel, type GroupProps } from './gltf'

const URL = '/models/marketing.glb'

/** Административно-сбытовой блок (маркетинг). */
export function Marketing(props: GroupProps) {
  const { nodes, materials } = useModel(URL)
  return (
    <group {...props} dispose={null}>
      <mesh
        castShadow
        receiveShadow
        geometry={nodes.Cube.geometry}
        material={materials.Material}
        position={[0, 7.353, -0.567 + 5.25]}
        scale={[3.25, 7.288, 2.7]}
      />
      <group position={[-0.001, 7.48, -9.918 + 5.25]} scale={[3.25, 7.288, 2.7]}>
        <mesh castShadow receiveShadow geometry={nodes.Cube001_1.geometry} material={materials.Material} />
        <mesh castShadow receiveShadow geometry={nodes.Cube001_2.geometry} material={materials['Материал']} />
      </group>
    </group>
  )
}

preloadModel(URL)
