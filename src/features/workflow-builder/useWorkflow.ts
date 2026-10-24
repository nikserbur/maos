/*
 * Состояние конструктора: граф с ограниченной историей снимков (⌘Z / ⇧⌘Z), автосохранение черновика
 * в этом браузере (с честным признаком «не сохраняется») и выделение шага или связи.
 */
import { useCallback, useEffect, useState } from 'react'
import { commit, initHistory, redo, undo } from './graphOps'
import { loadGraph, saveGraph } from './storage'
import type { WorkflowGraph } from './types'

const AUTOSAVE_MS = 400

export type Selection = { kind: 'node' | 'edge'; id: string } | null

export interface WorkflowState {
  graph: WorkflowGraph
  /** Правка графа; key — правки подряд с тем же ключом сливаются в один шаг отмены. */
  update: (fn: (g: WorkflowGraph) => WorkflowGraph, key?: string | null) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  /** false — браузер не дал записать черновик (квота, приватный режим). */
  saved: boolean
  selection: Selection
  select: (s: Selection) => void
}

export function useWorkflow(): WorkflowState {
  const [hist, setHist] = useState(() => initHistory(loadGraph()))
  const [selection, setSelection] = useState<Selection>(null)
  const [saved, setSaved] = useState(true)
  const graph = hist.present

  useEffect(() => {
    const t = window.setTimeout(() => setSaved(saveGraph(graph)), AUTOSAVE_MS)
    return () => window.clearTimeout(t)
  }, [graph])

  // Выделение, чей объект исчез (отмена, удаление), снимается.
  useEffect(() => {
    if (!selection) return
    const alive = selection.kind === 'node' ? graph.nodes.some((n) => n.id === selection.id) : graph.edges.some((e) => e.id === selection.id)
    if (!alive) setSelection(null)
  }, [graph, selection])

  const update = useCallback((fn: (g: WorkflowGraph) => WorkflowGraph, key: string | null = null) => {
    setHist((h) => commit(h, fn(h.present), key))
  }, [])

  return {
    graph,
    update,
    undo: useCallback(() => setHist(undo), []),
    redo: useCallback(() => setHist(redo), []),
    canUndo: hist.past.length > 0,
    canRedo: hist.future.length > 0,
    saved,
    selection,
    select: setSelection,
  }
}
