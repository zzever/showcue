/**
 * Modelo de datos compartido entre el proceso principal, el preload y la interfaz.
 * El formato del show es JSON plano, versionado, para poder guardar/abrir archivos
 * independientes del equipo (Windows / Linux / macOS).
 */

export type CueType = 'audio' | 'video' | 'group' | 'wait' | 'stop' | 'fade' | 'memo' | 'dmx'

export interface CueBase {
  id: string
  /** Número visible, editable por el operador ("1", "12.5", "M1"...). */
  number: string
  name: string
  notes: string
  /** Segundos de espera antes de ejecutar el cue. */
  preWait: number
  /** Segundos de espera después de que el cue termina, antes del auto-avance. */
  postWait: number
  /** Si está activo, al terminar lanza automáticamente el cue siguiente. */
  autoContinue: boolean
  /** Si es false, GO ignora el cue (útil para variantes/encores). */
  armed: boolean
  /** Atajo de teclado que dispara este cue (ej. "F1", "Shift+3"). */
  hotkey: string
  /** Nota MIDI (0-127) que dispara este cue; -1 = sin asignar. */
  midiNote: number
  /** Canal MIDI (1-16) o 0 = cualquier canal. */
  midiChannel: number
}

export interface AudioCue extends CueBase {
  type: 'audio'
  filePath: string
  fileName: string
  /** Duración real del archivo en segundos (0 si no se pudo leer). */
  mediaDuration: number
  /** Ganancia lineal 0..1. */
  volume: number
  fadeIn: number
  fadeOut: number
  /** Recorte: inicio y fin en segundos (endTime 0 = hasta el final). */
  startTime: number
  endTime: number
  loop: boolean
  /** 0 = infinito, N = N repeticiones completas. */
  loopCount: number
  /** -1 izquierda .. 1 derecha. */
  pan: number
  rate: number
  /** deviceId de WebAudio; cadena vacía = salida predeterminada. */
  deviceId: string
  /** Curva del fade de entrada/salida. */
  fadeCurve: 'linear' | 'exponential' | 's' | 'log'
}

export interface VideoCue extends CueBase {
  type: 'video'
  filePath: string
  fileName: string
  mediaKind: 'video' | 'image'
  mediaDuration: number
  /** Pantalla donde se muestra ('' = ventana de salida principal). */
  displayId: string
  /** Salida de audio del video ('' = predeterminada del sistema). */
  deviceId: string
  /** Recorte: segundo del archivo donde empieza. */
  startTime: number
  /** Recorte: segundo del archivo donde termina (0 = final del archivo). */
  endTime: number
  /** 0 = usar todo el tramo recortado. */
  duration: number
  volume: number
  fadeIn: number
  fadeOut: number
  loop: boolean
  /** 0..1 */
  opacity: number
  fit: 'contain' | 'cover'
}

export interface GroupMember {
  cueId: string
  /** Retardo en segundos respecto del GO del grupo. */
  delay: number
}

export interface GroupCue extends CueBase {
  type: 'group'
  members: GroupMember[]
}

export interface WaitCue extends CueBase {
  type: 'wait'
  duration: number
}

export interface MemoCue extends CueBase {
  type: 'memo'
  duration: number
}

export interface StopCue extends CueBase {
  type: 'stop'
  targets: string[]
  fadeOut: number
}

export interface FadeCue extends CueBase {
  type: 'fade'
  targets: string[]
  /** Ganancia final 0..1. */
  volume: number
  duration: number
}

export interface DmxChannel {
  /** Canal DMX, 1..512 dentro del universo. */
  channel: number
  /** Valor final, 0..255. */
  value: number
  /** Etiqueta del canal (del fixture importado). */
  name?: string
}

export interface DmxCue extends CueBase {
  type: 'dmx'
  /** Universo Art-Net, 0..32767 (Art-Net empieza en 0). */
  universe: number
  channels: DmxChannel[]
  /** Segundos que tarda en alcanzar los valores (0 = cambio inmediato). */
  fade: number
  /** Perfil de fixture aplicado (librería DMX/GDTF). */
  fixtureId?: string
  fixtureMode?: string
  /** Dirección DMX inicial del fixture, 1..512. */
  startAddress?: number
}

// ---------------------------------------------------------------- librería DMX
export interface FixtureChannel {
  /** Desplazamiento dentro del modo, 1..512. */
  offset: number
  name: string
  attribute: string
}

export interface FixtureMode {
  name: string
  channels: FixtureChannel[]
}

export interface FixtureProfile {
  id: string
  name: string
  manufacturer: string
  modes: FixtureMode[]
  source: 'gdtf' | 'library'
  importedAt: number
}

export interface DisplayInfo {
  id: string
  label: string
  primary: boolean
  width: number
  height: number
  scaleFactor: number
}

export type Cue =
  | AudioCue
  | VideoCue
  | GroupCue
  | WaitCue
  | MemoCue
  | StopCue
  | FadeCue
  | DmxCue

export interface ShowFile {
  format: 'showcue'
  version: 1
  title: string
  masterVolume: number
  cues: Cue[]
}

export interface AppSettings {
  lastShowPath: string | null
  defaultFade: number
  defaultDeviceId: string
  /** Bloquea los atajos de teclado de disparo y navegación. */
  hotkeysEnabled: boolean
  /** Escucha entradas MIDI. */
  midiEnabled: boolean
  /** Envía cues DMX por Art-Net. */
  artnetEnabled: boolean
  /** Destino Art-Net (IP o dirección de broadcast). */
  artnetHost: string
  /** Envía mensajes OSC al disparar cues. */
  oscEnabled: boolean
  /** Destino OSC (gMA3, QLab, etc.). */
  oscHost: string
  /** Puerto UDP de destino OSC. */
  oscPort: number
  /** Escucha mensajes OSC para disparar cues. */
  oscListenEnabled: boolean
  /** Puerto UDP local para OSC de entrada. */
  oscListenPort: number
  /** Prefijo de las direcciones OSC (por defecto /showcue). */
  oscPrefix: string
  /** Además de las direcciones propias, envía /gma3/cmd a grandMA3. */
  oscGma3: boolean
}

export interface RdmDevice {
  /** UID RDM como "0x1234:0x56789abc". */
  uid: string
  /** Universo Art-Net en el que se encontró (0-based). */
  universe: number
  /** IP del nodo que lo anunció. */
  host: string
  label: string
  /** Dirección DMX inicial, 1..512. */
  startAddress: number
  /** Canales ocupados por el modo actual. */
  footprint: number
  /** Personalidad (modo) activa del fixture, 1-based. */
  personality: number
}

export type OscTrigger = { action: 'go'; number: string } | { action: 'panic' }

export interface MediaFile {
  path: string
  name: string
  kind: 'audio' | 'video' | 'image'
}

export interface StartupData {
  show: ShowFile | null
  path: string | null
  settings: AppSettings
}

export interface OutputPayload {
  /** Cue que posee la capa: permite superponer varias salidas a la vez. */
  cueId: string
  /** Pantalla de destino ('' = salida principal). */
  displayId: string
  /** Salida de audio del video ('' = predeterminada). */
  deviceId: string
  url: string
  kind: 'video' | 'image'
  volume: number
  loop: boolean
  /** Segundo del archivo donde empieza la reproducción. */
  startTime: number
  /** Segundo del archivo donde termina (0 = final del archivo). */
  endTime: number
  fadeIn: number
  fadeOut: number
  opacity: number
  fit: 'contain' | 'cover'
}

export type OutputEvent =
  | { type: 'show'; payload: OutputPayload }
  | { type: 'clear'; cueId: string; fadeOut: number }
  | { type: 'pause'; cueId: string }
  | { type: 'resume'; cueId: string }

export interface ShowCueApi {
  platform: string
  version: string
  startup(): Promise<StartupData>
  openShow(): Promise<{ path: string; show: ShowFile } | null>
  /** path null => diálogo "Guardar como". Devuelve la ruta final. */
  saveShow(path: string | null, json: string): Promise<string | null>
  writeShow(path: string, json: string): Promise<boolean>
  saveDraft(json: string): Promise<boolean>
  pickMedia(): Promise<MediaFile[]>
  saveSettings(settings: AppSettings): Promise<void>
  fileStatus(paths: string[]): Promise<Record<string, boolean>>
  /** Pantallas disponibles para enviar video. */
  listDisplays(): Promise<DisplayInfo[]>
  /** Abre (o enfoca) la ventana de salida de una pantalla concreta. */
  ensureOutput(displayId?: string): Promise<void>
  /** Importa perfiles .gdtf o librerías .json y devuelve la librería completa. */
  importFixtures(): Promise<FixtureProfile[]>
  listFixtures(): Promise<FixtureProfile[]>
  removeFixture(id: string): Promise<FixtureProfile[]>
  /** Envía un universo DMX completo (512 bytes) por Art-Net. */
  dmxSend(universe: number, values: number[]): Promise<void>
  /** Avisa por OSC del disparo de un cue (Go) o de un pánico. */
  notifyCue(cue: { number: string; name: string; type: string }, action: 'go' | 'panic'): Promise<void>
  /** Pide la tabla de dispositivos RDM del universo y lee cada uno. */
  rdmDiscover(universe: number): Promise<RdmDevice[]>
  /** Cambia la dirección DMX inicial de un dispositivo RDM. */
  rdmSetStartAddress(
    uid: string,
    universe: number,
    host: string,
    address: number
  ): Promise<RdmDevice | null>
  /** Diálogo "Guardar como" para la lista de cues en CSV. */
  exportCueList(defaultName: string, csv: string): Promise<string | null>
  outputEvent(ev: OutputEvent): Promise<void>
  outputFullscreen(on: boolean, displayId?: string): Promise<void>
  toggleOutputFullscreen(displayId?: string): Promise<void>
  onOutput(cb: (ev: OutputEvent) => void): () => void
  onMenu(cb: (cmd: string) => void): () => void
  onOutputClosed(cb: () => void): () => void
  /** Mensajes OSC recibidos que disparan cues. */
  onOscTrigger(cb: (trigger: OscTrigger) => void): () => void
  /** Rutas de archivos arrastrados (Electron >= 32). */
  getPathForFile(file: File): string
  allowDevices(): Promise<boolean>
}
