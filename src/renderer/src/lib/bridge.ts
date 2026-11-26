import type { AppSettings, ShowCueApi, ShowFile, StartupData } from '@shared/types'

/**
 * Acceso al proceso principal. Si la interfaz se abre en un navegador
 * (por ejemplo para revisar el diseño con `npm run dev:web`), se usa un
 * respaldo local sobre localStorage para no romper nada.
 */

const STORE_KEY = 'showcue.web.state'

interface WebState {
  show: ShowFile | null
  path: string | null
  settings: AppSettings
}

const defaultSettings: AppSettings = {
  lastShowPath: null,
  defaultFade: 0.25,
  defaultDeviceId: '',
  hotkeysEnabled: true,
  midiEnabled: true,
  artnetEnabled: false,
  artnetHost: '255.255.255.255',
  oscEnabled: false,
  oscHost: '127.0.0.1',
  oscPort: 8000,
  oscListenEnabled: false,
  oscListenPort: 9000,
  oscPrefix: '/showcue',
  oscGma3: false
}

function readWebState(): WebState {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) return JSON.parse(raw) as WebState
  } catch {
    /* almacenamiento no disponible */
  }
  return { show: null, path: null, settings: defaultSettings }
}

function writeWebState(state: WebState): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state))
  } catch {
    /* sin persistencia */
  }
}

const noop = (): void => {}

const webApi: ShowCueApi = {
  platform: 'web',
  version: '1.0.0',
  startup: async (): Promise<StartupData> => {
    const state = readWebState()
    return { show: state.show, path: state.path, settings: state.settings }
  },
  openShow: async () => null,
  saveShow: async (_path, json) => {
    const state = readWebState()
    state.show = JSON.parse(json) as ShowFile
    state.path = 'navegador'
    writeWebState(state)
    return 'navegador'
  },
  writeShow: async (_path, json) => {
    const state = readWebState()
    state.show = JSON.parse(json) as ShowFile
    writeWebState(state)
    return true
  },
  saveDraft: async (json) => {
    const state = readWebState()
    state.show = JSON.parse(json) as ShowFile
    writeWebState(state)
    return true
  },
  pickMedia: async () => [],
  saveSettings: async (settings) => {
    const state = readWebState()
    state.settings = settings
    writeWebState(state)
  },
  fileStatus: async (paths) => Object.fromEntries(paths.map((p) => [p, true])),
  listDisplays: async () => [
    {
      id: '',
      label: 'Pantalla principal',
      primary: true,
      width: window.screen.width,
      height: window.screen.height,
      scaleFactor: window.devicePixelRatio || 1
    }
  ],
  ensureOutput: async () => noop(),
  importFixtures: async () => [],
  listFixtures: async () => [],
  removeFixture: async () => [],
  dmxSend: async () => noop(),
  notifyCue: async () => noop(),
  rdmDiscover: async () => [],
  rdmSetStartAddress: async () => null,
  exportCueList: async () => null,
  outputEvent: async () => noop(),
  outputFullscreen: async () => noop(),
  toggleOutputFullscreen: async () => noop(),
  onOutput: () => noop,
  onMenu: () => noop,
  onOutputClosed: () => noop,
  onOscTrigger: () => noop,
  getPathForFile: () => '',
  allowDevices: async () => true
}

export const isDesktop = !!window.api
export const api: ShowCueApi = window.api ?? webApi
