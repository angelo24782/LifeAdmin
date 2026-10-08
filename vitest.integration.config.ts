import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vitest/config'

import { appVersion } from './config/app-version.ts'

// Test di integrazione contro Supabase locale (Docker). Si lanciano con `pnpm test:integration`,
// che ricava URL e chiavi locali da `supabase status` senza scriverle su disco.
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.int.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
