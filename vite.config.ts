import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// MAOS dev/build config. Local-first: no external services at runtime.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: false,
  },
})
