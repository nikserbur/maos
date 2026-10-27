import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Версия продукта — одна, из package.json: статус-бар и окно входа читают __APP_VERSION__ (без литералов в src).
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

// MAOS dev/build config. Local-first: the only external requests at runtime are the 2D world map's CARTO tiles and OSRM routes.
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    // Уважаем PORT из окружения (превью-харнесс назначает свободный порт), иначе дефолт.
    port: Number(process.env.PORT) || 5173,
    open: false,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
})
