import { useEffect, useRef, useState } from 'react'
import type { OutputPayload } from '@shared/types'
import { api } from '../lib/bridge'
import { clamp } from '../lib/format'

interface Layer {
  /** cueId, usado por pause/resume/clear. */
  id: string
  /** Identifica esta ejecución concreta del cue (permite re-disparar el mismo cue). */
  token: number
  payload: OutputPayload
  visible: boolean
  fade: number
}

export default function OutputView(): JSX.Element {
  const [layers, setLayers] = useState<Layer[]>([])
  const sequence = useRef(0)
  const fadeTimers = useRef(new Map<string, number>())
  const activeTokens = useRef(new Map<string, number>())
  const videoRefs = useRef(new Map<string, HTMLVideoElement>())

  useEffect(() => {
    return api.onOutput((event) => {
      if (event.type === 'show') {
        const payload = event.payload
        const token = ++sequence.current
        activeTokens.current.set(payload.cueId, token)

        const pending = fadeTimers.current.get(payload.cueId)
        if (pending !== undefined) {
          window.clearTimeout(pending)
          fadeTimers.current.delete(payload.cueId)
        }

        // La capa nueva va arriba; si el mismo cue ya estaba, se reemplaza.
        setLayers((prev) => [
          ...prev.filter((layer) => layer.id !== payload.cueId),
          {
            id: payload.cueId,
            token,
            payload,
            visible: false,
            fade: Math.max(0.05, payload.fadeIn)
          }
        ])

        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            setLayers((prev) =>
              prev.map((layer) =>
                layer.id === payload.cueId && layer.token === token
                  ? { ...layer, visible: true }
                  : layer
              )
            )
          })
        })
        return
      }

      if (event.type === 'pause' || event.type === 'resume') {
        const video = videoRefs.current.get(event.cueId)
        if (!video) return
        if (event.type === 'pause') video.pause()
        else void video.play().catch(() => undefined)
        return
      }

      // clear: sólo retira esa capa; las demás siguen en pantalla.
      const token = activeTokens.current.get(event.cueId)
      const fade = Math.max(0.05, event.fadeOut)
      setLayers((prev) =>
        prev.map((layer) =>
          layer.id === event.cueId ? { ...layer, visible: false, fade } : layer
        )
      )

      const previous = fadeTimers.current.get(event.cueId)
      if (previous !== undefined) window.clearTimeout(previous)
      const timer = window.setTimeout(() => {
        fadeTimers.current.delete(event.cueId)
        setLayers((prev) =>
          prev.filter((layer) => !(layer.id === event.cueId && layer.token === token))
        )
      }, fade * 1000 + 150)
      fadeTimers.current.set(event.cueId, timer)
    })
  }, [])

  useEffect(() => {
    const timers = fadeTimers.current
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer)
      timers.clear()
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') void api.outputFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="output" onDoubleClick={() => void api.toggleOutputFullscreen()}>
      <div className="output-stage">
        {layers.map((layer) => (
          <div
            key={layer.token}
            className="output-layer"
            style={{
              opacity: layer.visible ? clamp(layer.payload.opacity, 0, 1) : 0,
              transition: `opacity ${layer.fade}s ease`
            }}
          >
            {layer.payload.kind === 'video' ? (
              <video
                ref={(element) => {
                  if (element) videoRefs.current.set(layer.id, element)
                  else videoRefs.current.delete(layer.id)
                }}
                className="output-media"
                src={layer.payload.url}
                autoPlay
                playsInline
                style={{ objectFit: layer.payload.fit }}
                onLoadedMetadata={(event) => applySegment(event.currentTarget, layer.payload)}
                onTimeUpdate={(event) => {
                  const video = event.currentTarget
                  const { startTime, endTime, loop } = layer.payload
                  if (endTime > startTime && video.currentTime >= endTime - 0.02) {
                    if (loop) video.currentTime = startTime
                    else video.pause()
                  }
                }}
                onEnded={(event) => {
                  if (layer.payload.loop) {
                    event.currentTarget.currentTime = layer.payload.startTime
                    void event.currentTarget.play().catch(() => undefined)
                  }
                }}
              />
            ) : (
              <img
                className="output-media"
                src={layer.payload.url}
                alt=""
                style={{ objectFit: layer.payload.fit }}
              />
            )}
          </div>
        ))}
      </div>

      {layers.length === 0 && (
        <div className="output-idle">
          <div className="output-logo">
            <svg viewBox="0 0 24 24" width="46" height="46" aria-hidden>
              <path
                d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
                opacity="0.4"
              />
              <path d="M10 8.2v7.6l6-3.8z" fill="currentColor" opacity="0.5" />
            </svg>
          </div>
          <div className="output-label">Salida ShowCue</div>
          <div className="output-hint">Doble clic para pantalla completa</div>
        </div>
      )}
    </div>
  )
}

/** Coloca el video en su punto de entrada, ajusta volumen y salida de audio. */
function applySegment(video: HTMLVideoElement, payload: OutputPayload): void {
  video.volume = clamp(payload.volume, 0, 1)
  const sink = video as HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> }
  if (typeof sink.setSinkId === 'function') {
    sink.setSinkId(payload.deviceId || '').catch(() => undefined)
  }
  const start = Math.max(0, payload.startTime || 0)
  if (start > 0 && Math.abs(video.currentTime - start) > 0.15) video.currentTime = start
}
