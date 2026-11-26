import { create } from 'zustand'
import type {
  AppSettings,
  Cue,
  CueType,
  MediaFile,
  PatchFixture,
  ShowFile,
  TimelineEntry
} from '@shared/types'
import { createCue, createMediaCue, emptyShow, normalizeCue } from './cues'

/** Valor de "lista activa" que muestra todas las sub-listas juntas. */
export const ALL_LISTS = '*'

export interface Toast {
  id: string
  text: string
  kind: 'info' | 'error' | 'success'
}

export type SaveState = 'saved' | 'draft' | 'dirty' | 'saving' | 'error'

interface Snapshot {
  cues: Cue[]
  selectedId: string | null
  standbyId: string | null
}

const HISTORY_LIMIT = 60
// Evita apilar un estado por cada tecla al editar un campo.
let lastRecordAt = 0
let lastRecordTag = ''

interface ShowStore {
  title: string
  cues: Cue[]
  selectedId: string | null
  standbyId: string | null
  /** Sub-lista activa para filtrar y para colocar los cues nuevos. */
  activeList: string
  masterVolume: number
  /** Patch de DMX del proyecto. */
  patch: PatchFixture[]
  /** Cues eliminados, para poder recuperarlos. */
  trash: Cue[]
  path: string | null
  saveState: SaveState
  missing: Record<string, boolean>
  toasts: Toast[]
  settings: AppSettings
  outputOpen: boolean
  settingsOpen: boolean
  shortcutsOpen: boolean
  dmxOpen: boolean
  patchOpen: boolean
  /** Grabación en curso de una línea de tiempo. */
  recording: { startedAt: number; entries: TimelineEntry[] } | null
  historyPast: Snapshot[]
  historyFuture: Snapshot[]

  setTitle: (title: string) => void
  select: (id: string | null) => void
  setStandby: (id: string | null) => void
  setActiveList: (list: string) => void
  setMasterVolume: (value: number) => void
  addCue: (type: CueType) => Cue
  addMedia: (files: MediaFile[]) => Cue[]
  updateCue: (id: string, patch: Record<string, unknown>) => void
  removeCue: (id: string) => void
  duplicateCue: (id: string) => void
  moveCue: (id: string, delta: number) => void
  loadShow: (show: ShowFile, path: string | null) => void
  newShow: () => void
  setPatch: (patch: PatchFixture[]) => void
  updatePatch: (id: string, patch: Partial<PatchFixture>) => void
  removePatch: (id: string) => void
  /** Recupera el último cue eliminado. */
  restoreLast: () => Cue | null
  setPath: (path: string | null) => void
  setSaveState: (state: SaveState) => void
  setMissing: (missing: Record<string, boolean>) => void
  setSettings: (patch: Partial<AppSettings>) => void
  setOutputOpen: (open: boolean) => void
  setSettingsOpen: (open: boolean) => void
  setShortcutsOpen: (open: boolean) => void
  setDmxOpen: (open: boolean) => void
  setPatchOpen: (open: boolean) => void
  startRecording: () => void
  /** Anota un GO en la grabación si está activa. */
  captureRecord: (cueId: string) => void
  /** Cierra la grabación y crea el cue de línea de tiempo. */
  stopRecording: () => Cue | null
  toast: (text: string, kind?: Toast['kind']) => void
  dismissToast: (id: string) => void
  /** Guarda el estado actual para poder deshacer. `tag` agrupa ediciones seguidas. */
  record: (tag?: string) => void
  undo: () => void
  redo: () => void
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
  oscGma3: false,
  artnetInEnabled: false,
  artnetInPort: 6454,
  speakerGroups: [],
  timelinePriority: 'go'
}

const uid = (): string => Math.random().toString(36).slice(2) + Date.now().toString(36)

export const useShowStore = create<ShowStore>((set, get) => ({
  title: 'Show sin título',
  cues: [],
  selectedId: null,
  standbyId: null,
  activeList: ALL_LISTS,
  masterVolume: 1,
  patch: [],
  trash: [],
  path: null,
  saveState: 'saved',
  missing: {},
  toasts: [],
  settings: defaultSettings,
  outputOpen: false,
  settingsOpen: false,
  shortcutsOpen: false,
  dmxOpen: false,
  patchOpen: false,
  recording: null,
  historyPast: [],
  historyFuture: [],

  setTitle: (title) => set({ title }),

  select: (id) => set({ selectedId: id }),

  setStandby: (id) => set({ standbyId: id }),

  setActiveList: (activeList) => set({ activeList }),

  setMasterVolume: (value) => set({ masterVolume: Math.min(1, Math.max(0, value)) }),

  addCue: (type) => {
    get().record(`add:${type}`)
    const list = get().activeList
    const cue = createCue(type, get().cues, get().settings, list === ALL_LISTS ? '' : list)
    set((state) => ({ cues: [...state.cues, cue], selectedId: cue.id }))
    return cue
  },

  addMedia: (files) => {
    get().record(`media:${files.map((file) => file.path).join('|')}`)
    const created: Cue[] = []
    set((state) => {
      let cues = state.cues
      for (const file of files) {
        const cue = createMediaCue(
          file,
          cues,
          state.settings,
          state.activeList === ALL_LISTS ? '' : state.activeList
        )
        cues = [...cues, cue]
        created.push(cue)
      }
      return {
        cues,
        selectedId: created.length > 0 ? created[0].id : state.selectedId,
        standbyId: state.standbyId ?? (created[0]?.id ?? null)
      }
    })
    return created
  },

  updateCue: (id, patch) => {
    get().record(`update:${id}:${Object.keys(patch).join(',')}`)
    set((state) => ({
      cues: state.cues.map((cue) => (cue.id === id ? ({ ...cue, ...patch } as Cue) : cue))
    }))
  },

  removeCue: (id) => {
    get().record(`remove:${id}`)
    set((state) => {
      const removed = state.cues.find((cue) => cue.id === id)
      const trash = removed ? [...state.trash.slice(-49), removed] : state.trash
      const cues = state.cues
        .filter((cue) => cue.id !== id)
        .map((cue) => {
          if (cue.type === 'group') {
            return { ...cue, members: cue.members.filter((member) => member.cueId !== id) }
          }
          if (cue.type === 'random') {
            return { ...cue, members: cue.members.filter((member) => member !== id) }
          }
          if (cue.type === 'stop' || cue.type === 'fade') {
            return { ...cue, targets: cue.targets.filter((target) => target !== id) }
          }
          return cue
        })
      const index = state.cues.findIndex((cue) => cue.id === id)
      const fallback = cues[Math.min(index, cues.length - 1)] ?? null
      return {
        cues,
        trash,
        selectedId: state.selectedId === id ? (fallback?.id ?? null) : state.selectedId,
        standbyId: state.standbyId === id ? (fallback?.id ?? null) : state.standbyId
      }
    })
  },

  restoreLast: () => {
    const state = get()
    const cue = state.trash[state.trash.length - 1]
    if (!cue) return null
    get().record(`restore:${cue.id}`)
    const exists = state.cues.some((item) => item.id === cue.id)
    set({
      cues: exists ? state.cues : [...state.cues, cue],
      trash: state.trash.slice(0, -1),
      selectedId: cue.id,
      standbyId: state.standbyId ?? cue.id
    })
    return cue
  },

  setPatch: (patch) => set({ patch }),

  updatePatch: (id, delta) =>
    set((state) => ({
      patch: state.patch.map((item) => (item.id === id ? { ...item, ...delta } : item))
    })),

  removePatch: (id) => set((state) => ({ patch: state.patch.filter((item) => item.id !== id) })),

  duplicateCue: (id) => {
    get().record(`duplicate:${id}`)
    set((state) => {
      const index = state.cues.findIndex((cue) => cue.id === id)
      if (index === -1) return {}
      const source = state.cues[index]
      const copy = structuredClone(source) as Cue
      copy.id = uid()
      copy.number = `${source.number} copy`
      copy.name = `${source.name} copy`
      if (copy.type === 'group') copy.members = copy.members.map((m) => ({ ...m }))
      const cues = [...state.cues]
      cues.splice(index + 1, 0, copy)
      return { cues, selectedId: copy.id }
    })
  },

  moveCue: (id, delta) => {
    get().record(`move:${id}:${delta}`)
    set((state) => {
      const index = state.cues.findIndex((cue) => cue.id === id)
      const target = index + delta
      if (index === -1 || target < 0 || target >= state.cues.length) return {}
      const cues = [...state.cues]
      const [moved] = cues.splice(index, 1)
      cues.splice(target, 0, moved)
      return { cues }
    })
  },

  loadShow: (show, path) =>
    set({
      title: show.title || 'Show sin título',
      cues: Array.isArray(show.cues) ? show.cues.map((cue) => normalizeCue(cue)) : [],
      masterVolume: typeof show.masterVolume === 'number' ? show.masterVolume : 1,
      patch: Array.isArray(show.patch) ? show.patch : [],
      trash: [],
      path,
      selectedId: show.cues?.[0]?.id ?? null,
      standbyId: show.cues?.[0]?.id ?? null,
      activeList: ALL_LISTS,
      saveState: path ? 'saved' : 'draft',
      missing: {},
      historyPast: [],
      historyFuture: []
    }),

  newShow: () => {
    const show = emptyShow()
    set({
      title: show.title,
      cues: [],
      masterVolume: 1,
      patch: [],
      trash: [],
      path: null,
      selectedId: null,
      standbyId: null,
      activeList: ALL_LISTS,
      saveState: 'draft',
      missing: {},
      historyPast: [],
      historyFuture: []
    })
  },

  setPath: (path) => set({ path }),
  setSaveState: (saveState) => set({ saveState }),
  setMissing: (missing) => set({ missing }),
  setSettings: (patch) => set((state) => ({ settings: { ...state.settings, ...patch } })),
  setOutputOpen: (outputOpen) => set({ outputOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setDmxOpen: (dmxOpen) => set({ dmxOpen }),
  setPatchOpen: (patchOpen) => set({ patchOpen }),

  startRecording: () => set({ recording: { startedAt: Date.now(), entries: [] } }),

  captureRecord: (cueId) => {
    const recording = get().recording
    if (!recording) return
    const at = Math.round(((Date.now() - recording.startedAt) / 1000) * 100) / 100
    set({ recording: { ...recording, entries: [...recording.entries, { at, cueId }] } })
  },

  stopRecording: () => {
    const state = get()
    const recording = state.recording
    set({ recording: null })
    if (!recording || recording.entries.length === 0) return null
    const entries = [...recording.entries].sort((a, b) => a.at - b.at)
    const duration = Math.round((entries[entries.length - 1].at + 1) * 100) / 100
    const cue = createCue('timeline', state.cues, state.settings, state.activeList === ALL_LISTS ? '' : state.activeList)
    const timeline = {
      ...cue,
      name: `Línea de tiempo (${entries.length} eventos)`,
      entries,
      duration
    } as Cue
    set({ cues: [...state.cues, timeline], selectedId: timeline.id })
    return timeline
  },

  toast: (text, kind = 'info') => {
    const id = Math.random().toString(36).slice(2)
    set((state) => ({ toasts: [...state.toasts.slice(-3), { id, text, kind }] }))
    window.setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }))
    }, 6000)
  },

  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),

  record: (tag) => {
    const now = Date.now()
    if (tag && tag === lastRecordTag && now - lastRecordAt < 700) {
      lastRecordAt = now
      return
    }
    lastRecordAt = now
    lastRecordTag = tag ?? ''
    set((state) => ({
      historyPast: [
        ...state.historyPast.slice(-(HISTORY_LIMIT - 1)),
        {
          cues: structuredClone(state.cues),
          selectedId: state.selectedId,
          standbyId: state.standbyId
        }
      ],
      historyFuture: []
    }))
  },

  undo: () => {
    const state = get()
    const previous = state.historyPast[state.historyPast.length - 1]
    if (!previous) return
    lastRecordTag = ''
    set({
      cues: previous.cues,
      selectedId: previous.selectedId,
      standbyId: previous.standbyId,
      historyPast: state.historyPast.slice(0, -1),
      historyFuture: [
        ...state.historyFuture,
        {
          cues: structuredClone(state.cues),
          selectedId: state.selectedId,
          standbyId: state.standbyId
        }
      ]
    })
  },

  redo: () => {
    const state = get()
    const next = state.historyFuture[state.historyFuture.length - 1]
    if (!next) return
    lastRecordTag = ''
    set({
      cues: next.cues,
      selectedId: next.selectedId,
      standbyId: next.standbyId,
      historyFuture: state.historyFuture.slice(0, -1),
      historyPast: [
        ...state.historyPast,
        {
          cues: structuredClone(state.cues),
          selectedId: state.selectedId,
          standbyId: state.standbyId
        }
      ]
    })
  }
}))

export const getStore = (): ShowStore => useShowStore.getState()

export function showFromStore(): ShowFile {
  const state = getStore()
  return {
    format: 'showcue',
    version: 1,
    title: state.title,
    masterVolume: state.masterVolume,
    cues: state.cues,
    patch: state.patch
  }
}
