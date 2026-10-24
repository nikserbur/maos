/*
 * «AI-воркфлоу» (X2 P-135…P-138, P-144, P-145): схема диалога MENTAT (блок [8]) — шаги-узлы и
 * связи с подписями веток. Шапка — анатомия верхней полосы канваса («Система · [8] LLM», «Открыть
 * MENTAT ⌘J», «Экспорт .json», ⋯); палитра типов · канвас · инспектор. Опасное — в ⋯ с подтверждением
 * и отменой (⌘Z / ⇧⌘Z, тост «Отменить»); черновик хранится только в этом браузере.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { countText } from '../../explain/format'
import { shortcutText } from '../../shell/commandIndex'
import { ErrorBoundary } from '../../shell/ErrorBoundary'
import { overlayActions } from '../../shell/overlays'
import { screenTitle } from '../../shell/screens'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import type { GraphCanvasHandle } from '../../ui/graph-canvas'
import { Menu, ScreenHeader, showUndo, type MenuItem } from '../../ui/kit'
import { connect, freeSpot, mergeGraph, patchEdge, patchNode, removeEdge, removeNode, restoreNode } from './graphOps'
import { edgeRoute } from './geometry'
import { seedGraph } from './seed'
import { downloadJson } from './storage'
import { NODE_META, NODE_TYPES, makeId, type NodeType, type WorkflowGraph } from './types'
import { useWorkflow } from './useWorkflow'
import { WorkflowCanvas } from './WorkflowCanvas'
import { WorkflowInspector } from './WorkflowInspector'
import './workflow-builder.css'

const STEP_FORMS = ['шаг', 'шага', 'шагов'] as const
const LINK_FORMS = ['связь', 'связи', 'связей'] as const
const EMPTY: WorkflowGraph = { nodes: [], edges: [] }

const isEditable = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

type Ask = null | 'clear' | 'seed'

export function WorkflowBuilder() {
  const wf = useWorkflow()
  const { graph, update, select, selection } = wf
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<GraphCanvasHandle>(null)
  const [ask, setAsk] = useState<Ask>(null)
  const steps = countText(graph.nodes.length, STEP_FORMS)
  const links = countText(graph.edges.length, LINK_FORMS)
  const hasBack = graph.edges.some((e) => {
    const from = graph.nodes.find((n) => n.id === e.from)
    const to = graph.nodes.find((n) => n.id === e.to)
    return Boolean(from && to && edgeRoute(from, to).back)
  })

  const addNode = (type: NodeType) => {
    const center = canvasRef.current?.getViewportCenterWorld()
    const spot = freeSpot(graph, center ?? { x: 0, y: 0 })
    const node = { id: makeId(), type, ...spot, title: NODE_META[type].label, notes: '' }
    update((g) => ({ ...g, nodes: [...g.nodes, node] }))
    select({ kind: 'node', id: node.id })
  }

  const deleteNode = useCallback((id: string) => {
    const { removed } = removeNode(graph, id)
    if (!removed) return
    update((g) => removeNode(g, id).graph)
    showUndo({ message: `Удалён шаг «${removed.node.title || 'без названия'}»`, onUndo: () => update((g) => restoreNode(g, removed)) })
  }, [graph, update])

  const deleteEdge = useCallback((id: string) => {
    const edge = graph.edges.find((e) => e.id === id)
    if (!edge) return
    update((g) => removeEdge(g, id))
    showUndo({ message: 'Связь удалена', onUndo: () => update((g) => mergeGraph(g, { nodes: [], edges: [edge] })) })
  }, [graph, update])

  const replaceAll = (next: WorkflowGraph, message: string) => {
    const snapshot = graph
    update(() => next)
    select(null)
    setAsk(null)
    showUndo({ message, onUndo: () => update((g) => (g.nodes.length === 0 ? snapshot : mergeGraph(g, snapshot))) })
  }

  // ⌘Z / Ctrl+Z — отменить, ⇧⌘Z / Ctrl+Y — повторить: фокус внутри конструктора или нигде; в полях — родная отмена текста.
  const { undo, redo } = wf
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || isEditable(e.target)) return
      const inside = e.target === document.body || (e.target instanceof Node && rootRef.current?.contains(e.target))
      if (!inside) return
      const k = e.key.toLowerCase()
      if (k === 'z' || k === 'я') { e.preventDefault(); if (e.shiftKey) redo(); else undo() }
      else if (k === 'y' || k === 'н') { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  // Del / Backspace на канвасе — удалить выбранное (в полях ввода — обычное редактирование).
  const onRootKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.key !== 'Delete' && e.key !== 'Backspace') || isEditable(e.target) || !selection) return
    if (!(e.target instanceof Element && e.target.closest('.wfb__canvas'))) return
    e.preventDefault()
    if (selection.kind === 'node') deleteNode(selection.id)
    else deleteEdge(selection.id)
  }

  const mod = shortcutText('mod+z')
  const menu: MenuItem[] = [
    { id: 'undo', label: `Отменить · ${mod}`, onSelect: undo, disabled: !wf.canUndo },
    { id: 'redo', label: `Повторить · ${shortcutText('mod+shift+z')}`, onSelect: redo, disabled: !wf.canRedo },
    { id: 'seed', label: 'Вернуть схему MENTAT…', onSelect: () => setAsk('seed') },
    { id: 'clear', label: 'Очистить канвас…', danger: true, onSelect: () => setAsk('clear'), disabled: graph.nodes.length === 0 },
  ]

  return (
    <div className="wfb" ref={rootRef} onKeyDown={onRootKey}>
      <div className="wfb__bar">
        <ScreenHeader
          eyebrow="Система · [8] LLM"
          blocks={['llm']}
          title={screenTitle('aiflow')}
          subtitle="Схема диалога MENTAT · черновик хранится в этом браузере"
          actions={
            <>
              <button type="button" className="btn" onClick={overlayActions.openMentat}>
                Открыть MENTAT <kbd className="wfb__kbd">{shortcutText('mod+j')}</kbd>
              </button>
              <button type="button" className="btn" onClick={() => downloadJson(graph)}>Экспорт .json</button>
              <Menu items={menu} label="Ещё действия со схемой" />
            </>
          }
        />
      </div>

      <div className="wfb__body">
        <aside className="wfb__palette" aria-labelledby="wfb-palette-t">
          <h2 className="wfb__side-title" id="wfb-palette-t">Типы шагов</h2>
          {NODE_TYPES.map((type) => (
            <button key={type} type="button" className={`wfb__palette-btn wfb__palette-btn--${NODE_META[type].tone}`} onClick={() => addNode(type)}>
              <span className="wfb__glyph" aria-hidden="true">{NODE_META[type].glyph}</span>
              {NODE_META[type].label}
            </button>
          ))}
        </aside>

        <section className="wfb__center" aria-label="Схема">
          <div className="wfb__tools">
            <span>Клик по типу — добавить · тяните от нижнего порта — связать · Del — удалить · F — вписать · {mod} — отменить</span>
            <span className="wfb__tools-right">
              {hasBack && <span className="wfb__legend"><span className="wfb__legend-line" aria-hidden="true" />возврат — связь назад по схеме</span>}
              <span className="wfb__count">{steps} · {links}</span>
              {!wf.saved && <span className="wfb__unsaved glyph-setup">черновик не сохраняется — браузер не дал записать</span>}
            </span>
          </div>
          <WorkflowCanvas
            ref={canvasRef}
            graph={graph}
            selection={selection}
            onSelect={select}
            onMove={(id, x, y, key) => update((g) => patchNode(g, id, { x, y }), key)}
            onConnect={(from, to) => update((g) => connect(g, from, to).graph)}
            onDeleteNode={deleteNode}
          />
        </section>

        <ErrorBoundary variant="inline" label="Инспектор">
          <WorkflowInspector
            graph={graph}
            selection={selection}
            onSelect={select}
            onPatchNode={(id, patch, key) => update((g) => patchNode(g, id, patch), key)}
            onPatchEdge={(id, label, key) => update((g) => patchEdge(g, id, { label }), key)}
            onConnect={(from, to) => update((g) => connect(g, from, to).graph)}
            onDeleteNode={deleteNode}
            onDeleteEdge={deleteEdge}
          />
        </ErrorBoundary>
      </div>

      {ask === 'clear' && (
        <ConfirmDialog
          title="Очистить канвас?"
          consequence={`Удалить ${steps} и ${links}? Черновик в браузере будет перезаписан — вернуть можно ${mod} или «Отменить».`}
          confirmLabel="Очистить"
          danger
          onConfirm={() => replaceAll(EMPTY, 'Канвас очищен')}
          onCancel={() => setAsk(null)}
        />
      )}
      {ask === 'seed' && (
        <ConfirmDialog
          title="Вернуть схему MENTAT?"
          consequence={`Текущая схема (${steps}, ${links}) заменится стартовой схемой MENTAT — вернуть можно ${mod} или «Отменить».`}
          confirmLabel="Вернуть схему"
          onConfirm={() => replaceAll(seedGraph(), 'Возвращена схема MENTAT')}
          onCancel={() => setAsk(null)}
        />
      )}
    </div>
  )
}
