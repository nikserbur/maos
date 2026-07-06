import { Suspense, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Loader } from '@react-three/drei'
import { SceneEnvironment } from './SceneEnvironment'
import { Facility } from './Facility'
import { WorkshopInterior } from './WorkshopInterior'
import { WorldMap } from './WorldMap'
import { PlantLayout } from './PlantLayout'
import { EditorPanel } from './EditorPanel'
import { SimulationLayer, createSimState } from './SimulationLayer'
import { SimulationPanel } from './SimulationPanel'
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
  const [simOn, setSimOn]           = useState(false)
  const sim = useRef(createSimState())

  // Дебаунс PUT-ов раскладки (перемещение/переименование тянут запросы пачками).
  const persistTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  // Схема строится из реестров НСИ — единый источник истины (БД).
  const loadGraph = async () => {
    const [m, t, f, ops, ous] = await Promise.all([
      api.machines.list().catch(() => [] as Machine[]),
      api.workCenterTypes.list().catch(() => [] as WorkCenterType[]),
      api.flows.list().catch(() => [] as Flow[]),
      api.operations.list().catch(() => [] as Operation[]),
      api.orgUnits.list().catch(() => []),
    ])
    setMachines(m)
    setWcTypes(t)
    setOperations(ops)
    // Дороги/дорожки берутся из flows (производственная линия внутри цеха + магистраль
    // цех→цех, сформированные из техкарт). Прежний process_flows давал сотни рёбер и
    // «глючную» кашу дорог — теперь сеть чистая и осмысленная.
    dispatch({ type: 'LOAD_GRAPH', graph: buildGraphFromDb(m, t, f, ous) })
    setLoading(false)
  }

  useEffect(() => { loadGraph() }, [])

  // DEV-only: детерминированный вход в цех для визуальной верификации из консоли
  // (window.__maos.enterShop(i) / .root()). В прод-сборку не попадает.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const factories = () => state.graph.nodes.filter((n) => n.refType === 'factory')
    // Цеха текущего завода (когда мы внутри завода) — для верификации входа.
    const shops = () => state.graph.nodes.filter(
      (n) => n.refType === 'shop' && n.parentId === state.currentParentId)
    Object.assign(window, {
      __maos: {
        factories: () => factories().map((f, i) => `${i}: ${f.title}`),
        enterFactory: (sel: number | string = 0) => {
          const list = factories()
          const f = typeof sel === 'number'
            ? list[sel]
            : list.find((x) => x.title.toLowerCase().includes(String(sel).toLowerCase()))
          if (f) dispatch({ type: 'ENTER_NODE', id: f.id })
          return f?.title ?? null
        },
        shops: () => shops().map((s, i) => `${i}: ${s.title}`),
        enterShop: (sel: number | string = 0) => {
          const list = shops()
          const shop = typeof sel === 'number'
            ? list[sel]
            : list.find((s) => s.title.toLowerCase().includes(String(sel).toLowerCase()))
          if (shop) dispatch({ type: 'ENTER_NODE', id: shop.id })
          return shop?.title ?? null
        },
        selectMachine: (i = 0) => {
          const ms = state.graph.nodes.filter((n) => n.parentId === state.currentParentId && n.refType === 'machine')
          if (ms[i]) dispatch({ type: 'NODE_CLICK', id: ms[i].id })
          return ms[i]?.title ?? null
        },
        root: () => dispatch({ type: 'GO_TO_LEVEL', index: 0 }),
      },
    })
  }, [state.graph, state.currentParentId])

  // useMemo обязателен: новые массивы на каждый рендер ломали useMemo в FlowLinks/
  // Facility (deps [nodes, edges]) — сеть дорог и обвязка пересчитывались на каждый
  // клик/hover по сцене.
  const nodes = useMemo(
    () => state.graph.nodes.filter((n) => n.parentId === state.currentParentId),
    [state.graph, state.currentParentId])
  const edges = useMemo(
    () => state.graph.edges.filter((e) => e.parentId === state.currentParentId),
    [state.graph, state.currentParentId])
  const selected = state.graph.nodes.find((n) => n.id === state.selectedId) ?? null
  const editing  = state.mode === 'edit'

  // Уровень иерархии определяется типом узла в currentParentId:
  //   null → МИР (WorldMap); refType 'factory' → ПЛОЩАДКА (Facility);
  //   refType 'shop' → ЦЕХ (WorkshopInterior).
  const currentNode = state.graph.nodes.find((n) => n.id === state.currentParentId) ?? null
  const level: 'world' | 'site' | 'shop' =
    state.currentParentId == null ? 'world'
      : currentNode?.refType === 'shop' ? 'shop'
        : 'site'
  const indoor = level === 'shop'

  // Габарит текущего уровня (самый дальний узел от центра) → туман/тени масштабируются
  // под РАЗМЕР завода: большой кампус виден целиком, маленький цех — камернее.
  const extent = useMemo(() => {
    let m = 34
    for (const n of nodes)
      m = Math.max(m, Math.abs(n.position[0]) + 10, Math.abs(n.position[1]) + 10)
    return m
  }, [nodes])

  // Карта станок→цех для симуляции (на уровне площадки цеха «горят» по своим станкам).
  const machineShop = useMemo(() => {
    const mm = new Map<string, string>()
    for (const n of state.graph.nodes) if (n.refType === 'machine' && n.parentId) mm.set(n.id, n.parentId)
    return mm
  }, [state.graph])

  /** Дебаунс-обёртка для частых PUT (позиция, имя). */
  const persistDebounced = (key: string, fn: () => Promise<unknown>) => {
    clearTimeout(persistTimers.current[key])
    persistTimers.current[key] = setTimeout(() => { fn().catch(() => {}) }, 400)
  }

  // ── Мутации: локальный диспатч (мгновенный отклик) + запись в БД ───────────

  const handleMove = (id: string, position: [number, number]) => {
    // position — координата гизмо в ЦЕНТРИРОВАННОМ кадре (buildGraphFromDb вычитает
    // центроид цеха при загрузке). В БД надо писать СЫРУЮ позицию, иначе перемещение
    // «не запоминается»: при перезагрузке центрируется повторно и станок прыгает на
    // центроид. Инвертируем центрирование, добавляя центроид сырых позиций цеха.
    dispatch({ type: 'MOVE_NODE', id, position })
    // Завод/склад (мировая карта) и цех (площадка): позиция АБСОЛЮТНАЯ (не центрируется)
    // — пишем прямо в org_units.pos_x/pos_z. Виртуальный завод (без orgUnitId) не
    // персистим. Тот же путь используется и для 'factory', и для 'shop'.
    const node = state.graph.nodes.find((n) => n.id === id)
    if (node?.refType === 'shop' || node?.refType === 'factory') {
      if (node.orgUnitId)
        persistDebounced(`pos-${id}`, () =>
          api.orgUnits.update(node.orgUnitId!, {
            pos_x: String(Math.round(position[0])), pos_z: String(Math.round(position[1])),
          }))
      return
    }
    const m = machines.find((x) => x.id === id)
    const shopMs = m ? machines.filter((x) => x.org_unit_id === m.org_unit_id) : []
    const cx = shopMs.length ? shopMs.reduce((s, x) => s + (Number(x.pos_x) || 0), 0) / shopMs.length : 0
    const cz = shopMs.length ? shopMs.reduce((s, x) => s + (Number(x.pos_z) || 0), 0) / shopMs.length : 0
    const rawX = String(Math.round(position[0] + cx))
    const rawZ = String(Math.round(position[1] + cz))
    // Держим локальный кэш сырых позиций согласованным (центроид для следующих move).
    setMachines((prev) => prev.map((x) => (x.id === id ? { ...x, pos_x: rawX, pos_z: rawZ } : x)))
    persistDebounced(`pos-${id}`, () => api.machines.update(id, { pos_x: rawX, pos_z: rawZ }))
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

  // Текущий цех (когда мы внутри цеха на схеме) — станки создаются в нём.
  const currentShop = state.graph.nodes.find(
    (n) => n.id === state.currentParentId && n.refType === 'shop',
  )
  // «Уровень площадки» (создание цехов) показываем ВНУТРИ ЗАВОДА (site), а не в
  // мире. На мировом уровне заводы/склад приходят из НСИ (создаются отдельно).
  const atRoot = level === 'site'

  /** Регистрация оборудования прямо со схемы: станок создаётся ВНУТРИ текущего цеха. */
  const handleCreateMachine = async (
    nodeId: string,
    data: { name: string; wcTypeId: string; orgUnit: string; status: string; kind: ObjectKind },
  ) => {
    const node = state.graph.nodes.find((n) => n.id === nodeId)
    await api.machines.create({
      name: data.name,
      wc_type_id: data.wcTypeId,
      // Цех берём из контекста (мы внутри цеха), а не из выпадашки — станок всегда в цехе.
      org_unit: currentShop?.title ?? data.orgUnit,
      org_unit_id: currentShop?.orgUnitId ?? '',
      status: data.status,
      subtitle: '',
      pos_x: String(node?.position[0] ?? 0),
      pos_z: String(node?.position[1] ?? 0),
      parent_machine_id: '',   // иерархия цеха идёт через org_unit, не через машину-родителя
    })
    dispatch({ type: 'DELETE_NODE', id: nodeId })
    await loadGraph()
  }

  /** Добавить станок: СРАЗУ создаётся в НСИ (без промежуточной «регистрации»).
   *  Имя — «Тип №N», цех — текущий, позиция — продолжение линии цеха,
   *  3D-модель — строго по типу оборудования. */
  const handleAddMachine = async (wcTypeId: string) => {
    const type = wcTypes.find((t) => t.id === wcTypeId)
    if (!type || !currentShop) return
    const n = machines.filter((m) => m.wc_type_id === wcTypeId).length + 1
    // Позиция в СЫРОМ кадре (как в БД): правее самого правого станка цеха. Брать
    // сырые pos из реестра машин, а не центрированные позиции сцены — иначе новый
    // станок после перезагрузки прыгает на центроид (как было с перемещением).
    const shopMs = machines.filter((m) => m.org_unit_id === currentShop.orgUnitId)
    const maxX = shopMs.length ? Math.max(...shopMs.map((m) => Number(m.pos_x) || 0)) : 0
    await api.machines.create({
      name: `${type.name} №${n}`,
      wc_type_id: wcTypeId,
      org_unit: currentShop.title,
      org_unit_id: currentShop.orgUnitId ?? '',
      status: 'active', subtitle: '',
      pos_x: String(Math.round(maxX + 8)), pos_z: '0',
      parent_machine_id: '',
    }).catch(() => {})
    await loadGraph()
  }

  /** Создать новый цех (org_unit): имя + опционально 3D-модель здания.
   *  На уровне площадки цех привязывается к ТЕКУЩЕМУ заводу (parent_id). Для
   *  виртуального завода (legacy, без orgUnitId) parent_id опускаем — модель
   *  сама повесит его на завод по умолчанию. */
  const handleCreateShop = async (name: string, kind?: string) => {
    if (!name.trim()) return
    const parentId = currentNode?.refType === 'factory' ? currentNode.orgUnitId : undefined
    await api.orgUnits.create({
      name: name.trim(), kind: kind || undefined, parent_id: parentId || undefined,
    }).catch(() => {})
    await loadGraph()
  }

  /** Сменить 3D-модель здания цеха (сохраняется в НСИ за подразделением). */
  const handleChangeShopKind = async (orgUnitId: string, kind: string) => {
    await api.orgUnits.update(orgUnitId, { kind }).catch(() => {})
    await loadGraph()
  }

  /** Удаление узла: цех → удаляем org_unit (станки станут «Без цеха»); станок → машину. */
  const handleDeleteNode = async (id: string) => {
    const node = state.graph.nodes.find((n) => n.id === id)
    if (node?.refType === 'shop') {
      if (node.orgUnitId) await api.orgUnits.delete(node.orgUnitId).catch(() => {})
      await loadGraph()
      return
    }
    await handleDelete(id)
  }

  /** Смена типа оборудования у уже зарегистрированной машины (3D-вид следует типу). */
  const handleChangeMachineType = async (machineId: string, wcTypeId: string) => {
    await api.machines.update(machineId, { wc_type_id: wcTypeId }).catch(() => {})
    await loadGraph()
  }

  return (
    <div className="scene">
      <div className="scene__canvas">
        <Canvas
          shadows
          dpr={[1, 1.5]}
          /* near=1.5 (было 0.1) — ГЛАВНЫЙ фикс z-fighting: точность буфера глубины
             определяется отношением far/near. 0.1/1000 давало «частокол» мерцаний
             на всех плоских декалях (тени, разметка, полосы, кольца) у земли;
             1.5/1500 повышает точность на порядок. Камера не ближе 8 ед. к цели
             (OrbitControls minDistance), поэтому near=1.5 ничего не срезает.
             logarithmicDepthBuffer НЕ используем — он ломает polygonOffset декалей. */
          camera={{ position: [46, 36, 50], fov: 44, near: 1.5, far: 1500 }}
          onPointerMissed={() => dispatch({ type: 'CLEAR_SELECTION' })}
        >
          <SceneEnvironment indoor={indoor} extent={extent} />
          <Suspense fallback={null}>
            {/* Земля/окружение уровня: мир — своя карта; площадка — газон (Facility);
                цех — интерьер. WorldMap сам рисует иконки заводов + магистрали,
                поэтому PlantLayout на мировом уровне НЕ рисуем (иначе двойной рендер). */}
            {level === 'world'
              ? (
                <WorldMap
                  nodes={nodes}
                  edges={edges}
                  selectedId={state.selectedId}
                  editing={editing}
                  onSelect={handleSelect}
                  onEnter={(id) => dispatch({ type: 'ENTER_NODE', id })}
                  onMove={handleMove}
                />
              )
              : (
                <>
                  {level === 'site' ? <Facility nodes={nodes} /> : <WorkshopInterior nodes={nodes} />}
                  {simOn && <SimulationLayer sim={sim} nodes={nodes} machineShop={machineShop} />}
                  <PlantLayout
                    graph={state.graph}
                    nodes={nodes}
                    edges={edges}
                    selectedId={state.selectedId}
                    connectFrom={state.connectFrom}
                    connecting={state.connecting}
                    editing={editing}
                    indoor={indoor}
                    onSelect={handleSelect}
                    onEnter={(id) => dispatch({ type: 'ENTER_NODE', id })}
                    onMove={handleMove}
                    onConnectFrom={(id) => dispatch({ type: 'CONNECT_FROM', id })}
                  />
                </>
              )}
          </Suspense>
        </Canvas>

        <Loader />

        <button className="btn" style={{ position: 'absolute', top: 16, right: simOn ? 412 : 16, zIndex: 6 }}
                onClick={() => setSimOn((v) => !v)}
                title="Проиграть построенный план на 3D-схеме (материальный поток, занятость станков)">
          {simOn ? '⏹ Выйти из симуляции' : '▶ Симуляция'}
        </button>
        {simOn && <SimulationPanel sim={sim} onClose={() => setSimOn(false)} />}

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
        atRoot={atRoot}
        currentShopName={currentShop?.title ?? null}
        onCreateShop={handleCreateShop}
        onChangeShopKind={handleChangeShopKind}
        onToggleMode={() => dispatch({ type: 'SET_MODE', mode: editing ? 'view' : 'edit' })}
        onAddMachine={handleAddMachine}
        onRename={handleRename}
        onDelete={handleDeleteNode}
        onEnter={(id) => dispatch({ type: 'ENTER_NODE', id })}
        onClose={() => dispatch({ type: 'CLEAR_SELECTION' })}
        onLinkMachine={(nodeId, machineId) =>
          dispatch({ type: 'LINK_MACHINE', id: nodeId, machineId })
        }
        onCreateMachine={handleCreateMachine}
        onChangeMachineType={handleChangeMachineType}
        onChangeKind={(nodeId, kind) => dispatch({ type: 'CHANGE_KIND', id: nodeId, kind })}
      />
    </div>
  )
}
