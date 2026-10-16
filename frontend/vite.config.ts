/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In dev the API is proxied, mirroring production where Nginx serves this app and proxies /api to FastAPI.
// That keeps the browser on one origin, so no CORS setup is needed.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: { '/api': 'http://localhost:8000' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
