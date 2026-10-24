/**
 * Ссылки Схемы в Справочники (X2 «связанный конвейер»): станок → карточка в реестре «Оборудование»,
 * цех/завод → «Подразделения». Выбранная запись передаётся параметром `sel` (P-45).
 */
import { buildHash } from '../../shell/router'
import type { SceneNode } from './graph/sceneModel'

/** Реестр «Подразделения» в Справочниках (заводы, склады, цеха). */
export const ORG_UNITS_HREF = buildHash('nsi', 'orgunit')

/** Карточка объекта схемы в Справочниках; у виртуального предприятия (нет записи) — null. */
export function nsiHref(node: Pick<SceneNode, 'refType' | 'id' | 'orgUnitId'>): string | null {
  if (node.refType === 'machine') return buildHash('nsi', 'machine', { sel: node.id })
  return node.orgUnitId ? buildHash('nsi', 'orgunit', { sel: node.orgUnitId }) : null
}
