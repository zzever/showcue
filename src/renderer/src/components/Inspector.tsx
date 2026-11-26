import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  AudioCue,
  Cue,
  DisplayInfo,
  FixtureProfile,
  GroupMember,
  VideoCue
} from '@shared/types'
import { api } from '../lib/bridge'
import { comboFromEvent, isReservedCombo } from '../lib/triggers'
import { useShowStore } from '../lib/store'
import { listOutputDevices, requestDeviceLabels } from '../lib/audio'
import {
  cueByIdMap,
  cueDuration,
  formatClock,
  formatGainDb,
  formatPercent,
  formatSeconds,
  toNumber
} from '../lib/format'
import { mediaUrl, probeDuration } from '../lib/media'
import { cueTypeLabel } from '../lib/cues'
import Waveform from './Waveform'

function Field({
  label,
  hint,
  children,
  wide
}: {
  label: string
  hint?: string
  children: ReactNode
  wide?: boolean
}): JSX.Element {
  return (
    <div className={`field ${wide ? 'wide' : ''}`}>
      <span className="field-label">{label}</span>
      <div className="field-control">{children}</div>
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  )
}

function NumberField({
  value,
  onChange,
  step = 0.1,
  min = 0,
  placeholder
}: {
  value: number
  onChange: (value: number) => void
  step?: number
  min?: number
  placeholder?: string
}): JSX.Element {
  const ref = useRef<HTMLInputElement | null>(null)
  const [text, setText] = useState(formatSeconds(value))

  useEffect(() => {
    if (document.activeElement !== ref.current) setText(formatSeconds(value))
  }, [value])

  return (
    <input
      ref={ref}
      className="input mono"
      inputMode="decimal"
      value={text}
      step={step}
      min={min}
      placeholder={placeholder}
      onChange={(event) => {
        setText(event.target.value)
        const parsed = toNumber(event.target.value, Number.NaN)
        if (Number.isFinite(parsed)) onChange(Math.max(min, parsed))
      }}
      onBlur={() => setText(formatSeconds(value))}
    />
  )
}

function TextField({
  value,
  onChange,
  placeholder
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}): JSX.Element {
  return (
    <input
      className="input"
      value={value}
      spellCheck={false}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
}): JSX.Element {
  return (
    <button
      type="button"
      className={`toggle ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
    >
      <span className="toggle-track">
        <span className="toggle-knob" />
      </span>
      <span className="toggle-label">{label}</span>
    </button>
  )
}

function VolumeControl({
  value,
  onChange,
  label = 'Volumen'
}: {
  value: number
  onChange: (value: number) => void
  label?: string
}): JSX.Element {
  return (
    <div className="field wide">
      <span className="field-label">{label}</span>
      <div className="slider-row">
        <input
          type="range"
          className="slider"
          min={0}
          max={100}
          step={1}
          value={Math.round(value * 100)}
          onChange={(event) => onChange(Number(event.target.value) / 100)}
        />
        <span className="mono slider-value">{formatPercent(value)}</span>
        <span className="mono slider-db">{formatGainDb(value)}</span>
      </div>
    </div>
  )
}

function FileBox({
  path,
  onChoose,
  onClear
}: {
  path: string
  onChoose: () => void
  onClear: () => void
}): JSX.Element {
  return (
    <div className="file-box">
      <div className="file-meta">
        {path ? (
          <span className="file-path mono" title={path}>
            {path}
          </span>
        ) : (
          <span className="file-empty">Sin archivo asignado</span>
        )}
      </div>
      <div className="file-actions">
        <button className="btn small" onClick={onChoose}>
          Elegir…
        </button>
        {path && (
          <button className="btn small ghost" onClick={onClear}>
            Quitar
          </button>
        )}
      </div>
    </div>
  )
}

function TargetPicker({
  cue,
  all,
  onChange
}: {
  cue: Cue
  all: Cue[]
  onChange: (targets: string[]) => void
}): JSX.Element {
  const targets = cue.type === 'stop' || cue.type === 'fade' ? cue.targets : []
  const candidates = all.filter(
    (candidate) =>
      candidate.id !== cue.id &&
      (candidate.type === 'audio' || candidate.type === 'video' || candidate.type === 'group')
  )

  return (
    <div className="field wide">
      <span className="field-label">Cues afectados</span>
      {candidates.length === 0 ? (
        <div className="field-hint">Todavía no hay otros cues en la lista.</div>
      ) : (
        <div className="target-grid">
          {candidates.map((candidate) => {
            const active = targets.includes(candidate.id)
            return (
              <button
                key={candidate.id}
                type="button"
                className={`target-chip ${active ? 'on' : ''}`}
                onClick={() => {
                  const next = active
                    ? targets.filter((id) => id !== candidate.id)
                    : [...targets, candidate.id]
                  onChange(next)
                }}
              >
                <span className="target-num mono">{candidate.number}</span>
                <span className="target-name">{candidate.name}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function outputSummary(cue: Cue | undefined, displays: DisplayInfo[]): string {
  if (!cue) return ''
  if (cue.type === 'dmx') return `DMX U${cue.universe}`
  if (cue.type === 'video') {
    const display = displays.find((item) => item.id === (cue.displayId ?? ''))
    return display ? display.label.split(' · ')[0] : 'Salida principal'
  }
  if (cue.type === 'audio') return cue.deviceId ? 'Altavoz asignado' : 'Altavoz predeterminado'
  return ''
}

function GroupMembersEditor({
  cue,
  all,
  displays,
  onChange
}: {
  cue: Cue & { type: 'group' }
  all: Cue[]
  displays: DisplayInfo[]
  onChange: (members: GroupMember[]) => void
}): JSX.Element {
  const candidates = all.filter(
    (candidate) => candidate.id !== cue.id && candidate.type !== 'group'
  )
  const used = new Set(cue.members.map((member) => member.cueId))
  const available = candidates.filter((candidate) => !used.has(candidate.id))

  return (
    <div className="field wide">
      <span className="field-label">Miembros</span>
      <div className="member-list">
        {cue.members.length === 0 && (
          <div className="field-hint">Añade cues para dispararlos juntos con un solo GO.</div>
        )}
        {cue.members.map((member, index) => {
          const child = all.find((candidate) => candidate.id === member.cueId)
          return (
            <div className="member-row" key={`${member.cueId}-${index}`}>
              <span className="member-label">
                <span className="target-num mono">{child?.number ?? '?'}</span>
                {child?.name ?? 'Cue eliminado'}
                <span className="member-output">{outputSummary(child, displays)}</span>
              </span>
              <div className="member-delay">
                <NumberField
                  value={member.delay}
                  onChange={(delay) => {
                    const next = cue.members.map((item, i) =>
                      i === index ? { ...item, delay } : item
                    )
                    onChange(next)
                  }}
                />
                <span className="field-hint">s</span>
              </div>
              <button
                className="btn tiny ghost"
                onClick={() => onChange(cue.members.filter((_, i) => i !== index))}
                title="Quitar miembro"
              >
                ✕
              </button>
            </div>
          )
        })}
      </div>

      {available.length > 0 && (
        <select
          className="input select"
          value=""
          onChange={(event) => {
            if (!event.target.value) return
            onChange([...cue.members, { cueId: event.target.value, delay: 0 }])
          }}
        >
          <option value="">Añadir cue al grupo…</option>
          {available.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.number} · {candidate.name} ({cueTypeLabel(candidate.type)})
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

export default function Inspector(): JSX.Element {
  const cues = useShowStore((state) => state.cues)
  const selectedId = useShowStore((state) => state.selectedId)
  const updateCue = useShowStore((state) => state.updateCue)
  const removeCue = useShowStore((state) => state.removeCue)
  const duplicateCue = useShowStore((state) => state.duplicateCue)
  const moveCue = useShowStore((state) => state.moveCue)
  const toast = useShowStore((state) => state.toast)

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [fixtures, setFixtures] = useState<FixtureProfile[]>([])

  const cue = cues.find((candidate) => candidate.id === selectedId)
  const byId = useMemo(() => cueByIdMap(cues), [cues])

  useEffect(() => {
    void listOutputDevices().then(setDevices)
    void api.listDisplays().then(setDisplays)
    void api.listFixtures().then(setFixtures)
  }, [])

  const importFixtures = async (): Promise<void> => {
    const list = await api.importFixtures()
    setFixtures(list)
    if (list.length === 0) {
      toast('No se importó ningún perfil (se esperan .gdtf o .json)', 'info')
      return
    }
    toast(`${list.length} perfil(es) en la librería DMX`, 'success')
  }

  const refreshDevices = async (): Promise<void> => {
    await api.allowDevices()
    await requestDeviceLabels()
    setDevices(await listOutputDevices())
  }

  const update = (id: string, patch: Record<string, unknown>): void => updateCue(id, patch)

  const chooseFile = async (target: AudioCue | VideoCue): Promise<void> => {
    const files = await api.pickMedia()
    const wanted =
      target.type === 'audio'
        ? files.filter((file) => file.kind === 'audio')
        : files.filter((file) => file.kind === 'video' || file.kind === 'image')
    if (wanted.length === 0) {
      toast('Selecciona un archivo compatible', 'info')
      return
    }
    const file = wanted[0]
    update(target.id, {
      filePath: file.path,
      fileName: file.name,
      mediaDuration: 0,
      ...(target.type === 'video'
        ? { mediaKind: file.kind === 'image' ? 'image' : 'video' }
        : {})
    })
    const duration = await probeDuration(
      mediaUrl(file.path),
      target.type === 'audio' ? 'audio' : 'video'
    )
    if (duration > 0) updateCue(target.id, { mediaDuration: duration })
  }

  if (!cue) {
    const totalDuration = cues.reduce((sum, item) => {
      const value = cueDuration(item, byId)
      return sum + (Number.isFinite(value) ? value : 0)
    }, 0)
    return (
      <aside className="inspector">
        <div className="insp-empty">
          <div className="insp-empty-mark">◈</div>
          <h2>Nada seleccionado</h2>
          <p className="muted">
            Selecciona un cue de la lista para editar sus parámetros. Los cambios se guardan solos.
          </p>
          <dl className="summary">
            <div>
              <dt>Cues</dt>
              <dd className="mono">{cues.length}</dd>
            </div>
            <div>
              <dt>Duración total</dt>
              <dd className="mono">{formatClock(totalDuration)}</dd>
            </div>
          </dl>
          <div className="tip-card">
            <strong>Flujo rápido</strong>
            <ol>
              <li>Arrastra audio o video a la ventana.</li>
              <li>Pulsa <kbd>Espacio</kbd> para ejecutar.</li>
              <li>Usa <kbd>Esc</kbd> como pánico.</li>
            </ol>
          </div>
        </div>
      </aside>
    )
  }

  const duration = cueDuration(cue, byId)
  const index = cues.findIndex((item) => item.id === cue.id)
  const dmxFixture =
    cue.type === 'dmx' && cue.fixtureId
      ? fixtures.find((item) => item.id === cue.fixtureId)
      : undefined
  const dmxMode =
    cue.type === 'dmx' && dmxFixture
      ? dmxFixture.modes.find((mode) => mode.name === cue.fixtureMode) ?? dmxFixture.modes[0]
      : undefined

  return (
    <aside className="inspector">
      <div className="insp-head">
        <div className="insp-head-top">
          <span className={`type-chip t-${cue.type}`}>{cueTypeLabel(cue.type)}</span>
          <span className="insp-duration mono" title="Duración calculada">
            {Number.isFinite(duration) ? formatClock(duration) : '∞'}
          </span>
        </div>
        <input
          className="insp-name"
          value={cue.name}
          spellCheck={false}
          onChange={(event) => update(cue.id, { name: event.target.value })}
          aria-label="Nombre del cue"
        />
        <div className="insp-number">
          <span className="hash">#</span>
          <TextField
            value={cue.number}
            onChange={(number) => update(cue.id, { number })}
          />
        </div>
      </div>

      <div className="insp-body">
        {cue.type === 'audio' && (
          <>
            <section className="insp-section">
              <h3>Archivo</h3>
              <FileBox
                path={cue.fileName || cue.filePath}
                onChoose={() => void chooseFile(cue)}
                onClear={() => update(cue.id, { filePath: '', fileName: '', mediaDuration: 0 })}
              />
              {cue.filePath && (
                <Waveform
                  path={cue.filePath}
                  start={cue.startTime}
                  end={cue.endTime > cue.startTime ? cue.endTime : cue.mediaDuration}
                  duration={cue.mediaDuration}
                />
              )}
              <div className="field-row">
                <Field label="Inicio" hint={cue.mediaDuration > 0 ? formatClock(cue.mediaDuration) : undefined}>
                  <NumberField
                    value={cue.startTime}
                    onChange={(startTime) => update(cue.id, { startTime })}
                  />
                </Field>
                <Field label="Fin" hint="0 = final">
                  <NumberField
                    value={cue.endTime}
                    onChange={(endTime) => update(cue.id, { endTime })}
                  />
                </Field>
              </div>
            </section>

            <section className="insp-section">
              <h3>Nivel</h3>
              <VolumeControl
                value={cue.volume}
                onChange={(volume) => update(cue.id, { volume })}
              />
              <div className="field-row">
                <Field label="Fade in">
                  <NumberField value={cue.fadeIn} onChange={(fadeIn) => update(cue.id, { fadeIn })} />
                </Field>
                <Field label="Fade out">
                  <NumberField
                    value={cue.fadeOut}
                    onChange={(fadeOut) => update(cue.id, { fadeOut })}
                  />
                </Field>
              </div>
              <Field label="Curva de fade">
                <select
                  className="input select"
                  value={cue.fadeCurve ?? 'linear'}
                  onChange={(event) => update(cue.id, { fadeCurve: event.target.value })}
                >
                  <option value="linear">Lineal</option>
                  <option value="exponential">Exponencial</option>
                  <option value="s">Curva S</option>
                  <option value="log">Logarítmica</option>
                </select>
              </Field>
              <div className="field-row">
                <Field label="Panorama" hint={cue.pan === 0 ? 'Centro' : cue.pan < 0 ? 'Izquierda' : 'Derecha'}>
                  <input
                    type="range"
                    className="slider"
                    min={-100}
                    max={100}
                    step={1}
                    value={Math.round(cue.pan * 100)}
                    onChange={(event) => update(cue.id, { pan: Number(event.target.value) / 100 })}
                  />
                </Field>
                <Field label="Velocidad" hint="1.00 = normal">
                  <NumberField
                    value={cue.rate}
                    min={0.1}
                    onChange={(rate) => update(cue.id, { rate })}
                  />
                </Field>
              </div>
            </section>

            <section className="insp-section">
              <h3>Reproducción</h3>
              <div className="toggle-row">
                <Toggle
                  checked={cue.loop}
                  onChange={(loop) => update(cue.id, { loop })}
                  label="Bucle"
                />
              </div>
              {cue.loop && (
                <Field label="Repeticiones" hint="0 = infinito">
                  <NumberField
                    value={cue.loopCount}
                    step={1}
                    onChange={(loopCount) => update(cue.id, { loopCount })}
                  />
                </Field>
              )}
              <Field label="Salida de audio">
                <div className="device-row">
                  <select
                    className="input select"
                    value={cue.deviceId}
                    onChange={(event) => update(cue.id, { deviceId: event.target.value })}
                  >
                    <option value="">Predeterminada del sistema</option>
                    {devices.map((device, deviceIndex) => (
                      <option key={device.deviceId || deviceIndex} value={device.deviceId}>
                        {device.label || `Salida ${deviceIndex + 1}`}
                      </option>
                    ))}
                  </select>
                  <button className="btn small ghost" onClick={() => void refreshDevices()} title="Detectar dispositivos">
                    ↻
                  </button>
                </div>
              </Field>
            </section>
          </>
        )}

        {cue.type === 'video' && (
          <>
            <section className="insp-section">
              <h3>Media</h3>
              <FileBox
                path={cue.fileName || cue.filePath}
                onChoose={() => void chooseFile(cue)}
                onClear={() =>
                  update(cue.id, { filePath: '', fileName: '', mediaDuration: 0, mediaKind: 'video' })
                }
              />
              <div className="field-hint">
                Se muestra en la ventana de salida. Ábrela con el botón «Salida».
              </div>
              <div className="field-row">
                <Field
                  label="Inicio"
                  hint={cue.mediaDuration > 0 ? `Archivo: ${formatClock(cue.mediaDuration)}` : 'segundo del video'}
                >
                  <NumberField
                    value={cue.startTime ?? 0}
                    onChange={(startTime) => update(cue.id, { startTime })}
                  />
                </Field>
                <Field label="Fin" hint="0 = final del archivo">
                  <NumberField
                    value={cue.endTime ?? 0}
                    onChange={(endTime) => update(cue.id, { endTime })}
                  />
                </Field>
              </div>
              <Field label="Duración" hint="0 = todo el tramo recortado">
                <NumberField
                  value={cue.duration}
                  onChange={(value) => update(cue.id, { duration: value })}
                />
              </Field>
              {cue.mediaDuration > 0 && (
                <div className="trim-readout mono">
                  tramo {formatClock(cue.startTime ?? 0)} →{' '}
                  {formatClock(cue.endTime > 0 ? cue.endTime : cue.mediaDuration)} ·{' '}
                  {formatClock(cueDuration(cue, byId))}
                </div>
              )}
            </section>

            <section className="insp-section">
              <h3>Presentación</h3>
              <VolumeControl value={cue.volume} onChange={(volume) => update(cue.id, { volume })} />
              <div className="field-row">
                <Field label="Fade in">
                  <NumberField value={cue.fadeIn} onChange={(fadeIn) => update(cue.id, { fadeIn })} />
                </Field>
                <Field label="Fade out">
                  <NumberField value={cue.fadeOut} onChange={(fadeOut) => update(cue.id, { fadeOut })} />
                </Field>
              </div>
              <Field label="Opacidad">
                <div className="slider-row">
                  <input
                    type="range"
                    className="slider"
                    min={0}
                    max={100}
                    value={Math.round(cue.opacity * 100)}
                    onChange={(event) => update(cue.id, { opacity: Number(event.target.value) / 100 })}
                  />
                  <span className="mono slider-value">{formatPercent(cue.opacity)}</span>
                </div>
              </Field>
              <div className="field-row">
                <Field label="Ajuste">
                  <select
                    className="input select"
                    value={cue.fit}
                    onChange={(event) => update(cue.id, { fit: event.target.value })}
                  >
                    <option value="contain">Completo (contain)</option>
                    <option value="cover">Rellenar (cover)</option>
                  </select>
                </Field>
                <Field label="Bucle">
                  <Toggle
                    checked={cue.loop}
                    onChange={(loop) => update(cue.id, { loop })}
                    label={cue.loop ? 'Sí' : 'No'}
                  />
                </Field>
              </div>
            </section>

            <section className="insp-section">
              <h3>Salida</h3>
              <Field label="Pantalla" hint="Se abre la ventana de salida en ese monitor">
                <div className="device-row">
                  <select
                    className="input select"
                    value={cue.displayId ?? ''}
                    onChange={(event) => update(cue.id, { displayId: event.target.value })}
                  >
                    <option value="">Salida principal</option>
                    {displays.map((display) => (
                      <option key={display.id || 'main'} value={display.id}>
                        {display.label}
                        {display.primary ? ' (principal)' : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn small ghost"
                    onClick={() => void api.ensureOutput(cue.displayId ?? '')}
                    title="Abrir la ventana de salida de esa pantalla"
                  >
                    Abrir
                  </button>
                </div>
              </Field>
              <Field label="Salida de audio">
                <select
                  className="input select"
                  value={cue.deviceId ?? ''}
                  onChange={(event) => update(cue.id, { deviceId: event.target.value })}
                >
                  <option value="">Predeterminada del sistema</option>
                  {devices.map((device, deviceIndex) => (
                    <option key={device.deviceId || deviceIndex} value={device.deviceId}>
                      {device.label || `Salida ${deviceIndex + 1}`}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="field-hint">
                Cada cue puede ir a una pantalla distinta y sacar su audio por un altavoz
                distinto. Los grupos reparten sus miembros entre salidas.
              </div>
            </section>
          </>
        )}

        {cue.type === 'group' && (
          <section className="insp-section">
            <h3>Grupo</h3>
            <GroupMembersEditor
              cue={cue}
              all={cues}
              displays={displays}
              onChange={(members) => update(cue.id, { members })}
            />
            <div className="field-hint">
              Todos los miembros arrancan con el GO del grupo; el retardo permite escalonarlos.
            </div>
          </section>
        )}

        {cue.type === 'wait' && (
          <section className="insp-section">
            <h3>Espera</h3>
            <Field label="Duración" hint="Cuenta el tiempo del show">
              <NumberField value={cue.duration} onChange={(value) => update(cue.id, { duration: value })} />
            </Field>
          </section>
        )}

        {cue.type === 'memo' && (
          <section className="insp-section">
            <h3>Nota</h3>
            <Field label="Duración" hint="0 = paso instantáneo">
              <NumberField value={cue.duration} onChange={(value) => update(cue.id, { duration: value })} />
            </Field>
          </section>
        )}

        {cue.type === 'stop' && (
          <section className="insp-section">
            <h3>Stop</h3>
            <Field label="Fade out" hint="0 = corte seco">
              <NumberField value={cue.fadeOut} onChange={(value) => update(cue.id, { fadeOut: value })} />
            </Field>
            <TargetPicker
              cue={cue}
              all={cues}
              onChange={(targets) => update(cue.id, { targets })}
            />
          </section>
        )}

        {cue.type === 'fade' && (
          <section className="insp-section">
            <h3>Fade</h3>
            <Field label="Duración">
              <NumberField value={cue.duration} onChange={(value) => update(cue.id, { duration: value })} />
            </Field>
            <VolumeControl
              label="Volumen final"
              value={cue.volume}
              onChange={(volume) => update(cue.id, { volume })}
            />
            <TargetPicker
              cue={cue}
              all={cues}
              onChange={(targets) => update(cue.id, { targets })}
            />
          </section>
        )}

        {cue.type === 'dmx' && (
          <section className="insp-section">
            <h3>DMX (Art-Net)</h3>
            <div className="field-row">
              <Field label="Universo" hint="0-32767 (Art-Net empieza en 0)">
                <NumberField
                  value={cue.universe}
                  step={1}
                  min={0}
                  onChange={(universe) => update(cue.id, { universe })}
                />
              </Field>
              <Field label="Fade" hint="0 = cambio seco">
                <NumberField value={cue.fade} onChange={(fade) => update(cue.id, { fade })} />
              </Field>
            </div>
            <div className="field wide">
              <span className="field-label">Fixture</span>
              <div className="device-row">
                <select
                  className="input select"
                  value={cue.fixtureId ?? ''}
                  onChange={(event) => {
                    const fixture = fixtures.find((item) => item.id === event.target.value)
                    update(cue.id, {
                      fixtureId: event.target.value,
                      fixtureMode: fixture?.modes[0]?.name ?? ''
                    })
                  }}
                >
                  <option value="">Sin fixture (canales manuales)</option>
                  {fixtures.map((fixture) => (
                    <option key={fixture.id} value={fixture.id}>
                      {fixture.manufacturer} · {fixture.name}
                    </option>
                  ))}
                </select>
                <button className="btn small" onClick={() => void importFixtures()}>
                  Importar GDTF
                </button>
              </div>
              <span className="field-hint">
                Añade perfiles .gdtf o librerías .json a la librería del equipo.
              </span>
            </div>
            {dmxFixture && (
              <>
                <div className="field-row">
                  <Field label="Modo" hint={`${dmxMode?.channels.length ?? 0} canales`}>
                    <select
                      className="input select"
                      value={dmxMode?.name ?? ''}
                      onChange={(event) => update(cue.id, { fixtureMode: event.target.value })}
                    >
                      {dmxFixture.modes.map((mode) => (
                        <option key={mode.name} value={mode.name}>
                          {mode.name} · {mode.channels.length} ch
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Dirección" hint="1-512">
                    <NumberField
                      value={cue.startAddress ?? 1}
                      step={1}
                      min={1}
                      onChange={(startAddress) => update(cue.id, { startAddress })}
                    />
                  </Field>
                </div>
                <button
                  className="btn small"
                  onClick={() => {
                    if (cue.type !== 'dmx' || !dmxMode) return
                    const start = Math.max(1, Math.min(512, Math.round(cue.startAddress ?? 1)))
                    update(cue.id, {
                      channels: dmxMode.channels
                        .map((channel) => ({
                          channel: start + channel.offset - 1,
                          value: 0,
                          name: channel.name
                        }))
                        .filter((channel) => channel.channel >= 1 && channel.channel <= 512),
                      fixtureMode: dmxMode.name,
                      startAddress: start
                    })
                  }}
                >
                  Colocar canales del fixture
                </button>
              </>
            )}
            <div className="field wide">
              <span className="field-label">Canales</span>
              <div className="dmx-list">
                {cue.channels.length === 0 && (
                  <div className="field-hint">Añade los canales que debe fijar este cue.</div>
                )}
                {cue.channels.map((item, index) => (
                  <div className="dmx-row" key={index} title={item.name ?? undefined}>
                    <span className="dmx-tag">{item.name ? item.name.slice(0, 10) : 'CH'}</span>
                    <input
                      className="input mono dmx-num"
                      inputMode="numeric"
                      value={item.channel}
                      onChange={(event) => {
                        const channel = Math.max(
                          1,
                          Math.min(512, Math.round(toNumber(event.target.value, 1)))
                        )
                        update(cue.id, {
                          channels: cue.channels.map((entry, i) =>
                            i === index ? { ...entry, channel } : entry
                          )
                        })
                      }}
                    />
                    <input
                      type="range"
                      className="slider"
                      min={0}
                      max={255}
                      value={item.value}
                      onChange={(event) => {
                        const value = Number(event.target.value)
                        update(cue.id, {
                          channels: cue.channels.map((entry, i) =>
                            i === index ? { ...entry, value } : entry
                          )
                        })
                      }}
                    />
                    <input
                      className="input mono dmx-value"
                      inputMode="numeric"
                      value={item.value}
                      onChange={(event) => {
                        const value = Math.max(
                          0,
                          Math.min(255, Math.round(toNumber(event.target.value, 0)))
                        )
                        update(cue.id, {
                          channels: cue.channels.map((entry, i) =>
                            i === index ? { ...entry, value } : entry
                          )
                        })
                      }}
                    />
                    <button
                      className="btn tiny ghost"
                      title="Quitar canal"
                      onClick={() =>
                        update(cue.id, {
                          channels: cue.channels.filter((_, i) => i !== index)
                        })
                      }
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <button
                className="btn small"
                onClick={() => {
                  const used = new Set(cue.channels.map((item) => item.channel))
                  let channel = 1
                  while (used.has(channel) && channel < 512) channel += 1
                  update(cue.id, { channels: [...cue.channels, { channel, value: 255 }] })
                }}
              >
                + Añadir canal
              </button>
            </div>
            <div className="field-hint">
              Se envía al destino Art-Net configurado en Ajustes (universos desde 0). Si el envío
              DMX está desactivado, el cue se ejecuta sin emitir nada.
            </div>
          </section>
        )}

        <section className="insp-section">
          <h3>Ejecución</h3>
          <div className="field-row">
            <Field label="Pre-espera">
              <NumberField value={cue.preWait} onChange={(preWait) => update(cue.id, { preWait })} />
            </Field>
            <Field label="Post-espera">
              <NumberField value={cue.postWait} onChange={(postWait) => update(cue.id, { postWait })} />
            </Field>
          </div>
          <div className="toggle-row">
            <Toggle
              checked={cue.autoContinue}
              onChange={(autoContinue) => update(cue.id, { autoContinue })}
              label="Continuar automáticamente"
            />
          </div>
        </section>

        <section className="insp-section">
          <h3>Disparo</h3>
          <div className="toggle-row">
            <Toggle
              checked={cue.armed !== false}
              onChange={(armed) => update(cue.id, { armed })}
              label="Armado"
            />
          </div>
          <Field label="Atajo de teclado" hint="Pulsa una tecla con el campo enfocado">
            <input
              className="input mono"
              value={cue.hotkey || ''}
              placeholder="Sin asignar"
              readOnly
              onKeyDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
                const combo = comboFromEvent(event.nativeEvent as KeyboardEvent)
                if (isReservedCombo(combo)) return
                update(cue.id, { hotkey: combo })
              }}
              onFocus={(event) => {
                event.currentTarget.value = cue.hotkey || ''
              }}
            />
            {cue.hotkey && (
              <button className="btn tiny ghost" onClick={() => update(cue.id, { hotkey: '' })}>
                Quitar
              </button>
            )}
          </Field>
          <div className="field-row">
            <Field label="Nota MIDI" hint="0-127, -1 = sin asignar">
                              <NumberField
                value={cue.midiNote ?? -1}
                min={-1}
                onChange={(midiNote) => update(cue.id, { midiNote })}
              />
            </Field>
            <Field label="Canal MIDI" hint="0 = cualquiera">
                              <NumberField
                value={cue.midiChannel ?? 0}
                min={0}
                onChange={(midiChannel) => update(cue.id, { midiChannel })}
              />
            </Field>
          </div>
        </section>

        <section className="insp-section">
          <h3>Notas</h3>
          <textarea
            className="input textarea"
            rows={3}
            value={cue.notes}
            placeholder="Indicaciones para el operador…"
            onChange={(event) => update(cue.id, { notes: event.target.value })}
          />
        </section>
      </div>

      <div className="insp-foot">
        <button className="btn small" onClick={() => moveCue(cue.id, -1)} disabled={index <= 0} title="Subir">
          ▲
        </button>
        <button
          className="btn small"
          onClick={() => moveCue(cue.id, 1)}
          disabled={index === cues.length - 1}
          title="Bajar"
        >
          ▼
        </button>
        <button className="btn small" onClick={() => duplicateCue(cue.id)}>
          Duplicar
        </button>
        <button className="btn small danger" onClick={() => removeCue(cue.id)}>
          Eliminar
        </button>
      </div>
    </aside>
  )
}
