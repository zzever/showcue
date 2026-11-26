import { useShowStore } from '../lib/store'

const SHORTCUTS: { keys: string[]; action: string }[] = [
  { keys: ['Espacio'], action: 'Ejecutar el cue en espera (GO)' },
  { keys: ['Esc'], action: 'Detener todo (pánico)' },
  { keys: ['↑'], action: 'Cue en espera anterior' },
  { keys: ['↓'], action: 'Siguiente cue en espera' },
  { keys: ['Enter'], action: 'Ejecutar el cue seleccionado' },
  { keys: ['Doble clic'], action: 'Ejecutar el cue de la fila' },
  { keys: ['Supr'], action: 'Eliminar el cue seleccionado' },
  { keys: ['Ctrl', 'Z'], action: 'Deshacer' },
  { keys: ['Ctrl', 'Shift', 'Z'], action: 'Rehacer' },
  { keys: ['P'], action: 'Pausar / reanudar el cue en curso' },
  { keys: ['Ctrl', 'Alt', 'H'], action: 'Bloquear / desbloquear los atajos de teclado' },
  { keys: ['Ctrl', 'S'], action: 'Guardar el show' },
  { keys: ['Ctrl', 'Shift', 'S'], action: 'Guardar una copia' },
  { keys: ['Ctrl', 'O'], action: 'Abrir un show' },
  { keys: ['Ctrl', 'N'], action: 'Nuevo show' },
  { keys: ['Ctrl', 'D'], action: 'Duplicar el cue seleccionado' },
  { keys: ['Ctrl', '4'], action: 'Añadir un cue DMX' },
  { keys: ['Ctrl', 'Shift', 'O'], action: 'Abrir la ventana de salida' },
  { keys: ['F11'], action: 'Pantalla completa de la salida' }
]

export default function ShortcutsDialog(): JSX.Element {
  const close = useShowStore((state) => state.setShortcutsOpen)

  return (
    <div className="modal-backdrop" onPointerDown={() => close(false)}>
      <div className="modal modal-narrow" onPointerDown={(event) => event.stopPropagation()}>
        <header className="modal-head">
          <h2>Atajos de teclado</h2>
          <button className="btn btn-icon" onClick={() => close(false)}>
            ✕
          </button>
        </header>
        <div className="modal-body">
          <ul className="shortcut-list">
            {SHORTCUTS.map((item) => (
              <li key={item.action}>
                <span className="keys">
                  {item.keys.map((key) => (
                    <kbd key={key}>{key}</kbd>
                  ))}
                </span>
                <span>{item.action}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
