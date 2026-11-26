import { useEffect, useRef, useState } from 'react'
import type { VideoCue } from '@shared/types'
import { formatClock } from '../lib/format'
import { mediaUrl } from '../lib/media'

/** Equivalencia entre el ajuste del cue y el object-fit del navegador. */
function fitCss(fit: VideoCue['fit']): 'contain' | 'cover' | 'fill' | 'none' {
  if (fit === 'stretch') return 'fill'
  if (fit === 'none') return 'none'
  return fit === 'cover' ? 'cover' : 'contain'
}

/**
 * Vista previa del encuadre del cue seleccionado: aplica el mismo ajuste,
 * escala, desplazamiento y rotación que la ventana de salida, sin emitir nada.
 */
export default function CuePreview({
  cue,
  outputLabel
}: {
  cue: VideoCue
  outputLabel: string
}): JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const url = cue.filePath ? mediaUrl(cue.filePath) : ''
  const isImage = cue.mediaKind === 'image'

  useEffect(() => {
    setPlaying(false)
    setTime(0)
  }, [cue.filePath, cue.id])

  const transform = `translate(${cue.offsetX ?? 0}%, ${cue.offsetY ?? 0}%) scale(${
    cue.scale > 0 ? cue.scale : 1
  }) rotate(${cue.rotation ?? 0}deg)`

  const toggle = (): void => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play().catch(() => undefined)
    else video.pause()
  }

  return (
    <section className="insp-section">
      <h3>Previsualización</h3>
      <div className="cue-preview">
        <div className="preview-stage">
          {!url && <span className="preview-empty">Sin archivo asignado</span>}
          {url && isImage && (
            <img
              className="preview-media"
              src={url}
              alt=""
              style={{ objectFit: fitCss(cue.fit), transform }}
            />
          )}
          {url && !isImage && (
            <video
              ref={videoRef}
              className="preview-media"
              src={url}
              muted
              loop={cue.loop}
              playsInline
              preload="metadata"
              style={{ objectFit: fitCss(cue.fit), transform }}
              onLoadedMetadata={(event) => {
                const video = event.currentTarget
                video.currentTime = Math.max(0, cue.startTime ?? 0)
              }}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
            />
          )}
          <div className="preview-frame" aria-hidden>
            <span className="preview-frame-label">{outputLabel}</span>
          </div>
        </div>
        <div className="preview-bar">
          {url && !isImage && (
            <button
              type="button"
              className="btn tiny"
              onClick={toggle}
              title={playing ? 'Pausar la previsualización' : 'Reproducir en silencio'}
            >
              {playing ? '❚❚' : '▶'}
            </button>
          )}
          <span className="mono preview-time">
            {isImage
              ? `imagen · ${formatClock(cue.duration > 0 ? cue.duration : 5)}`
              : url
                ? `${formatClock(time)} / ${formatClock(cue.mediaDuration)}`
                : '—'}
          </span>
          <span className="mono preview-zoom">{Math.round((cue.scale || 1) * 100)}%</span>
        </div>
      </div>
      <div className="field-hint">
        Mismo encuadre que la salida, en silencio y sin emitir. Los ajustes de imagen se ven aquí al
        instante.
      </div>
    </section>
  )
}
