import { mediaUrl } from './media'

/**
 * Banco de audio: decodifica cada archivo una sola vez y lo reutiliza,
 * y mantiene un bus (contexto + ganancia maestra) por dispositivo de salida.
 */

let decodeContext: AudioContext | null = null
const buffers = new Map<string, AudioBuffer>()
const pending = new Map<string, Promise<AudioBuffer>>()

interface Bus {
  ctx: AudioContext
  master: GainNode
}

const buses = new Map<string, Bus>()
let masterLevel = 1

function decoder(): AudioContext {
  if (!decodeContext) decodeContext = new AudioContext({ latencyHint: 'playback' })
  return decodeContext
}

export function audioUrl(path: string): string {
  return mediaUrl(path)
}

export async function loadBuffer(path: string): Promise<AudioBuffer> {
  const cached = buffers.get(path)
  if (cached) return cached

  const inFlight = pending.get(path)
  if (inFlight) return inFlight

  const task = (async () => {
    const response = await fetch(audioUrl(path))
    if (!response.ok) throw new Error(`No se pudo abrir el archivo (${response.status})`)
    const data = await response.arrayBuffer()
    if (data.byteLength === 0) throw new Error('El archivo está vacío')
    const decoded = await decoder().decodeAudioData(data)
    buffers.set(path, decoded)
    return decoded
  })()

  pending.set(path, task)
  try {
    return await task
  } finally {
    pending.delete(path)
  }
}

export function isBufferReady(path: string): boolean {
  return buffers.has(path)
}

export function outputBus(deviceId: string): Bus {
  const key = deviceId || 'default'
  let bus = buses.get(key)
  if (!bus) {
    const ctx = new AudioContext({ latencyHint: 'interactive' })
    const master = ctx.createGain()
    master.gain.value = masterLevel
    master.connect(ctx.destination)
    bus = { ctx, master }
    buses.set(key, bus)

    if (deviceId) {
      const withSink = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> }
      if (typeof withSink.setSinkId === 'function') {
        withSink.setSinkId(deviceId).catch((err: unknown) => {
          console.warn('No se pudo usar el dispositivo de salida', deviceId, err)
        })
      }
    }
  }
  if (bus.ctx.state === 'suspended') void bus.ctx.resume()
  return bus
}

export function setMasterLevel(value: number): void {
  masterLevel = Math.min(1, Math.max(0, value))
  for (const bus of buses.values()) {
    bus.master.gain.setTargetAtTime(masterLevel, bus.ctx.currentTime, 0.02)
  }
}

export function getMasterLevel(): number {
  return masterLevel
}

/** Despierta los contextos con el primer gesto del operador. */
export async function unlockAudio(): Promise<void> {
  try {
    if (!decodeContext) decodeContext = new AudioContext({ latencyHint: 'playback' })
    if (decodeContext.state === 'suspended') await decodeContext.resume()
    for (const bus of buses.values()) {
      if (bus.ctx.state === 'suspended') await bus.ctx.resume()
    }
  } catch {
    /* sin audio disponible */
  }
}

const peaksCache = new Map<string, number[]>()

/** Picos normalizados para dibujar la forma de onda. */
export async function getPeaks(path: string, buckets = 640): Promise<number[]> {
  const cacheKey = `${path}::${buckets}`
  const cached = peaksCache.get(cacheKey)
  if (cached) return cached

  const buffer = await loadBuffer(path)
  const channels = Math.min(buffer.numberOfChannels, 2)
  const samples = buffer.length
  const step = Math.max(1, Math.floor(samples / buckets))
  const result: number[] = []

  const channelData: Float32Array[] = []
  for (let c = 0; c < channels; c += 1) channelData.push(buffer.getChannelData(c))

  for (let i = 0; i < buckets; i += 1) {
    const start = i * step
    const end = Math.min(samples, start + step)
    let peak = 0
    for (let s = start; s < end; s += 4) {
      for (const data of channelData) {
        const value = Math.abs(data[s] ?? 0)
        if (value > peak) peak = value
      }
    }
    result.push(peak)
  }

  const max = Math.max(0.001, ...result)
  const normalized = result.map((value) => value / max)
  peaksCache.set(cacheKey, normalized)
  return normalized
}

export async function listOutputDevices(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices.filter((device) => device.kind === 'audiooutput')
  } catch {
    return []
  }
}

/** Pide permiso de micrófono para que Chromium revele los nombres de dispositivos. */
export async function requestDeviceLabels(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((track) => track.stop())
    return true
  } catch {
    return false
  }
}

/** Dispositivos de entrada/salida por tipo (micrófonos, cámaras, altavoces). */
export async function listDevices(
  kind: 'audioinput' | 'audiooutput' | 'videoinput'
): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices.filter((device) => device.kind === kind)
  } catch {
    return []
  }
}
