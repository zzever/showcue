import { useEffect, useMemo, useState } from 'react'
import type { FixtureProfile, PatchFixture } from '@shared/types'
import { api } from '../lib/bridge'
import { useShowStore } from '../lib/store'
import { toNumber } from '../lib/format'

const uid = (): string => Math.random().toString(36).slice(2, 10)

/** Patch del proyecto: todos los fixtures con su universo y dirección DMX. */
export default function PatchDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const patch = useShowStore((state) => state.patch)
  const setPatch = useShowStore((state) => state.setPatch)
  const updatePatch = useShowStore((state) => state.updatePatch)
  const removePatch = useShowStore((state) => state.removePatch)
  const [fixtures, setFixtures] = useState<FixtureProfile[]>([])

  useEffect(() => {
    void api.listFixtures().then(setFixtures)
  }, [])

  const modesFor = useMemo(
    () => (fixtureId: string): FixtureProfile['modes'] =>
      fixtures.find((item) => item.id === fixtureId)?.modes ?? [],
    [fixtures]
  )

  const addEntry = (): void => {
    const fixture = fixtures[0]
    const mode = fixture?.modes[0]
    const used = new Set<number>()
    for (const item of patch) {
      for (let channel = 0; channel < item.channelCount; channel += 1) {
        used.add((item.universe << 9) | (item.startAddress + channel))
      }
    }
    let start = 1
    while ([...used].some((key) => key === ((0 << 9) | start))) start += 1
    const entry: PatchFixture = {
      id: uid(),
      label: fixture ? `${fixture.manufacturer} ${fixture.name}` : `Fixture ${patch.length + 1}`,
      fixtureId: fixture?.id ?? '',
      fixtureMode: mode?.name ?? '',
      universe: 0,
      startAddress: start,
      channelCount: mode?.channels.length ?? 1
    }
    setPatch([...patch, entry])
  }

  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div className="modal" onPointerDown={(event) => event.stopPropagation()}>
        <header className="modal-head">
          <h2>Patch de DMX</h2>
          <button className="btn btn-icon" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="modal-body">
          <section className="insp-section">
            <h3>Fixtures del proyecto</h3>
            <p className="field-hint">
              El patch se guarda con el show: cada fixture tiene su perfil, universo y dirección. Los
              cues DMX pueden colocarse desde aquí sin repetir los canales.
            </p>
            <div className="patch-list">
              {patch.length === 0 && (
                <div className="field-hint">
                  Todavía no hay fixtures. Importa perfiles .gdtf en el inspector de un cue DMX.
                </div>
              )}
              {patch.map((entry) => (
                <div className="patch-row" key={entry.id}>
                  <input
                    className="input"
                    value={entry.label}
                    onChange={(event) => updatePatch(entry.id, { label: event.target.value })}
                    aria-label="Nombre del fixture"
                  />
                  <select
                    className="input select"
                    value={entry.fixtureId}
                    onChange={(event) => {
                      const fixture = fixtures.find((item) => item.id === event.target.value)
                      const mode = fixture?.modes[0]
                      updatePatch(entry.id, {
                        fixtureId: event.target.value,
                        fixtureMode: mode?.name ?? '',
                        channelCount: mode?.channels.length ?? 1
                      })
                    }}
                  >
                    <option value="">Sin perfil</option>
                    {fixtures.map((fixture) => (
                      <option key={fixture.id} value={fixture.id}>
                        {fixture.manufacturer} · {fixture.name}
                      </option>
                    ))}
                  </select>
                  <select
                    className="input select"
                    value={entry.fixtureMode}
                    onChange={(event) => {
                      const mode = modesFor(entry.fixtureId).find(
                        (item) => item.name === event.target.value
                      )
                      updatePatch(entry.id, {
                        fixtureMode: event.target.value,
                        channelCount: mode?.channels.length ?? entry.channelCount
                      })
                    }}
                  >
                    <option value="">Modo…</option>
                    {modesFor(entry.fixtureId).map((mode) => (
                      <option key={mode.name} value={mode.name}>
                        {mode.name} · {mode.channels.length} ch
                      </option>
                    ))}
                  </select>
                  <label className="patch-mini">
                    U
                    <input
                      className="input mono"
                      inputMode="numeric"
                      value={entry.universe}
                      onChange={(event) =>
                        updatePatch(entry.id, {
                          universe: Math.max(0, Math.round(toNumber(event.target.value, 0)))
                        })
                      }
                    />
                  </label>
                  <label className="patch-mini">
                    Dir
                    <input
                      className="input mono"
                      inputMode="numeric"
                      value={entry.startAddress}
                      onChange={(event) =>
                        updatePatch(entry.id, {
                          startAddress: Math.max(
                            1,
                            Math.min(512, Math.round(toNumber(event.target.value, 1)))
                          )
                        })
                      }
                    />
                  </label>
                  <span className="mono patch-foot">
                    {entry.channelCount} ch → {entry.startAddress + entry.channelCount - 1}
                  </span>
                  <button
                    className="btn tiny ghost"
                    title="Quitar del patch"
                    onClick={() => removePatch(entry.id)}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <button className="btn small" onClick={addEntry}>
              + Añadir fixture
            </button>
          </section>
        </div>
      </div>
    </div>
  )
}
