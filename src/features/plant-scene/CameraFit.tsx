/**
 * Кадрирование камеры по bbox узлов уровня (X1 §1 п. 3): при входе в цех — автоматически,
 * по кнопке «Вписать»/клавише F — вручную (сохраняя текущий ракурс). Работает через
 * OrbitControls, зарегистрированные `makeDefault` в SceneEnvironment; саму 3D-модель не трогает.
 */
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { SceneNode } from './graph/sceneModel'

interface CameraFitProps {
  nodes: SceneNode[]
  /** Ключ уровня (id текущего родителя): смена ключа при `autoFit` → кадрирование. */
  levelKey: string
  /** Кадрировать автоматически при смене уровня (цех). */
  autoFit: boolean
  /** Инкремент = ручное «Вписать» (кнопка или клавиша F). */
  fitToken: number
  /** Запас вокруг bbox: 0,15 = 15 %. */
  margin?: number
}

/** Ракурс по умолчанию при входе на уровень (как стартовая камера сцены, ≈ 30° над горизонтом). */
const DEFAULT_DIR = new THREE.Vector3(0.6, 0.47, 0.65).normalize()
/** Высота объектов цеха — bbox узлов плоский, станки же объёмные. */
const OBJECT_HEIGHT = 3.5
const EMPTY_HALF = 12

interface Bounds { cx: number; cz: number; radius: number }

/** Сфера, описывающая узлы уровня в плане (+ высота объектов), с запасом `margin`. */
export function levelBounds(nodes: ReadonlyArray<SceneNode>, margin: number): Bounds {
  if (nodes.length === 0) return { cx: 0, cz: 0, radius: EMPTY_HALF * (1 + margin) }
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const n of nodes) {
    const [x, z] = n.position
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z)
  }
  const hw = Math.max(4, (maxX - minX) / 2 + 2)
  const hd = Math.max(4, (maxZ - minZ) / 2 + 2)
  const radius = Math.hypot(hw, hd, OBJECT_HEIGHT / 2) * (1 + margin)
  return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, radius }
}

/** Дистанция, на которой сфера радиуса r целиком входит в кадр перспективной камеры. */
export function fitDistance(radius: number, vFovDeg: number, aspect: number): number {
  const vHalf = THREE.MathUtils.degToRad(vFovDeg) / 2
  const hHalf = Math.atan(Math.tan(vHalf) * aspect)
  return radius / Math.sin(Math.min(vHalf, hHalf))
}

export function CameraFit({ nodes, levelKey, autoFit, fitToken, margin = 0.15 }: CameraFitProps) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null
  const size = useThree((s) => s.size)
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const lastToken = useRef(fitToken)
  const lastLevel = useRef<string | null>(null)

  const fit = (keepView: boolean) => {
    if (!controls || !(camera instanceof THREE.PerspectiveCamera)) return
    const { cx, cz, radius } = levelBounds(nodesRef.current, margin)
    const target = new THREE.Vector3(cx, 1, cz)
    const dir = keepView
      ? camera.position.clone().sub(controls.target).normalize()
      : DEFAULT_DIR.clone()
    if (dir.lengthSq() < 1e-6 || dir.y < 0.15) dir.copy(DEFAULT_DIR)
    const aspect = size.width / Math.max(1, size.height)
    const d = THREE.MathUtils.clamp(fitDistance(radius, camera.fov, aspect), controls.minDistance, controls.maxDistance)
    controls.target.copy(target)
    camera.position.copy(target).addScaledVector(dir, d)
    camera.updateProjectionMatrix()
    controls.update()
  }

  // Вход на уровень: ракурс по умолчанию (детерминированный кадр).
  useEffect(() => {
    if (!controls || lastLevel.current === levelKey) return
    lastLevel.current = levelKey
    if (autoFit) fit(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls, levelKey, autoFit])

  // Ручное «Вписать»: сохраняем текущий ракурс, меняем только дистанцию и цель.
  useEffect(() => {
    if (fitToken === lastToken.current) return
    lastToken.current = fitToken
    fit(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitToken])

  return null
}
