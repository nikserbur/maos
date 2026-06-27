import { Suspense, useEffect, useReducer, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Loader } from '@react-three/drei'
import { SceneEnvironment } from './SceneEnvironment'
import { PlantLayout } from './PlantLayout'
import { EditorPanel } from './EditorPanel'
import { Breadcrumbs } from './Breadcrumbs'
import { STATUS_META, type ObjectKind } from './types'
import { graphReducer, initialGraphState } from './graph/graphReducer'
import { buildGraphFromDb, hasChildren } from './graph/sceneModel'
import { api, type Machine, type WorkCenterType, type Operation, type Flow } from '../../lib/api'
import './scene.css'

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
  const [state, dispatch] = useReducer(graphReducer, initialGraphState)

  const [machines, setMachines]     = useState<Machine[]>([])
  const [wcTypes, setWcTypes]       = useState<WorkCenterType[]>([])
  const [operations, setOperations] = useState<Operation[]>([])
  const [loading, setLoading]       = useState(true)

  // Дебаунс PUT-ов раскладки (перемещение/переименование тянут запросы пачками).
  const persistTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  // Схема строится из реестров НСИ — единый источник истины (БД).
  const loadGraph = async () => {
    const [m, t, f, ops] = await Promise.all([
      api.machines.list().catch(() => [] as Machine[]),
      api.workCenterTypes.list().catch(() => [] as WorkCenterType[]),
      api.flows.list().catch(() => [] as Flow[]),
      api.operations.list().catch(() => [] as Operation[]),
    ])
    setMachines(m)
    setWcTypes(t)
    setOperations(ops)
    dispatch({ type: 'LOAD_GRAPH', graph: buildGraphFromDb(m, t, f) })
    setLoading(false)
  }

  useEffect(() => { loadGraph() }, [])

  const nodes    = state.graph.nodes.filter((n) => n.parentId === state.currentParentId)
  const edges    = state.graph.edges.filter((e) => e.parentId === state.currentParentId)
  const selected = state.graph.nodes.find((n) => n.id === state.selectedId) ?? null
  const editing  = state.mode === 'edit'

  /** Дебаунс-обёртка для частых PUT (позиция, имя). */
  const persistDebounced = (key: string, fn: () => Promise<unknown>) => {
    clearTimeout(persistTimers.current[key])
    persistTimers.current[key] = setTimeout(() => { fn().catch(() => {}) }, 400)
  }

  // ── Мутации: локальный диспатч (мгновенный отклик) + запись в БД ───────────

  const handleMove = (id: string, position: [number, number]) => {
    dispatch({ type: 'MOVE_NODE', id, position })
    persistDebounced(`pos-${id}`, () =>
      api.machines.update(id, { pos_x: String(position[0]), pos_z: String(position[1]) }))
  }

  const handleRename = (id: string, title: string) => {
    dispatch({ type: 'RENAME_NODE', id, title })
    persistDebounced(`name-${id}`, () => api.machines.update(id, { name: title }))
  }

  const handleDelete = async (id: string) => {
    dispatch({ type: 'DELETE_NODE', id })
    await api.machines.delete(id).catch(() => {})
    await loadGraph()
  }

  /** Завершение прокладки связи: персистим flow до локального диспатча edge. */
  const handleSelect = (id: string) => {
    if (state.connecting && state.connectFrom && state.connectFrom !== id) {
      api.flows.create({
        from_id: state.connectFrom,
        to_id: id,
        parent_id: state.currentParentId ?? '',
      }).catch(() => {})
    }
    dispatch({ type: 'NODE_CLICK', id })
  }

  /** Регистрация оборудования прямо со схемы: тип + позиция узла → новая машина. */
  const handleCreateMachine = async (
    nodeId: string,
    data: { name: string; wcTypeId: string; orgUnit: string; status: string; kind: ObjectKind },
  ) => {
    const node = state.graph.nodes.find((n) => n.id === nodeId)
    await api.machines.create({
      name: data.name,
      wc_type_id: data.wcTypeId,
      org_unit: data.orgUnit,
      status: data.status,
      subtitle: '',
      pos_x: String(node?.position[0] ?? 0),
      pos_z: String(node?.position[1] ?? 0),
      parent_machine_id: state.currentParentId ?? '',
    })
    // Удаляем временный локальный узел и перестраиваем граф из БД.
    dispatch({ type: 'DELETE_NODE', id: nodeId })
    await loadGraph()
  }

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
              onSelect={handleSelect}
              onEnter={(id) => dispatch({ type: 'ENTER_NODE', id })}
              onMove={handleMove}
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

        {loading && (
          <div className="scene__hint mono" style={{ top: 16, bottom: 'auto' }}>
            Загрузка схемы из НСИ…
          </div>
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
        onRename={handleRename}
        onDelete={handleDelete}
        onEnter={(id) => dispatch({ type: 'ENTER_NODE', id })}
        onClose={() => dispatch({ type: 'CLEAR_SELECTION' })}
        onLinkMachine={(nodeId, machineId) =>
          dispatch({ type: 'LINK_MACHINE', id: nodeId, machineId })
        }
        onCreateMachine={handleCreateMachine}
        onChangeKind={(nodeId, kind) => dispatch({ type: 'CHANGE_KIND', id: nodeId, kind })}
      />
    </div>
  )
}
