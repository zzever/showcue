import { useEffect, useState } from 'react'
import type { AppSettings, RdmDevice } from '@shared/types'
import { api } from '../lib/bridge'
import { useShowStore } from '../lib/store'
import { listOutputDevices, requestDeviceLabels } from '../lib/audio'
import { formatSeconds, toNumber } from '../lib/format'
import { updateSettings } from '../lib/settings'

function Switch({
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

export default function SettingsDialog(): JSX.Element {
  const settings = useShowStore((state) => state.settings)
  const close = useShowStore((state) => state.setSettingsOpen)
  const openShortcuts = useShowStore((state) => state.setShortcutsOpen)
  const path = useShowStore((state) => state.path)
  const toast = useShowStore((state) => state.toast)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [scanning, setScanning] = useState(false)
  const [rdmUniverse, setRdmUniverse] = useState(0)
  const [rdmDevices, setRdmDevices] = useState<RdmDevice[]>([])
  const [rdmBusy, setRdmBusy] = useState(false)
  const [rdmAddresses, setRdmAddresses] = useState<Record<string, string>>({})

  useEffect(() => {
    void listOutputDevices().then(setDevices)
  }, [])

  const update = (patch: Partial<AppSettings>): void => updateSettings(patch)

  const scan = async (): Promise<void> => {
    setScanning(true)
    await api.allowDevices()
    await requestDeviceLabels()
    setDevices(await listOutputDevices())
    setScanning(false)
  }

  const discoverRdm = async (): Promise<void> => {
    setRdmBusy(true)
    try {
      const found = await api.rdmDiscover(rdmUniverse)
      setRdmDevices(found)
      setRdmAddresses(
        Object.fromEntries(found.map((item) => [item.uid, String(item.startAddress || 1)]))
      )
      toast(
        found.length > 0
          ? `${found.length} dispositivo(s) RDM en el universo ${rdmUniverse}`
          : `Ningún dispositivo RDM respondió en el universo ${rdmUniverse}`,
        found.length > 0 ? 'success' : 'info'
      )
    } catch (err) {
      toast(`RDM: ${(err as Error).message}`, 'error')
    } finally {
      setRdmBusy(false)
    }
  }

  const applyAddress = async (device: RdmDevice): Promise<void> => {
    const value = Number(rdmAddresses[device.uid])
    if (!Number.isFinite(value)) return
    try {
      const updated = await api.rdmSetStartAddress(
        device.uid,
        device.universe,
        device.host,
        value
      )
      if (!updated) {
        toast('RDM: el dispositivo no confirmó el cambio de dirección', 'error')
        return
      }
      setRdmDevices((list) => list.map((item) => (item.uid === updated.uid ? updated : item)))
      setRdmAddresses((map) => ({ ...map, [updated.uid]: String(updated.startAddress) }))
      toast(`${updated.label}: dirección DMX ${updated.startAddress}`, 'success')
    } catch (err) {
      toast(`RDM: ${(err as Error).message}`, 'error')
    }
  }

  return (
    <div className="modal-backdrop" onPointerDown={() => close(false)}>
      <div className="modal" onPointerDown={(event) => event.stopPropagation()}>
        <header className="modal-head">
          <h2>Ajustes</h2>
          <button className="btn btn-icon" onClick={() => close(false)}>
            ✕
          </button>
        </header>

        <div className="modal-body">
          <section className="insp-section">
            <h3>Audio</h3>
            <div className="field wide">
              <span className="field-label">Salida predeterminada</span>
              <div className="device-row">
                <select
                  className="input select"
                  value={settings.defaultDeviceId}
                  onChange={(event) => update({ defaultDeviceId: event.target.value })}
                >
                  <option value="">Predeterminada del sistema</option>
                  {devices.map((device, index) => (
                    <option key={device.deviceId || index} value={device.deviceId}>
                      {device.label || `Salida ${index + 1}`}
                    </option>
                  ))}
                </select>
                <button className="btn small" onClick={() => void scan()} disabled={scanning}>
                  {scanning ? '…' : 'Detectar'}
                </button>
              </div>
              <span className="field-hint">
                Se usa en los cues nuevos. Cada cue puede ir a una salida distinta.
              </span>
            </div>

            <div className="field wide">
              <span className="field-label">Fade out por defecto</span>
              <div className="slider-row">
                <input
                  className="input mono"
                  style={{ width: 90 }}
                  value={formatSeconds(settings.defaultFade)}
                  onChange={(event) => {
                    const value = toNumber(event.target.value, 0)
                    update({ defaultFade: Math.max(0, value) })
                  }}
                />
                <span className="field-hint">segundos al detener un cue nuevo</span>
              </div>
            </div>
          </section>

          <section className="insp-section">
            <h3>Grupos de altavoces</h3>
            <p className="field-hint">
              Rutas de sonido del equipo: cada grupo apunta a una salida y las pistas (cues de
              audio) se asignan a un grupo desde el inspector.
            </p>
            <div className="patch-list">
              {(settings.speakerGroups ?? []).length === 0 && (
                <div className="field-hint">Todavía no hay grupos.</div>
              )}
              {(settings.speakerGroups ?? []).map((group) => (
                <div className="patch-row" key={group.id}>
                  <input
                    className="input"
                    value={group.name}
                    onChange={(event) =>
                      update({
                        speakerGroups: (settings.speakerGroups ?? []).map((item) =>
                          item.id === group.id ? { ...item, name: event.target.value } : item
                        )
                      })
                    }
                    aria-label="Nombre del grupo"
                  />
                  <select
                    className="input select"
                    value={group.deviceId}
                    onChange={(event) =>
                      update({
                        speakerGroups: (settings.speakerGroups ?? []).map((item) =>
                          item.id === group.id ? { ...item, deviceId: event.target.value } : item
                        )
                      })
                    }
                  >
                    <option value="">Predeterminada del sistema</option>
                    {devices.map((device, index) => (
                      <option key={device.deviceId || index} value={device.deviceId}>
                        {device.label || `Salida ${index + 1}`}
                      </option>
                    ))}
                  </select>
                  <div className="slider-row group-level">
                    <input
                      type="range"
                      className="slider"
                      min={0}
                      max={100}
                      value={Math.round(group.level * 100)}
                      onChange={(event) =>
                        update({
                          speakerGroups: (settings.speakerGroups ?? []).map((item) =>
                            item.id === group.id
                              ? { ...item, level: Number(event.target.value) / 100 }
                              : item
                          )
                        })
                      }
                    />
                    <span className="mono slider-value">{Math.round(group.level * 100)}%</span>
                  </div>
                  <button
                    className="btn tiny ghost"
                    title="Quitar grupo"
                    onClick={() =>
                      update({
                        speakerGroups: (settings.speakerGroups ?? []).filter(
                          (item) => item.id !== group.id
                        )
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
              onClick={() =>
                update({
                  speakerGroups: [
                    ...(settings.speakerGroups ?? []),
                    {
                      id: Math.random().toString(36).slice(2, 10),
                      name: `Grupo ${(settings.speakerGroups ?? []).length + 1}`,
                      deviceId: settings.defaultDeviceId || '',
                      level: 1
                    }
                  ]
                })
              }
            >
              + Añadir grupo
            </button>
          </section>

          <section className="insp-section">
            <h3>Disparo</h3>
            <div className="field wide">
              <span className="field-label">Prioridad con línea de tiempo</span>
              <select
                className="input select"
                value={settings.timelinePriority ?? 'go'}
                onChange={(event) =>
                  update({ timelinePriority: event.target.value === 'timeline' ? 'timeline' : 'go' })
                }
              >
                <option value="go">GO manual manda siempre</option>
                <option value="timeline">La línea de tiempo bloquea el GO</option>
              </select>
              <span className="field-hint">
                Con la segunda opción, mientras suena una línea de tiempo los GO se ignoran con un
                aviso, para que nadie descuadre la secuencia.
              </span>
            </div>
            <div className="toggle-row">
              <Switch
                checked={settings.hotkeysEnabled !== false}
                onChange={(hotkeysEnabled) => update({ hotkeysEnabled })}
                label="Atajos de teclado"
              />
              <Switch
                checked={settings.midiEnabled !== false}
                onChange={(midiEnabled) => update({ midiEnabled })}
                label="Entrada MIDI"
              />
            </div>
            <div className="field-hint">
              Al bloquear los atajos sólo responden <kbd>Esc</kbd> (pánico) y{' '}
              <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>H</kbd> para volver a activarlos.
            </div>
          </section>

          <section className="insp-section">
            <h3>DMX / Art-Net</h3>
            <div className="toggle-row">
              <Switch
                checked={settings.artnetEnabled === true}
                onChange={(artnetEnabled) => update({ artnetEnabled })}
                label="Enviar DMX por red"
              />
            </div>
            <div className="field wide">
              <span className="field-label">Destino</span>
              <input
                className="input mono"
                value={settings.artnetHost}
                placeholder="255.255.255.255"
                spellCheck={false}
                onChange={(event) => update({ artnetHost: event.target.value })}
              />
              <span className="field-hint">
                IP del nodo DMX (Luminex, Enttec, etc.) o broadcast de la red, puerto 6454. Los
                cues DMX envían ArtDmx (512 canales) y numeran los universos desde 0, como el
                estándar Art-Net.
              </span>
            </div>
            <div className="toggle-row">
              <Switch
                checked={settings.artnetInEnabled === true}
                onChange={(artnetInEnabled) => update({ artnetInEnabled })}
                label="Recibir Art-Net"
              />
            </div>
            <div className="field wide">
              <span className="field-label">Puerto de entrada</span>
              <input
                className="input mono"
                style={{ width: 100 }}
                value={settings.artnetInPort ?? 6454}
                onChange={(event) => update({ artnetInPort: toNumber(event.target.value, 6454) })}
              />
              <span className="field-hint">
                Escucha ArtDmx entrante para el monitor y el modo directo del grid DMX. Si otra
                aplicación de la máquina ocupa el 6454, cambia el puerto aquí.
              </span>
            </div>
          </section>

          <section className="insp-section">
            <h3>OSC</h3>
            <div className="toggle-row">
              <Switch
                checked={settings.oscEnabled === true}
                onChange={(oscEnabled) => update({ oscEnabled })}
                label="Enviar OSC al disparar"
              />
              <Switch
                checked={settings.oscListenEnabled === true}
                onChange={(oscListenEnabled) => update({ oscListenEnabled })}
                label="Escuchar OSC"
              />
            </div>
            <div className="field wide">
              <span className="field-label">Destino</span>
              <div className="device-row">
                <input
                  className="input mono"
                  value={settings.oscHost}
                  placeholder="127.0.0.1"
                  spellCheck={false}
                  onChange={(event) => update({ oscHost: event.target.value })}
                />
                <input
                  className="input mono"
                  style={{ width: 90 }}
                  value={settings.oscPort}
                  onChange={(event) => update({ oscPort: toNumber(event.target.value, 8000) })}
                />
              </div>
              <span className="field-hint">
                En cada GO se envía <code>{settings.oscPrefix}/go</code> (número, nombre, tipo) y{' '}
                <code>{settings.oscPrefix}/cue/&lt;número&gt;/go</code>. Al detener todo,{' '}
                <code>{settings.oscPrefix}/panic</code>. gMA3 suele escuchar en el puerto 8000.
              </span>
            </div>
            <div className="toggle-row">
              <Switch
                checked={settings.oscGma3 === true}
                onChange={(oscGma3) => update({ oscGma3 })}
                label="Modo grandMA3"
              />
            </div>
            <div className="field wide">
              <span className="field-label">Entrada</span>
              <div className="device-row">
                <input
                  className="input mono"
                  value={settings.oscPrefix}
                  placeholder="/showcue"
                  spellCheck={false}
                  onChange={(event) => update({ oscPrefix: event.target.value })}
                />
                <input
                  className="input mono"
                  style={{ width: 90 }}
                  value={settings.oscListenPort}
                  onChange={(event) =>
                    update({ oscListenPort: toNumber(event.target.value, 9000) })
                  }
                />
              </div>
              <span className="field-hint">
                Acepta <code>{settings.oscPrefix}/go</code> con el número de cue como argumento y{' '}
                <code>{settings.oscPrefix}/panic</code>. El puerto de entrada debe ser distinto del
                de destino para no crear un bucle.
              </span>
            </div>
          </section>

          <section className="insp-section">
            <h3>RDM</h3>
            <div className="field wide">
              <span className="field-label">Universo Art-Net</span>
              <div className="device-row">
                <input
                  className="input mono"
                  style={{ width: 100 }}
                  value={rdmUniverse}
                  onChange={(event) =>
                    setRdmUniverse(Math.max(0, Math.min(32767, toNumber(event.target.value, 0))))
                  }
                />
                <button className="btn" disabled={rdmBusy} onClick={() => void discoverRdm()}>
                  {rdmBusy ? 'Buscando…' : 'Buscar dispositivos'}
                </button>
              </div>
              <span className="field-hint">
                Pide la tabla de dispositivos (TOD) al nodo Art-Net y lee etiqueta, modo y dirección
                por RDM. Requiere un nodo o gateway con RDM y que el destino Art-Net sea el correcto.
              </span>
            </div>
            {rdmDevices.length > 0 && (
              <div className="rdm-list">
                {rdmDevices.map((device) => (
                  <div className="rdm-item" key={device.uid}>
                    <div className="rdm-info">
                      <span className="rdm-label">{device.label}</span>
                      <span className="rdm-meta mono">
                        {device.uid} · {device.host}
                      </span>
                      <span className="rdm-meta">
                        {device.footprint > 0
                          ? `${device.footprint} canales · modo ${device.personality || 1}`
                          : 'Sin datos del modelo'}
                      </span>
                    </div>
                    <div className="rdm-set">
                      <input
                        className="input mono"
                        style={{ width: 72 }}
                        value={rdmAddresses[device.uid] ?? ''}
                        onChange={(event) =>
                          setRdmAddresses((map) => ({ ...map, [device.uid]: event.target.value }))
                        }
                      />
                      <button className="btn small" onClick={() => void applyAddress(device)}>
                        Dirección
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="insp-section">
            <h3>Show actual</h3>
            <div className="field wide">
              <span className="field-label">Archivo</span>
              <span className="file-path mono">{path ?? 'Sin guardar (borrador automático)'}</span>
            </div>
          </section>

          <section className="insp-section">
            <h3>Ayuda</h3>
            <button
              className="btn"
              onClick={() => {
                close(false)
                openShortcuts(true)
              }}
            >
              Ver atajos de teclado
            </button>
            <div className="field-hint" style={{ marginTop: 10 }}>
              ShowCue {api.version} · {api.platform}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
