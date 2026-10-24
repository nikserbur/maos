/** Версия продукта из package.json (vite define); вне сборки Vite (тесты) — «dev». */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'

/** «PESCADITO v<версия>» — одна подпись версии для статус-бара и окна входа. */
export const PRODUCT_VERSION = `PESCADITO v${APP_VERSION}`

/**
 * Версии интерфейса и сервера расходятся (сервер разработки Vite запущен до повышения версии —
 * __APP_VERSION__ фиксируется при старте, — или сервер не пересобран): подпись для статус-бара,
 * иначе `null`. Неизвестная версия (тесты, нет связи) — не расхождение.
 */
export function versionMismatch(app: string, server: string | null | undefined): string | null {
  if (!server || app === 'dev' || app === server) return null
  return `сервер v${server}`
}
