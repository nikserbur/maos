/**
 * Тост «Отменить» (X2 «безопасная правка»): после удаления/перезаписи — «Удалено «ТК-12» · Отменить»
 * на 8 с, role="status", один за раз (новый заменяет прежний). Хост (<UndoToast/>) один — в оболочке;
 * экраны вызывают showUndo().
 */
import { useEffect, useSyncExternalStore } from 'react'
import './kit.css'

export interface UndoRequest {
  message: string
  onUndo: () => void
  /** Подпись действия; по умолчанию «Отменить». */
  actionLabel?: string
}

interface Toast extends UndoRequest { id: number }

const UNDO_MS = 8000
let current: Toast | null = null
let seq = 0
const listeners = new Set<() => void>()

function emit(next: Toast | null): void {
  current = next
  listeners.forEach((l) => l())
}

/** Показать тост отмены (заменяет прежний). */
export function showUndo(req: UndoRequest): void {
  emit({ ...req, id: ++seq })
}

export function dismissUndo(): void {
  emit(null)
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}
const snapshot = (): Toast | null => current

export function useUndoToast(): typeof showUndo {
  return showUndo
}

/** Хост тоста — один на приложение (AppShell). */
export function UndoToast() {
  const toast = useSyncExternalStore(subscribe, snapshot, snapshot)
  useEffect(() => {
    if (!toast) return undefined
    const t = window.setTimeout(() => { if (current?.id === toast.id) dismissUndo() }, UNDO_MS)
    return () => window.clearTimeout(t)
  }, [toast])
  return (
    <div className="dk-toast-host" role="status" aria-live="polite">
      {toast && (
        <div className="dk-toast" key={toast.id}>
          <span className="dk-toast__msg" title={toast.message}>{toast.message}</span>
          <button type="button" className="btn btn--sm" onClick={() => { dismissUndo(); toast.onUndo() }}>{toast.actionLabel ?? 'Отменить'}</button>
          <button type="button" className="btn btn--ghost btn--sm btn--icon" onClick={dismissUndo} aria-label="Скрыть">✕</button>
        </div>
      )}
    </div>
  )
}
