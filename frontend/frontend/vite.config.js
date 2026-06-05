import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// build: 2026-06-05
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['xlsx']
  },
  build: {
    commonjsOptions: {
      include: [/xlsx/, /node_modules/]
    }
  }
})
