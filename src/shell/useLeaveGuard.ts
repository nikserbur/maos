/**
 * Страж несохранённых изменений (X2 «безопасная правка»): пока `dirty`, переход по рельсе, палитре,
 * ссылке или «Назад» спрашивает «Есть несохранённые изменения — уйти?», а закрытие/перезагрузка
 * вкладки — системный вопрос браузера (beforeunload). Используется формами НСИ, конструктором
 * техкарт, полями сценария, финансовой карточкой мастера и боковой панелью кита.
 */
import { useEffect, useRef } from 'react'
import { LEAVE_MESSAGE, registerLeaveGuard } from './router'

export function useLeaveGuard(dirty: boolean, message: string = LEAVE_MESSAGE): void {
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  useEffect(() => registerLeaveGuard(() => dirtyRef.current, message), [message])

  useEffect(() => {
    if (!dirty || typeof window === 'undefined') return undefined
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])
}
