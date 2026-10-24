/**
 * Клиент MENTAT-API (backend/src/Mentat.cpp). Отдельно от src/lib/api.ts, потому что панели нужен HTTP-код
 * ответа: 503 «LLM не подключена» — честное пустое состояние, а не сбой. Тот же конверт {data, error} и
 * Bearer-токен сессии.
 */
import type { ChatMessage } from '../prompts'
import { normalizeSettings, type LlmFlavour, type LlmSettings } from './settings'

export interface MentatStatus {
  configured: boolean
  /** Откуда адрес: переменные окружения сервера (env) или настройки проекта (prefs). */
  source: 'env' | 'prefs' | null
  base_url: string
  model: string
  flavour: LlmFlavour
  /** null — не проверялось (без probe). */
  reachable: boolean | null
  error: string
  /** Модели, которые отдал сервер модели при проверке соединения. */
  models: string[]
  /** Сохранённые настройки проекта (без секретов). */
  settings: LlmSettings
  /** Адрес задан переменной окружения — настройки проекта его не меняют. */
  env_locked: boolean
}

export interface MentatAnswer {
  text: string
  model: string
  flavour: LlmFlavour
  ms: number
  prompt_version: string
}

export interface AskBody {
  messages: ChatMessage[]
  template_id: string
  prompt_version: string
  asked: string
  /** Сводка контекста для аудита: число узлов, оценка токенов. */
  context: { nodes: number; tokens: number }
}

export class MentatHttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'MentatHttpError'
    this.status = status
  }
}

/** 503 — модель не подключена (не ошибка продукта). */
export const isNotConnected = (e: unknown): boolean => e instanceof MentatHttpError && e.status === 503

/** Запрос отменён кнопкой «Остановить» (AbortController) — не ошибка. */
export const isAborted = (e: unknown): boolean => typeof e === 'object' && e !== null && (e as { name?: string }).name === 'AbortError'

async function call<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  try {
    const token = sessionStorage.getItem('maos.token')
    if (token) headers.Authorization = `Bearer ${token}`
  } catch { /* приватный режим */ }
  const res = await fetch(`/api/mentat${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal })
  const text = await res.text()
  let json: { data?: T; error?: string | null } = {}
  try { json = text ? JSON.parse(text) : {} } catch { /* не JSON — сообщим кодом */ }
  if (!res.ok || json.error) throw new MentatHttpError(res.status, json.error ?? `HTTP ${res.status}`)
  return json.data as T
}

function normalizeStatus(s: MentatStatus): MentatStatus {
  return { ...s, settings: normalizeSettings(s.settings), models: Array.isArray(s.models) ? s.models : [] }
}

export const mentatApi = {
  /** Статус подключения; probe — проверить, отвечает ли модель (короткий таймаут на сервере). */
  status: (probe = false) => call<MentatStatus>('GET', `/status${probe ? '?probe=1' : ''}`).then(normalizeStatus),
  saveSettings: (s: LlmSettings) => call<MentatStatus>('PUT', '/settings', s).then(normalizeStatus),
  /** Вопрос модели; `signal` — «Остановить»: fetch отменяется, сервер видит закрытое соединение. */
  ask: (body: AskBody, signal?: AbortSignal) => call<MentatAnswer>('POST', '/ask', body, signal),
}
