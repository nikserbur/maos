/**
 * Кадрирование камеры по уровню (X2 P-31): у каждого 3D-уровня своя поза — уход сохраняет,
 * возврат восстанавливает; первый визит любого уровня вписывается автоматически; «Вписать» (F)
 * сохраняет текущий ракурс и меняет только дистанцию и цель. Кэш поз живёт в PlantScene и
 * переживает размонтирование Canvas (мировой уровень — 2D). Геометрия — cameraPose.ts.
 */
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { SceneNode } from './graph/sceneModel'
import { fitBoxDistance, fitPose, guardPose, levelBounds, viewDirection, withPose, type LevelBounds, type Pose, type Vec3 } from './cameraPose'

export type PoseCache = MutableRefObject<ReadonlyMap<string, Pose>>

export interface LevelFit {
  bounds: LevelBounds
  dir: Vec3
  /** Дистанция вписывания уровня при текущем размере холста. */
  distance: number
}

/** Рамка, ракурс и дистанция вписывания уровня (внутри Canvas: нужен размер холста и fov). */
export function useLevelFit(nodes: ReadonlyArray<Pick<SceneNode, 'position'>>): LevelFit {
  const size = useThree((s) => s.size)
  const camera = useThree((s) => s.camera)
  const fov = camera instanceof THREE.PerspectiveCamera ? camera.fov : 44
  return useMemo(() => {
    const bounds = levelBounds(nodes)
    const dir = viewDirection(bounds)
    const distance = fitBoxDistance(bounds, dir, fov, size.width / Math.max(1, size.height))
    return { bounds, dir, distance }
  }, [nodes, fov, size.width, size.height])
}

interface CameraFitProps {
  nodes: SceneNode[]
  /** Ключ уровня (id текущего родителя). */
  levelKey: string
  /** Инкремент = ручное «Вписать» (кнопка или клавиша F). */
  fitToken: number
  /** Кэш поз по уровням (ref PlantScene: переживает размонтирование Canvas). */
  poses: PoseCache
}

const toVec = (v: THREE.Vector3): Vec3 => [v.x, v.y, v.z]

export function CameraFit({ nodes, levelKey, fitToken, poses }: CameraFitProps) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null
  const size = useThree((s) => s.size)
  const fit = useLevelFit(nodes)
  const fitRef = useRef(fit)
  fitRef.current = fit
  const lastToken = useRef(fitToken)
  const lastLevel = useRef<string | null>(null)

  const apply = (pose: Pose) => {
    if (!controls) return
    const p = guardPose(pose)
    controls.target.set(...p.target)
    camera.position.set(...p.position)
    camera.updateProjectionMatrix()
    controls.update()
  }
  const current = (): Pose | null => (controls ? { position: toVec(camera.position), target: toVec(controls.target) } : null)

  // Смена уровня: поза прежнего — в кэш; новый — из кэша или вписать (первый визит).
  useEffect(() => {
    if (!controls || lastLevel.current === levelKey) return
    const prev = lastLevel.current
    const pose = current()
    if (prev !== null && pose) poses.current = withPose(poses.current, prev, pose)
    lastLevel.current = levelKey
    const saved = poses.current.get(levelKey)
    const f = fitRef.current
    apply(saved ?? fitPose(f.bounds, f.dir, f.distance))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls, levelKey])

  // Уход с 3D (мировой уровень размонтирует Canvas) — сохранить позу последнего уровня.
  useEffect(() => () => {
    const pose = current()
    if (lastLevel.current !== null && pose) poses.current = withPose(poses.current, lastLevel.current, pose)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls])

  // Ручное «Вписать»: текущий ракурс, новая цель и дистанция.
  useEffect(() => {
    if (fitToken === lastToken.current || !controls) return
    lastToken.current = fitToken
    const f = fitRef.current
    const view = camera.position.clone().sub(controls.target).normalize()
    const keep = view.lengthSq() > 1e-6 && view.y >= 0.15
    const dir: Vec3 = keep ? toVec(view) : f.dir
    const fov = camera instanceof THREE.PerspectiveCamera ? camera.fov : 44
    const distance = keep ? fitBoxDistance(f.bounds, dir, fov, size.width / Math.max(1, size.height)) : f.distance
    apply(fitPose(f.bounds, dir, distance))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitToken])

  return null
}
