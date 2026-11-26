import type { AppSettings, AudioCue, Cue, CueType, MediaFile, ShowFile } from '@shared/types'
import { nextCueNumber } from './format'

const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)

type Defaults = Pick<AppSettings, 'defaultFade' | 'defaultDeviceId'>

const TYPE_LABEL: Record<CueType, string> = {
  audio: 'Audio',
  video: 'Video',
  group: 'Grupo',
  wait: 'Espera',
  stop: 'Stop',
  fade: 'Fade',
  memo: 'Nota',
  dmx: 'DMX'
}

export const cueTypeLabel = (type: CueType): string => TYPE_LABEL[type]

/** Rellena campos nuevos en cues cargados de archivos antiguos. */
export function normalizeCue(cue: Cue): Cue {
  const base = cue as Cue & Record<string, unknown>
  const armed = typeof base.armed === 'boolean' ? base.armed : true
  const hotkey = typeof base.hotkey === 'string' ? base.hotkey : ''
  const midiNote = typeof base.midiNote === 'number' ? base.midiNote : -1
  const midiChannel = typeof base.midiChannel === 'number' ? base.midiChannel : 0
  if (cue.type === 'audio') {
    return { ...cue, armed, hotkey, midiNote, midiChannel, fadeCurve: (base.fadeCurve as AudioCue['fadeCurve']) ?? 'linear' }
  }
  if (cue.type === 'video') {
    return {
      ...cue,
      armed,
      hotkey,
      midiNote,
      midiChannel,
      startTime: typeof base.startTime === 'number' ? base.startTime : 0,
      endTime: typeof base.endTime === 'number' ? base.endTime : 0,
      displayId: typeof base.displayId === 'string' ? base.displayId : '',
      deviceId: typeof base.deviceId === 'string' ? base.deviceId : ''
    }
  }
  if (cue.type === 'dmx') {
    return { ...cue, armed, hotkey, midiNote, midiChannel, channels: Array.isArray(base.channels) ? cue.channels : [] }
  }
  return { ...cue, armed, hotkey, midiNote, midiChannel }
}

export function emptyShow(): ShowFile {
  return {
    format: 'showcue',
    version: 1,
    title: 'Show sin título',
    masterVolume: 1,
    cues: []
  }
}

export function createCue(type: CueType, cues: Cue[], defaults: Defaults): Cue {
  const base = {
    id: uid(),
    number: nextCueNumber(cues),
    name: TYPE_LABEL[type],
    notes: '',
    preWait: 0,
    postWait: 0,
    autoContinue: false,
    armed: true,
    hotkey: '',
    midiNote: -1,
    midiChannel: 0
  }

  switch (type) {
    case 'audio':
      return {
        ...base,
        type: 'audio',
        filePath: '',
        fileName: '',
        mediaDuration: 0,
        volume: 1,
        fadeIn: 0,
        fadeOut: defaults.defaultFade,
        startTime: 0,
        endTime: 0,
        loop: false,
        loopCount: 0,
        pan: 0,
        rate: 1,
        deviceId: defaults.defaultDeviceId,
        fadeCurve: 'linear' as const
      }
    case 'video':
      return {
        ...base,
        type: 'video',
        filePath: '',
        fileName: '',
        mediaKind: 'video',
        mediaDuration: 0,
        displayId: '',
        deviceId: defaults.defaultDeviceId,
        startTime: 0,
        endTime: 0,
        duration: 0,
        volume: 1,
        fadeIn: 0.4,
        fadeOut: 0.4,
        loop: false,
        opacity: 1,
        fit: 'contain'
      }
    case 'group':
      return { ...base, type: 'group', members: [] }
    case 'wait':
      return { ...base, type: 'wait', duration: 2 }
    case 'memo':
      return { ...base, type: 'memo', duration: 0 }
    case 'stop':
      return { ...base, type: 'stop', targets: [], fadeOut: 0.3 }
    case 'fade':
      return { ...base, type: 'fade', targets: [], volume: 0, duration: 2 }
    case 'dmx':
      return {
        ...base,
        type: 'dmx',
        universe: 0,
        channels: [],
        fade: 0,
        startAddress: 1
      }
    default:
      return { ...base, type: 'memo', duration: 0 }
  }
}

export function createMediaCue(file: MediaFile, cues: Cue[], defaults: Defaults): Cue {
  if (file.kind === 'audio') {
    const cue = createCue('audio', cues, defaults)
    if (cue.type !== 'audio') return cue
    cue.name = file.name
    cue.filePath = file.path
    cue.fileName = file.name
    return cue
  }

  const cue = createCue('video', cues, defaults)
  if (cue.type !== 'video') return cue
  cue.name = file.name
  cue.filePath = file.path
  cue.fileName = file.name
  cue.mediaKind = file.kind === 'image' ? 'image' : 'video'
  return cue
}
