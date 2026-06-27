/**
 * Редьюсер схемы: единственная точка мутаций (прообраз Action layer).
 * Все изменения — типизированные действия; состояние неизменяемо.
 */
import type { ObjectKind } from '../types'
import {
  INITIAL_GRAPH,
  KIND_META,
  type SceneEdge,
  type SceneGraph,
  type SceneNode,
} from './sceneModel'

export type SceneMode = 'view' | 'edit'

export interface Crumb {
  id: string | null
  title: string
}

export interface GraphState {
  graph: SceneGraph
  /** Текущий уровень иерархии (null = верхний). */
  currentParentId: string | null
  path: Crumb[]
  selectedId: string | null
  mode: SceneMode
  /** Режим прокладки связи — ожидаем клик на целевой узел. */
  connecting: boolean
  connectFrom: string | null
}

export const initialGraphState: GraphState = {
  graph: INITIAL_GRAPH,
  currentParentId: null,
  path: [{ id: null, title: 'Схема предприятия' }],
  selectedId: null,
  mode: 'view',
  connecting: false,
  connectFrom: null,
}

export type GraphAction =
  | { type: 'SET_MODE'; mode: SceneMode }
  | { type: 'NODE_CLICK'; id: string }
  | { type: 'ENTER_NODE'; id: string }
  | { type: 'GO_TO_LEVEL'; index: number }
  | { type: 'ADD_NODE'; kind: ObjectKind; position?: [number, number] }
  | { type: 'MOVE_NODE'; id: string; position: [number, number] }
  | { type: 'RENAME_NODE'; id: string; title: string }
  | { type: 'DELETE_NODE'; id: string }
  | { type: 'CONNECT_FROM'; id: string }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'LOAD_GRAPH'; graph: SceneGraph }
  | { type: 'LINK_MACHINE'; id: string; machineId: string | null }
  | { type: 'CHANGE_KIND'; id: string; kind: ObjectKind }

const uuid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}`

/** Узел и все его потомки (для каскадного удаления). */
function subtree(graph: SceneGraph, rootId: string): Set<string> {
  const ids = new Set<string>([rootId])
  let grew = true
  while (grew) {
    grew = false
    for (const n of graph.nodes) {
      if (n.parentId && ids.has(n.parentId) && !ids.has(n.id)) {
        ids.add(n.id)
        grew = true
      }
    }
  }
  return ids
}

export function graphReducer(state: GraphState, action: GraphAction): GraphState {
  switch (action.type) {
    case 'SET_MODE':
      return { ...state, mode: action.mode, connecting: false, connectFrom: null }

    case 'CLEAR_SELECTION':
      return { ...state, selectedId: null, connectFrom: null, connecting: false }

    case 'NODE_CLICK': {
      if (state.connecting) {
        if (!state.connectFrom) return { ...state, connectFrom: action.id }
        if (state.connectFrom === action.id)
          return { ...state, connecting: false, connectFrom: null }
        const edge: SceneEdge = {
          id: uuid(),
          parentId: state.currentParentId,
          from: state.connectFrom,
          to: action.id,
        }
        return {
          ...state,
          graph: { ...state.graph, edges: [...state.graph.edges, edge] },
          connecting: false,
          connectFrom: null,
        }
      }
      return { ...state, selectedId: action.id }
    }

    case 'CONNECT_FROM':
      return { ...state, connecting: true, connectFrom: action.id, selectedId: null }

    case 'ENTER_NODE': {
      const node = state.graph.nodes.find((n) => n.id === action.id)
      if (!node) return state
      return {
        ...state,
        currentParentId: action.id,
        path: [...state.path, { id: action.id, title: node.title }],
        selectedId: null,
        connecting: false,
        connectFrom: null,
      }
    }

    case 'GO_TO_LEVEL': {
      const path = state.path.slice(0, action.index + 1)
      const crumb = path[path.length - 1]
      return {
        ...state,
        path,
        currentParentId: crumb.id,
        selectedId: null,
        connecting: false,
        connectFrom: null,
      }
    }

    case 'ADD_NODE': {
      const siblings = state.graph.nodes.filter((n) => n.parentId === state.currentParentId)
      const i = siblings.length
      const meta = KIND_META[action.kind]
      const defaultPos: [number, number] = [(i % 5) * 6 - 12, Math.floor(i / 5) * 6 - 6]
      const node: SceneNode = {
        id: uuid(),
        parentId: state.currentParentId,
        kind: action.kind,
        title: meta.label,
        subtitle: 'Новый узел',
        position: action.position ?? defaultPos,
        rotationY: meta.rotationY,
        scale: meta.scale,
        status: 'idle',
        kpis: [],
      }
      return {
        ...state,
        graph: { ...state.graph, nodes: [...state.graph.nodes, node] },
        selectedId: node.id,
      }
    }

    case 'MOVE_NODE':
      return {
        ...state,
        graph: {
          ...state.graph,
          nodes: state.graph.nodes.map((n) =>
            n.id === action.id ? { ...n, position: action.position } : n,
          ),
        },
      }

    case 'RENAME_NODE':
      return {
        ...state,
        graph: {
          ...state.graph,
          nodes: state.graph.nodes.map((n) =>
            n.id === action.id ? { ...n, title: action.title } : n,
          ),
        },
      }

    case 'DELETE_NODE': {
      const remove = subtree(state.graph, action.id)
      return {
        ...state,
        selectedId: null,
        graph: {
          nodes: state.graph.nodes.filter((n) => !remove.has(n.id)),
          edges: state.graph.edges.filter((e) => !remove.has(e.from) && !remove.has(e.to)),
        },
      }
    }

    case 'LOAD_GRAPH':
      return { ...state, graph: action.graph }

    case 'LINK_MACHINE':
      return {
        ...state,
        graph: {
          ...state.graph,
          nodes: state.graph.nodes.map((n) =>
            n.id === action.id
              ? { ...n, linkedMachineId: action.machineId ?? undefined }
              : n,
          ),
        },
      }

    case 'CHANGE_KIND': {
      const meta = KIND_META[action.kind]
      return {
        ...state,
        graph: {
          ...state.graph,
          nodes: state.graph.nodes.map((n) =>
            n.id === action.id
              ? { ...n, kind: action.kind, scale: meta.scale, rotationY: meta.rotationY }
              : n,
          ),
        },
      }
    }

    default:
      return state
  }
}
