// The bridge between the page and the main process. The page cannot reach
// Electron or the file system directly; it only gets the functions listed here,
// as `window.runner`.

import { contextBridge, ipcRenderer } from 'electron'
import type { RunnerApi } from '../shared/api'

const api: RunnerApi = {
  loadManifest: () => ipcRenderer.invoke('manifest:load'),
  chooseFile: (extensions) => ipcRenderer.invoke('file:choose', extensions),
  run: (values) => ipcRenderer.invoke('run:start', values),
  onLog: (listener) => {
    const handler = (_event: unknown, line: string): void => listener(line)
    ipcRenderer.on('run:log', handler)
    return () => ipcRenderer.removeListener('run:log', handler)
  },
  openResults: () => ipcRenderer.invoke('results:open'),
}

contextBridge.exposeInMainWorld('runner', api)
