/// <reference types="vite/client" />
import type { TrailblazerApi } from '../preload'

declare global {
  interface Window {
    api: TrailblazerApi
  }
}

export {}
