import type { ComponentType } from 'react'
import type { GroupProps } from './objects/gltf'
import type { ObjectKind } from './types'
import { Feedstock } from './objects/Feedstock'
import { Cleaningarea } from './objects/Cleaningarea'
import { Dryer } from './objects/Dryer'
import { Boiler } from './objects/Boiler'
import { Finecleaning } from './objects/Finecleaning'
import { Briquettes } from './objects/Briquettes'
import { Pileizer } from './objects/Pileizer'
import { Transformer } from './objects/Transformer'
import { Wirehouse } from './objects/Wirehouse'
import { Sale } from './objects/Sale'
import { Marketing } from './objects/Marketing'

/** Соответствие типа узла схемы → 3D-компонент. */
export const OBJECT_REGISTRY: Record<ObjectKind, ComponentType<GroupProps>> = {
  feedstock: Feedstock,
  cleaningarea: Cleaningarea,
  dryer: Dryer,
  boiler: Boiler,
  finecleaning: Finecleaning,
  briquettes: Briquettes,
  pileizer: Pileizer,
  transformer: Transformer,
  wirehouse: Wirehouse,
  sale: Sale,
  marketing: Marketing,
}
