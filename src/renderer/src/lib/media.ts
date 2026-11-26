export type MediaKind = 'audio' | 'video' | 'image'

const AUDIO_EXT = new Set(['mp3', 'wav', 'aiff', 'aif', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus'])
const VIDEO_EXT = new Set(['mp4', 'm4v', 'mov', 'mkv', 'webm'])
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'])

export function extensionOf(path: string): string {
  const clean = path.split(/[?#]/)[0]
  const dot = clean.lastIndexOf('.')
  const slash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'))
  if (dot <= slash) return ''
  return clean.slice(dot + 1).toLowerCase()
}

export function kindForPath(path: string): MediaKind | null {
  const ext = extensionOf(path)
  if (AUDIO_EXT.has(ext)) return 'audio'
  if (VIDEO_EXT.has(ext)) return 'video'
  if (IMAGE_EXT.has(ext)) return 'image'
  return null
}

export function baseName(path: string): string {
  const clean = path.split(/[?#]/)[0]
  const slash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'))
  const file = slash >= 0 ? clean.slice(slash + 1) : clean
  const dot = file.lastIndexOf('.')
  return dot > 0 ? file.slice(0, dot) : file
}

/** URL reproducible: cuefile:// en escritorio, blob:/http: en navegador. */
export function mediaUrl(path: string): string {
  if (!path) return ''
  if (path.startsWith('blob:') || path.startsWith('http:') || path.startsWith('https:') || path.startsWith('cuefile:')) {
    return path
  }
  return `cuefile://local/?p=${encodeURIComponent(path)}`
}

export function probeDuration(url: string, kind: 'audio' | 'video'): Promise<number> {
  return new Promise((resolve) => {
    if (!url) {
      resolve(0)
      return
    }
    const element = kind === 'video' ? document.createElement('video') : document.createElement('audio')
    let settled = false
    const finish = (value: number): void => {
      if (settled) return
      settled = true
      element.onloadedmetadata = null
      element.onerror = null
      element.removeAttribute('src')
      resolve(Number.isFinite(value) ? value : 0)
    }
    element.preload = 'metadata'
    element.onloadedmetadata = () => finish(element.duration)
    element.onerror = () => finish(0)
    window.setTimeout(() => finish(element.duration), 8000)
    element.src = url
  })
}
