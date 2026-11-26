import type { AppSettings } from '@shared/types'
import { api } from './bridge'
import { getStore } from './store'

/** Cambia ajustes de la aplicación y los persiste en disco. */
export function updateSettings(patch: Partial<AppSettings>): void {
  const state = getStore()
  const next = { ...state.settings, ...patch }
  state.setSettings(patch)
  void api.saveSettings(next)
}

/** Activa o desactiva los atajos de disparo y navegación. */
export function setHotkeysEnabled(enabled: boolean): void {
  updateSettings({ hotkeysEnabled: enabled })
  getStore().toast(
    enabled ? 'Atajos de teclado activados' : 'Atajos de teclado bloqueados',
    enabled ? 'success' : 'info'
  )
}

export function toggleHotkeys(): void {
  setHotkeysEnabled(getStore().settings.hotkeysEnabled === false)
}
