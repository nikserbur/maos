/**
 * Связь формы НСИ с боковой панелью (P-50): форма регистрирует свою отправку, сообщает «есть
 * изменения» и «сохраняем»; кнопки — в липком подвале панели. При правке уходят только поля,
 * изменённые относительно записи (P-43): неизменённые связи и поля сервер не трогает.
 */
import { useEffect, type MutableRefObject } from 'react'

export type EditCtx = { id: string; row: Record<string, unknown> } | undefined

export interface FormBridge {
  submitRef: MutableRefObject<(() => void) | null>
  onDirty: (dirty: boolean) => void
  onBusy: (busy: boolean) => void
}

export interface NsiFormProps {
  edit?: EditCtx
  /** Запись сохранена; `message` — для тоста/статуса. */
  onSuccess: (message?: string) => void
  bridge: FormBridge
}

const isBlank = (v: unknown) => v === null || v === undefined || String(v).trim() === ''

/** Одинаковые значения поля: числа — по величине («6800.0» = «6800»), строки — без пробелов по краям, пустое = пустое. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (isBlank(a) && isBlank(b)) return true
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a ?? []) === JSON.stringify(b ?? [])
  const sa = String(a ?? '').trim()
  const sb = String(b ?? '').trim()
  if (sa === sb) return true
  const na = Number(sa)
  const nb = Number(sb)
  return sa !== '' && sb !== '' && Number.isFinite(na) && Number.isFinite(nb) && na === nb
}

/** Поля `payload`, отличающиеся от `base` (новый объект; исходные не меняются). */
export function changedFields<T extends Record<string, unknown>>(payload: T, base: Readonly<Record<string, unknown>>): Partial<T> {
  const out: Partial<T> = {}
  for (const key of Object.keys(payload) as Array<keyof T>) {
    if (!sameValue(payload[key], base[key as string])) out[key] = payload[key]
  }
  return out
}

/** Регистрация формы в панели: отправка, признак изменений и занятости. */
export function useFormBridge(bridge: FormBridge, submit: () => void, dirty: boolean, busy: boolean): void {
  bridge.submitRef.current = submit
  const { onDirty, onBusy } = bridge
  useEffect(() => { onDirty(dirty) }, [dirty, onDirty])
  useEffect(() => { onBusy(busy) }, [busy, onBusy])
}

/** Значение поля записи строкой (для начального состояния формы). */
export const fieldOf = (row: Readonly<Record<string, unknown>>) => (key: string, fallback = ''): string =>
  row[key] === null || row[key] === undefined ? fallback : String(row[key])
