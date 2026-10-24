import { describe, expect, it } from 'vitest'
import { verifyAnswer } from '../verify'
import { FEW_SHOTS } from '../prompts'
import { EMPTY_REPORT, HISTORY_MAX, appendHistory, exportMarkdown, historyKey, parseHistory, type HistoryEntry } from './history'
import { DEFAULT_SETTINGS, chatEndpoint, checkBaseUrl, isLoopbackHost, normalizeSettings } from './settings'
import { MentatHttpError, isAborted, isNotConnected } from './mentatApi'

describe('settings', () => {
  it('normalizes anything into bounded settings with defaults', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    const s = normalizeSettings({ base_url: ' http://127.0.0.1:11434/ ', model: 'qwen', flavour: 'ollama', temperature: 5, max_tokens: '10', timeout_s: 'x', audit_answers: true })
    expect(s).toMatchObject({ base_url: 'http://127.0.0.1:11434', flavour: 'ollama', temperature: 1, max_tokens: 64, timeout_s: 120, audit_answers: true })
    expect(normalizeSettings({ flavour: 'gpt' }).flavour).toBe('openai')
  })

  it('accepts loopback hosts and warns about others; rejects credentials and odd schemes', () => {
    for (const h of ['localhost', '127.0.0.1', '127.1.2.3', '[::1]', 'llm.localhost']) expect(isLoopbackHost(h), h).toBe(true)
    for (const h of ['10.0.0.5', 'example.com', '127.0.0.256', '0.0.0.0']) expect(isLoopbackHost(h), h).toBe(false)
    expect(checkBaseUrl('http://127.0.0.1:11434')).toEqual({ ok: true, message: null, loopback: true })
    expect(checkBaseUrl('http://gpu-box.lan:8000/v1')).toMatchObject({ ok: true, loopback: false })
    expect(checkBaseUrl('http://gpu-box.lan:8000/v1').message).toContain('MAOS_LLM_ALLOWED_HOSTS')
    expect(checkBaseUrl('http://u:p@127.0.0.1:8000').ok).toBe(false)
    expect(checkBaseUrl('file:///etc/passwd').ok).toBe(false)
    expect(checkBaseUrl('ftp://127.0.0.1').ok).toBe(false)
    expect(checkBaseUrl('https://127.0.0.1:8000').ok).toBe(false)
    expect(checkBaseUrl('').ok).toBe(true)
  })

  it('builds the chat endpoint per API flavour', () => {
    expect(chatEndpoint({ base_url: 'http://127.0.0.1:8000/v1', flavour: 'openai' })).toBe('http://127.0.0.1:8000/v1/chat/completions')
    expect(chatEndpoint({ base_url: 'http://127.0.0.1:8000', flavour: 'openai' })).toBe('http://127.0.0.1:8000/v1/chat/completions')
    expect(chatEndpoint({ base_url: 'http://127.0.0.1:11434', flavour: 'ollama' })).toBe('http://127.0.0.1:11434/api/chat')
    expect(chatEndpoint({ base_url: '', flavour: 'ollama' })).toBe('')
  })
})

const entry = (id: string): HistoryEntry => {
  const ex = FEW_SHOTS[0]
  return { id, at: '2026-10-24T12:00:00.000Z', templateId: 'cvar_driver', question: ex.question, asked: ex.context.asked, promptVersion: 'v', model: 'm', answer: ex.answer, report: verifyAnswer(ex.answer, ex.context) }
}

describe('history', () => {
  it('keeps newest first, deduplicates and caps the list', () => {
    let list: HistoryEntry[] = []
    for (let i = 0; i < HISTORY_MAX + 5; i++) list = appendHistory(list, entry(`e${i}`))
    expect(list).toHaveLength(HISTORY_MAX)
    expect(list[0].id).toBe(`e${HISTORY_MAX + 4}`)
    expect(appendHistory(list, entry(list[3].id))[0].id).toBe(list[3].id)
    expect(appendHistory(list, entry(list[3].id))).toHaveLength(HISTORY_MAX)
  })

  it('parses only valid stored entries and is keyed per project', () => {
    expect(parseHistory(JSON.stringify([entry('a'), { id: 1 }, null]))).toHaveLength(1)
    expect(parseHistory('not json')).toEqual([])
    expect(historyKey('maos.db')).not.toBe(historyKey('plant2.db'))
  })

  it('exports markdown with per-claim verdict marks', () => {
    const md = exportMarkdown([entry('a')])
    expect(md).toContain('## Что определило CVaR прибыли портфеля?')
    expect(md).toContain('проверка верности: пройдена')
    expect(md).toMatch(/- ✓ Вывод: CVaR прибыли/)
  })
})

describe('mentatApi errors', () => {
  it('treats 503 as «not connected», other codes as errors', () => {
    expect(isNotConnected(new MentatHttpError(503, 'LLM не подключена'))).toBe(true)
    expect(isNotConnected(new MentatHttpError(502, 'нет ответа'))).toBe(false)
    expect(isNotConnected(new Error('x'))).toBe(false)
  })

  it('treats a user «Остановить» (AbortError) as a cancel, and records it in history as stopped', () => {
    expect(isAborted(new DOMException('aborted', 'AbortError'))).toBe(true)
    expect(isAborted(new MentatHttpError(500, 'x'))).toBe(false)
    const stopped: HistoryEntry = { ...entry('s'), answer: '', report: EMPTY_REPORT, outcome: 'stopped' }
    expect(parseHistory(JSON.stringify([stopped]))).toHaveLength(1)
    expect(exportMarkdown([stopped])).toContain('остановлен пользователем')
  })
})
