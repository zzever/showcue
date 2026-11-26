import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AppSettings,
  DisplayInfo,
  FixtureProfile,
  MediaFile,
  OscTrigger,
  OutputEvent,
  RdmDevice,
  ShowCueApi,
  ShowFile,
  StartupData
} from '../shared/types'

const api: ShowCueApi = {
  platform: process.platform,
  version: process.env.npm_package_version ?? '1.0.0',

  startup: (): Promise<StartupData> => ipcRenderer.invoke('app:startup'),
  openShow: (): Promise<{ path: string; show: ShowFile } | null> => ipcRenderer.invoke('show:open'),
  saveShow: (path: string | null, json: string): Promise<string | null> =>
    ipcRenderer.invoke('show:save', path, json),
  writeShow: (path: string, json: string): Promise<boolean> =>
    ipcRenderer.invoke('show:write', path, json),
  saveDraft: (json: string): Promise<boolean> => ipcRenderer.invoke('show:draft', json),
  pickMedia: (): Promise<MediaFile[]> => ipcRenderer.invoke('media:pick'),
  saveSettings: (settings: AppSettings): Promise<void> => ipcRenderer.invoke('settings:save', settings),
  fileStatus: (paths: string[]): Promise<Record<string, boolean>> =>
    ipcRenderer.invoke('files:status', paths),

  listDisplays: (): Promise<DisplayInfo[]> => ipcRenderer.invoke('output:displays'),
  ensureOutput: (displayId?: string): Promise<void> => ipcRenderer.invoke('output:ensure', displayId),
  importFixtures: (): Promise<FixtureProfile[]> => ipcRenderer.invoke('fixtures:import'),
  listFixtures: (): Promise<FixtureProfile[]> => ipcRenderer.invoke('fixtures:list'),
  removeFixture: (id: string): Promise<FixtureProfile[]> =>
    ipcRenderer.invoke('fixtures:remove', id),
  dmxSend: (universe: number, values: number[]): Promise<void> =>
    ipcRenderer.invoke('dmx:send', universe, values),
  notifyCue: (
    cue: { number: string; name: string; type: string },
    action: 'go' | 'panic'
  ): Promise<void> => ipcRenderer.invoke('osc:cue', cue, action),
  rdmDiscover: (universe: number): Promise<RdmDevice[]> =>
    ipcRenderer.invoke('rdm:discover', universe),
  rdmSetStartAddress: (
    uid: string,
    universe: number,
    host: string,
    address: number
  ): Promise<RdmDevice | null> =>
    ipcRenderer.invoke('rdm:set-address', uid, universe, host, address),
  exportCueList: (defaultName: string, csv: string): Promise<string | null> =>
    ipcRenderer.invoke('show:export-csv', defaultName, csv),
  outputEvent: (ev: OutputEvent): Promise<void> => ipcRenderer.invoke('output:event', ev),
  outputFullscreen: (on: boolean, displayId?: string): Promise<void> =>
    ipcRenderer.invoke('output:fullscreen', on, displayId),
  toggleOutputFullscreen: (displayId?: string): Promise<void> =>
    ipcRenderer.invoke('output:toggle-fullscreen', displayId),

  onOutput: (cb: (ev: OutputEvent) => void): (() => void) => {
    const listener = (_e: unknown, ev: OutputEvent): void => cb(ev)
    ipcRenderer.on('output:event', listener)
    return () => ipcRenderer.removeListener('output:event', listener)
  },
  onMenu: (cb: (cmd: string) => void): (() => void) => {
    const listener = (_e: unknown, cmd: string): void => cb(cmd)
    ipcRenderer.on('menu', listener)
    return () => ipcRenderer.removeListener('menu', listener)
  },
  onOutputClosed: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('output:closed', listener)
    return () => ipcRenderer.removeListener('output:closed', listener)
  },
  onOscTrigger: (cb: (trigger: OscTrigger) => void): (() => void) => {
    const listener = (_e: unknown, trigger: OscTrigger): void => cb(trigger)
    ipcRenderer.on('osc:trigger', listener)
    return () => ipcRenderer.removeListener('osc:trigger', listener)
  },

  getPathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },

  allowDevices: (): Promise<boolean> => ipcRenderer.invoke('app:allow-devices')
}

contextBridge.exposeInMainWorld('api', api)
