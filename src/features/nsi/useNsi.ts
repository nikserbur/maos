import { useState, useEffect } from 'react'
import {
  api,
  type WorkCenterType,
  type Machine,
  type Product,
  type Operation,
  type OrgUnit,
} from '../../lib/api'

export function useOrgUnits(): OrgUnit[] {
  const [data, setData] = useState<OrgUnit[]>([])
  useEffect(() => { api.orgUnits.list().then(setData).catch(() => {}) }, [])
  return data
}

export function useWorkCenterTypes(): WorkCenterType[] {
  const [data, setData] = useState<WorkCenterType[]>([])
  useEffect(() => {
    api.workCenterTypes.list().then(setData).catch(() => {})
  }, [])
  return data
}

export function useMachines(): Machine[] {
  const [data, setData] = useState<Machine[]>([])
  useEffect(() => {
    api.machines.list().then(setData).catch(() => {})
  }, [])
  return data
}

export function useProducts(): Product[] {
  const [data, setData] = useState<Product[]>([])
  useEffect(() => {
    api.products.list().then(setData).catch(() => {})
  }, [])
  return data
}

export function useOperations(): Operation[] {
  const [data, setData] = useState<Operation[]>([])
  useEffect(() => {
    api.operations.list().then(setData).catch(() => {})
  }, [])
  return data
}
