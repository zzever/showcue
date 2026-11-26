import { useShowStore } from '../lib/store'

export default function Toasts(): JSX.Element {
  const toasts = useShowStore((state) => state.toasts)
  const dismiss = useShowStore((state) => state.dismissToast)

  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.kind}`} onClick={() => dismiss(toast.id)}>
          <span className="toast-mark" />
          <span className="toast-text">{toast.text}</span>
          <span className="toast-close">×</span>
        </div>
      ))}
    </div>
  )
}
