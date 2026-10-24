/**
 * Настройки подключения локальной модели (хранятся в настройках проекта — app_prefs `mentat.llm` — через
 * PUT /api/mentat/settings; сервер проверяет их сам). Здесь — типы, умолчания, нормализация и зеркальная
 * проверка адреса для мгновенной подсказки в форме: без адреса модель не подключена, а адрес вне
 * localhost/127.0.0.1/::1 сервер примет только из явного списка MAOS_LLM_ALLOWED_HOSTS.
 */

export type LlmFlavour = 'openai' | 'ollama'

export interface LlmSettings {
  base_url: string
  model: string
  flavour: LlmFlavour
  /** Низкая температура — пересказ, а не творчество. */
  temperature: number
  max_tokens: number
  timeout_s: number
  /** Бюджет токенов контекста (узлы графа). */
  context_tokens: number
  /** Примеры few-shot в запросе. */
  with_examples: boolean
  /** Писать текст ответа в журнал аудита (по умолчанию — нет, только метаданные вопроса). */
  audit_answers: boolean
}

export const DEFAULT_SETTINGS: LlmSettings = {
  base_url: '', model: '', flavour: 'openai', temperature: 0.1, max_tokens: 800, timeout_s: 120,
  context_tokens: 3000, with_examples: true, audit_answers: false,
}

type NumKey = 'temperature' | 'max_tokens' | 'timeout_s' | 'context_tokens'

/** Допустимые диапазоны (те же — в backend/src/Mentat.cpp). */
export const LIMITS: Readonly<Record<NumKey, readonly [number, number]>> = {
  temperature: [0, 1], max_tokens: [64, 4096], timeout_s: [5, 600], context_tokens: [500, 12000],
}

export const FLAVOURS: ReadonlyArray<{ id: LlmFlavour; label: string; endpoint: string; example: string }> = [
  { id: 'openai', label: 'OpenAI-совместимый', endpoint: '/v1/chat/completions', example: 'http://127.0.0.1:8000/v1' },
  { id: 'ollama', label: 'Ollama', endpoint: '/api/chat', example: 'http://127.0.0.1:11434' },
]

const clamp = (v: unknown, [lo, hi]: readonly [number, number], dflt: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : Number.NaN
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt
}

/** Нормализация чего угодно (ответ сервера, форма) в настройки: умолчания и диапазоны. */
export function normalizeSettings(raw: unknown): LlmSettings {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const str = (k: string) => (typeof o[k] === 'string' ? (o[k] as string).trim() : '')
  return {
    base_url: str('base_url').replace(/\/+$/, ''),
    model: str('model'),
    flavour: o.flavour === 'ollama' ? 'ollama' : 'openai',
    temperature: clamp(o.temperature, LIMITS.temperature, DEFAULT_SETTINGS.temperature),
    max_tokens: Math.round(clamp(o.max_tokens, LIMITS.max_tokens, DEFAULT_SETTINGS.max_tokens)),
    timeout_s: Math.round(clamp(o.timeout_s, LIMITS.timeout_s, DEFAULT_SETTINGS.timeout_s)),
    context_tokens: Math.round(clamp(o.context_tokens, LIMITS.context_tokens, DEFAULT_SETTINGS.context_tokens)),
    with_examples: o.with_examples === undefined ? DEFAULT_SETTINGS.with_examples : o.with_examples === true,
    audit_answers: o.audit_answers === true,
  }
}

/** localhost, *.localhost, 127.0.0.0/8, ::1. */
export function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h === '::1') return true
  const m = h.match(/^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  return Boolean(m && m.slice(1).every((x) => Number(x) <= 255))
}

export interface UrlCheck {
  ok: boolean
  /** Ошибка (адрес не годится) или предупреждение (нелокальный хост — нужен список на сервере). */
  message: string | null
  loopback: boolean
}

/** Проверка адреса модели для подсказки в форме; окончательное решение — на сервере. */
export function checkBaseUrl(url: string): UrlCheck {
  const s = url.trim()
  if (!s) return { ok: true, message: null, loopback: false }
  let u: URL
  try { u = new URL(s) } catch { return { ok: false, message: 'Адрес не распознан: нужен вид http://127.0.0.1:11434', loopback: false } }
  if (u.protocol !== 'http:') return { ok: false, message: 'Только http:// — локальная модель (TLS — обратным прокси вне MAOS)', loopback: false }
  if (u.username || u.password) return { ok: false, message: 'Логин и пароль в адресе запрещены — ключ задаётся переменной MAOS_LLM_API_KEY на сервере', loopback: false }
  if (u.search || u.hash) return { ok: false, message: 'Адрес без параметров запроса и якоря', loopback: false }
  const loopback = isLoopbackHost(u.hostname)
  return loopback
    ? { ok: true, message: null, loopback }
    : { ok: true, message: `Хост ${u.hostname} не локальный: сервер примет его, только если он перечислен в MAOS_LLM_ALLOWED_HOSTS`, loopback }
}

/** Полный адрес конечной точки чата — как его соберёт сервер (для подписи в форме). */
export function chatEndpoint(s: Pick<LlmSettings, 'base_url' | 'flavour'>): string {
  const base = s.base_url.replace(/\/+$/, '')
  if (!base) return ''
  if (s.flavour === 'ollama') return `${base}/api/chat`
  return base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`
}
