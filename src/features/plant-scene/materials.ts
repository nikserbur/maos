/**
 * Загрузка CC0 PBR-текстур (Poly Haven, public domain) для реалистичных
 * поверхностей сцены. Наборы лежат в /public/textures/<id>/<id>_{diff,nor,rough}.jpg.
 * Текстуры кэшируются drei-loader'ом; клонируем на потребителя, чтобы у каждой
 * поверхности был свой тайлинг (repeat), не ломая общий кэш.
 */
import { useMemo } from 'react'
import * as THREE from 'three'
import { useTexture } from '@react-three/drei'

const BASE = '/textures'

/** Имя поверхности → путь-префикс набора карт. */
export const SURFACES = {
  concrete: 'concrete_floor_02/concrete_floor_02',
  metal:    'metal_plate/metal_plate',
  asphalt:  'asphalt_02/asphalt_02',
  siding:   'corrugated_iron/corrugated_iron',
} as const

export type SurfaceName = keyof typeof SURFACES

export interface SurfaceMaps {
  map: THREE.Texture
  normalMap: THREE.Texture
  roughnessMap: THREE.Texture
}

/**
 * PBR-набор поверхности с заданным тайлингом. Возвращает пропсы, которые
 * раскладываются прямо в <meshStandardMaterial {...maps} />.
 * aoMap намеренно не используем — контактное затенение даёт экранный N8AO,
 * а aoMap потребовал бы второй UV-набор (uv1) на геометрии.
 */
export function useSurface(name: SurfaceName, repeatX = 1, repeatY = repeatX): SurfaceMaps {
  const p = `${BASE}/${SURFACES[name]}`
  const [diff, nor, rough] = useTexture([`${p}_diff.jpg`, `${p}_nor.jpg`, `${p}_rough.jpg`])

  return useMemo(() => {
    const prep = (t: THREE.Texture, srgb: boolean): THREE.Texture => {
      const c = t.clone()
      c.wrapS = c.wrapT = THREE.RepeatWrapping
      c.repeat.set(repeatX, repeatY)
      c.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
      c.anisotropy = 8
      c.needsUpdate = true
      return c
    }
    return {
      map: prep(diff, true),
      normalMap: prep(nor, false),
      roughnessMap: prep(rough, false),
    }
  }, [diff, nor, rough, repeatX, repeatY])
}
