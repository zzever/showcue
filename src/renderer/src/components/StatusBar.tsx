import { api } from '../lib/bridge'
import { useShowStore } from '../lib/store'
import { formatClock } from '../lib/format'

interface Props {
  runningCount: number
  showElapsed: number | null
  hotkeysEnabled: boolean
}

function shortenPath(path: string): string {
  if (path.length <= 46) return path
  return `…${path.slice(path.length - 45)}`
}

export default function StatusBar({ runningCount, showElapsed, hotkeysEnabled }: Props): JSX.Element {
  const cues = useShowStore((state) => state.cues)
  const path = useShowStore((state) => state.path)
  const missing = useShowStore((state) => state.missing)

  const missingCount = Object.values(missing).filter((exists) => exists === false).length

  return (
    <footer className="statusbar">
      <span className="status-item">
        <strong className="mono">{cues.length}</strong> cues
      </span>
      <span className="status-sep" />
      <span className={`status-item ${runningCount > 0 ? 'live' : ''}`}>
        {runningCount > 0 ? `${runningCount} en reproducción` : 'en reposo'}
      </span>
      {showElapsed !== null && (
        <>
          <span className="status-sep" />
          <span className="status-item mono">{formatClock(showElapsed)}</span>
        </>
      )}
      {missingCount > 0 && (
        <>
          <span className="status-sep" />
          <span className="status-item warn">{missingCount} archivo(s) no encontrado(s)</span>
        </>
      )}

      <span className="status-spacer" />

      {hotkeysEnabled ? (
        <span className="status-hints">
          <kbd>Espacio</kbd> GO
          <span className="status-sep" />
          <kbd>Esc</kbd> stop all
          <span className="status-sep" />
          <kbd>↑</kbd>
          <kbd>↓</kbd> espera
          <span className="status-sep" />
          <kbd>Ctrl</kbd>+<kbd>Z</kbd> deshacer
        </span>
      ) : (
        <span className="status-item warn" title="Sólo Esc (pánico) y Ctrl+Alt+H responden">
          atajos bloqueados · Ctrl+Alt+H para activar
        </span>
      )}

      <span className="status-sep" />
      <span className="status-path mono" title={path ?? 'Show sin guardar'}>
        {path ? shortenPath(path) : 'sin guardar'}
      </span>
      <span className="status-sep" />
      <span className="status-item muted mono">v{api.version}</span>
    </footer>
  )
}
