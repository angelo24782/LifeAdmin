import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// `build.target` è esplicito (SPECIFICA §14, §23.1): è la baseline minima per Tailwind 4 e per
// Vite 8 (Chrome 111, Safari/iOS 16.4). Non cambiarlo senza aggiornare i minimi nativi (§22.3/22.4).
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'baseline-widely-available',
  },
})
