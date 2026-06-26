import { useModel, preloadModel, type GroupProps } from './gltf'

const URL = '/models/transformer.glb'

/** Трансформаторная подстанция — электроснабжение линии. */
export function Transformer(props: GroupProps) {
  const { nodes, materials } = useModel(URL)
  return (
    <group {...props} dispose={null}>
      <group position={[0, 1.163, 0]}>
        <mesh castShadow receiveShadow geometry={nodes.Cube_1.geometry} material={materials.Material} />
        <mesh
          castShadow
          receiveShadow
          geometry={nodes.Cube_2.geometry}
          material={materials['Материал.003']}
        />
      </group>
      <mesh
        castShadow
        receiveShadow
        geometry={nodes.Cube002.geometry}
        material={materials['Материал.002']}
        position={[0, 1.163, 0]}
      />
      <mesh
        castShadow
        receiveShadow
        geometry={nodes.Cube003.geometry}
        material={materials['Материал.001']}
        position={[-0.742, 1.163, -0.003]}
      />
      <mesh
        castShadow
        receiveShadow
        geometry={nodes.Cube004.geometry}
        material={materials['Материал']}
        position={[-1.457, 1.152, -0.013]}
      />
      <mesh
        castShadow
        receiveShadow
        geometry={nodes.Cube005.geometry}
        material={materials.Material}
        position={[0, 1.163, 0]}
        rotation={[-0.022, 0, 0]}
      />
      <group position={[0.024, 1.174, -1.141]} rotation={[-0.022, 0, 0]}>
        <mesh castShadow receiveShadow geometry={nodes.Cube006_1.geometry} material={materials.Material} />
        <mesh
          castShadow
          receiveShadow
          geometry={nodes.Cube006_2.geometry}
          material={materials['Материал.004']}
        />
        <mesh
          castShadow
          receiveShadow
          geometry={nodes.Cube006_3.geometry}
          material={materials['Материал.005']}
        />
      </group>
    </group>
  )
}

preloadModel(URL)
