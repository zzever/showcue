import type { AudioCue, Cue, DmxCue, GroupCue, SpeakerGroup, StopCue, VideoCue } from '@shared/types'
import { api } from './bridge'
import { loadBuffer, outputBus } from './audio'
import { clamp, cueByIdMap, cueDuration } from './format'
import { mediaUrl } from './media'

function rampGain(
  param: AudioParam,
  from: number,
  to: number,
  start: number,
  end: number,
  curve: 'linear' | 'exponential' | 's' | 'log'
): void {
  const safeFrom = Math.max(from, 0.0001)
  const safeTo = Math.max(to, 0.0001)
  try {
    param.cancelScheduledValues(start)
    param.setValueAtTime(safeFrom, start)
    if (curve === 'exponential' || curve === 'log') {
      param.exponentialRampToValueAtTime(safeTo, end)
    } else if (curve === 's') {
      const steps = 48
      const values = new Float32Array(steps)
      for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1)
        const s = t * t * (3 - 2 * t)
        values[i] = safeFrom + (safeTo - safeFrom) * s
      }
      param.setValueCurveAtTime(values, start, Math.max(0.01, end - start))
    } else {
      param.linearRampToValueAtTime(safeTo, end)
    }
  } catch {
    /* nodo liberado */
  }
}

export interface RunView {
  pending: boolean
  progress: number
  remaining: number
  duration: number
  paused: boolean
}

interface Run {
  cue: Cue
  duration: number
  startPerf: number
  timers: number[]
  cancelled: boolean
  paused: boolean
  pauseStartPerf: number
  accumulatedPauseMs: number
  customPause: boolean
  resumeOffset: number
  pauseImpl?: () => void
  resumeImpl?: (offset: number) => void
  pauseHook?: () => void
  resumeHook?: (remaining: number) => void
  cancel: (fade: number) => void
  fadeTo: (gain: number, duration: number) => void
}

interface PendingRun {
  timer: number
  startPerf: number
  duration: number
}

/**
 * Motor de reproducción. Vive fuera de React: los componentes sólo se
 * suscriben a las lecturas de progreso y disparan acciones.
 */
export class Player {
  private runs = new Map<string, Run>()
  private pendings = new Map<string, PendingRun>()
  private loading = new Map<string, { aborted: boolean }>()
  private tails = new Set<number>()
  /** Último valor enviado a cada universo DMX, para poder hacer fades. */
  private dmxState = new Map<number, Uint8Array>()
  /** Historial por cue aleatorio, para no repetir hasta agotar el grupo. */
  private randomHistory = new Map<string, string[]>()
  /** Grupos de altavoces del proyecto (destino y nivel por pista). */
  private speakerGroups: SpeakerGroup[] = []
  private listeners = new Set<(runs: Record<string, RunView>) => void>()
  private interval: number | null = null

  private getCue: (id: string) => Cue | undefined = () => undefined
  private allCues: () => Cue[] = () => []

  onAutoContinue: (cueId: string) => void = () => undefined
  onError: (message: string) => void = () => undefined
  onCueGo: (cue: Cue) => void = () => undefined
  onPanic: () => void = () => undefined

  configure(options: {
    getCue: (id: string) => Cue | undefined
    allCues: () => Cue[]
    onAutoContinue: (cueId: string) => void
    onError: (message: string) => void
    onCueGo?: (cue: Cue) => void
    onPanic?: () => void
  }): void {
    this.getCue = options.getCue
    this.allCues = options.allCues
    this.onAutoContinue = options.onAutoContinue
    this.onError = options.onError
    this.onCueGo = options.onCueGo ?? (() => undefined)
    this.onPanic = options.onPanic ?? (() => undefined)
  }

  setSpeakerGroups(groups: SpeakerGroup[]): void {
    this.speakerGroups = Array.isArray(groups) ? groups : []
  }

  /** ¿Hay una línea de tiempo en curso? Sirve para resolver la prioridad GO/timeline. */
  timelineRunning(): boolean {
    for (const run of this.runs.values()) if (run.cue.type === 'timeline') return true
    return false
  }

  subscribe(listener: (runs: Record<string, RunView>) => void): () => void {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => {
      this.listeners.delete(listener)
    }
  }

  isActive(cueId: string): boolean {
    return this.runs.has(cueId) || this.pendings.has(cueId) || this.loading.has(cueId)
  }

  isPlaying(cueId: string): boolean {
    return this.runs.has(cueId)
  }

  private snapshot(): Record<string, RunView> {
    const out: Record<string, RunView> = {}
    const now = performance.now()

    for (const [id, run] of this.runs) {
      const baseElapsed = run.paused
        ? (run.pauseStartPerf - run.startPerf) / 1000
        : (now - run.startPerf) / 1000
      const elapsed = Math.max(0, baseElapsed - run.accumulatedPauseMs / 1000)
      const finite = Number.isFinite(run.duration) && run.duration > 0
      out[id] = {
        pending: false,
        progress: finite ? clamp(elapsed / run.duration, 0, 1) : 0,
        remaining: Number.isFinite(run.duration) ? Math.max(0, run.duration - elapsed) : Number.POSITIVE_INFINITY,
        duration: run.duration,
        paused: run.paused
      }
    }

    for (const [id, pending] of this.pendings) {
      const elapsed = Math.max(0, (now - pending.startPerf) / 1000)
      out[id] = {
        pending: true,
        progress: pending.duration > 0 ? clamp(elapsed / pending.duration, 0, 1) : 1,
        remaining: Math.max(0, pending.duration - elapsed),
        duration: pending.duration,
        paused: false
      }
    }

    return out
  }

  private notify(): void {
    if (this.listeners.size === 0) return
    const snapshot = this.snapshot()
    for (const listener of this.listeners) listener(snapshot)
  }

  private ensureLoop(): void {
    if (this.interval !== null) return
    this.interval = window.setInterval(() => {
      this.notify()
      if (this.runs.size === 0 && this.pendings.size === 0) this.stopLoop()
    }, 80)
  }

  private stopLoop(): void {
    if (this.interval === null) return
    window.clearInterval(this.interval)
    this.interval = null
  }

  private finishRun(cueId: string): void {
    const run = this.runs.get(cueId)
    if (!run) return
    this.runs.delete(cueId)
    for (const timer of run.timers) window.clearTimeout(timer)
    this.notify()

    if (!run.cancelled && run.cue.autoContinue) {
      const delay = Math.max(0, run.cue.postWait) * 1000
      const timer = window.setTimeout(() => {
        this.tails.delete(timer)
        this.onAutoContinue(run.cue.id)
      }, delay)
      this.tails.add(timer)
    }
  }

  private trackRun(run: Run, timer?: number): void {
    if (timer !== undefined) run.timers.push(timer)
    this.runs.set(run.cue.id, run)
    this.ensureLoop()
    this.notify()
  }

  // ---------------------------------------------------------------- transporte

  go(cue: Cue): void {
    if (cue.armed === false) {
      this.onError(`El cue "${cue.name}" está desarmado`)
      return
    }
    if (this.isActive(cue.id)) return

    // Aviso OSC en el GO, también si el cue tiene pre-espera.
    this.onCueGo(cue)

    if (cue.preWait > 0.001) {
      const duration = cue.preWait
      const timer = window.setTimeout(() => {
        this.pendings.delete(cue.id)
        this.startNow(cue)
      }, duration * 1000)
      this.pendings.set(cue.id, { timer, startPerf: performance.now(), duration })
      this.ensureLoop()
      this.notify()
      return
    }

    this.startNow(cue)
  }

  private startNow(cue: Cue): void {
    switch (cue.type) {
      case 'audio':
        void this.startAudio(cue)
        break
      case 'video':
        this.startVideo(cue)
        break
      case 'group':
        this.startGroup(cue)
        break
      case 'random':
        this.startRandom(cue)
        break
      case 'timeline':
        this.startTimeline(cue)
        break
      case 'wait':
      case 'memo':
        this.startTimed(cue, Math.max(0.05, cue.duration))
        break
      case 'stop':
        this.startStop(cue)
        break
      case 'fade':
        this.startFade(cue)
        break
      case 'dmx':
        this.startDmx(cue)
        break
    }
  }

  stopCue(cueId: string, fade = 0.1): void {
    const pending = this.pendings.get(cueId)
    if (pending) {
      window.clearTimeout(pending.timer)
      this.pendings.delete(cueId)
      this.notify()
    }
    const load = this.loading.get(cueId)
    if (load) {
      load.aborted = true
      this.loading.delete(cueId)
    }
    const run = this.runs.get(cueId)
    if (run) run.cancel(fade)
  }

  stopAll(fade = 0.12): void {
    for (const pending of this.pendings.values()) window.clearTimeout(pending.timer)
    this.pendings.clear()

    for (const load of this.loading.values()) load.aborted = true
    this.loading.clear()

    for (const timer of this.tails) window.clearTimeout(timer)
    this.tails.clear()

    const runs = [...this.runs.values()]
    this.runs.clear()
    for (const run of runs) {
      run.cancelled = true
      try {
        run.cancel(fade)
      } catch {
        /* el nodo ya estaba detenido */
      }
    }
    this.notify()
    this.stopLoop()
    this.onPanic()
  }

  fadeCue(cueId: string, gain: number, duration: number): void {
    this.runs.get(cueId)?.fadeTo(gain, duration)
  }

  pauseCue(cueId: string): void {
    const run = this.runs.get(cueId)
    if (!run || run.paused || run.cancelled) return
    if (run.customPause && run.pauseImpl) {
      run.paused = true
      run.pauseStartPerf = performance.now()
      for (const timer of run.timers) window.clearTimeout(timer)
      run.timers = []
      try {
        run.pauseImpl()
      } catch {
        /* ignore */
      }
      this.notify()
      return
    }
    run.paused = true
    run.pauseStartPerf = performance.now()
    for (const timer of run.timers) window.clearTimeout(timer)
    run.timers = []
    try {
      run.pauseHook?.()
    } catch {
      /* ignore */
    }
    this.notify()
  }

  resumeCue(cueId: string): void {
    const run = this.runs.get(cueId)
    if (!run || !run.paused || run.cancelled) return
    if (run.customPause && run.resumeImpl) {
      const offset = run.resumeOffset
      run.resumeImpl(offset)
      return
    }
    const now = performance.now()
    run.accumulatedPauseMs += now - run.pauseStartPerf
    run.startPerf += now - run.pauseStartPerf
    run.paused = false
    const elapsed = Math.max(0, (now - run.startPerf) / 1000)
    const remaining = Math.max(0.01, run.duration - elapsed)
    try {
      run.resumeHook?.(remaining)
    } catch {
      /* ignore */
    }
    if (run.timers.length === 0 && Number.isFinite(run.duration)) {
      const timer = window.setTimeout(() => this.finishRun(cueId), remaining * 1000)
      run.timers.push(timer)
    }
    this.ensureLoop()
    this.notify()
  }

  togglePause(cueId: string): void {
    const run = this.runs.get(cueId)
    if (!run) return
    if (run.paused) this.resumeCue(cueId)
    else this.pauseCue(cueId)
  }

  pauseAll(): void {
    for (const id of [...this.runs.keys()]) this.pauseCue(id)
  }

  resumeAll(): void {
    for (const id of [...this.runs.keys()]) this.resumeCue(id)
  }

  isPaused(cueId: string): boolean {
    return this.runs.get(cueId)?.paused ?? false
  }

  // ------------------------------------------------------------------ motores

  private startTimed(
    cue: Cue,
    duration: number,
    hooks?: { begin?: () => void; cancel?: (fade: number) => void }
  ): void {
    hooks?.begin?.()
    const run: Run = {
      cue,
      duration,
      startPerf: performance.now(),
      timers: [],
      cancelled: false,
      paused: false,
      pauseStartPerf: 0,
      accumulatedPauseMs: 0,
      customPause: false,
      resumeOffset: 0,
      cancel: (fade) => {
        run.cancelled = true
        hooks?.cancel?.(fade)
        this.runs.delete(cue.id)
        this.notify()
      },
      fadeTo: () => undefined,
      pauseHook: () => {
        for (const t of run.timers) window.clearTimeout(t)
        run.timers = []
      },
      resumeHook: (remaining: number) => {
        const t = window.setTimeout(() => this.finishRun(cue.id), Math.max(0.02, remaining) * 1000)
        run.timers.push(t)
      }
    }
    const timer = window.setTimeout(() => this.finishRun(cue.id), Math.max(0.02, duration) * 1000)
    this.trackRun(run, timer)
  }

  /** Destino y nivel según el grupo de altavoces del cue. */
  private routeFor(cue: AudioCue): { deviceId: string; level: number } {
    if (!cue.groupId) return { deviceId: cue.deviceId, level: 1 }
    const group = this.speakerGroups.find((item) => item.id === cue.groupId)
    if (!group) return { deviceId: cue.deviceId, level: 1 }
    return { deviceId: group.deviceId, level: clamp(group.level, 0, 1) }
  }

  /** Entrada de micrófono en directo, enrutada como una pista más. */
  private async startMicrophone(cue: AudioCue): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.onError('Este equipo no permite capturar el micrófono')
      return
    }
    const route = this.routeFor(cue)
    const { ctx, master } = outputBus(route.deviceId)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: cue.inputDeviceId ? { deviceId: { exact: cue.inputDeviceId } } : true
      })
    } catch (err) {
      this.onError(`No se pudo abrir el micrófono (${(err as Error).message})`)
      return
    }

    const source = ctx.createMediaStreamSource(stream)
    const gain = ctx.createGain()
    gain.gain.value = clamp(cue.volume, 0, 1) * route.level
    const panner = ctx.createStereoPanner()
    panner.pan.value = clamp(cue.pan, -1, 1)
    source.connect(gain)
    gain.connect(panner)
    panner.connect(master)

    const tracks = stream.getAudioTracks()
    const run: Run = {
      cue,
      duration: Number.POSITIVE_INFINITY,
      startPerf: performance.now(),
      timers: [],
      cancelled: false,
      paused: false,
      pauseStartPerf: 0,
      accumulatedPauseMs: 0,
      customPause: false,
      resumeOffset: 0,
      cancel: () => {
        run.cancelled = true
        for (const track of tracks) track.stop()
        try {
          source.disconnect()
          gain.disconnect()
          panner.disconnect()
        } catch {
          /* ya desconectado */
        }
        this.runs.delete(cue.id)
        this.notify()
      },
      fadeTo: (target, duration) => {
        const now = ctx.currentTime
        gain.gain.cancelScheduledValues(now)
        gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now)
        gain.gain.linearRampToValueAtTime(
          Math.max(clamp(target, 0, 1) * route.level, 0.0001),
          now + Math.max(0.01, duration)
        )
      },
      pauseHook: () => {
        for (const track of tracks) track.enabled = false
      },
      resumeHook: () => {
        for (const track of tracks) track.enabled = true
      }
    }

    this.trackRun(run)
  }

  private async startAudio(cue: AudioCue, offsetInBuffer = 0, isResume = false): Promise<void> {
    if (cue.sourceKind === 'microphone') {
      await this.startMicrophone(cue)
      return
    }
    if (!cue.filePath) {
      this.onError(`El cue "${cue.name}" no tiene archivo asignado`)
      return
    }

    const token = { aborted: false }
    this.loading.set(cue.id, token)

    let buffer: AudioBuffer
    try {
      buffer = await loadBuffer(cue.filePath)
    } catch (err) {
      this.loading.delete(cue.id)
      if (!token.aborted) {
        this.onError(`No se pudo cargar "${cue.fileName || cue.name}" (${(err as Error).message})`)
      }
      return
    }
    this.loading.delete(cue.id)
    if (token.aborted) return

    const route = this.routeFor(cue)
    const { ctx, master } = outputBus(route.deviceId)
    const start = clamp(cue.startTime + offsetInBuffer, 0, Math.max(0, buffer.duration - 0.01))
    const rawEnd =
      cue.endTime > start + 0.01 ? Math.min(cue.endTime, buffer.duration) : buffer.duration
    const rate = cue.rate > 0 ? cue.rate : 1
    const single = Math.max(0.01, (rawEnd - start) / rate)
    const loops = cue.loop && cue.loopCount !== 1
    const total = loops ? (cue.loopCount > 0 ? single * cue.loopCount : Number.POSITIVE_INFINITY) : single

    const when = ctx.currentTime + 0.04
    const gain = ctx.createGain()
    const panner = ctx.createStereoPanner()
    panner.pan.value = clamp(cue.pan, -1, 1)

    // Cadena de ajuste: ganancia → paso alto → 3 bandas → panorama → bus.
    const chain: AudioNode[] = [gain]
    const eq = cue.eq ?? { low: 0, mid: 0, high: 0, highPass: 0 }
    if (eq.highPass > 0) {
      const highPass = ctx.createBiquadFilter()
      highPass.type = 'highpass'
      highPass.frequency.value = clamp(eq.highPass, 20, 400)
      highPass.Q.value = 0.7
      chain.push(highPass)
    }
    const bands: Array<[BiquadFilterType, number, number]> = [
      ['lowshelf', 200, eq.low],
      ['peaking', 1000, eq.mid],
      ['highshelf', 4000, eq.high]
    ]
    for (const [type, frequency, db] of bands) {
      if (Math.abs(db) < 0.05) continue
      const filter = ctx.createBiquadFilter()
      filter.type = type
      filter.frequency.value = frequency
      filter.gain.value = clamp(db, -12, 12)
      if (type === 'peaking') filter.Q.value = 0.9
      chain.push(filter)
    }
    chain.push(panner)
    for (let index = 0; index < chain.length - 1; index += 1) chain[index].connect(chain[index + 1])
    panner.connect(master)

    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = rate
    if (loops) {
      source.loop = true
      source.loopStart = start
      source.loopEnd = rawEnd
    }

    const volume = clamp(cue.volume, 0, 1) * route.level
    const fadeIn = isResume ? 0 : Math.max(0, cue.fadeIn)
    const fadeOut = Math.max(0, cue.fadeOut)
    const param = gain.gain

    const fadeInDur = fadeIn > 0 ? Math.min(fadeIn, single) : 0
    if (fadeInDur > 0) {
      rampGain(param, 0.0001, volume, when, when + fadeInDur, cue.fadeCurve ?? 'linear')
    } else {
      param.setValueAtTime(volume, when)
    }

    if (Number.isFinite(total)) {
      const stopAt = when + total
      if (fadeOut > 0 && volume > 0) {
        const fadeStart = Math.max(when + Math.min(fadeIn, single), stopAt - Math.min(fadeOut, total))
        if (fadeStart < stopAt) {
          param.setValueAtTime(volume, fadeStart)
          rampGain(param, volume, 0.0001, fadeStart, stopAt, cue.fadeCurve ?? 'linear')
        }
      }
    }

    source.connect(gain)
    try {
      // Web Audio exige start() antes de poder programar stop().
      source.start(when, start)
      if (Number.isFinite(total)) source.stop(when + total + 0.05)
    } catch (err) {
      this.onError(`No se pudo reproducir "${cue.fileName || cue.name}" (${(err as Error).message})`)
      return
    }

    const run: Run = {
      cue,
      duration: total,
      startPerf: performance.now() + Math.max(0, (when - ctx.currentTime) * 1000),
      timers: [],
      cancelled: false,
      paused: false,
      pauseStartPerf: 0,
      accumulatedPauseMs: 0,
      customPause: true,
      resumeOffset: start,
      cancel: (fade) => {
        run.cancelled = true
        const now = ctx.currentTime
        const seconds = Math.max(fade, 0.01)
        try {
          param.cancelScheduledValues(now)
          param.setValueAtTime(Math.max(param.value, 0.0001), now)
          param.linearRampToValueAtTime(0.0001, now + seconds)
        } catch {
          /* nodo liberado */
        }
        try {
          source.stop(now + seconds + 0.03)
        } catch {
          /* el source ya terminó */
        }
        this.runs.delete(cue.id)
        this.notify()
      },
      fadeTo: (target, duration) => {
        const now = ctx.currentTime
        try {
          param.cancelScheduledValues(now)
          param.setValueAtTime(Math.max(param.value, 0.0001), now)
          param.linearRampToValueAtTime(
            Math.max(clamp(target, 0, 1), 0.0001),
            now + Math.max(0.01, duration)
          )
        } catch {
          /* nodo liberado */
        }
      },
      pauseImpl: () => {
        try {
          source.stop()
        } catch {
          /* ya detenido */
        }
        const elapsed = Math.max(0, ctx.currentTime - when)
        run.resumeOffset = Math.min(start + elapsed * rate, rawEnd)
      },
      resumeImpl: (offset: number) => {
        void this.startAudio(cue, offset - cue.startTime, true)
      }
    }

    // Al pausar detenemos el source a propósito: no debe darse por terminado.
    source.onended = () => {
      if (run.cancelled || run.paused) return
      this.finishRun(cue.id)
    }
    this.trackRun(run)
  }

  /** Cámara en directo en la ventana de salida (la captura la hace la propia salida). */
  private startCamera(cue: VideoCue): void {
    const total = cue.duration > 0 ? cue.duration : Number.POSITIVE_INFINITY
    const fadeOut = Math.max(0, cue.fadeOut)
    const clear = (fade: number): void => {
      void api.outputEvent({ type: 'clear', cueId: cue.id, fadeOut: fade })
    }

    void api.outputEvent({
      type: 'show',
      payload: {
        cueId: cue.id,
        displayId: cue.displayId ?? '',
        deviceId: cue.deviceId ?? '',
        url: '',
        kind: 'camera',
        cameraDeviceId: cue.cameraDeviceId ?? '',
        volume: clamp(cue.volume, 0, 1),
        loop: true,
        startTime: 0,
        endTime: 0,
        fadeIn: Math.max(0, cue.fadeIn),
        fadeOut,
        opacity: clamp(cue.opacity, 0, 1),
        fit: cue.fit,
        scale: cue.scale > 0 ? cue.scale : 1,
        offsetX: Number.isFinite(cue.offsetX) ? cue.offsetX : 0,
        offsetY: Number.isFinite(cue.offsetY) ? cue.offsetY : 0,
        rotation: Number.isFinite(cue.rotation) ? cue.rotation : 0,
        testPattern: cue.testPattern === true
      }
    })

    const run: Run = {
      cue,
      duration: total,
      startPerf: performance.now(),
      timers: [],
      cancelled: false,
      paused: false,
      pauseStartPerf: 0,
      accumulatedPauseMs: 0,
      customPause: false,
      resumeOffset: 0,
      cancel: (fade) => {
        run.cancelled = true
        for (const timer of run.timers) window.clearTimeout(timer)
        clear(fade > 0 ? fade : fadeOut)
        this.runs.delete(cue.id)
        this.notify()
      },
      fadeTo: () => undefined,
      pauseHook: () => {
        void api.outputEvent({ type: 'pause', cueId: cue.id })
      },
      resumeHook: (remaining: number) => {
        void api.outputEvent({ type: 'resume', cueId: cue.id })
        if (!Number.isFinite(remaining)) return
        run.timers.push(window.setTimeout(() => this.finishRun(cue.id), remaining * 1000))
      }
    }

    if (Number.isFinite(total)) {
      run.timers.push(window.setTimeout(() => this.finishRun(cue.id), total * 1000))
    }
    this.trackRun(run)
  }

  private startVideo(cue: VideoCue): void {
    if (cue.sourceKind === 'camera') {
      this.startCamera(cue)
      return
    }
    const start = Math.max(0, cue.startTime ?? 0)
    const segmentEnd = cue.endTime > start ? cue.endTime : cue.mediaDuration
    const segment = cue.mediaKind === 'image' ? 5 : Math.max(0, segmentEnd - start)
    const configured = cue.duration > 0 ? cue.duration : segment
    // En bucle el cue no termina solo: la capa se queda hasta que se pare.
    const total = cue.loop
      ? Number.POSITIVE_INFINITY
      : Math.max(0.05, configured > 0 ? configured : 5)
    const fadeOut = Math.max(0, cue.fadeOut)

    // Cada cue es una capa independiente: al terminar una, las de abajo siguen visibles.
    const clear = (fade: number): void => {
      void api.outputEvent({ type: 'clear', cueId: cue.id, fadeOut: fade })
    }

    void api.outputEvent({
      type: 'show',
      payload: {
        cueId: cue.id,
        displayId: cue.displayId ?? '',
        deviceId: cue.deviceId ?? '',
        url: mediaUrl(cue.filePath),
        kind: cue.mediaKind,
        cameraDeviceId: '',
        volume: clamp(cue.volume, 0, 1),
        loop: cue.loop,
        startTime: start,
        endTime: cue.endTime > start ? cue.endTime : 0,
        fadeIn: Math.max(0, cue.fadeIn),
        fadeOut,
        opacity: clamp(cue.opacity, 0, 1),
        fit: cue.fit,
        scale: cue.scale > 0 ? cue.scale : 1,
        offsetX: Number.isFinite(cue.offsetX) ? cue.offsetX : 0,
        offsetY: Number.isFinite(cue.offsetY) ? cue.offsetY : 0,
        rotation: Number.isFinite(cue.rotation) ? cue.rotation : 0,
        testPattern: cue.testPattern === true
      }
    })

    const run: Run = {
      cue,
      duration: total,
      startPerf: performance.now(),
      timers: [],
      cancelled: false,
      paused: false,
      pauseStartPerf: 0,
      accumulatedPauseMs: 0,
      customPause: false,
      resumeOffset: 0,
      cancel: (fade) => {
        run.cancelled = true
        for (const timer of run.timers) window.clearTimeout(timer)
        clear(fade > 0 ? fade : fadeOut)
        this.runs.delete(cue.id)
        this.notify()
      },
      fadeTo: () => undefined,
      pauseHook: () => {
        void api.outputEvent({ type: 'pause', cueId: cue.id })
      },
      resumeHook: (remaining: number) => {
        void api.outputEvent({ type: 'resume', cueId: cue.id })
        if (!Number.isFinite(remaining)) return
        run.timers.push(
          window.setTimeout(() => clear(fadeOut), Math.max(0, remaining - fadeOut) * 1000),
          window.setTimeout(() => this.finishRun(cue.id), remaining * 1000)
        )
      }
    }

    if (Number.isFinite(total)) {
      run.timers.push(
        window.setTimeout(() => clear(fadeOut), Math.max(0, total - fadeOut) * 1000),
        window.setTimeout(() => this.finishRun(cue.id), total * 1000)
      )
    }

    this.trackRun(run)
  }

  private startStop(cue: StopCue): void {
    for (const target of cue.targets) this.stopCue(target, Math.max(0, cue.fadeOut))
    this.startTimed(cue, Math.max(0.05, cue.fadeOut))
  }

  private startFade(cue: Cue & { type: 'fade' }): void {
    for (const target of cue.targets) this.fadeCue(target, cue.volume, cue.duration)
    this.startTimed(cue, Math.max(0.05, cue.duration))
  }

  private sendDmx(universe: number, state: Uint8Array): void {
    void api.dmxSend(universe, Array.from(state)).catch(() => undefined)
  }

  /** Fade Art-Net: interpola los canales indicados desde el valor actual. */
  private startDmx(cue: DmxCue): void {
    const universe = Math.max(0, Math.min(32767, Math.round(cue.universe) || 0))
    let state = this.dmxState.get(universe)
    if (!state) {
      state = new Uint8Array(512)
      this.dmxState.set(universe, state)
    }
    const from = Uint8Array.from(state)
    const targets = (cue.channels ?? []).filter(
      (item) => item.channel >= 1 && item.channel <= 512 && Number.isFinite(item.value)
    )
    const duration = Math.max(0, cue.fade)

    const apply = (t: number): void => {
      for (const item of targets) {
        const index = item.channel - 1
        const target = Math.max(0, Math.min(255, Math.round(item.value)))
        state[index] = Math.round(from[index] + (target - from[index]) * t)
      }
      this.sendDmx(universe, state)
    }

    const run: Run = {
      cue,
      duration: duration > 0 ? duration : 0.05,
      startPerf: performance.now(),
      timers: [],
      cancelled: false,
      paused: false,
      pauseStartPerf: 0,
      accumulatedPauseMs: 0,
      customPause: false,
      resumeOffset: 0,
      cancel: () => {
        run.cancelled = true
        window.clearInterval(timer)
        this.runs.delete(cue.id)
        this.notify()
      },
      fadeTo: () => undefined
    }

    const timer = window.setInterval(() => {
      if (run.cancelled || !this.runs.has(cue.id)) {
        window.clearInterval(timer)
        return
      }
      if (run.paused) return
      if (duration <= 0) {
        apply(1)
        this.finishRun(cue.id)
        return
      }
      const elapsed = (performance.now() - run.startPerf) / 1000 - run.accumulatedPauseMs / 1000
      const t = clamp(elapsed / duration, 0, 1)
      apply(t)
      if (t >= 1) this.finishRun(cue.id)
    }, 40)

    apply(0)
    this.trackRun(run)
    if (duration <= 0) {
      apply(1)
      this.finishRun(cue.id)
    }
  }

  /**
   * Cue aleatorio: elige miembros del grupo y los dispara. Pensado para pilas de
   * logos, donde cada GO muestra una pieza distinta.
   */
  private startRandom(cue: Cue & { type: 'random' }): void {
    const byId = cueByIdMap(this.allCues())
    const pool = (cue.members ?? [])
      .map((id) => byId.get(id))
      .filter((child): child is Cue => !!child && child.id !== cue.id && child.type !== 'group' && child.type !== 'random')

    if (pool.length === 0) {
      this.onError(`El cue "${cue.name}" no tiene cues entre los que elegir`)
      this.startTimed(cue, 0.05)
      return
    }

    const count = Math.max(1, Math.min(pool.length, Math.round(cue.count) || 1))
    let candidates = pool
    if (cue.avoidRepeat) {
      const used = this.randomHistory.get(cue.id) ?? []
      const remaining = pool.filter((child) => !used.includes(child.id))
      if (remaining.length >= count) candidates = remaining
      else this.randomHistory.set(cue.id, [])
    }

    const pool2 = [...candidates]
    const picked: Cue[] = []
    while (picked.length < count && pool2.length > 0) {
      const index = Math.floor(Math.random() * pool2.length)
      picked.push(pool2.splice(index, 1)[0])
    }

    if (cue.avoidRepeat) {
      const used = new Set(this.randomHistory.get(cue.id) ?? [])
      for (const child of picked) used.add(child.id)
      this.randomHistory.set(cue.id, [...used])
    }

    const children: string[] = []
    for (const child of picked) {
      children.push(child.id)
      if (!this.isActive(child.id)) this.startNow(child)
    }

    const run: Run = {
      cue,
      // Termina enseguida a propósito: así se puede volver a pulsar GO
      // mientras el logo elegido sigue en pantalla.
      duration: 0.05,
      startPerf: performance.now(),
      timers: [],
      cancelled: false,
      paused: false,
      pauseStartPerf: 0,
      accumulatedPauseMs: 0,
      customPause: false,
      resumeOffset: 0,
      cancel: (fade) => {
        run.cancelled = true
        for (const timer of run.timers) window.clearTimeout(timer)
        for (const id of children) this.stopCue(id, fade)
        this.runs.delete(cue.id)
        this.notify()
      },
      fadeTo: (gain, fadeDuration) => {
        for (const id of children) this.fadeCue(id, gain, fadeDuration)
      },
      pauseHook: () => {
        for (const id of children) {
          if (this.runs.has(id)) this.pauseCue(id)
        }
      },
      resumeHook: (remaining: number) => {
        for (const id of children) {
          if (this.runs.has(id) && this.isPaused(id)) this.resumeCue(id)
        }
        if (!Number.isFinite(remaining)) return
        run.timers.push(
          window.setTimeout(() => this.finishRun(cue.id), Math.max(0.02, remaining) * 1000)
        )
      }
    }

    run.timers.push(window.setTimeout(() => this.finishRun(cue.id), 50))
    this.trackRun(run)
  }

  /** Línea de tiempo: dispara los cues anotados en su segundo correspondiente. */
  private startTimeline(cue: Cue & { type: 'timeline' }): void {
    const entries = [...(cue.entries ?? [])].sort((a, b) => a.at - b.at)
    const last = entries.reduce((max, entry) => Math.max(max, entry.at), 0)
    const end = cue.duration > 0 ? cue.duration : last + 0.05
    const fired = new Set<number>()
    const children: string[] = []

    const run: Run = {
      cue,
      duration: Math.max(0.05, end),
      startPerf: performance.now(),
      timers: [],
      cancelled: false,
      paused: false,
      pauseStartPerf: 0,
      accumulatedPauseMs: 0,
      customPause: false,
      resumeOffset: 0,
      cancel: (fade) => {
        run.cancelled = true
        window.clearInterval(timer)
        for (const timer of run.timers) window.clearTimeout(timer)
        for (const id of children) this.stopCue(id, fade)
        this.runs.delete(cue.id)
        this.notify()
      },
      fadeTo: (gain, duration) => {
        for (const id of children) this.fadeCue(id, gain, duration)
      },
      pauseHook: () => {
        for (const id of children) if (this.runs.has(id)) this.pauseCue(id)
      },
      resumeHook: () => {
        for (const id of children) {
          if (this.runs.has(id) && this.isPaused(id)) this.resumeCue(id)
        }
      }
    }

    const timer = window.setInterval(() => {
      if (run.cancelled || !this.runs.has(cue.id)) {
        window.clearInterval(timer)
        return
      }
      if (run.paused) return
      const elapsed = Math.max(0, (performance.now() - run.startPerf) / 1000)
      entries.forEach((entry, index) => {
        if (fired.has(index) || entry.at > elapsed) return
        fired.add(index)
        const child = this.getCue(entry.cueId)
        if (!child || child.id === cue.id) return
        children.push(child.id)
        if (!this.isActive(child.id)) this.startNow(child)
      })
      if (elapsed >= run.duration) {
        window.clearInterval(timer)
        this.finishRun(cue.id)
      }
    }, 40)

    this.trackRun(run)
  }

  private startGroup(cue: GroupCue): void {
    const byId = cueByIdMap(this.allCues())
    const timers: number[] = []
    const children: string[] = []
    let total = 0

    for (const member of cue.members) {
      const child = this.getCue(member.cueId)
      if (!child || child.id === cue.id) continue
      children.push(child.id)
      const childDuration = cueDuration(child, byId)
      const end = member.delay + childDuration
      total = Number.isFinite(end) ? Math.max(total, end) : Number.POSITIVE_INFINITY

      if (member.delay > 0.001) {
        const timer = window.setTimeout(() => {
          if (!this.runs.has(cue.id)) return
          this.startNow(child)
        }, member.delay * 1000)
        timers.push(timer)
      } else {
        this.startNow(child)
      }
    }

    const run: Run = {
      cue,
      duration: total > 0 ? total : 0.05,
      startPerf: performance.now(),
      timers,
      cancelled: false,
      paused: false,
      pauseStartPerf: 0,
      accumulatedPauseMs: 0,
      customPause: false,
      resumeOffset: 0,
      cancel: (fade) => {
        run.cancelled = true
        for (const timer of run.timers) window.clearTimeout(timer)
        for (const id of children) this.stopCue(id, fade)
        this.runs.delete(cue.id)
        this.notify()
      },
      fadeTo: (gain, duration) => {
        for (const id of children) this.fadeCue(id, gain, duration)
      },
      pauseHook: () => {
        for (const id of children) {
          if (this.runs.has(id)) this.pauseCue(id)
        }
      },
      resumeHook: (remaining: number) => {
        for (const id of children) {
          if (this.runs.has(id) && this.isPaused(id)) this.resumeCue(id)
        }
        const t = window.setTimeout(() => this.finishRun(cue.id), Math.max(0.02, remaining) * 1000)
        run.timers.push(t)
      }
    }

    if (cue.members.length > 0 && Number.isFinite(run.duration)) {
      run.timers.push(window.setTimeout(() => this.finishRun(cue.id), run.duration * 1000))
    }
    this.trackRun(run)
  }
}

export const player = new Player()
