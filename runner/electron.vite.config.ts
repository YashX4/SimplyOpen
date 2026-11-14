import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

// VS Code sets this in the terminals it starts, and it makes Electron behave
// like plain Node (no windows). Clear it so `npm run dev` works from anywhere.
delete process.env.ELECTRON_RUN_AS_NODE

// One section per part of the app: the main process, the bridge, and the page.
export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react()],
  },
})
