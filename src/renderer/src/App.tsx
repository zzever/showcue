import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent } from 'react'
import type { Cue, CueType, MediaFile } from '@shared/types'
import { api, isDesktop } from './lib/bridge'
import { getStore, showFromStore, useShowStore } from './lib/store'
import { player, type RunView } from './lib/player'
import { loadBuffer, setMasterLevel, unlockAudio } from './lib/audio'
import { baseName, kindForPath, mediaUrl, probeDuration } from './lib/media'
import { configureTriggers, disableMidi, enableMidi, handleHotkey, rebuildTriggerMaps } from './lib/triggers'
import { toggleHotkeys } from './lib/settings'
import { cuesToCsv } from './lib/csv'
import TopBar from './components/TopBar'
import CueList from './components/CueList'
import Inspector from './components/Inspector'
import StatusBar from './components/StatusBar'
import Toasts from './components/Toasts'
import SettingsDialog from './components/SettingsDialog'
import ShortcutsDialog from './components/ShortcutsDialog'

export default function App(): JSX.Element {
  const [ready, setReady] = useState(false)
  const [runs, setRuns] = useState<Record<string, RunView>>({})
  const [dragging, setDragging] = useState(false)
  const [showElapsed, setShowElapsed] = useState<number | null>(null)
  const showStartRef = useRef<number | null>(null)

  const title = useShowStore((state) => state.title)
  const cues = useShowStore((state) => state.cues)
  const masterVolume = useShowStore((state) => state.masterVolume)
  const settingsOpen = useShowStore((state) => state.settingsOpen)
  const shortcutsOpen = useShowStore((state) => state.shortcutsOpen)
  const standbyId = useShowStore((state) => state.standbyId)
  const hotkeysEnabled = useShowStore((state) => state.settings.hotkeysEnabled !== false)
  const midiEnabled = useShowStore((state) => state.settings.midiEnabled !== false)

  const dragDepth = useRef(0)

  // ------------------------------------------------------------ motor de audio
  useEffect(() => {
    player.configure({
      getCue: (id) => getStore().cues.find((cue) => cue.id === id),
      allCues: () => getStore().cues,
      onAutoContinue: (cueId) => {
        const state = getStore()
        const index = state.cues.findIndex((cue) => cue.id === cueId)
        const next = index >= 0 ? state.cues[index + 1] : undefined
        if (!next) return
        state.setStandby(next.id)
        player.go(next)
      },
      onError: (message) => getStore().toast(message, 'error'),
      onCueGo: (cue) => {
        void api.notifyCue({ number: cue.number, name: cue.name, type: cue.type }, 'go')
      },
      onPanic: () => {
        void api.notifyCue({ number: '', name: '', type: '' }, 'panic')
      }
    })
    configureTriggers({
      getCue: (id) => getStore().cues.find((cue) => cue.id === id),
      allCues: () => getStore().cues
    })
    const unsubscribe = player.subscribe(setRuns)
    return unsubscribe
  }, [])

  useEffect(() => {
    setMasterLevel(masterVolume)
  }, [masterVolume])

  useEffect(() => {
    const tick = (): void => {
      if (showStartRef.current === null) return
      setShowElapsed((performance.now() - showStartRef.current) / 1000)
    }
    const id = window.setInterval(tick, 1000)
    tick()
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (!midiEnabled) {
      disableMidi()
      return
    }
    void enableMidi().catch(() => undefined)
  }, [midiEnabled])

  useEffect(() => {
    const unlock = (): void => {
      void unlockAudio()
    }
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  // ------------------------------------------------------------------ arranque
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const data = await api.startup()
        if (!alive) return
        getStore().setSettings(data.settings)
        if (data.show) getStore().loadShow(data.show, data.path)
        setMasterLevel(getStore().masterVolume)
      } catch (err) {
        getStore().toast(`No se pudo cargar el show: ${(err as Error).message}`, 'error')
      } finally {
        if (alive) setReady(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  // ------------------------------------------------------------------- guardado
  const autosave = useCallback(async () => {
    const state = getStore()
    const json = JSON.stringify(showFromStore(), null, 2)
    await api.saveDraft(json)
    if (!state.path) {
      state.setSaveState('draft')
      return
    }
    state.setSaveState('saving')
    const ok = await api.writeShow(state.path, json)
    state.setSaveState(ok ? 'saved' : 'error')
    if (!ok) state.toast('No se pudo guardar el show', 'error')
  }, [])

  useEffect(() => {
    if (!ready) return
    const timer = window.setTimeout(() => {
      void autosave()
    }, 800)
    return () => window.clearTimeout(timer)
  }, [title, cues, masterVolume, ready, autosave])

  const saveShowAs = useCallback(async () => {
    const state = getStore()
    const json = JSON.stringify(showFromStore(), null, 2)
    state.setSaveState('saving')
    const path = await api.saveShow(state.path, json)
    if (!path) {
      state.setSaveState(state.path ? 'saved' : 'draft')
      return
    }
    state.setPath(path)
    state.setSaveState('saved')
    state.toast(`Show guardado en ${path}`, 'success')
  }, [])

  const saveNow = useCallback(async () => {
    const state = getStore()
    if (!state.path) {
      await saveShowAs()
      return
    }
    const json = JSON.stringify(showFromStore(), null, 2)
    state.setSaveState('saving')
    const ok = await api.writeShow(state.path, json)
    state.setSaveState(ok ? 'saved' : 'error')
  }, [saveShowAs])

  const exportCsv = useCallback(async () => {
    const state = getStore()
    const csv = cuesToCsv(state.cues)
    const path = await api.exportCueList(state.title || 'show', csv)
    if (!path) return
    state.toast(`Lista exportada en ${path}`, 'success')
  }, [])

  const saveCopy = useCallback(async () => {
    const state = getStore()
    const json = JSON.stringify(showFromStore(), null, 2)
    await api.saveDraft(json)
    const path = await api.saveShow(null, json)
    if (!path) return
    state.setPath(path)
    state.setSaveState('saved')
    state.toast(`Copia guardada en ${path}`, 'success')
  }, [])

  // ------------------------------------------------------------- archivos faltantes
  useEffect(() => {
    const paths = cues
      .map((cue) => (cue.type === 'audio' || cue.type === 'video' ? cue.filePath : ''))
      .filter((path): path is string => !!path)
    if (paths.length === 0) {
      getStore().setMissing({})
      return
    }
    let alive = true
    void api.fileStatus([...new Set(paths)]).then((status) => {
      if (alive) getStore().setMissing(status)
    })
    return () => {
      alive = false
    }
  }, [cues])

  // ------------------------------------------------------------ precarga del GO
  useEffect(() => {
    const cue = cues.find((candidate) => candidate.id === standbyId)
    if (cue?.type === 'audio' && cue.filePath) {
      void loadBuffer(cue.filePath).catch(() => undefined)
    }
  }, [standbyId, cues])

  // ----------------------------------------------------- mapas de disparo (teclas/MIDI)
  useEffect(() => {
    rebuildTriggerMaps(cues)
  }, [cues])

  // ------------------------------------------------------------------ transporte
  const go = useCallback((targetId?: string | null) => {
    void unlockAudio()
    if (showStartRef.current === null) showStartRef.current = performance.now()
    const state = getStore()
    const id = targetId ?? state.standbyId
    const cue = state.cues.find((candidate) => candidate.id === id)
    if (!cue) {
      state.toast('No hay ningún cue en espera', 'info')
      return
    }
    player.go(cue)
    state.select(cue.id)
    const index = state.cues.findIndex((candidate) => candidate.id === cue.id)
    state.setStandby(state.cues[index + 1]?.id ?? null)
  }, [])

  const panic = useCallback(() => {
    player.stopAll(0.12)
  }, [])

  // -------------------------------------------------------------- OSC entrante
  useEffect(() => {
    return api.onOscTrigger((trigger) => {
      const state = getStore()
      if (trigger.action === 'panic') {
        panic()
        return
      }
      const number = trigger.number.trim()
      if (!number) {
        state.toast('OSC: el mensaje no indica número de cue', 'error')
        return
      }
      const cue = state.cues.find((candidate) => candidate.number.trim() === number)
      if (!cue) {
        state.toast(`OSC: no hay ningún cue con el número "${number}"`, 'error')
        return
      }
      go(cue.id)
    })
  }, [go, panic])

  const step = useCallback((delta: number) => {
    const state = getStore()
    if (state.cues.length === 0) return
    const current = state.cues.findIndex((cue) => cue.id === state.standbyId)
    const base = current === -1 ? (delta > 0 ? -1 : state.cues.length) : current
    const next = Math.min(state.cues.length - 1, Math.max(0, base + delta))
    state.setStandby(state.cues[next].id)
    state.select(state.cues[next].id)
  }, [])

  const stopCue = useCallback((id: string) => {
    player.stopCue(id, 0.15)
  }, [])

  // --------------------------------------------------------------------- añadir
  const addCue = useCallback((type: CueType) => {
    const cue = getStore().addCue(type)
    if (!getStore().standbyId) getStore().setStandby(cue.id)
  }, [])

  const addFiles = useCallback(async (files: MediaFile[]) => {
    if (files.length === 0) return
    const created = getStore().addMedia(files)
    for (const cue of created) {
      if (cue.type !== 'audio' && cue.type !== 'video') continue
      const duration = await probeDuration(
        mediaUrl(cue.filePath),
        cue.type === 'audio' ? 'audio' : 'video'
      )
      if (duration > 0) getStore().updateCue(cue.id, { mediaDuration: duration })
    }
  }, [])

  const importMedia = useCallback(async () => {
    if (!isDesktop) {
      getStore().toast('En el navegador arrastra archivos sobre la ventana', 'info')
      return
    }
    const files = await api.pickMedia()
    await addFiles(files)
  }, [addFiles])

  // ------------------------------------------------------------------- archivos
  const openShow = useCallback(async () => {
    const result = await api.openShow()
    if (!result) return
    player.stopAll(0)
    showStartRef.current = null
    setShowElapsed(null)
    getStore().loadShow(result.show, result.path)
    await api.saveSettings({ ...getStore().settings, lastShowPath: result.path })
    getStore().toast(`Show abierto: ${result.show.title}`, 'success')
  }, [])

  const newShow = useCallback(() => {
    player.stopAll(0)
    showStartRef.current = null
    setShowElapsed(null)
    getStore().newShow()
  }, [])

  const openOutput = useCallback(() => {
    void api.ensureOutput()
    getStore().setOutputOpen(true)
  }, [])

  const toggleFullscreen = useCallback(() => {
    void api.toggleOutputFullscreen()
  }, [])

  // -------------------------------------------------------------------- teclado
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      const typing =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)

      // El bloqueo/desbloqueo de atajos siempre responde, incluso bloqueado.
      if ((event.ctrlKey || event.metaKey) && event.altKey && event.key.toLowerCase() === 'h') {
        event.preventDefault()
        toggleHotkeys()
        return
      }

      if (event.key === 'Escape') {
        const state = getStore()
        if (state.settingsOpen) {
          state.setSettingsOpen(false)
          return
        }
        if (state.shortcutsOpen) {
          state.setShortcutsOpen(false)
          return
        }
        if (typing) {
          target?.blur()
          return
        }
        event.preventDefault()
        panic()
        return
      }

      // Pánico y cierre de diálogos siguen activos; el resto se puede bloquear.
      if (getStore().settings.hotkeysEnabled === false) return

      if (typing) return

      if (event.code === 'Space' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault()
        if (!event.repeat) go()
        return
      }

      // Atajos de disparo por cue (teclado).
      if (handleHotkey(event)) return

      // Pausa/reanudación del cue en ejecución.
      if (event.key.toLowerCase() === 'p' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const running = Object.keys(runs)
        if (running.length > 0) {
          event.preventDefault()
          const id = running[0]
          player.togglePause(id)
          return
        }
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) getStore().redo()
        else getStore().undo()
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        getStore().redo()
        return
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        step(1)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        step(-1)
        return
      }
      if (event.key === 'Delete') {
        const id = getStore().selectedId
        if (id) {
          event.preventDefault()
          getStore().removeCue(id)
        }
        return
      }
      if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) {
        if (getStore().selectedId && document.activeElement === document.body) {
          event.preventDefault()
          go(getStore().selectedId)
        }
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, panic, step, runs])

  // ---------------------------------------------------------------------- menú
  const actions = useRef({ go, panic, openShow, newShow, saveNow, saveCopy, importMedia, addCue, exportCsv })
  actions.current = { go, panic, openShow, newShow, saveNow, saveCopy, importMedia, addCue, exportCsv }

  useEffect(() => {
    return api.onMenu((command) => {
      const state = getStore()
      const current = actions.current
      switch (command) {
        case 'new':
          current.newShow()
          break
        case 'open':
          void current.openShow()
          break
        case 'save':
          void current.saveNow()
          break
        case 'save-as':
          void current.saveCopy()
          break
        case 'go':
          current.go()
          break
        case 'panic':
          current.panic()
          break
        case 'add-audio':
          void current.importMedia()
          break
        case 'add-wait':
          current.addCue('wait')
          break
        case 'add-group':
          current.addCue('group')
          break
        case 'add-dmx':
          current.addCue('dmx')
          break
        case 'undo':
          state.undo()
          break
        case 'redo':
          state.redo()
          break
        case 'toggle-hotkeys':
          toggleHotkeys()
          break
        case 'export-csv':
          void current.exportCsv()
          break
        case 'duplicate':
          if (state.selectedId) state.duplicateCue(state.selectedId)
          break
        case 'delete':
          if (state.selectedId) state.removeCue(state.selectedId)
          break
        case 'output':
          openOutput()
          break
        case 'output-fullscreen':
          toggleFullscreen()
          break
        case 'shortcuts':
          state.setShortcutsOpen(true)
          break
      }
    })
  }, [openOutput, toggleFullscreen])

  useEffect(() => {
    return api.onOutputClosed(() => getStore().setOutputOpen(false))
  }, [])

  // --------------------------------------------------------------- arrastrar/soltar
  const onDragEnter = (event: ReactDragEvent): void => {
    event.preventDefault()
    dragDepth.current += 1
    setDragging(true)
  }

  const onDragLeave = (event: ReactDragEvent): void => {
    event.preventDefault()
    dragDepth.current -= 1
    if (dragDepth.current <= 0) {
      dragDepth.current = 0
      setDragging(false)
    }
  }

  const onDrop = async (event: ReactDragEvent): Promise<void> => {
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    const files: MediaFile[] = []
    for (const file of Array.from(event.dataTransfer.files)) {
      const nativePath = api.getPathForFile(file)
      const kind = kindForPath(file.name) ?? (nativePath ? kindForPath(nativePath) : null)
      if (!kind) continue
      if (isDesktop && !nativePath) continue
      files.push({ path: nativePath || URL.createObjectURL(file), name: baseName(file.name), kind })
    }
    if (files.length > 0) await addFiles(files)
  }

  const runningCount = Object.keys(runs).length
  const standby: Cue | undefined = cues.find((cue) => cue.id === standbyId)

  return (
    <div
      className={`app ${dragging ? 'is-dragging' : ''}`}
      onDragEnter={onDragEnter}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <TopBar
        onGo={() => go()}
        onPanic={panic}
        onStep={step}
        onAdd={addCue}
        onImport={importMedia}
        onNew={newShow}
        onOpen={openShow}
        onSave={saveNow}
        onOpenOutput={openOutput}
        runningCount={runningCount}
        standby={standby}
        hotkeysEnabled={hotkeysEnabled}
        onToggleHotkeys={toggleHotkeys}
      />

      <main className="workspace">
        <CueList runs={runs} onGo={(id) => go(id)} onStop={stopCue} />
        <Inspector />
      </main>

      <StatusBar runningCount={runningCount} showElapsed={showElapsed} hotkeysEnabled={hotkeysEnabled} />

      <Toasts />
      {settingsOpen && <SettingsDialog />}
      {shortcutsOpen && <ShortcutsDialog />}

      {dragging && (
        <div className="drop-overlay">
          <div className="drop-card">
            <div className="drop-icon">＋</div>
            <div>Suelta los archivos para crear cues</div>
            <div className="muted">Audio, video o imágenes</div>
          </div>
        </div>
      )}
    </div>
  )
}
