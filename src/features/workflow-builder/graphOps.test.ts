import { describe, expect, it } from 'vitest'
import { HISTORY_LIMIT, commit, connect, freeSpot, initHistory, mergeGraph, patchEdge, redo, removeNode, restoreNode, undo } from './graphOps'
import { edgeRoute, graphBounds } from './geometry'
import { isUntouchedLegacySeed, seedGraph } from './seed'
import { exportJson, sanitizeGraph } from './storage'
import { NODE_H, NODE_META, NODE_TYPES, NODE_W, type WorkflowGraph, type WorkflowNode } from './types'

const node = (id: string, x = 0, y = 0): WorkflowNode => ({ id, type: 'tool', x, y, title: id, notes: '' })
const g3: WorkflowGraph = {
  nodes: [node('a', 0, 0), node('b', 0, 200), node('c', 300, 200)],
  edges: [{ id: 'ab', from: 'a', to: 'b' }, { id: 'bc', from: 'b', to: 'c', label: 'да' }],
}

describe('graphOps: правки графа', () => {
  it('удалённый шаг возвращается вместе со связями', () => {
    const { graph, removed } = removeNode(g3, 'b')
    expect(graph.nodes.map((n) => n.id)).toEqual(['a', 'c'])
    expect(graph.edges).toEqual([])
    expect(removed?.edges.map((e) => e.id)).toEqual(['ab', 'bc'])
    const back = restoreNode(graph, removed!)
    expect(back.nodes).toHaveLength(3)
    expect(back.edges.map((e) => e.id).sort()).toEqual(['ab', 'bc'])
  })
  it('связь: без петель и дублей', () => {
    expect(connect(g3, 'a', 'a').edge).toBeNull()
    expect(connect(g3, 'a', 'b').edge).toBeNull()
    const r = connect(g3, 'c', 'a', 'нет')
    expect(r.edge?.label).toBe('нет')
    expect(r.graph.edges).toHaveLength(3)
  })
  it('подпись ветки: пустая снимается', () => {
    expect(patchEdge(g3, 'bc', { label: '  ' }).edges[1]).toEqual({ id: 'bc', from: 'b', to: 'c' })
    expect(patchEdge(g3, 'ab', { label: 'нет' }).edges[0].label).toBe('нет')
  })
  it('снимок после очистки возвращается и не теряет новых шагов', () => {
    const fresh: WorkflowGraph = { nodes: [node('z')], edges: [] }
    const merged = mergeGraph(fresh, g3)
    expect(merged.nodes.map((n) => n.id)).toEqual(['z', 'a', 'b', 'c'])
    expect(merged.edges).toHaveLength(2)
  })
  it('новый шаг — в центре вида, занято — со сдвигом', () => {
    const spot = freeSpot(g3, { x: NODE_W / 2, y: NODE_H / 2 })
    expect(spot).toEqual({ x: 24, y: 24 })
    expect(freeSpot({ nodes: [], edges: [] }, { x: 500, y: 400 })).toEqual({ x: 500 - NODE_W / 2, y: 400 - NODE_H / 2 })
  })
})

describe('graphOps: история', () => {
  it('Cmd+Z возвращает очищенный граф, Shift+Z — снова очищает', () => {
    let h = initHistory(g3)
    h = commit(h, { nodes: [], edges: [] })
    h = undo(h)
    expect(h.present).toBe(g3)
    h = redo(h)
    expect(h.present.nodes).toHaveLength(0)
  })
  it('набор текста одним ключом — один шаг отмены; история ограничена', () => {
    let h = initHistory(g3)
    h = commit(h, { ...g3, nodes: g3.nodes.slice(0, 2) }, 'title:a')
    h = commit(h, { ...g3, nodes: g3.nodes.slice(0, 1) }, 'title:a')
    expect(h.past).toHaveLength(1)
    for (let i = 0; i < HISTORY_LIMIT + 10; i += 1) h = commit(h, { ...g3 })
    expect(h.past.length).toBe(HISTORY_LIMIT)
  })
})

describe('geometry', () => {
  it('прямая связь — подпись посередине; связь назад — по полосе справа', () => {
    const fwd = edgeRoute(node('a', 0, 0), node('b', 0, 200))
    expect(fwd.back).toBe(false)
    expect(fwd.label).toEqual({ x: NODE_W / 2, y: (NODE_H + 200) / 2 })
    const back = edgeRoute(node('b', 0, 200), node('a', 0, 0))
    expect(back.back).toBe(true)
    expect(back.label.x).toBeGreaterThan(NODE_W)
  })
  it('границы включают полосу возврата', () => {
    expect(graphBounds(g3.nodes)).toEqual({ x: 0, y: 0, w: 300 + NODE_W, h: 200 + NODE_H })
    expect(graphBounds(g3.nodes, 900).w).toBe(900)
  })
})

describe('seed и хранилище', () => {
  it('стартовый граф — конвейер MENTAT с подписанными ветками, без «мини-ChatGPT»', () => {
    const g = seedGraph()
    const titles = g.nodes.map((n) => n.title).join(' ')
    expect(titles).toContain('Сборка контекста графа')
    expect(titles).toContain('Проверка чисел')
    expect(titles).not.toMatch(/ChatGPT/i)
    expect(g.edges.filter((e) => e.label).map((e) => e.label).sort()).toEqual(['да', 'нет'])
    const ids = new Set(g.nodes.map((n) => n.id))
    for (const e of g.edges) expect(ids.has(e.from) && ids.has(e.to)).toBe(true)
  })
  it('нетронутый пример v1 узнаётся, изменённый — нет', () => {
    const v1: WorkflowGraph = {
      nodes: [
        { id: '1', type: 'start', x: 360, y: 40, title: 'Старт диалога', notes: 'Пользователь открыл чат.' },
        { id: '2', type: 'userMessage', x: 360, y: 170, title: 'Запрос пользователя', notes: 'Свободный текст: что хочет пользователь.' },
        { id: '3', type: 'aiReply', x: 360, y: 300, title: 'Ответ AI', notes: 'LLM формирует ответ по контексту диалога.' },
        { id: '4', type: 'condition', x: 360, y: 430, title: 'Достаточно данных?', notes: 'Ветвление: хватает ли информации для действия.' },
        { id: '5', type: 'tool', x: 140, y: 560, title: 'Вызов инструмента', notes: 'Запуск действия/API, если данных достаточно.' },
        { id: '6', type: 'clarify', x: 560, y: 560, title: 'Уточнить у пользователя', notes: 'Задать уточняющий вопрос, вернуться к диалогу.' },
        { id: '7', type: 'end', x: 360, y: 690, title: 'Конец', notes: 'Итог выдан пользователю.' },
      ],
      edges: Array.from({ length: 7 }, (_, i) => ({ id: `e${i}`, from: '1', to: '2' })),
    }
    expect(isUntouchedLegacySeed(v1)).toBe(true)
    expect(isUntouchedLegacySeed({ ...v1, nodes: v1.nodes.map((n, i) => (i === 0 ? { ...n, x: 361 } : n)) })).toBe(false)
  })
  it('мусор из хранилища отбрасывается, связи на несуществующие шаги — тоже', () => {
    const g = sanitizeGraph({ nodes: [node('a'), { id: 'x', type: 'evil', x: 0, y: 0 }, { id: 'b', type: 'end', x: 'NaN', y: 0 }], edges: [{ id: 'e', from: 'a', to: 'x' }] })
    expect(g?.nodes.map((n) => n.id)).toEqual(['a'])
    expect(g?.edges).toEqual([])
    expect(sanitizeGraph('мусор')).toBeNull()
  })
  it('экспорт — JSON с версией формата', () => {
    const parsed = JSON.parse(exportJson(g3, new Date(0)))
    expect(parsed).toMatchObject({ format: 'maos.aiWorkflow', version: 2, exportedAt: '1970-01-01T00:00:00.000Z' })
    expect(parsed.nodes).toHaveLength(3)
  })
  it('у каждого типа — глиф и тон, без hex-цвета', () => {
    for (const t of NODE_TYPES) {
      expect(NODE_META[t].glyph).toBeTruthy()
      expect(JSON.stringify(NODE_META[t])).not.toMatch(/#[0-9a-f]{3,6}/i)
    }
  })
})
