import { useEffect, useRef, useState } from 'react'
import { getPeaks } from '../lib/audio'

interface Props {
  path: string
  /** Recorte activo en segundos. */
  start: number
  end: number
  duration: number
}

export default function Waveform({ path, start, end, duration }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [peaks, setPeaks] = useState<number[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setPeaks(null)
    setFailed(false)
    if (!path) return
    void getPeaks(path, 380)
      .then((data) => {
        if (alive) setPeaks(data)
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [path])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    canvas.width = Math.max(1, Math.floor(width * dpr))
    canvas.height = Math.max(1, Math.floor(height * dpr))
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, width, height)

    if (!peaks || peaks.length === 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.10)'
      ctx.beginPath()
      ctx.moveTo(0, height / 2)
      ctx.lineTo(width, height / 2)
      ctx.stroke()
      return
    }

    const total = Math.max(0.01, duration || 1)
    const startRatio = duration > 0 ? Math.max(0, Math.min(1, start / total)) : 0
    const endRatio = duration > 0 && end > start ? Math.max(0, Math.min(1, end / total)) : 1

    const barWidth = width / peaks.length
    for (let i = 0; i < peaks.length; i += 1) {
      const ratio = i / peaks.length
      const inside = ratio >= startRatio && ratio <= endRatio
      const value = Math.max(0.02, peaks[i])
      const barHeight = value * (height - 6)
      ctx.fillStyle = inside ? 'rgba(94, 210, 255, 0.72)' : 'rgba(148, 170, 195, 0.16)'
      ctx.fillRect(i * barWidth, (height - barHeight) / 2, Math.max(1, barWidth * 0.7), barHeight)
    }
  }, [peaks, start, end, duration])

  return (
    <div className="waveform">
      {failed && <div className="waveform-message">Sin forma de onda</div>}
      <canvas ref={canvasRef} />
    </div>
  )
}
