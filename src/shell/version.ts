/** Версия продукта из package.json (vite define); вне сборки Vite (тесты) — «dev». */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'

/** «PESCADITO v<версия>» — одна подпись версии для статус-бара и окна входа. */
export const PRODUCT_VERSION = `PESCADITO v${APP_VERSION}`
