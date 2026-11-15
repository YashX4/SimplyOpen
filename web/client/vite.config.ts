import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The API runs next door. Everything under /api goes to it, so the
    // browser only ever talks to one origin and cookies just work.
    proxy: {
      '/api': { target: 'http://localhost:3200', changeOrigin: true },
    },
  },
})
