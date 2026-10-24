import { describe, expect, it } from 'vitest'
import { levelHref, resolveScenePath, schemeAnchor, schemeHref } from './schemeHref'
import type { SceneGraph, SceneNode } from './graph/sceneModel'

const node = (id: string, parentId: string | null, refType: SceneNode['refType'], title = id): SceneNode => ({
  id, parentId, refType, kind: 'marketing', title, subtitle: '', position: [0, 0], scale: 1, status: 'running', kpis: [],
})

const graph: SceneGraph = {
  nodes: [
    node('factory:f1', null, 'factory'),
    node('factory:f2', null, 'factory'),
    node('shop:s1', 'factory:f1', 'shop'),
    node('shop:s2', 'factory:f2', 'shop'),
    node('m1', 'shop:s1', 'machine'),
    node('m2', 'shop:s2', 'machine'),
  ],
  edges: [],
}

describe('адрес Схемы', () => {
  it('ссылка на станок с других экранов — только sel', () => {
    expect(schemeHref('m1')).toBe('#/scheme?sel=m1')
  })

  it('якорь пути — id подразделений без служебных префиксов', () => {
    expect(schemeAnchor(['factory:f1', 'shop:s1'])).toBe('f1/s1')
    expect(levelHref([])).toBe('#/scheme')
    expect(levelHref(['factory:f1'])).toBe('#/scheme/f1')
  })

  it('F5 в цехе с выбранным станком восстанавливает и цех, и выбор', () => {
    expect(resolveScenePath(graph, 'f1/s1', 'm1')).toEqual({ ids: ['factory:f1', 'shop:s1'], selectedId: 'm1' })
  })

  it('sel вне открытого уровня задаёт путь до родителя объекта', () => {
    expect(resolveScenePath(graph, null, 'm2')).toEqual({ ids: ['factory:f2', 'shop:s2'], selectedId: 'm2' })
    expect(resolveScenePath(graph, 'f1', 'm2')).toEqual({ ids: ['factory:f2', 'shop:s2'], selectedId: 'm2' })
  })

  it('неизвестный сегмент обрезает путь, неизвестный sel игнорируется', () => {
    expect(resolveScenePath(graph, 'f1/nope', 'zzz')).toEqual({ ids: ['factory:f1'], selectedId: null })
    expect(resolveScenePath(graph, 'f2/s1', null)).toEqual({ ids: ['factory:f2'], selectedId: null })
  })

  it('без адреса и с одним заводом — сразу площадка', () => {
    const single: SceneGraph = { nodes: [node('factory:__default__', null, 'factory'), node('shop:a', 'factory:__default__', 'shop')], edges: [] }
    expect(resolveScenePath(single, null, null)).toEqual({ ids: ['factory:__default__'], selectedId: null })
    expect(resolveScenePath(graph, null, null)).toEqual({ ids: [], selectedId: null })
    expect(resolveScenePath(single, null, null, false)).toEqual({ ids: [], selectedId: null })
  })
})
