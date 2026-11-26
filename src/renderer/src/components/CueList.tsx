import { useMemo, useState } from 'react'
import type { Cue } from '@shared/types'
import { ALL_LISTS, useShowStore } from '../lib/store'
import { player } from '../lib/player'
import type { RunView } from '../lib/player'
import { cueByIdMap, cueDuration, formatClock, targetNames } from '../lib/format'
import { cueTypeLabel } from '../lib/cues'
import { allTags, tagColor } from '../lib/tags'

interface Props {
  runs: Record<string, RunView>
  onGo: (id: string) => void
  onStop: (id: string) => void
}

interface RowProps {
  cue: Cue
  duration: number
  selected: boolean
  standby: boolean
  run: RunView | undefined
  missing: boolean
  targets: string
  onSelect: (id: string) => void
  onGo: (id: string) => void
  onStop: (id: string) => void
}

function timeCell(value: number): string {
  if (!Number.isFinite(value)) return '∞'
  if (value <= 0) return '—'
  return formatClock(value)
}

function CueRow({
  cue,
  duration,
  selected,
  standby,
  run,
  missing,
  targets,
  onSelect,
  onGo,
  onStop
}: RowProps): JSX.Element {
  const active = !!run
  const progress = run ? Math.round(run.progress * 1000) / 10 : 0
  const remaining = run ? (run.pending ? `−${formatClock(run.remaining)}` : formatClock(run.remaining)) : ''

  return (
    <div
      className={[
        'cue-row',
        `cue-type-${cue.type}`,
        selected ? 'is-selected' : '',
        standby ? 'is-standby' : '',
        active ? 'is-active' : '',
        run?.pending ? 'is-pending' : '',
        missing ? 'is-missing' : '',
        cue.armed === false ? 'is-disarmed' : '',
        run?.paused ? 'is-paused' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={() => onSelect(cue.id)}
      onDoubleClick={() => onGo(cue.id)}
    >
      <div className="cell cell-num">
        <span className="num-text">{cue.number}</span>
        <span className="row-actions">
          <button
            className="mini-btn mini-go"
            onClick={(event) => {
              event.stopPropagation()
              onGo(cue.id)
            }}
            title="Ejecutar este cue"
          >
            ▶
          </button>
          {active && (
            <button
              className="mini-btn mini-stop"
              onClick={(event) => {
                event.stopPropagation()
                onStop(cue.id)
              }}
              title="Detener"
            >
              ■
            </button>
          )}
          {active && (
            <button
              className="mini-btn"
              onClick={(event) => {
                event.stopPropagation()
                player.togglePause(cue.id)
              }}
              title="Pausar/reanudar"
            >
              ⏸
            </button>
          )}
        </span>
      </div>

      <div className="cell cell-type">
        <span className={`type-chip t-${cue.type}`}>{cueTypeLabel(cue.type)}</span>
      </div>

      <div className="cell cell-name">
        <div className="name-line">
          {standby && <span className="standby-mark" title="En espera">▶</span>}
          <span className="cue-name">{cue.name || 'Sin nombre'}</span>
          {cue.hotkey && (
            <span className="hotkey-badge" title="Atajo de teclado">
              {cue.hotkey}
            </span>
          )}
          {missing && (
            <span className="missing-mark" title="El archivo no se encuentra">
              !
            </span>
          )}
          {(cue.tags ?? []).map((tag) => (
            <span
              key={tag}
              className="tag-chip small"
              style={{ color: tagColor(tag), borderColor: `${tagColor(tag)}44` }}
            >
              {tag}
            </span>
          ))}
        </div>
        {cue.notes && <div className="cue-notes">{cue.notes}</div>}
      </div>

      <div className="cell cell-target mono">{targets}</div>
      <div className="cell cell-time mono">{cue.preWait > 0 ? formatClock(cue.preWait) : '—'}</div>
      <div className={`cell cell-time mono ${active ? 'live' : ''}`}>
        {active ? remaining : timeCell(duration)}
      </div>
      <div className="cell cell-time mono">{cue.postWait > 0 ? formatClock(cue.postWait) : '—'}</div>
      <div className="cell cell-auto">
        {cue.autoContinue && (
          <span className="auto-flag" title="Continúa automáticamente">
            ⟶
          </span>
        )}
      </div>

      {run && (
        <div className="row-progress">
          <span style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  )
}

export default function CueList({ runs, onGo, onStop }: Props): JSX.Element {
  const cues = useShowStore((state) => state.cues)
  const selectedId = useShowStore((state) => state.selectedId)
  const standbyId = useShowStore((state) => state.standbyId)
  const missing = useShowStore((state) => state.missing)
  const select = useShowStore((state) => state.select)
  const setStandby = useShowStore((state) => state.setStandby)
  const activeList = useShowStore((state) => state.activeList)
  const setActiveList = useShowStore((state) => state.setActiveList)
  const updateCue = useShowStore((state) => state.updateCue)
  const trash = useShowStore((state) => state.trash)
  const restoreLast = useShowStore((state) => state.restoreLast)
  const toast = useShowStore((state) => state.toast)
  const [search, setSearch] = useState('')
  const [activeTags, setActiveTags] = useState<string[]>([])
  const [expanded, setExpanded] = useState<string[]>([])

  const byId = useMemo(() => cueByIdMap(cues), [cues])
  const tags = useMemo(() => allTags(cues), [cues])
  const lists = useMemo(() => {
    const set = new Set<string>([''])
    for (const cue of cues) set.add(cue.list ?? '')
    return [...set].sort((a, b) => {
      if (a === '') return -1
      if (b === '') return 1
      return a.localeCompare(b, 'es')
    })
  }, [cues])

  // Permite mover la espera con las flechas aunque el foco esté en el buscador.
  const stepStandby = (delta: number): void => {
    if (cues.length === 0) return
    const current = cues.findIndex((cue) => cue.id === standbyId)
    const base = current === -1 ? (delta > 0 ? -1 : cues.length) : current
    const next = Math.min(cues.length - 1, Math.max(0, base + delta))
    setStandby(cues[next].id)
    select(cues[next].id)
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return cues.filter((cue) => {
      if (activeList !== ALL_LISTS && (cue.list ?? '') !== activeList) return false
      if (activeTags.length > 0) {
        const cueTags = cue.tags ?? []
        if (!activeTags.some((tag) => cueTags.includes(tag))) return false
      }
      if (!q) return true
      const hay = [cue.number, cue.name, cue.notes, cue.type, (cue.tags ?? []).join(' '), targetNames(cue, byId)]
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [cues, search, byId, activeTags, activeList])

  return (
    <section className="list-pane">
      <div className="list-tabs" role="tablist" aria-label="Sub-listas">
        <button
          type="button"
          role="tab"
          aria-selected={activeList === ALL_LISTS}
          className={`list-tab ${activeList === ALL_LISTS ? 'on' : ''}`}
          onClick={() => setActiveList(ALL_LISTS)}
        >
          Todas<span className="list-tab-count mono">{cues.length}</span>
        </button>
        {lists.map((list) => {
          const count = cues.filter((cue) => (cue.list ?? '') === list).length
          return (
            <button
              key={list || 'main'}
              type="button"
              role="tab"
              aria-selected={activeList === list}
              className={`list-tab ${activeList === list ? 'on' : ''}`}
              onClick={() => setActiveList(list)}
              title={list ? `Lista «${list}»` : 'Lista principal'}
            >
              {list || 'Principal'}
              <span className="list-tab-count mono">{count}</span>
            </button>
          )
        })}
      </div>

      <div className="list-toolbar">
        <input
          className="input"
          placeholder="Buscar cues…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              stepStandby(-1)
            } else if (event.key === 'ArrowDown') {
              event.preventDefault()
              stepStandby(1)
            } else if (event.key === 'Escape') {
              event.currentTarget.blur()
            }
          }}
        />
        {trash.length > 0 && (
          <button
            className="btn tiny ghost"
            title={`Recuperar el último cue eliminado (${trash.length} en la papelera)`}
            onClick={() => {
              const cue = restoreLast()
              if (cue) toast(`Cue recuperado: ${cue.number} · ${cue.name}`, 'success')
            }}
          >
            ↺ {trash.length}
          </button>
        )}
        <span className="list-count mono">
          {filtered.length}/{cues.length}
        </span>
      </div>
      {tags.length > 0 && (
        <div className="tag-filter">
          {tags.map((tag) => {
            const active = activeTags.includes(tag)
            return (
              <button
                key={tag}
                type="button"
                className={`tag-chip filter ${active ? 'on' : ''}`}
                style={{ color: tagColor(tag), borderColor: active ? tagColor(tag) : `${tagColor(tag)}44` }}
                onClick={() =>
                  setActiveTags((prev) =>
                    prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag]
                  )
                }
                title={active ? 'Quitar filtro' : 'Filtrar por esta etiqueta'}
              >
                {tag}
              </button>
            )
          })}
          {activeTags.length > 0 && (
            <button
              type="button"
              className="tag-clear"
              onClick={() => setActiveTags([])}
              title="Quitar todos los filtros"
            >
              ✕
            </button>
          )}
        </div>
      )}
      <div className="list-head cue-grid">
        <div className="cell cell-num">#</div>
        <div className="cell cell-type">Tipo</div>
        <div className="cell cell-name">Cue</div>
        <div className="cell cell-target">Destino</div>
        <div className="cell cell-time">Pre</div>
        <div className="cell cell-time">Duración</div>
        <div className="cell cell-time">Post</div>
        <div className="cell cell-auto" />
      </div>

      <div className="list-body">
        {filtered.length === 0 && (
          <div className="empty-state">
            <div className="empty-mark">
              <svg viewBox="0 0 48 48" width="54" height="54" aria-hidden>
                <rect x="6" y="9" width="36" height="8" rx="4" fill="currentColor" opacity="0.16" />
                <rect x="6" y="21" width="36" height="8" rx="4" fill="currentColor" opacity="0.1" />
                <rect x="6" y="33" width="24" height="8" rx="4" fill="currentColor" opacity="0.07" />
              </svg>
            </div>
            <h2>{search ? 'Sin resultados' : 'Tu lista de cues está vacía'}</h2>
            <p className="muted">
              {search
                ? 'Prueba con otro término de búsqueda.'
                : 'Usa + Nuevo cue o arrastra archivos de audio, video e imágenes sobre esta ventana. Pulsa Espacio para ejecutar el cue en espera.'}
            </p>
          </div>
        )}

        {filtered.map((cue) => {
          const duration = cueDuration(cue, byId)
          const filePath = cue.type === 'audio' || cue.type === 'video' ? cue.filePath : ''
          const isGroup = cue.type === 'group'
          const open = isGroup && expanded.includes(cue.id)
          return (
            <div
              key={cue.id}
              className="cue-drag-wrap"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData('text/cue-id', cue.id)
                event.dataTransfer.effectAllowed = 'link'
              }}
              onDragOver={
                isGroup
                  ? (event) => {
                      if (!event.dataTransfer.types.includes('text/cue-id')) return
                      event.preventDefault()
                      event.dataTransfer.dropEffect = 'link'
                    }
                  : undefined
              }
              onDrop={
                isGroup
                  ? (event) => {
                      event.preventDefault()
                      const droppedId = event.dataTransfer.getData('text/cue-id')
                      if (!droppedId || droppedId === cue.id) return
                      if (cue.type !== 'group') return
                      if (cue.members.some((member) => member.cueId === droppedId)) return
                      updateCue(cue.id, {
                        members: [...cue.members, { cueId: droppedId, delay: 0 }]
                      })
                      setExpanded((prev) => (prev.includes(cue.id) ? prev : [...prev, cue.id]))
                    }
                  : undefined
              }
            >
              <CueRow
                cue={cue}
                duration={duration}
                selected={selectedId === cue.id}
                standby={standbyId === cue.id}
                run={runs[cue.id]}
                missing={!!filePath && missing[filePath] === false}
                targets={targetNames(cue, byId)}
                onSelect={(id) => {
                  select(id)
                  setStandby(id)
                }}
                onGo={onGo}
                onStop={onStop}
              />

              {isGroup && (
                <div className="group-children">
                  <button
                    type="button"
                    className="group-toggle"
                    onClick={(event) => {
                      event.stopPropagation()
                      setExpanded((prev) =>
                        prev.includes(cue.id)
                          ? prev.filter((id) => id !== cue.id)
                          : [...prev, cue.id]
                      )
                    }}
                  >
                    {open ? '▾' : '▸'} {cue.members.length} miembro(s)
                  </button>
                  {open &&
                    cue.members.map((member) => {
                      const child = byId.get(member.cueId)
                      return (
                        <div className="group-child" key={member.cueId}>
                          <span className="mono group-child-num">
                            {child?.number ?? '?'}
                          </span>
                          <span className="group-child-name">{child?.name ?? 'Cue eliminado'}</span>
                          {member.delay > 0 && (
                            <span className="mono group-child-delay">+{member.delay}s</span>
                          )}
                        </div>
                      )
                    })}
                  {open && cue.members.length === 0 && (
                    <div className="group-child muted">Arrastra cues aquí para añadirlos</div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
