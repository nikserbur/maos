/** Typed API client — проксируется через Vite на 127.0.0.1:8080 в dev-режиме. */

export interface ApiResponse<T> {
  data: T | null
  error: string | null
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!text) throw new Error(`HTTP ${res.status}: empty response`)
  const json: ApiResponse<T> = JSON.parse(text)
  if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`)
  return json.data as T
}

const get  = <T>(path: string)               => request<T>('GET',    path)
const post = <T>(path: string, body: unknown) => request<T>('POST',   path, body)
const put  = <T>(path: string, body: unknown) => request<T>('PUT',    path, body)
const del  = <T>(path: string)               => request<T>('DELETE', path)

/* ── NSI entities ────────────────────────────────────────────────────────── */
export interface WorkCenterType {
  id: string; name: string; group_name: string
  kind: string           // ObjectKind: определяет 3D-вид на схеме
  description: string; interchangeable: string; created_at: string
}
export interface Machine {
  id: string; name: string; wc_type_id: string; org_unit: string
  inv_no: string; serial_no: string; year_made: string
  schedule: string; status: string; created_at: string
}
export interface Product {
  id: string; code: string; name: string; unit: string
  parent_id: string; qty_in_parent: string; batch_size: string
  stock: string; purchased: string; created_at: string
}
export interface Routing {
  id: string; name: string; product_id: string; created_at: string
  operations?: Operation[]
}
export interface Operation {
  id: string; routing_id: string; code: string; name: string
  op_type: string; wc_types: string; order_no: string
  setup_required: string; t_norm: string; t_opt: string; t_pess: string
  cost: string; risk_coef: string
  controls: string; mechanisms: string; inputs: string; outputs: string
  created_at: string
}
export interface Worker {
  id: string; tab_no: string; last_name: string; first_name: string
  middle_name: string; org_unit: string; position: string
  grade: string; skills: string; created_at: string
}
export interface RoutingCreatePayload {
  name: string
  product_id?: string
  operations?: Array<Partial<Omit<Operation, 'id' | 'routing_id' | 'created_at'>> & { name: string }>
}

export interface AuditAction {
  id: string; ts: string; actor: string
  entity_type: string; entity_id: string
  action_type: string; payload: string
}

/* ── API surface ─────────────────────────────────────────────────────────── */
export const api = {
  health: () => get<{ status: string; version: string }>('/health'),

  auth: {
    login: (password: string) =>
      post<{ token: string; role: string }>('/auth/login', { password }),
  },

  workCenterTypes: {
    list:   ()                               => get<WorkCenterType[]>('/work_center_types'),
    get:    (id: string)                     => get<WorkCenterType>(`/work_center_types/${id}`),
    create: (d: Partial<WorkCenterType>)     => post<WorkCenterType>('/work_center_types', d),
    update: (id: string, d: Partial<WorkCenterType>) => put<WorkCenterType>(`/work_center_types/${id}`, d),
    delete: (id: string)                     => del<object>(`/work_center_types/${id}`),
  },

  machines: {
    list:   ()                           => get<Machine[]>('/machines'),
    get:    (id: string)                 => get<Machine>(`/machines/${id}`),
    create: (d: Partial<Machine>)        => post<Machine>('/machines', d),
    update: (id: string, d: Partial<Machine>) => put<Machine>(`/machines/${id}`, d),
    delete: (id: string)                 => del<object>(`/machines/${id}`),
  },

  products: {
    list:   ()                            => get<Product[]>('/products'),
    get:    (id: string)                  => get<Product>(`/products/${id}`),
    create: (d: Partial<Product>)         => post<Product>('/products', d),
    update: (id: string, d: Partial<Product>) => put<Product>(`/products/${id}`, d),
    delete: (id: string)                  => del<object>(`/products/${id}`),
  },

  routings: {
    list:   ()                                  => get<Routing[]>('/routings'),
    get:    (id: string)                        => get<Routing>(`/routings/${id}`),
    create: (d: RoutingCreatePayload)           => post<Routing>('/routings', d),
    delete: (id: string)                        => del<object>(`/routings/${id}`),
  },

  operations: {
    list:   ()                             => get<Operation[]>('/operations'),
    get:    (id: string)                   => get<Operation>(`/operations/${id}`),
    create: (d: Partial<Operation>)        => post<Operation>('/operations', d),
    update: (id: string, d: Partial<Operation>) => put<Operation>(`/operations/${id}`, d),
    delete: (id: string)                   => del<object>(`/operations/${id}`),
  },

  workers: {
    list:   ()                            => get<Worker[]>('/workers'),
    get:    (id: string)                  => get<Worker>(`/workers/${id}`),
    create: (d: Partial<Worker>)          => post<Worker>('/workers', d),
    update: (id: string, d: Partial<Worker>) => put<Worker>(`/workers/${id}`, d),
    delete: (id: string)                  => del<object>(`/workers/${id}`),
  },

  actions: {
    list: (limit = 100) => get<AuditAction[]>(`/actions?limit=${limit}`),
  },

  demo: {
    seed: () => post<Array<{ nodeId: string; machineId: string }>>('/demo/seed', {}),
  },
}
