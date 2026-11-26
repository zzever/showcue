import type { Cue } from '@shared/types'

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

export const toNumber = (value: string, fallback = 0): number => {
  const parsed = Number.parseFloat(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : fallback
}

/** 83.4 -> "1:23.4" · 3725 -> "1:02:05" · Infinity -> "∞" */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds)) return '∞'
  if (seconds < 0) seconds = 0
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const tenths = Math.floor((seconds - total) * 10)

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }
  if (seconds < 10) return `${secs}.${tenths}s`
  if (seconds < 60) return `${Math.floor(seconds)}.${tenths}s`
  return `${minutes}:${String(secs).padStart(2, '0')}`
}

/** 1.25 -> "1.25" (para inputs numéricos) */
export function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds)) return ''
  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(2).replace(/0$/, '')
}

export function formatGainDb(gain: number): string {
  if (gain <= 0.0001) return '−∞ dB'
  const db = 20 * Math.log10(gain)
  return `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`
}

export function formatPercent(gain: number): string {
  return `${Math.round(gain * 100)}%`
}

export function cueLabel(cue: Cue | undefined): string {
  if (!cue) return '—'
  return cue.number ? `${cue.number} · ${cue.name}` : cue.name
}

/** Duración efectiva del cue en segundos (Infinity para bucles infinitos). */
export function cueDuration(cue: Cue, byId: Map<string, Cue>, depth = 0): number {
  if (depth > 4) return 0
  switch (cue.type) {
    case 'audio': {
      const start = Math.max(0, cue.startTime)
      const end = cue.endTime > start + 0.01 ? cue.endTime : cue.mediaDuration
      const one = Math.max(0, (end - start) / (cue.rate > 0 ? cue.rate : 1))
      if (cue.loop) {
        if (cue.loopCount <= 0) return Number.POSITIVE_INFINITY
        return one * cue.loopCount
      }
      return one
    }
    case 'video': {
      if (cue.duration > 0) return cue.duration
      if (cue.mediaKind === 'image') return 5
      const start = Math.max(0, cue.startTime ?? 0)
      const end = cue.endTime > start ? cue.endTime : cue.mediaDuration
      return Math.max(0, end - start)
    }
    case 'wait':
    case 'memo':
      return cue.duration
    case 'stop':
      return cue.fadeOut
    case 'fade':
      return cue.duration
    case 'dmx':
      return cue.fade
    case 'group': {
      let max = 0
      for (const member of cue.members) {
        const child = byId.get(member.cueId)
        if (!child) continue
        const childDuration = cueDuration(child, byId, depth + 1)
        const total = member.delay + childDuration
        if (!Number.isFinite(total)) return Number.POSITIVE_INFINITY
        max = Math.max(max, total)
      }
      return max
    }
    default:
      return 0
  }
}

export function targetNames(cue: Cue, byId: Map<string, Cue>): string {
  if (cue.type !== 'stop' && cue.type !== 'fade') return ''
  return cue.targets
    .map((id) => byId.get(id)?.number ?? '?')
    .filter(Boolean)
    .join(', ')
}

export function cueByIdMap(cues: Cue[]): Map<string, Cue> {
  return new Map(cues.map((cue) => [cue.id, cue]))
}

export function nextCueNumber(cues: Cue[]): string {
  let max = 0
  for (const cue of cues) {
    const parsed = Number.parseFloat(cue.number)
    if (Number.isFinite(parsed) && parsed > max) max = parsed
  }
  return String(Math.floor(max) + 1)
}
