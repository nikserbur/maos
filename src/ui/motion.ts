/**
 * Движение и его остановка (WCAG 2.2.2, 2.3.3): системная настройка «меньше движения» и пауза
 * бесконечной анимации, общая для заставки входа, симуляции «Схемы» и полосы методологии.
 * Пауза хранится в sessionStorage (переживает F5 вкладки, не навязывается другим вкладкам);
 * любое чтение/запись — в try/catch. Хуки — на useSyncExternalStore, без контекста.
 */
import { createElement, useSyncExternalStore } from 'react'
import { IconButton } from './kit/Controls'

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)'
const PAUSE_KEY = 'maos.anim-paused'

/** Системная настройка «меньше движения» сейчас. */
export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia?.(REDUCE_QUERY).matches === true
  } catch {
    return false
  }
}

function subscribeReduced(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const mq = window.matchMedia(REDUCE_QUERY)
  mq.addEventListener?.('change', onChange)
  return () => mq.removeEventListener?.('change', onChange)
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, prefersReducedMotion, () => false)
}

/* ── Пауза бесконечной анимации ───────────────────────────────────────────── */

function readPaused(storage: Pick<Storage, 'getItem'> | null): boolean | null {
  try {
    const v = storage?.getItem(PAUSE_KEY)
    return v === '1' ? true : v === '0' ? false : null
  } catch {
    return null
  }
}

function sessionStore(): Storage | null {
  try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null } catch { return null }
}

/** Начальное значение: явный выбор вкладки, иначе — системное «меньше движения». */
export function initialPaused(storage: Pick<Storage, 'getItem'> | null = sessionStore(), reduced = prefersReducedMotion()): boolean {
  return readPaused(storage) ?? reduced
}

let paused: boolean | null = null
const listeners = new Set<() => void>()

export function getAnimationPaused(): boolean {
  if (paused === null) paused = initialPaused()
  return paused
}

export function setAnimationPaused(next: boolean): void {
  paused = next
  try { sessionStore()?.setItem(PAUSE_KEY, next ? '1' : '0') } catch { /* приватный режим — только в памяти */ }
  listeners.forEach((l) => l())
}

function subscribePaused(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

/** [пауза?, установить] — общая для всех бесконечных анимаций приложения. */
export function useAnimationPaused(): [boolean, (v: boolean) => void] {
  const value = useSyncExternalStore(subscribePaused, getAnimationPaused, () => false)
  return [value, setAnimationPaused]
}

/** Кнопка «Пауза анимации» (aria-pressed) для любой бесконечной анимации. */
export function AnimationToggle({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const [isPaused, setPaused] = useAnimationPaused()
  return createElement(IconButton, {
    icon: isPaused ? 'play' : 'pause',
    size,
    variant: 'ghost',
    pressed: isPaused,
    title: isPaused ? 'Продолжить анимацию' : 'Пауза анимации',
    onClick: () => setPaused(!isPaused),
  })
}

/** Только для тестов: сбросить состояние модуля. */
export function resetMotionForTests(): void {
  paused = null
  listeners.clear()
}
