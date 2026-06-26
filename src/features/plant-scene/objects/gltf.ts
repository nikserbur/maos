import { useGLTF } from '@react-three/drei'

/** Пропсы three-группы (position/rotation/scale/обработчики указателя и пр.). */
export type GroupProps = JSX.IntrinsicElements['group']

/**
 * Узлы и материалы загруженной модели. Имена сеток/материалов заданы
 * в самих .glb (часть — кириллицей из Blender), поэтому доступ идёт по
 * произвольным ключам — типизируем нестрого.
 */
export interface ModelParts {
  nodes: Record<string, any>
  materials: Record<string, any>
}

/** Тонкая обёртка над useGLTF с предсказуемой формой результата. */
export function useModel(url: string): ModelParts {
  return useGLTF(url) as unknown as ModelParts
}

/** Префетч модели (вызывается на уровне модуля компонента). */
export function preloadModel(url: string): void {
  useGLTF.preload(url)
}
