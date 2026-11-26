import { useEffect, useMemo, useRef, useState } from 'react'
import type { Cue, DmxInput } from '@shared/types'
import { api } from '../lib/bridge'
import { useShowStore } from '../lib/store'
import { toNumber } from '../lib/format'
import { updateSettings } from '../lib/settings'

const MANUAL_CHANNELS = 16

/**
 * Mesa de DMX manual: faders de escenas (cues DMX) y de canales sueltos,
 * con grabación de cue y monitor de Art-Net entrante.
 */
export default function DmxPanel({
  onClose,
  onOpenPatch
}: {
  onClose: () => void
  onOpenPatch: () => void
}): JSX.Element {
  const cues = useShowStore((state) => state.cues)
  const addCue = useShowStore((state) => state.addCue)
  const updateCue = useShowStore((state) => state.updateCue)
  const setSelected = useShowStore((state) => state.select)
  const toast = useShowStore((state) => state.toast)
  const artnetInEnabled = useShowStore((state) => state.settings.artnetInEnabled === true)

  const [tab, setTab] = useState<'scenes' | 'channels' | 'input'>('scenes')
  const [universe, setUniverse] = useState(0)
  const [firstChannel, setFirstChannel] = useState(1)
  const [levels, setLevels] = useState<Record<string, number>>({})
  const [manual, setManual] = useState<number[]>(Array(MANUAL_CHANNELS).fill(0))
  const [incoming, setIncoming] = useState<Record<number, DmxInput>>({})
  const timer = useRef<number | null>(null)

  const dmxCues = useMemo(
    () => cues.filter((cue): cue is Cue & { type: 'dmx' } => cue.type === 'dmx'),
    [cues]
  )

  useEffect(() => {
    return api.onDmxIn((input) => {
      setIncoming((prev) => ({ ...prev, [input.universe]: input }))
    })
  }, [])

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [])

  /** Mezcla escenas + canales manuales y envía el universo. */
  const apply = (nextLevels: Record<string, number>, nextManual: number[]): void => {
    const state = new Array<number>(512).fill(0)
    for (const cue of dmxCues) {
      const level = nextLevels[cue.id] ?? 0
      if (level <= 0) continue
      const factor = level / 255
      for (const item of cue.channels) {
        if (item.channel < 1 || item.channel > 512) continue
        const value = Math.round(item.value * factor)
        state[item.channel - 1] = Math.max(state[item.channel - 1], value)
      }
    }
    nextManual.forEach((value, index) => {
      const channel = firstChannel - 1 + index
      if (channel < 0 || channel > 511) return
      state[channel] = Math.max(state[channel], value)
    })
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      void api.dmxSend(universe, state).catch(() => undefined)
    }, 40)
  }

  const setLevel = (cueId: string, value: number): void => {
    const next = { ...levels, [cueId]: value }
    setLevels(next)
    apply(next, manual)
  }

  const setChannel = (index: number, value: number): void => {
    const next = [...manual]
    next[index] = value
    setManual(next)
    apply(levels, next)
  }

  const recordCue = (): void => {
    const channels = manual
      .map((value, index) => ({
        channel: firstChannel + index,
        value,
        name: `CH ${firstChannel + index}`
      }))
      .filter((item) => item.value > 0)
    if (channels.length === 0) {
      toast('Sube algún canal antes de grabar el cue', 'info')
      return
    }
    const cue = addCue('dmx')
    updateCue(cue.id, { universe, channels, fade: 0 })
    setSelected(cue.id)
    toast(`Cue ${cue.number} grabado con ${channels.length} canales`, 'success')
  }

  const loadIncoming = (): void => {
    const input = incoming[universe]
    if (!input) return
    const next = input.values.slice(firstChannel - 1, firstChannel - 1 + MANUAL_CHANNELS)
    setManual(next)
    apply(levels, next)
  }

  const live = incoming[universe]
  const channelsInView = live
    ? live.values.slice(firstChannel - 1, firstChannel - 1 + MANUAL_CHANNELS)
    : []

  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div className="modal wide" onPointerDown={(event) => event.stopPropagation()}>
        <header className="modal-head">
          <h2>DMX directo</h2>
          <div className="modal-head-actions">
            <button className="btn small ghost" onClick={onOpenPatch}>
              Patch
            </button>
            <button className="btn small ghost" onClick={recordCue}>
              Grabar cue
            </button>
            <button className="btn btn-icon" onClick={onClose}>
              ✕
            </button>
          </div>
        </header>

        <div className="dmx-toolbar">
          <div className="seg">
            <button
              className={`seg-btn ${tab === 'scenes' ? 'on' : ''}`}
              onClick={() => setTab('scenes')}
            >
              Escenas
            </button>
            <button
              className={`seg-btn ${tab === 'channels' ? 'on' : ''}`}
              onClick={() => setTab('channels')}
            >
              Canales
            </button>
            <button
              className={`seg-btn ${tab === 'input' ? 'on' : ''}`}
              onClick={() => setTab('input')}
            >
              Entrada
            </button>
          </div>
          <label className="patch-mini">
            Universo
            <input
              className="input mono"
              inputMode="numeric"
              value={universe}
              onChange={(event) => setUniverse(Math.max(0, toNumber(event.target.value, 0)))}
            />
          </label>
          <label className="patch-mini">
            Primer canal
            <input
              className="input mono"
              inputMode="numeric"
              value={firstChannel}
              onChange={(event) =>
                setFirstChannel(Math.max(1, Math.min(512, toNumber(event.target.value, 1))))
              }
            />
          </label>
          <button className="btn small" onClick={loadIncoming} disabled={!live}>
            Copiar entrada
          </button>
        </div>

        <div className="modal-body">
          {tab === 'scenes' && (
            <section className="insp-section">
              <h3>Faders de escenas</h3>
              <p className="field-hint">
                Cada cue DMX de la lista tiene su fader. Mueve el nivel para aplicarlo en directo sin
                tocar la lista; los canales se mezclan tomando el valor más alto.
              </p>
              {dmxCues.length === 0 ? (
                <div className="field-hint">Todavía no hay cues DMX en el show.</div>
              ) : (
                <div className="fader-grid">
                  {dmxCues.map((cue) => (
                    <div className="fader" key={cue.id}>
                      <span className="fader-name" title={cue.name}>
                        {cue.number} · {cue.name}
                      </span>
                      <input
                        type="range"
                        className="fader-range"
                        min={0}
                        max={255}
                        value={levels[cue.id] ?? 0}
                        onChange={(event) => setLevel(cue.id, Number(event.target.value))}
                        aria-label={`Nivel de ${cue.name}`}
                      />
                      <span className="mono fader-value">{levels[cue.id] ?? 0}</span>
                      <button
                        className="btn tiny ghost"
                        onClick={() => setLevel(cue.id, 255)}
                        title="Llevar al 100 %"
                      >
                        FULL
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {tab === 'channels' && (
            <section className="insp-section">
              <h3>Canales manuales</h3>
              <p className="field-hint">
                Modo directo: cada cambio se envía por Art-Net al universo elegido. «Grabar cue»
                crea un cue DMX con los canales que estén por encima de 0.
              </p>
              <div className="fader-grid">
                {manual.map((value, index) => (
                  <div className="fader" key={index}>
                    <span className="fader-name mono">CH {firstChannel + index}</span>
                    <input
                      type="range"
                      className="fader-range"
                      min={0}
                      max={255}
                      value={value}
                      onChange={(event) => setChannel(index, Number(event.target.value))}
                    />
                    <span className="mono fader-value">{value}</span>
                    <button
                      className="btn tiny ghost"
                      onClick={() => setChannel(index, 0)}
                      title="A cero"
                    >
                      0
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {tab === 'input' && (
            <section className="insp-section">
              <h3>Art-Net entrante</h3>
              <div className="toggle-row">
                <button
                  className={`toggle ${artnetInEnabled ? 'on' : ''}`}
                  onClick={() => {
                    const enabled = !artnetInEnabled
                    updateSettings({ artnetInEnabled: enabled })
                    void api.setArtnetInput(enabled, 6454)
                  }}
                  aria-pressed={artnetInEnabled}
                >
                  <span className="toggle-track">
                    <span className="toggle-knob" />
                  </span>
                  <span className="toggle-label">Escuchar entrada</span>
                </button>
                <span className="field-hint">
                  {live
                    ? `U${live.universe} desde ${live.host}`
                    : 'Sin paquetes ArtDmx recibidos'}
                </span>
              </div>
              <div className="meter-grid">
                {channelsInView.length === 0 && (
                  <div className="field-hint">
                    Activa la escucha y envía DMX desde la mesa para ver los canales aquí.
                  </div>
                )}
                {channelsInView.map((value, index) => (
                  <div className="meter" key={index}>
                    <span className="mono meter-label">{firstChannel + index}</span>
                    <span className="meter-bar">
                      <span style={{ height: `${Math.round((value / 255) * 100)}%` }} />
                    </span>
                    <span className="mono meter-value">{value}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
