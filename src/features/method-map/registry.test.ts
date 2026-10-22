import { describe, expect, it } from 'vitest'
import { isDiagramId, isMethodologyAnchor } from '../../explain/anchors'
import { getMetric } from '../../explain/metrics'
import { SCREENS } from '../../shell/screens'
import { BLOCKS } from './blocks'
import { ALL_EDGES, L0_EDGES } from './edges'
import { getParamDef } from './params'
import { NODES, REGISTRY, blocksForScreen, childrenOf, descendantsOf, getNode, nodeForMetric, pathOf, searchNodes } from './registry'
import { BLOCK_IDS, type MapEdgeKind, type MapNodeKind } from './types'

const SCREEN_IDS = new Set(SCREENS.map((s) => s.id))
const LEAF_KINDS: readonly MapNodeKind[] = ['parameter', 'formula', 'dataset', 'screen']
const EDGE_KINDS: readonly MapEdgeKind[] = ['data', 'param', 'feedback', 'control', 'explain']

/** Канонические имена PLAN-V2 §3 — порядок и названия обязательны. */
const CANON = ['Внешние условия', 'Распределения', 'Внутренние условия', 'Решения', 'Критерии', 'Агенты', 'Прогноз и мониторинг', 'LLM (MENTAT)']

describe('method-map registry integrity', () => {
  it('has 8 canonical blocks in PLAN-V2 §3 order with fixed L0 positions', () => {
    expect(BLOCKS.map((b) => b.id)).toEqual(BLOCK_IDS)
    expect(BLOCKS.map((b) => b.title)).toEqual(CANON)
    BLOCKS.forEach((b, i) => expect(b.n).toBe(i + 1))
    for (const b of BLOCK_IDS) expect(getNode(b)?.pos, b).toBeDefined()
  })

  it('has unique node and edge ids; version mirrors package.json', () => {
    const ids = NODES.map((n) => n.id)
    expect(new Set(ids).size).toBe(ids.length)
    const eids = ALL_EDGES.map((e) => e.id)
    expect(new Set(eids).size).toBe(eids.length)
    expect(REGISTRY.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('respects the node taxonomy: block → subblock → leaf', () => {
    for (const n of NODES) {
      if (n.kind === 'block') {
        expect(n.parent, n.id).toBeUndefined()
        expect(childrenOf(n.id).every((c) => c.kind === 'subblock'), n.id).toBe(true)
        expect(childrenOf(n.id).length, n.id).toBeGreaterThan(0)
      } else {
        expect(n.parent, n.id).toBeDefined()
        const parent = getNode(n.parent!)
        expect(parent, `${n.id} → ${n.parent}`).toBeDefined()
        expect(parent!.block, n.id).toBe(n.block)
        if (n.kind === 'subblock') expect(parent!.kind, n.id).toBe('block')
        else {
          expect(LEAF_KINDS, n.id).toContain(n.kind)
          expect(parent!.kind, n.id).toBe('subblock')
          expect(childrenOf(n.id), n.id).toHaveLength(0)
        }
      }
    }
  })

  it('every formula node references a registered metric; every parameter — a passport', () => {
    for (const n of NODES) {
      if (n.kind === 'formula') expect(n.metricId && getMetric(n.metricId), `${n.id} → ${n.metricId}`).toBeTruthy()
      if (n.kind === 'parameter') expect(n.paramId && getParamDef(n.paramId), `${n.id} → ${n.paramId}`).toBeTruthy()
      if (n.kind === 'dataset') expect(n.dataset?.table, n.id).toBeTruthy()
      if (n.kind === 'screen') expect(n.screen?.id, n.id).toBeTruthy()
    }
  })

  it('links only to existing screens, diagrams and methodology anchors', () => {
    for (const n of NODES) {
      if (n.screen) expect(SCREEN_IDS.has(n.screen.id), `${n.id} → #/${n.screen.id}`).toBe(true)
      if (n.diagram) expect(isDiagramId(n.diagram), `${n.id} → ${n.diagram}`).toBe(true)
      if (n.learnMore) expect(isMethodologyAnchor(n.learnMore), `${n.id} → ${n.learnMore}`).toBe(true)
    }
    for (const p of NODES.flatMap((n) => (n.kind === 'parameter' && n.paramId ? [getParamDef(n.paramId)!] : []))) {
      if (p.screen) expect(SCREEN_IDS.has(p.screen.id), `${p.id} → #/${p.screen.id}`).toBe(true)
    }
  })

  it('every block has at least one screen and every subblock a methodology anchor', () => {
    for (const b of BLOCK_IDS) {
      const screens = descendantsOf(b).filter((n) => n.screen)
      expect(screens.length, b).toBeGreaterThan(0)
      for (const s of childrenOf(b)) expect(s.learnMore, s.id).toBeDefined()
    }
  })

  it('edges connect existing nodes with valid kinds and labels', () => {
    for (const e of ALL_EDGES) {
      expect(getNode(e.from), `${e.id}: ${e.from}`).toBeDefined()
      expect(getNode(e.to), `${e.id}: ${e.to}`).toBeDefined()
      expect(EDGE_KINDS).toContain(e.kind)
      expect(e.label?.trim(), e.id).toBeTruthy()
      if (e.kind === 'param') {
        expect(getNode(e.from)!.kind, e.id).toBe('parameter')
        expect(getNode(e.to)!.kind, e.id).toBe('formula')
      }
    }
  })

  it('L0 edges encode the canonical flow, the RL loop and the Stage 1 → Stage 2 feedback', () => {
    const has = (from: string, to: string, kind: MapEdgeKind) => L0_EDGES.some((e) => e.from === from && e.to === to && e.kind === kind)
    expect(has('external', 'distributions', 'data')).toBe(true)
    expect(has('distributions', 'internal', 'data')).toBe(true)
    expect(has('internal', 'decisions', 'data')).toBe(true)
    expect(has('decisions', 'criteria', 'data')).toBe(true)
    for (const src of ['external', 'distributions', 'internal']) expect(has(src, 'agents', 'data'), src).toBe(true)
    expect(has('agents', 'decisions', 'feedback')).toBe(true)
    expect(has('criteria', 'agents', 'control')).toBe(true)
    expect(L0_EDGES.find((e) => e.id === 'e.4-4')?.payload).toContain('stage1_calibrated')
    for (const e of L0_EDGES) expect(getNode(e.from)!.kind + getNode(e.to)!.kind, e.id).toBe('blockblock')
  })

  it('maps screens back to blocks and metrics to formula nodes', () => {
    expect(blocksForScreen('optimization')).toContain('decisions')
    expect(blocksForScreen('optimization')).toContain('criteria')
    expect(blocksForScreen('scenarios')).toEqual(['external', 'distributions'])
    expect(blocksForScreen('plan')).toContain('internal')
    expect(nodeForMetric('opt.cvar')?.block).toBe('criteria')
    expect(nodeForMetric('nope.nope')).toBeUndefined()
  })

  it('builds paths and searches by title, id and metric', () => {
    expect(pathOf('crit.profit.f.cvar').map((n) => n.id)).toEqual(['criteria', 'crit.profit', 'crit.profit.f.cvar'])
    expect(searchNodes('cvar').length).toBeGreaterThan(0)
    expect(searchNodes('ключевая')[0]?.id).toBe('ext.macro.key_rate')
    expect(searchNodes('ставка').map((n) => n.id)).toContain('ext.macro.key_rate')
    expect(searchNodes('   ')).toEqual([])
    expect(getNode('constructor')).toBeUndefined()
  })
})
