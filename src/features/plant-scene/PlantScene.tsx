import { Suspense, useEffect, useReducer, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Loader } from '@react-three/drei'
import { SceneEnvironment } from './SceneEnvironment'
import { PlantLayout } from './PlantLayout'
import { EditorPanel } from './EditorPanel'
import { Breadcrumbs } from './Breadcrumbs'
import { STATUS_META, type ObjectKind } from './types'
import { graphReducer, initialGraphState } from './graph/graphReducer'
import { PALETTE, hasChildren, type SceneGraph, type SceneNode } from './graph/sceneModel'
import { api, type Machine, type WorkCenterType, type Operation } from '../../lib/api'
import './scene.css'

const STORAGE_KEY = 'maos-scene-graph'

function loadSavedGraph(): SceneGraph | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as SceneGraph
  } catch {
    return null
  }
}

/** Резолвим kind из реестра: wcType.kind → если валидный ObjectKind, берём его, иначе node.kind */
function resolveKind(node: SceneNode, machines: Machine[], wcTypes: WorkCenterType[]): ObjectKind {
  if (!node.linkedMachineId) return node.kind
  const machine = machines.find((m) => m.id === node.linkedMachineId)
  if (!machine?.wc_type_id) return node.kind
  const wcType = wcTypes.find((t) => t.id === machine.wc_type_id)
  const k = wcType?.kind
  return k && (PALETTE as string[]).includes(k) ? (k as ObjectKind) : node.kind
}

function Legend() {
  return (
    <div className="legend" aria-hidden>
      <div className="legend__title">Статус</div>
      {Object.values(STATUS_META).map((meta) => (
        <div className="legend__row" key={meta.label}>
          <span className="legend__dot" style={{ background: meta.color }} />
          {meta.label}
        </div>
      ))}
    </div>
  )
}

export default function PlantScene() {
  const [state, dispatch] = useReducer(graphReducer, undefined, () => {
    const saved = loadSavedGraph()
    return saved ? { ...initialGraphState, graph: saved } : initialGraphState
  })

  const [machines, setMachines]     = useState<Machine[]>([])
  const [wcTypes, setWcTypes]       = useState<WorkCenterType[]>([])
  const [operations, setOperations] = useState<Operation[]>([])
  const [seeding, setSeeding]       = useState(false)

  const refreshAll = () => Promise.all([
    api.machines.list().then(setMachines).catch(() => {}),
    api.workCenterTypes.list().then(setWcTypes).catch(() => {}),
    api.operations.list().then(setOperations).catch(() => {}),
  ])

  useEffect(() => { refreshAll() }, [])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.graph))
    } catch { /* localStorage недоступен */ }
  }, [state.graph])

  /** POST /api/demo/seed → создаёт типы и машины, затем линкует узлы сцены */
  const handleSeedDemo = async () => {
    setSeeding(true)
    try {
      const mapping = await api.demo.seed()
      // Линкуем каждый узел верхнего уровня (parentId=null) по его id
      for (const { nodeId, machineId } of mapping) {
        const node = state.graph.nodes.find((n) => n.id === nodeId && n.parentId === null)
        if (node) {
          dispatch({ type: 'LINK_MACHINE', id: nodeId, machineId })
        }
      }
      await refreshAll()
    } catch (e) {
      console.error('seed failed', e)
    } finally {
      setSeeding(false)
    }
  }

  const rawNodes = state.graph.nodes.filter((n) => n.parentId === state.currentParentId)
  const edges    = state.graph.edges.filter((e) => e.parentId === state.currentParentId)

  // Подменяем kind на основе wcType.kind из реестра
  const nodes = rawNodes.map((n) => ({
    ...n,
    kind: resolveKind(n, machines, wcTypes),
  }))

  const selected = nodes.find((n) => n.id === state.selectedId) ?? null
  const editing  = state.mode === 'edit'

  const refreshMachines = () => api.machines.list().then(setMachines).catch(() => {})

  const handleCreateMachine = async (
    nodeId: string,
    data: { name: string; wcTypeId: string; orgUnit: string; status: string; kind: ObjectKind },
  ) => {
    const machine = await api.machines.create({
      name: data.name,
      wc_type_id: data.wcTypeId,
      org_unit: data.orgUnit,
      status: data.status,
    })
    dispatch({ type: 'LINK_MACHINE', id: nodeId, machineId: machine.id })
    // kind теперь берётся из wcType.kind — но диспатч оставляем как fallback
    dispatch({ type: 'CHANGE_KIND', id: nodeId, kind: data.kind })
    await refreshMachines()
  }

  const handleChangeKind = (nodeId: string, kind: ObjectKind) => {
    dispatch({ type: 'CHANGE_KIND', id: nodeId, kind })
  }

  const allSeeded = machines.length > 0 && nodes.every((n) => n.linkedMachineId)

  return (
    <div className="scene">
      <div className="scene__canvas">
        <Canvas
          shadows
          dpr={[1, 2]}
          camera={{ position: [30, 24, 32], fov: 42 }}
          onPointerMissed={() => dispatch({ type: 'CLEAR_SELECTION' })}
        >
          <SceneEnvironment />
          <Suspense fallback={null}>
            <PlantLayout
              nodes={nodes}
              edges={edges}
              selectedId={state.selectedId}
              connectFrom={state.connectFrom}
              connecting={state.connecting}
              editing={editing}
              onSelect={(id) => dispatch({ type: 'NODE_CLICK', id })}
              onEnter={(id) => dispatch({ type: 'ENTER_NODE', id })}
              onMove={(id, position) => dispatch({ type: 'MOVE_NODE', id, position })}
              onConnectFrom={(id) => dispatch({ type: 'CONNECT_FROM', id })}
            />
          </Suspense>
        </Canvas>

        <Loader />

        <Breadcrumbs
          path={state.path}
          onNavigate={(index) => dispatch({ type: 'GO_TO_LEVEL', index })}
        />
        <Legend />

        {/* Кнопка посева демо-данных — пока не все узлы привязаны */}
        {!allSeeded && (
          <button
            className="btn btn--primary"
            style={{
              position: 'absolute', bottom: 36, left: '50%', transform: 'translateX(-50%)',
              zIndex: 10, fontSize: 12, opacity: 0.9,
            }}
            onClick={handleSeedDemo}
            disabled={seeding}
          >
            {seeding ? 'Создаём записи в НСИ…' : '⚙ Заполнить НСИ демо-данными'}
          </button>
        )}

        <div className="scene__hint mono">
          {state.connecting
            ? 'Связь: нажмите на целевой узел · Escape / клик на пустое — отмена'
            : 'ЛКМ — выбор · 2×ЛКМ — внутрь узла · колесо — зум · ПКМ — панорама'}
        </div>
      </div>

      <EditorPanel
        mode={state.mode}
        connecting={state.connecting}
        selectedNode={selected}
        hasChildren={selected ? hasChildren(state.graph, selected.id) : false}
        machines={machines}
        wcTypes={wcTypes}
        operations={operations}
        onToggleMode={() => dispatch({ type: 'SET_MODE', mode: editing ? 'view' : 'edit' })}
        onAddNode={(kind) => dispatch({ type: 'ADD_NODE', kind })}
        onRename={(id, title) => dispatch({ type: 'RENAME_NODE', id, title })}
        onDelete={(id) => dispatch({ type: 'DELETE_NODE', id })}
        onEnter={(id) => dispatch({ type: 'ENTER_NODE', id })}
        onClose={() => dispatch({ type: 'CLEAR_SELECTION' })}
        onLinkMachine={(nodeId, machineId) =>
          dispatch({ type: 'LINK_MACHINE', id: nodeId, machineId })
        }
        onCreateMachine={handleCreateMachine}
        onChangeKind={handleChangeKind}
      />
    </div>
  )
}
