import type { Cue } from '@shared/types'
import { player } from './player'

let hotkeyMap = new Map<string, string>() // combo -> cueId
let midiMap = new Map<string, string>() // "channel:note" -> cueId (channel 0 = any)
let cueLookup: (id: string) => Cue | undefined = () => undefined
let allCues: () => Cue[] = () => []
let midiAccess: MIDIAccess | null = null
let midiEnabled = false

const RESERVED_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  ' ',
  'Escape',
  'Esc',
  'Enter',
  'Tab',
  'Delete',
  'Backspace',
  'Home',
  'End',
  'PageUp',
  'PageDown'
])

/** Teclas de navegación/transporte que no deben usarse como atajo de un cue. */
export function isReservedCombo(combo: string): boolean {
  if (!combo) return true
  return !combo.includes('+') && RESERVED_KEYS.has(combo)
}

export function comboFromEvent(event: KeyboardEvent): string {
  const parts: string[] = []
  if (event.ctrlKey) parts.push('Ctrl')
  if (event.shiftKey) parts.push('Shift')
  if (event.altKey) parts.push('Alt')
  if (event.metaKey) parts.push('Meta')
  const key = event.key
  if (!['Control', 'Shift', 'Alt', 'Meta'].includes(key)) parts.push(key)
  return parts.join('+')
}

export function rebuildTriggerMaps(cues: Cue[]): void {
  hotkeyMap = new Map()
  midiMap = new Map()
  for (const cue of cues) {
    if (cue.hotkey) hotkeyMap.set(cue.hotkey, cue.id)
    if (cue.midiNote >= 0 && cue.midiNote <= 127) {
      const ch = cue.midiChannel > 0 ? cue.midiChannel : 0
      midiMap.set(`${ch}:${cue.midiNote}`, cue.id)
    }
  }
}

export function configureTriggers(options: { getCue: (id: string) => Cue | undefined; allCues: () => Cue[] }): void {
  cueLookup = options.getCue
  allCues = options.allCues
}

export function handleHotkey(event: KeyboardEvent): boolean {
  // Ignorar si el foco está en un campo de texto.
  const target = event.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
    return false
  }
  const combo = comboFromEvent(event)
  if (isReservedCombo(combo)) return false
  const cueId = hotkeyMap.get(combo)
  if (!cueId) return false
  const cue = cueLookup(cueId)
  if (!cue || cue.armed === false) return false
  event.preventDefault()
  player.go(cue)
  return true
}

export async function enableMidi(): Promise<boolean> {
  if (!navigator.requestMIDIAccess) return false
  try {
    midiAccess = await navigator.requestMIDIAccess({ sysex: false })
    midiEnabled = true
    attachMidi()
    midiAccess.onstatechange = () => attachMidi()
    return true
  } catch {
    midiEnabled = false
    return false
  }
}

export function disableMidi(): void {
  midiEnabled = false
  if (midiAccess) {
    for (const input of midiAccess.inputs.values()) input.onmidimessage = null
  }
}

export function isMidiEnabled(): boolean {
  return midiEnabled
}

function attachMidi(): void {
  if (!midiAccess) return
  for (const input of midiAccess.inputs.values()) {
    input.onmidimessage = (msg: MIDIMessageEvent) => {
      if (!midiEnabled) return
      const data = msg.data
      if (!data || data.length < 3) return
      const status = data[0] & 0xf0
      if (status !== 0x90) return
      const velocity = data[2]
      if (velocity === 0) return
      const note = data[1]
      const channel = (data[0] & 0x0f) + 1
      // Buscar primero canal exacto, luego "cualquier canal".
      let cueId = midiMap.get(`${channel}:${note}`)
      if (!cueId) cueId = midiMap.get(`0:${note}`)
      if (!cueId) return
      const cue = cueLookup(cueId)
      if (!cue || cue.armed === false) return
      player.go(cue)
    }
  }
}