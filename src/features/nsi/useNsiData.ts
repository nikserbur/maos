/**
 * Данные экрана Справочников: все шесть реестров из общего кэша (одна загрузка на экран, формы и
 * конструктор читают тот же кэш), связи между ними и представление активного реестра. Ошибки
 * загрузки не прячутся: у каждого списка — своя ошибка и «Повторить».
 */
import { useMemo } from 'react'
import type { Machine, Operation, Product, Routing, Worker, WorkCenterType } from '../../lib/api'
import { buildLookups, workerIncomplete, type NsiData, type NsiLookups } from './nsiLookups'
import { machineView, wcTypeView, workerView, type AnyRow, type RegistryView } from './registryColumns'
import { operationView, productView, routingView } from './registryColumnsGoods'
import { registryTitle } from './registries'
import {
  useMachinesState, useOperationsState, useProductsState, useRoutingsState, useWorkCenterTypesState, useWorkersState,
  type ListState,
} from './useNsi'

export type RegistryLists = Readonly<Record<string, ListState<unknown>>>

/** Какие справочники нужны реестру для подписей (их сбой — баннер «названия не показаны»). */
const LOOKUPS_OF: Readonly<Record<string, readonly string[]>> = {
  workcentertype: ['machine', 'worker', 'operation', 'routing'],
  machine: ['workcentertype', 'operation', 'routing'],
  product: [],
  routing: ['product', 'operation'],
  operation: ['routing', 'workcentertype', 'product'],
  worker: ['workcentertype', 'machine'],
}

export function viewFor(id: string, data: NsiData, lk: NsiLookups): RegistryView {
  const ctx = { data, lk }
  switch (id) {
    case 'workcentertype': return wcTypeView(ctx)
    case 'machine': return machineView(ctx)
    case 'product': return productView(ctx)
    case 'routing': return routingView(ctx)
    case 'operation': return operationView(ctx)
    default: return workerView(ctx)
  }
}

/** Неполные записи реестра (▲ в списке реестров): рабочие без цеха/имени, станки и операции без типа. */
export function incompleteCount(id: string, data: NsiData, lk: NsiLookups): number {
  switch (id) {
    case 'worker': return data.workers.filter((w) => workerIncomplete(w) !== null).length
    case 'machine': return data.wcTypes.length ? data.machines.filter((m) => !lk.typeById.has(m.wc_type_id)).length : 0
    case 'operation': return data.wcTypes.length ? data.operations.filter((o) => lk.typesOfOp(o).length === 0).length : 0
    default: return 0
  }
}

export interface NsiScreenData {
  lists: RegistryLists
  data: NsiData
  lk: NsiLookups
  /** Справочники-подписи, не загрузившиеся для активного реестра: имена и «Повторить». */
  lookupFailures: (activeId: string) => { names: string[]; retry: () => void }
}

export function useNsiData(): NsiScreenData {
  const wcTypes = useWorkCenterTypesState()
  const machines = useMachinesState()
  const products = useProductsState()
  const routings = useRoutingsState()
  const operations = useOperationsState()
  const workers = useWorkersState()

  const data = useMemo<NsiData>(() => ({
    wcTypes: wcTypes.data as WorkCenterType[], machines: machines.data as Machine[], workers: workers.data as Worker[],
    products: products.data as Product[], operations: operations.data as Operation[], routings: routings.data as Routing[],
  }), [wcTypes.data, machines.data, workers.data, products.data, operations.data, routings.data])
  const lk = useMemo(() => buildLookups(data), [data])

  const lists: RegistryLists = {
    workcentertype: wcTypes as ListState<unknown>, machine: machines as ListState<unknown>, product: products as ListState<unknown>,
    routing: routings as ListState<unknown>, operation: operations as ListState<unknown>, worker: workers as ListState<unknown>,
  }
  const lookupFailures = (activeId: string) => {
    const failed = (LOOKUPS_OF[activeId] ?? []).filter((id) => lists[id]?.error && !lists[id]?.loaded)
    return { names: failed.map(registryTitle), retry: () => failed.forEach((id) => lists[id].reload()) }
  }
  return { lists, data, lk, lookupFailures }
}

/** Строка для поиска: всё, что видно в ячейках, плюс подпись группы. */
export function rowSearchText(row: AnyRow, view: RegistryView): string {
  const cells = view.columns.map((c) => c.text(row)).join(' ')
  return `${cells} ${view.groupText?.(row) ?? ''}`.toLowerCase()
}
