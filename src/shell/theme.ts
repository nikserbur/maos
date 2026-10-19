import { useSyncExternalStore } from 'react'

/** Тема оформления: `<html data-theme>`; выбор хранится в localStorage['maos-theme']. */
export type Theme = 'dark' | 'light'

export const THEME_STORAGE_KEY = 'maos-theme'

const isTheme = (value: unknown): value is Theme => value === 'dark' || value === 'light'

/** Текущая тема по атрибуту `<html data-theme>` (по умолчанию — тёмная). */
export function getTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

function readStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return isTheme(stored) ? stored : null
  } catch {
    return null // хранилище недоступно (приватный режим)
  }
}

/** `<meta name="theme-color">` = токен --theme-color активной темы. */
function syncThemeColor(): void {
  const meta = document.querySelector('meta[name="theme-color"]')
  const color = getComputedStyle(document.documentElement).getPropertyValue('--theme-color').trim()
  if (meta && color) meta.setAttribute('content', color)
}

/** Применяет тему и сохраняет выбор. */
export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  syncThemeColor()
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    /* выбор просто не переживёт перезагрузку */
  }
}

/** Вызывается один раз в main.tsx (index.html уже выставил тему до первой отрисовки). */
export function initTheme(): void {
  document.documentElement.dataset.theme = readStoredTheme() ?? getTheme()
  syncThemeColor()
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}

/** Реактивная тема — например, чтобы 3D-сцена подстраивала небо/туман. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getTheme, () => 'dark')
}
