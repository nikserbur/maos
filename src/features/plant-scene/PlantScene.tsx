/**
 * Схема предприятия: полоса режимов и уровней (SceneModeBar) · канвас (мировая карта или 3D) ·
 * правая колонка 360 px (инспектор или симуляция). Данные — реестры Справочников (useSceneData),
 * загрузка по плану (useSceneOps), правки с «Отменить» (useSceneWrites), уровень и выбор — в адресе
 * (useSceneUrl). Клавиши: F — только в канвасе, Esc — через стек слоёв (MENTAT и меню не теряют уровень).
 */
import { Suspense, useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent } from 'react'
import { Canvas } from '@react-three/fiber'
import { Loader } from '@react-three/drei'
import { ErrorBoundary } from '../../shell/ErrorBoundary'
import { useEscapeLayer } from '../../shell/overlays'
import { useAnimationPaused, usePrefersReducedMotion } from '../../ui/motion'
import type { Crumb as KitCrumb } from '../../ui/kit'
import { SceneEnvironment } from './SceneEnvironment'
import { Facility } from './Facility'
import { WorkshopInterior } from './WorkshopInterior'
import { WorldMap2D } from './WorldMap2D'
import { PlantLayout } from './PlantLayout'
import { EditorPanel } from './EditorPanel'
import { SimulationLayer, createSimState } from './SimulationLayer'
import { SimulationPanel } from './SimulationPanel'
import { SceneTimeline } from './SceneTimeline'
import { SceneCanvasState } from './SceneCanvasState'
import { CameraFit } from './CameraFit'
import { SceneLegend } from './SceneLegend'
import { SceneVerdict } from './SceneVerdict'
import { SceneModeBar, type ModeAvailability, type SceneUiMode } from './SceneModeBar'
import type { ObjectRow } from './SceneObjectsTable'
import type { Pose } from './cameraPose'
import { useDevHooks } from './useDevHooks'
import { useSceneData } from './useSceneData'
import { useSceneOps } from './useSceneOps'
import { useSceneWrites } from './useSceneWrites'
import { useSceneUrl } from './useSceneUrl'
import { useSimSession } from './useSimSession'
import { levelCountText, levelOf, machinesUnder } from './sceneView'
import { levelHref } from './schemeHref'
import { MIN_GEO_SITES, hasRealGeo } from './worldmap2d/cities'
import { graphReducer, initialGraphState } from './graph/graphReducer'
import type { SceneNode } from './graph/sceneModel'
import './scene.css'

const WORLD_EDIT = 'Заводы создаются в Справочниках › Подразделения — правка схемы доступна на площадке и в цехе'
const WORLD_SIM = 'Симуляция видна на площадке и в цехе — войдите в завод'

export default function PlantScene() {
  const [state, dispatch] = useReducer(graphReducer, initialGraphState)
  const data = useSceneData(dispatch)
  const ops = useSceneOps(state.graph, data.machines)
  const writes = useSceneWrites(state, dispatch, data)
  useSceneUrl(state, dispatch, data.loaded)
  useDevHooks(state, dispatch)

  const [simOn, setSimOn] = useState(false)
  const [fitToken, setFitToken] = useState(0)
  const sim = useRef(createSimState())
  const poses = useRef<ReadonlyMap<string, Pose>>(new Map())
  const session = useSimSession(sim, simOn, data.machines, data.wcTypes)
  const [paused, setPaused] = useAnimationPaused()
  const reduced = usePrefersReducedMotion()
  // «Меньше движения» в системе — анимация схемы на паузе; снять можно кнопкой паузы (явный выбор).
  useEffect(() => { if (reduced) setPaused(true) }, [reduced, setPaused])

  const { graph } = state
  const nodes = useMemo(() => graph.nodes.filter((n) => n.parentId === state.currentParentId), [graph, state.currentParentId])
  const edges = useMemo(() => graph.edges.filter((e) => e.parentId === state.currentParentId), [graph, state.currentParentId])
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph])
  const parents = useMemo(() => new Set(graph.nodes.map((n) => n.parentId)), [graph])
  const currentNode = state.currentParentId ? byId.get(state.currentParentId) ?? null : null
  const selected = state.selectedId ? byId.get(state.selectedId) ?? null : null
  const level = levelOf(currentNode)
  const indoor = level === 'shop'
  const editing = state.mode === 'edit'
  const factories = useMemo(() => graph.nodes.filter((n) => n.refType === 'factory'), [graph])
  const showMap = level === 'world' && factories.filter(hasRealGeo).length >= MIN_GEO_SITES

  // Габарит уровня → туман/тени под размер завода.
  const extent = useMemo(() => nodes.reduce((m, n) => Math.max(m, Math.abs(n.position[0]) + 10, Math.abs(n.position[1]) + 10), 34), [nodes])
  // Станок → цех (на площадке цеха «горят» по своим станкам).
  const machineShop = useMemo(() => new Map(graph.nodes.filter((n) => n.refType === 'machine' && n.parentId).map((n) => [n.id, n.parentId as string])), [graph])
  const levelMachines = useMemo(() => machinesUnder(graph, state.currentParentId), [graph, state.currentParentId])
  const selectedMachines = useMemo(() => new Set(selected ? machinesUnder(graph, selected.id).map((m) => m.id) : []), [graph, selected])

  // ── Режимы по уровню (X2 P-29) ─────────────────────────────────────────────
  const singleFactory = factories.length === 1 ? factories[0] : null
  const simTarget = selected?.refType === 'factory' ? selected : singleFactory
  const availability: ModeAvailability = {
    edit: level === 'world' ? WORLD_EDIT : null,
    sim: level === 'world' && !simTarget ? WORLD_SIM : null,
  }
  const uiMode: SceneUiMode = simOn ? 'sim' : state.mode
  /** Пауза до входа в «Редактирование»: на выходе возвращаем выбор пользователя. */
  const pausedBeforeEdit = useRef<boolean | null>(null)
  const leaveEdit = () => {
    if (pausedBeforeEdit.current === false) setPaused(false)
    pausedBeforeEdit.current = null
  }
  const setUiMode = (m: SceneUiMode) => {
    if (m !== 'edit' && state.mode === 'edit') leaveEdit()
    if (m === 'sim') {
      if (level === 'world') {
        if (!simTarget) return
        dispatch({ type: 'ENTER_NODE', id: simTarget.id })
      }
      setSimOn(true)
      dispatch({ type: 'SET_MODE', mode: 'view' })
      return
    }
    setSimOn(false)
    dispatch({ type: 'SET_MODE', mode: m })
    if (m === 'edit' && state.mode !== 'edit') {
      pausedBeforeEdit.current = paused
      setPaused(true)   // в «Редактировании» анимация по умолчанию на паузе
    }
  }
  // Мировой уровень: правка и симуляция живут на площадке и в цехе.
  useEffect(() => {
    if (level !== 'world') return
    if (state.mode === 'edit') { leaveEdit(); dispatch({ type: 'SET_MODE', mode: 'view' }) }
    setSimOn(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, state.mode])

  // ── Выбор, связи, клавиши ──────────────────────────────────────────────────
  const handleSelect = (id: string) => {
    if (state.connecting && state.connectFrom && state.connectFrom !== id) writes.connect(state.connectFrom, id)
    dispatch({ type: 'NODE_CLICK', id })
  }
  const enter = (id: string) => dispatch({ type: 'ENTER_NODE', id })
  const depth = state.path.length
  useEscapeLayer('scene', () => {
    if (state.connecting || state.selectedId) dispatch({ type: 'CLEAR_SELECTION' })
    else if (depth > 1) dispatch({ type: 'GO_TO_LEVEL', index: depth - 2 })
  }, state.connecting || state.selectedId !== null || depth > 1)
  const onCanvasKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const tag = (e.target as HTMLElement).tagName
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') return
    if (e.code !== 'KeyF' || e.metaKey || e.ctrlKey || e.altKey || level === 'world') return
    e.preventDefault()
    setFitToken((t) => t + 1)
  }

  // ── Таблица-двойник и состав ───────────────────────────────────────────────
  const rowOf = (n: SceneNode): ObjectRow => ({ node: n, ops: ops.byNode.get(n.id), enterable: n.refType !== 'machine' && parents.has(n.id) })
  const levelRows = nodes.map(rowOf)
  const childRows = selected && selected.refType !== 'machine' ? graph.nodes.filter((n) => n.parentId === selected.id).map(rowOf) : []
  const pathIds = state.path.slice(1).map((c) => c.id).filter((id): id is string => id !== null)
  const openChild = (row: ObjectRow, into: boolean) => {
    if (!selected) return
    const ids = into && row.enterable ? [...pathIds, selected.id, row.node.id] : [...pathIds, selected.id]
    dispatch({ type: 'SET_PATH', ids, selectedId: into && row.enterable ? null : row.node.id })
  }
  const crumbs: KitCrumb[] = state.path.map((c, i) => ({ label: c.title, href: i < depth - 1 ? levelHref(pathIds.slice(0, i)) : undefined }))

  return (
    <div className="scene">
      <SceneModeBar mode={uiMode} onMode={setUiMode} availability={availability} level={level}
                    crumbs={crumbs} countText={data.loaded ? levelCountText(level, nodes) : ''}
                    verdict={<SceneVerdict ops={ops} />} legend={<SceneLegend statuses={levelMachines.map((m) => m.status)} />}
                    onFit={() => setFitToken((t) => t + 1)} />
      <div className="scene__body">
        <div className="scene__canvas" tabIndex={0} role="region" aria-label="Схема предприятия: сцена" aria-keyshortcuts="F Escape" onKeyDown={onCanvasKey}>
          {level === 'world' ? (
            showMap && (
              <ErrorBoundary variant="inline" label="Мировая карта" message="Карта не загрузилась — выберите предприятие в списке справа.">
                <WorldMap2D nodes={nodes} edges={edges} graph={graph} ops={ops.byNode} selectedId={state.selectedId} editing={false}
                            onSelect={handleSelect} onEnter={enter} onMove={writes.move}
                            onBackground={() => dispatch({ type: 'CLEAR_SELECTION' })} />
              </ErrorBoundary>
            )
          ) : (
            <Canvas shadows dpr={[1, 1.5]}
              /* near=1,5: точность глубины (far/near) без z-fighting декалей; камера не ближе 8 к цели. */
              camera={{ position: [46, 36, 50], fov: 44, near: 1.5, far: 1500 }}
              onPointerMissed={() => dispatch({ type: 'CLEAR_SELECTION' })}>
              <SceneEnvironment indoor={indoor} extent={extent} nodes={nodes} />
              <CameraFit nodes={nodes} levelKey={state.currentParentId ?? ''} fitToken={fitToken} poses={poses} />
              <Suspense fallback={null}>
                {level === 'site' ? <Facility nodes={nodes} /> : <WorkshopInterior nodes={nodes} />}
                {simOn && <SimulationLayer sim={sim} nodes={nodes} machineShop={machineShop} productIds={session.productIds} still={paused} />}
                <PlantLayout graph={graph} nodes={nodes} edges={edges} selectedId={state.selectedId}
                             connectFrom={state.connectFrom} connecting={state.connecting} editing={editing} indoor={indoor}
                             ops={ops.byNode} simActive={simOn} still={paused}
                             onSelect={handleSelect} onEnter={enter} onMove={writes.move}
                             onConnectFrom={(id) => dispatch({ type: 'CONNECT_FROM', id })} />
              </Suspense>
            </Canvas>
          )}
          {level !== 'world' && <Loader />}
          <SceneCanvasState loading={data.loading} loaded={data.loaded} error={data.error} onRetry={() => { void data.reload() }}
                            empty={data.loaded && graph.nodes.length === 0} noMap={data.loaded && level === 'world' && !showMap && graph.nodes.length > 0} />
          {simOn && level !== 'world' && <SceneTimeline sim={sim} session={session} />}
        </div>

        <ErrorBoundary variant="inline" label="Правая колонка схемы" message="Панель не удалось показать — сцена работает; повторите.">
          {simOn ? (
            <SimulationPanel sim={sim} session={session} selectedNode={selected} selectedMachines={selectedMachines} onExit={() => setUiMode('view')} />
          ) : (
            <EditorPanel editing={editing} connecting={state.connecting} level={level} selectedNode={selected}
                         status={data.loaded ? 'ready' : data.error ? 'unavailable' : 'loading'}
                         levelRows={levelRows} childRows={childRows} canEnter={Boolean(selected && selected.refType !== 'machine' && parents.has(selected.id))}
                         currentShopName={currentNode?.refType === 'shop' ? currentNode.title : null}
                         data={data} ops={ops} writes={writes}
                         onSelectRow={(r) => handleSelect(r.node.id)} onEnterRow={(r) => enter(r.node.id)} onOpenChild={openChild}
                         onEnter={enter} onClose={() => dispatch({ type: 'CLEAR_SELECTION' })} />
          )}
        </ErrorBoundary>
      </div>
    </div>
  )
}
