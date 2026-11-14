/// <reference types="vite/client" />

import type { RunnerApi } from '../../shared/api'

declare global {
  interface Window {
    runner: RunnerApi
  }
}
