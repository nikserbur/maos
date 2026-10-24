/**
 * Адрес Схемы (X2 P-38): `#/scheme/<завод>/<цех>?sel=<объект>` — уровень и выбранный объект
 * переживают F5 и «Назад». В сегментах пути — id подразделений без служебных префиксов узлов
 * (`factory:`/`shop:`), в `sel` — id узла как есть. Ссылки с других экранов (План, Справочники,
 * Аналитика) знают только станок: `schemeHref(machineId)` → `#/scheme?sel=<id>`, путь до цеха
 * Схема выводит сама по графу (resolveScenePath).
 */
import { anchorParts, buildHash, joinAnchor } from '../../shell/router'
import { FACTORY_PREFIX, SHOP_PREFIX } from './graph/ids'
import type { SceneGraph, SceneNode } from './graph/sceneModel'

export const SCHEME_SCREEN = 'scheme'

/** Ссылка на объект Схемы (станок, цех, завод) — для переходов с других экранов. */
export function schemeHref(nodeId: string): string {
  return buildHash(SCHEME_SCREEN, null, { sel: nodeId })
}

const stripPrefix = (id: string): string =>
  id.startsWith(FACTORY_PREFIX) ? id.slice(FACTORY_PREFIX.length) : id.startsWith(SHOP_PREFIX) ? id.slice(SHOP_PREFIX.length) : id

/** Путь уровней (id узлов от корня) → якорь адреса: ['factory:f1', 'shop:s2'] → `f1/s2`. */
export function schemeAnchor(pathIds: ReadonlyArray<string>): string {
  return joinAnchor(...pathIds.map(stripPrefix))
}

/** Адрес уровня (крошки, «Назад»): `#/scheme/f1/s2`. */
export function levelHref(pathIds: ReadonlyArray<string>): string {
  const anchor = schemeAnchor(pathIds)
  return buildHash(SCHEME_SCREEN, anchor || null)
}

export interface ScenePath {
  /** Путь уровней от корня (без корня «Мир»). */
  ids: string[]
  selectedId: string | null
}

/** Цепочка предков узла (от корня, без самого узла). */
function ancestors(byId: ReadonlyMap<string, SceneNode>, node: SceneNode): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  let p = node.parentId
  while (p && !seen.has(p)) {
    seen.add(p)
    out.unshift(p)
    p = byId.get(p)?.parentId ?? null
  }
  return out
}

/**
 * Куда открыть Схему по адресу: сегменты якоря проверяются по графу (неизвестный обрезает путь);
 * `sel` вне открытого уровня задаёт путь сам — до родителя объекта. При первом открытии без адреса
 * и с одним заводом экран сразу открывает площадку (X2 P-35); «Мир» остаётся корневой крошкой и
 * доступен по ней (тогда `autoEnter` = false).
 */
export function resolveScenePath(graph: SceneGraph, anchor: string | null, sel: string | null | undefined, autoEnter = true): ScenePath {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const ids: string[] = []
  let parent: string | null = null
  for (const seg of anchorParts(anchor)) {
    const node = [FACTORY_PREFIX + seg, SHOP_PREFIX + seg, seg].map((id) => byId.get(id)).find((n) => n && n.parentId === parent)
    if (!node || node.refType === 'machine') break
    ids.push(node.id)
    parent = node.id
  }
  const selNode = sel ? byId.get(sel) : undefined
  if (selNode) {
    if (selNode.parentId === parent) return { ids, selectedId: selNode.id }
    return { ids: ancestors(byId, selNode), selectedId: selNode.id }
  }
  if (autoEnter && ids.length === 0 && !anchor) {
    const factories = graph.nodes.filter((n) => n.refType === 'factory')
    if (factories.length === 1) return { ids: [factories[0].id], selectedId: null }
  }
  return { ids, selectedId: null }
}

/** Ключ состояния для сравнения адреса и сцены. */
export const sceneKey = (anchor: string, sel: string | null | undefined): string => `${anchor}?${sel ?? ''}`
