import type { ShowCueApi } from '@shared/types'

declare global {
  interface Window {
    api?: ShowCueApi
  }
}

export {}
