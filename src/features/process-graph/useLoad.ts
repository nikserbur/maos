import { useCallback, useEffect, useState } from 'react'
import { errorText } from './data'

export type LoadState<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; error: string }

/**
 * Асинхронная загрузка с явными состояниями и «Повторить». Устаревший ответ
 * (после размонтирования или повторного запроса) отбрасывается.
 */
export function useLoad<T>(load: () => Promise<T>): { state: LoadState<T>; reload: () => void } {
  const [state, setState] = useState<LoadState<T>>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    setState({ status: 'loading' })
    load().then(
      (data) => { if (live) setState({ status: 'ready', data }) },
      (e: unknown) => { if (live) setState({ status: 'error', error: errorText(e) }) },
    )
    return () => { live = false }
  }, [load, attempt])

  const reload = useCallback(() => setAttempt((a) => a + 1), [])
  return { state, reload }
}
