import { useEffect, useRef, useState } from 'react'
import type { Cue, CueType } from '@shared/types'
import { useShowStore, type SaveState } from '../lib/store'
import { formatPercent, formatGainDb } from '../lib/format'
import { cueTypeLabel } from '../lib/cues'

interface Props {
  onGo: () => void
  onPanic: () => void
  onStep: (delta: number) => void
  onAdd: (type: CueType) => void
  onImport: () => void
  onNew: () => void
  onOpen: () => void
  onSave: () => void
  onOpenOutput: () => void
  runningCount: number
  standby: Cue | undefined
  hotkeysEnabled: boolean
  onToggleHotkeys: () => void
}

const SAVE_LABEL: Record<SaveState, string> = {
  saved: 'Guardado',
  saving: 'Guardando…',
  dirty: 'Sin guardar',
  draft: 'Borrador',
  error: 'Error al guardar'
}

const ADD_TYPES: { type: CueType; hint: string }[] = [
  { type: 'audio', hint: 'Reproduce un archivo de audio' },
  { type: 'video', hint: 'Video o imagen en la ventana de salida' },
  { type: 'group', hint: 'Dispara varios cues juntos' },
  { type: 'wait', hint: 'Pausa temporizada' },
  { type: 'fade', hint: 'Cambia el volumen de otros cues' },
  { type: 'stop', hint: 'Detiene otros cues' },
  { type: 'memo', hint: 'Nota para el operador' },
  { type: 'dmx', hint: 'Envía canales DMX por Art-Net' }
]

export default function TopBar({
  onGo,
  onPanic,
  onStep,
  onAdd,
  onImport,
  onNew,
  onOpen,
  onSave,
  onOpenOutput,
  runningCount,
  standby,
  hotkeysEnabled,
  onToggleHotkeys
}: Props): JSX.Element {
  const title = useShowStore((state) => state.title)
  const saveState = useShowStore((state) => state.saveState)
  const masterVolume = useShowStore((state) => state.masterVolume)
  const outputOpen = useShowStore((state) => state.outputOpen)
  const setTitle = useShowStore((state) => state.setTitle)
  const setMasterVolume = useShowStore((state) => state.setMasterVolume)
  const setSettingsOpen = useShowStore((state) => state.setSettingsOpen)
  const setShortcutsOpen = useShowStore((state) => state.setShortcutsOpen)

  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [menuOpen])

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark" aria-hidden>
          <svg viewBox="0 0 24 24" width="22" height="22">
            <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5z" fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.55" />
            <path d="M10 8.2v7.6l6-3.8z" fill="currentColor" />
          </svg>
        </div>
        <div className="brand-text">
          <div className="brand-name">ShowCue</div>
          <div className="brand-sub">Sistema de cues</div>
        </div>
      </div>

      <div className="show-title">
        <input
          className="show-title-input"
          value={title}
          spellCheck={false}
          onChange={(event) => setTitle(event.target.value)}
          aria-label="Nombre del show"
        />
        <div className={`save-flag is-${saveState}`}>
          <span className="dot" />
          {SAVE_LABEL[saveState]}
        </div>
      </div>

      <div className="top-actions">
        <div className="add-wrap" ref={menuRef}>
          <button className="btn btn-accent" onClick={() => setMenuOpen((open) => !open)}>
            <span className="plus">+</span> Nuevo cue
          </button>
          {menuOpen && (
            <div className="popover">
              <div className="popover-title">Tipo de cue</div>
              {ADD_TYPES.map((item) => (
                <button
                  key={item.type}
                  className="popover-item"
                  onClick={() => {
                    onAdd(item.type)
                    setMenuOpen(false)
                  }}
                >
                  <span className={`type-dot t-${item.type}`} />
                  <span className="popover-label">{cueTypeLabel(item.type)}</span>
                  <span className="popover-hint">{item.hint}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <button className="btn" onClick={onImport} title="Añadir archivos de audio, video o imagen">
          Importar
        </button>

        <div className="btn-group">
          <button className="btn btn-icon" onClick={onNew} title="Nuevo show (Ctrl+N)">
            Nuevo
          </button>
          <button className="btn btn-icon" onClick={onOpen} title="Abrir show (Ctrl+O)">
            Abrir
          </button>
          <button className="btn btn-icon" onClick={onSave} title="Guardar (Ctrl+S)">
            Guardar
          </button>
        </div>

        <button
          className={`btn ${outputOpen ? 'btn-live' : ''}`}
          onClick={onOpenOutput}
          title="Ventana de salida de video (Ctrl+Shift+O)"
        >
          <span className={`live-dot ${outputOpen ? 'on' : ''}`} />
          Salida
        </button>

        <button
          className={`btn btn-icon ${hotkeysEnabled ? '' : 'btn-warn'}`}
          onClick={onToggleHotkeys}
          title={
            hotkeysEnabled
              ? 'Bloquear atajos de teclado (Ctrl+Alt+H)'
              : 'Reactivar atajos de teclado (Ctrl+Alt+H)'
          }
          aria-pressed={!hotkeysEnabled}
        >
          ⌨
        </button>
        <button className="btn btn-icon" onClick={() => setSettingsOpen(true)} title="Ajustes">
          ⚙
        </button>
        <button className="btn btn-icon" onClick={() => setShortcutsOpen(true)} title="Atajos de teclado">
          ?
        </button>
      </div>

      <div className="transport">
        <button className="go-button" onClick={onGo} disabled={!standby}>
          <span className="go-main">GO</span>
          <span className="go-cue">{standby ? `${standby.number} · ${standby.name}` : 'Sin cue en espera'}</span>
          <span className="go-hint">espacio</span>
        </button>

        <div className="step-group">
          <button className="step-btn" onClick={() => onStep(-1)} title="Cue en espera anterior (↑)">
            ▲
          </button>
          <button className="step-btn" onClick={() => onStep(1)} title="Siguiente cue en espera (↓)">
            ▼
          </button>
        </div>

        <button className="panic-button" onClick={onPanic} title="Detener todo (Esc)">
          <span className="panic-icon" />
          <span>STOP ALL</span>
        </button>

        <div className="master">
          <div className="master-head">
            <span>Master</span>
            <span className="mono">{formatPercent(masterVolume)}</span>
          </div>
          <input
            className="slider"
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(masterVolume * 100)}
            onChange={(event) => setMasterVolume(Number(event.target.value) / 100)}
            aria-label="Volumen maestro"
          />
          <div className="master-db mono">{formatGainDb(masterVolume)}</div>
        </div>

        <div className={`running-chip ${runningCount > 0 ? 'on' : ''}`}>
          <span className="pulse" />
          {runningCount > 0 ? `${runningCount} en curso` : 'en reposo'}
        </div>
      </div>
    </header>
  )
}
