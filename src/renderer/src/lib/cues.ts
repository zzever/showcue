import type { AppSettings, AudioCue, AudioEq, Cue, CueType, FitMode, MediaFile, ShowFile } from '@shared/types'
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
  random: 'Aleatorio',
  wait: 'Espera',
  stop: 'Stop',
  fade: 'Fade',
  memo: 'Nota',
  dmx: 'DMX',
  timeline: 'Línea de tiempo'
}

export const cueTypeLabel = (type: CueType): string => TYPE_LABEL[type]

const DEFAULT_EQ: AudioEq = { low: 0, mid: 0, high: 0, highPass: 0 }

/** Geometría neutra de proyección. */
export const NEUTRAL_FRAME = {
  fit: 'contain' as FitMode,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  rotation: 0
}

const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

/** Rellena campos nuevos en cues cargados de archivos antiguos. */
export function normalizeCue(cue: Cue): Cue {
  const base = cue as Cue & Record<string, unknown>
  const armed = typeof base.armed === 'boolean' ? base.armed : true
  const hotkey = typeof base.hotkey === 'string' ? base.hotkey : ''
  const midiNote = typeof base.midiNote === 'number' ? base.midiNote : -1
  const midiChannel = typeof base.midiChannel === 'number' ? base.midiChannel : 0
  const tags = Array.isArray(base.tags)
    ? (base.tags as unknown[]).filter((tag): tag is string => typeof tag === 'string')
    : []
  const list = typeof base.list === 'string' ? base.list : ''
  const common = { armed, hotkey, midiNote, midiChannel, tags, list }
  if (cue.type === 'audio') {
    const rawEq = (base.eq ?? {}) as Partial<AudioEq>
    const eq: AudioEq = {
      low: num(rawEq.low, DEFAULT_EQ.low),
      mid: num(rawEq.mid, DEFAULT_EQ.mid),
      high: num(rawEq.high, DEFAULT_EQ.high),
      highPass: num(rawEq.highPass, DEFAULT_EQ.highPass)
    }
    return {
      ...cue,
      ...common,
      sourceKind: base.sourceKind === 'microphone' ? 'microphone' : 'file',
      inputDeviceId: typeof base.inputDeviceId === 'string' ? base.inputDeviceId : '',
      groupId: typeof base.groupId === 'string' ? base.groupId : '',
      fadeCurve: (base.fadeCurve as AudioCue['fadeCurve']) ?? 'linear',
      eq
    }
  }
  if (cue.type === 'video') {
    return {
      ...cue,
      ...common,
      startTime: typeof base.startTime === 'number' ? base.startTime : 0,
      endTime: typeof base.endTime === 'number' ? base.endTime : 0,
      displayId: typeof base.displayId === 'string' ? base.displayId : '',
      deviceId: typeof base.deviceId === 'string' ? base.deviceId : '',
      sourceKind: base.sourceKind === 'camera' ? 'camera' : 'file',
      cameraDeviceId: typeof base.cameraDeviceId === 'string' ? base.cameraDeviceId : '',
      fit: (['contain', 'cover', 'stretch', 'none'].includes(String(base.fit))
        ? base.fit
        : NEUTRAL_FRAME.fit) as FitMode,
      scale: num(base.scale, NEUTRAL_FRAME.scale),
      offsetX: num(base.offsetX, NEUTRAL_FRAME.offsetX),
      offsetY: num(base.offsetY, NEUTRAL_FRAME.offsetY),
      rotation: num(base.rotation, NEUTRAL_FRAME.rotation),
      testPattern: base.testPattern === true
    }
  }
  if (cue.type === 'random') {
    return {
      ...cue,
      ...common,
      members: Array.isArray(base.members)
        ? (base.members as unknown[]).filter((id): id is string => typeof id === 'string')
        : [],
      count: Math.max(1, Math.round(num(base.count, 1))),
      avoidRepeat: base.avoidRepeat !== false
    }
  }
  if (cue.type === 'timeline') {
    return {
      ...cue,
      ...common,
      duration: num(base.duration, 0),
      entries: Array.isArray(base.entries)
        ? (base.entries as Array<Record<string, unknown>>)
            .filter((entry) => typeof entry?.cueId === 'string' && Number.isFinite(Number(entry?.at)))
            .map((entry) => ({ at: Math.max(0, Number(entry.at)), cueId: String(entry.cueId) }))
        : []
    }
  }
  if (cue.type === 'dmx') {
    return {
      ...cue,
      ...common,
      patchId: typeof base.patchId === 'string' ? base.patchId : '',
      channels: Array.isArray(base.channels) ? cue.channels : []
    }
  }
  return { ...cue, ...common }
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

export function createCue(
  type: CueType,
  cues: Cue[],
  defaults: Defaults,
  list = ''
): Cue {
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
    midiChannel: 0,
    tags: [],
    list
  }

  switch (type) {
    case 'audio':
      return {
        ...base,
        type: 'audio',
        sourceKind: 'file' as const,
        inputDeviceId: '',
        groupId: '',
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
        fadeCurve: 'linear' as const,
        eq: { ...DEFAULT_EQ }
      }
    case 'video':
      return {
        ...base,
        type: 'video',
        sourceKind: 'file' as const,
        cameraDeviceId: '',
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
        ...NEUTRAL_FRAME,
        testPattern: false
      }
    case 'group':
      return { ...base, type: 'group', members: [] }
    case 'random':
      return { ...base, type: 'random', members: [], count: 1, avoidRepeat: true }
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
        patchId: '',
        startAddress: 1
      }
    case 'timeline':
      return { ...base, type: 'timeline', entries: [], duration: 0 }
    default:
      return { ...base, type: 'memo', duration: 0 }
  }
}

export function createMediaCue(
  file: MediaFile,
  cues: Cue[],
  defaults: Defaults,
  list = ''
): Cue {
  if (file.kind === 'audio') {
    const cue = createCue('audio', cues, defaults, list)
    if (cue.type !== 'audio') return cue
    cue.name = file.name
    cue.filePath = file.path
    cue.fileName = file.name
    return cue
  }

  const cue = createCue('video', cues, defaults, list)
  if (cue.type !== 'video') return cue
  cue.name = file.name
  cue.filePath = file.path
  cue.fileName = file.name
  cue.mediaKind = file.kind === 'image' ? 'image' : 'video'
  return cue
}
