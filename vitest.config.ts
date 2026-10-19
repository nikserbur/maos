import { defineConfig } from 'vitest/config'

// Юнит-тесты чистой логики (реестр «i», форматтеры). DOM не нужен.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
