/**
 * Правки схемы без тихих записей (X2 P-30): каждая запись в НСИ — явное действие пользователя,
 * ошибка — баннер простыми словами с «Повторить» (ни одной проглоченной ошибки), успех — тост
 * «Отменить» на 8 с. Имя сохраняется по Enter/blur в реестр своего типа: цех/завод — в
 * «Подразделения», станок — в «Оборудование». Удаление подтверждает вызывающий (ConfirmDialog).
 */
import { useCallback, useRef, useState, type Dispatch } from 'react'
import { api, type Machine } from '../../lib/api'
import { showUndo } from '../../ui/kit'
import type { GraphAction, GraphState } from './graph/graphReducer'
import type { SceneNode } from './graph/sceneModel'
import type { SceneData } from './useSceneData'

export interface WriteFailure {
  title: string
  error: unknown
  retry: () => void
}

/** Ключ выполняющейся записи — кнопка выключается только на время запроса. */
export type BusyKey = 'add-shop' | 'add-machine' | 'delete' | null

interface UndoSpec { message: string; act: () => Promise<void> }

export interface SceneWrites {
  failure: WriteFailure | null
  dismiss: () => void
  busy: BusyKey
  move: (id: string, position: [number, number]) => void
  rename: (id: string, title: string) => void
  remove: (id: string) => Promise<boolean>
  createShop: (name: string, kind: string) => Promise<boolean>
  addMachine: (wcTypeId: string) => Promise<boolean>
  changeShopKind: (orgUnitId: string, kind: string) => void
  changeMachineType: (machineId: string, wcTypeId: string) => void
  connect: (fromId: string, toId: string) => void
}

const round = (v: number): string => String(Math.round(v))

export function useSceneWrites(state: GraphState, dispatch: Dispatch<GraphAction>, data: SceneData): SceneWrites {
  const [failure, setFailure] = useState<WriteFailure | null>(null)
  const [busy, setBusy] = useState<BusyKey>(null)
  // Актуальные граф и реестры в колбэках тоста «Отменить» (они живут дольше рендера).
  const live = useRef({ state, data })
  live.current = { state, data }
  const nodeById = (id: string): SceneNode | undefined => live.current.state.graph.nodes.find((n) => n.id === id)
  const reload = () => live.current.data.reload()

  const run = useCallback(async (title: string, act: () => Promise<void>, undo?: UndoSpec, key: BusyKey = null): Promise<boolean> => {
    if (key) setBusy(key)
    try {
      await act()
      setFailure(null)
      if (undo) showUndo({ message: undo.message, onUndo: () => { void run(`Не удалось отменить: ${undo.message}`, undo.act) } })
      return true
    } catch (e) {
      setFailure({ title, error: e, retry: () => { void run(title, act, undo, key) } })
      return false
    } finally {
      if (key) setBusy(null)
    }
  }, [])

  /** Позиция узла в справочнике: цех/завод — абсолютная, станок — в сыром кадре цеха (без центрирования). */
  const persistPosition = (node: SceneNode, from: [number, number], to: [number, number]): Promise<unknown> => {
    if (node.refType !== 'machine') {
      return node.orgUnitId ? api.orgUnits.update(node.orgUnitId, { pos_x: round(to[0]), pos_z: round(to[1]) }) : Promise.resolve()
    }
    const m = live.current.data.machines.find((x) => x.id === node.id)
    // Сдвиг «сцена → справочник» берём у самого станка: без дрейфа центроида цеха.
    const off = m ? [(Number(m.pos_x) || 0) - from[0], (Number(m.pos_z) || 0) - from[1]] : [0, 0]
    const raw = { pos_x: round(to[0] + off[0]), pos_z: round(to[1] + off[1]) }
    live.current.data.patchMachine(node.id, raw)
    return api.machines.update(node.id, raw)
  }

  const move = (id: string, position: [number, number]) => {
    const node = nodeById(id)
    if (!node) return
    const from = node.position
    dispatch({ type: 'MOVE_NODE', id, position })
    void run(`Не удалось сохранить положение «${node.title}»`, async () => { await persistPosition(node, from, position) }, {
      message: `«${node.title}» перемещён`,
      act: async () => { dispatch({ type: 'MOVE_NODE', id, position: from }); await persistPosition({ ...node, position }, position, from) },
    })
  }

  const saveName = (node: SceneNode, title: string): Promise<unknown> => {
    if (node.refType === 'machine') return api.machines.update(node.id, { name: title })
    if (!node.orgUnitId) return Promise.reject(new Error('Это предприятие не записано в справочнике — переименуйте его в Справочниках'))
    return api.orgUnits.update(node.orgUnitId, { name: title })
  }

  const rename = (id: string, raw: string) => {
    const node = nodeById(id)
    const title = raw.trim()
    if (!node || !title || title === node.title) return
    const old = node.title
    dispatch({ type: 'RENAME_NODE', id, title })
    const act = async () => {
      try { await saveName(node, title) } catch (e) { dispatch({ type: 'RENAME_NODE', id, title: old }); throw e }
    }
    void run(`Не удалось переименовать «${old}»`, act, {
      message: `«${old}» переименован в «${title}»`,
      act: async () => { dispatch({ type: 'RENAME_NODE', id, title: old }); await saveName(node, old) },
    })
  }

  const remove = async (id: string): Promise<boolean> => {
    const node = nodeById(id)
    if (!node) return false
    if (node.refType === 'machine') {
      const snap = live.current.data.machines.find((m) => m.id === id)
      return run(`Не удалось удалить «${node.title}»`, async () => { await api.machines.delete(id); await reload() }, snap ? {
        message: `Станок «${node.title}» удалён`,
        act: async () => { await api.machines.create(machineCopy(snap)); await reload() },
      } : undefined, 'delete')
    }
    const ouId = node.orgUnitId
    if (!ouId) return false
    const unit = live.current.data.orgUnits.find((o) => o.id === ouId)
    const inside = live.current.data.machines.filter((m) => m.org_unit_id === ouId)
    return run(`Не удалось удалить «${node.title}»`, async () => { await api.orgUnits.delete(ouId); await reload() }, {
      message: `Цех «${node.title}» удалён`,
      act: async () => {
        const created = await api.orgUnits.create({ name: node.title, kind: unit?.kind || undefined, parent_id: unit?.parent_id || undefined })
        await api.orgUnits.update(created.id, { pos_x: unit?.pos_x ?? round(node.position[0]), pos_z: unit?.pos_z ?? round(node.position[1]), unit_type: unit?.unit_type })
        await Promise.all(inside.map((m) => api.machines.update(m.id, { org_unit_id: created.id, org_unit: node.title })))
        await reload()
      },
    }, 'delete')
  }

  const currentFactoryOu = (): string | undefined => {
    const cur = nodeById(live.current.state.currentParentId ?? '')
    return cur?.refType === 'factory' ? cur.orgUnitId : undefined
  }

  const createShop = (name: string, kind: string): Promise<boolean> => {
    let createdId = ''
    return run(`Не удалось создать цех «${name}»`, async () => {
      const created = await api.orgUnits.create({ name, kind: kind || undefined, parent_id: currentFactoryOu() })
      createdId = created.id
      await reload()
    }, { message: `Цех «${name}» создан`, act: async () => { await api.orgUnits.delete(createdId); await reload() } }, 'add-shop')
  }

  const addMachine = (wcTypeId: string): Promise<boolean> => {
    const { data: d, state: s } = live.current
    const type = d.wcTypes.find((t) => t.id === wcTypeId)
    const shop = nodeById(s.currentParentId ?? '')
    if (!type || shop?.refType !== 'shop') return Promise.resolve(false)
    const name = `${type.name} №${d.machines.filter((m) => m.wc_type_id === wcTypeId).length + 1}`
    // Сырой кадр справочника: правее самого правого станка цеха (не центрированные позиции сцены).
    const shopMs = d.machines.filter((m) => m.org_unit_id === shop.orgUnitId)
    const maxX = shopMs.length ? Math.max(...shopMs.map((m) => Number(m.pos_x) || 0)) : 0
    let createdId = ''
    return run(`Не удалось добавить станок «${name}»`, async () => {
      const created = await api.machines.create({
        name, wc_type_id: wcTypeId, org_unit: shop.title, org_unit_id: shop.orgUnitId ?? '', status: 'active', subtitle: '',
        pos_x: round(maxX + 8), pos_z: '0', parent_machine_id: '',
      })
      createdId = created.id
      await reload()
    }, { message: `Станок «${name}» добавлен`, act: async () => { await api.machines.delete(createdId); await reload() } }, 'add-machine')
  }

  const changeShopKind = (orgUnitId: string, kind: string) => {
    const old = live.current.data.orgUnits.find((o) => o.id === orgUnitId)?.kind ?? ''
    void run('Не удалось сменить модель здания', async () => { await api.orgUnits.update(orgUnitId, { kind }); await reload() }, {
      message: 'Модель здания изменена',
      act: async () => { await api.orgUnits.update(orgUnitId, { kind: old }); await reload() },
    })
  }

  const changeMachineType = (machineId: string, wcTypeId: string) => {
    const old = live.current.data.machines.find((m) => m.id === machineId)?.wc_type_id ?? ''
    void run('Не удалось сменить тип оборудования', async () => { await api.machines.update(machineId, { wc_type_id: wcTypeId }); await reload() }, {
      message: 'Тип оборудования изменён',
      act: async () => { await api.machines.update(machineId, { wc_type_id: old }); await reload() },
    })
  }

  const connect = (fromId: string, toId: string) => {
    let createdId = ''
    void run('Не удалось сохранить связь', async () => {
      const created = await api.flows.create({ from_id: fromId, to_id: toId, parent_id: live.current.state.currentParentId ?? '' })
      createdId = created.id
      await reload()
    }, { message: 'Связь проложена', act: async () => { await api.flows.delete(createdId); await reload() } })
  }

  return {
    failure, dismiss: () => setFailure(null), busy,
    move, rename, remove, createShop, addMachine, changeShopKind, changeMachineType, connect,
  }
}

/** Копия станка для восстановления (без id и даты создания — их назначит справочник). */
function machineCopy(m: Machine): Partial<Machine> {
  const { id: _id, created_at: _created, ...rest } = m
  void _id
  void _created
  return rest
}
