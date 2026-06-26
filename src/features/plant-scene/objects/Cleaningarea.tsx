import { useModel, preloadModel, type GroupProps } from './gltf'

const URL = '/models/cleaningarea.glb'

/** Узел схемы — 3D-модель cleaningarea.glb. */
export function Cleaningarea(props: GroupProps) {
  const { nodes, materials } = useModel(URL)
  return (
    <group {...props} dispose={null}>
      <mesh
        castShadow
        receiveShadow
        geometry={nodes.Cube_1.geometry}
        material={materials.Material}
        position={[-4, 1.634, 0]}
        scale={[2.848, 0.164, 0.711]}
      />
      <mesh
        castShadow
        receiveShadow
        geometry={nodes.Cube_2.geometry}
        material={materials['Материал']}
        position={[-4, 1.634, 0]}
        scale={[2.848, 0.164, 0.711]}
      />
      <mesh
        castShadow
        receiveShadow
        geometry={nodes.Cube_3.geometry}
        material={materials['Материал.001']}
        position={[-4, 1.634, 0]}
        scale={[2.848, 0.164, 0.711]}
      />
    </group>
  )
}

preloadModel(URL)
