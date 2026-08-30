import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // `@/` -> src/, the import prefix shadcn/ui components are generated with.
  // Mirrored in jsconfig.json so editors resolve it too.
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    proxy: {
      // Forward API calls to the Express server during development,
      // so the frontend can just fetch('/api/...') with no CORS involved.
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.js',
    // Playwright specs live in e2e/ and are driven by Playwright, not Vitest.
    exclude: ['node_modules/**', 'dist/**', 'e2e/**'],
  },
})
