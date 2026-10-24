/*
 * Инспектор воркфлоу: шаг — заголовок, требования/промпт, «Следующий шаг» (связь без мыши) и список
 * исходящих связей; связь — «Откуда → Куда», подпись ветки с быстрыми «да»/«нет»; удаление — внизу.
 * Поля — общие примитивы форм; тип шага — нейтральной плашкой с глифом.
 */
import { useId } from 'react'
import { ChoiceChip, EmptyState } from '../../ui/kit'
import { NODE_META, type WorkflowEdge, type WorkflowGraph, type WorkflowNode } from './types'
import type { Selection } from './useWorkflow'

interface InspectorProps {
  graph: WorkflowGraph
  selection: Selection
  onSelect: (s: Selection) => void
  onPatchNode: (id: string, patch: Partial<Pick<WorkflowNode, 'title' | 'notes'>>, key: string) => void
  onPatchEdge: (id: string, label: string, key: string) => void
  onConnect: (from: string, to: string) => void
  onDeleteNode: (id: string) => void
  onDeleteEdge: (id: string) => void
}

const QUICK_LABELS = ['да', 'нет'] as const
const titleOf = (n: WorkflowNode | undefined) => (n ? n.title || 'без названия' : '—')

function NodeInspector({ node, graph, onSelect, onPatchNode, onConnect, onDeleteNode }: Omit<InspectorProps, 'selection' | 'onPatchEdge' | 'onDeleteEdge'> & { node: WorkflowNode }) {
  const id = useId()
  const meta = NODE_META[node.type]
  const outgoing = graph.edges.filter((e) => e.from === node.id)
  const targets = graph.nodes.filter((n) => n.id !== node.id && !outgoing.some((e) => e.to === n.id))
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  return (
    <>
      <span className="wfb__type-chip"><span className="wfb__glyph" aria-hidden="true">{meta.glyph}</span>{meta.label}</span>
      <div className="form__field">
        <label className="form__label" htmlFor={`${id}-title`}>Заголовок</label>
        <input id={`${id}-title`} className="form__input" value={node.title}
               onChange={(e) => onPatchNode(node.id, { title: e.target.value }, `title:${node.id}`)} />
      </div>
      <div className="form__field">
        <label className="form__label" htmlFor={`${id}-notes`}>Требования и промпт</label>
        <textarea id={`${id}-notes`} className="form__textarea wfb__notes" value={node.notes}
                  placeholder="Что делает шаг: инструкции для LLM, условия ветвления, ожидаемый результат…"
                  onChange={(e) => onPatchNode(node.id, { notes: e.target.value }, `notes:${node.id}`)} />
      </div>
      <div className="form__field">
        <label className="form__label" htmlFor={`${id}-next`}>Следующий шаг</label>
        <select id={`${id}-next`} className="form__select" value="" disabled={targets.length === 0}
                onChange={(e) => { if (e.target.value) onConnect(node.id, e.target.value) }}>
          <option value="">{targets.length ? '— связать с шагом —' : 'все шаги уже связаны'}</option>
          {targets.map((t) => <option key={t.id} value={t.id}>{titleOf(t)}</option>)}
        </select>
      </div>
      {outgoing.length > 0 && (
        <ul className="wfb__links" aria-label="Связи из этого шага">
          {outgoing.map((e) => (
            <li key={e.id}>
              <button type="button" className="wfb__link" onClick={() => onSelect({ kind: 'edge', id: e.id })}>
                → {titleOf(byId.get(e.to))}{e.label && <span className="wfb__link-label">{e.label}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="wfb__inspector-actions">
        <button type="button" className="btn btn--danger" onClick={() => onDeleteNode(node.id)}>Удалить шаг</button>
      </div>
    </>
  )
}

function EdgeInspector({ edge, graph, onPatchEdge, onDeleteEdge }: Pick<InspectorProps, 'graph' | 'onPatchEdge' | 'onDeleteEdge'> & { edge: WorkflowEdge }) {
  const id = useId()
  const from = graph.nodes.find((n) => n.id === edge.from)
  const to = graph.nodes.find((n) => n.id === edge.to)
  const key = `label:${edge.id}`
  return (
    <>
      <p className="wfb__route"><span>{titleOf(from)}</span><span className="wfb__route-arrow" aria-label="ведёт в">→</span><span>{titleOf(to)}</span></p>
      <div className="form__field">
        <label className="form__label" htmlFor={`${id}-label`}>Подпись ветки</label>
        <input id={`${id}-label`} className="form__input" value={edge.label ?? ''} placeholder="например, да / нет / ошибка"
               onChange={(e) => onPatchEdge(edge.id, e.target.value, key)} />
        <div className="wfb__quick" role="group" aria-label="Быстрая подпись">
          {QUICK_LABELS.map((l) => (
            <ChoiceChip key={l} pressed={edge.label === l} onToggle={() => onPatchEdge(edge.id, edge.label === l ? '' : l, `${key}:quick`)}>{l}</ChoiceChip>
          ))}
        </div>
      </div>
      <div className="wfb__inspector-actions">
        <button type="button" className="btn btn--danger" onClick={() => onDeleteEdge(edge.id)}>Удалить связь</button>
      </div>
    </>
  )
}

export function WorkflowInspector(props: InspectorProps) {
  const { graph, selection } = props
  const node = selection?.kind === 'node' ? graph.nodes.find((n) => n.id === selection.id) : undefined
  const edge = selection?.kind === 'edge' ? graph.edges.find((e) => e.id === selection.id) : undefined
  return (
    <aside className="wfb__inspector" aria-label="Инспектор">
      <h2 className="wfb__side-title">{node ? 'Шаг' : edge ? 'Связь' : 'Инспектор'}</h2>
      {node && <NodeInspector key={node.id} node={node} {...props} />}
      {!node && edge && <EdgeInspector key={edge.id} edge={edge} {...props} />}
      {!node && !edge && (
        <EmptyState quiet size="sm" variant="flow" title="Выберите шаг">
          Клик по карточке — заголовок и промпт шага; клик по связи — подпись ветки.
        </EmptyState>
      )}
    </aside>
  )
}
