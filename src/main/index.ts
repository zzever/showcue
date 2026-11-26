import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  protocol,
  screen,
  session,
  type MenuItemConstructorOptions
} from 'electron'
import { createSocket, type Socket as UdpSocket } from 'node:dgram'
import { createReadStream, existsSync, promises as fsp } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { Readable } from 'node:stream'
import { parseGdtf, parseLibraryJson, readZipEntry } from './fixtures'
import { decodeOsc, encodeOscMessage, type OscArg } from './osc'
import {
  artRdmPacket,
  artTodRequest,
  parseArtRdm,
  parseDeviceInfo,
  parseTodData,
  rdmText,
  RDM_PID,
  type ParsedRdm
} from './rdm'
import type {
  AppSettings,
  DisplayInfo,
  FixtureProfile,
  MediaFile,
  OscTrigger,
  OutputEvent,
  RdmDevice,
  ShowFile,
  StartupData
} from '../shared/types'

const isDev = !!process.env['ELECTRON_RENDERER_URL']
const RENDERER_URL = process.env['ELECTRON_RENDERER_URL']

let mainWindow: BrowserWindow | null = null
/** Ventanas de salida por pantalla (clave '' = salida principal). */
const outputWindows = new Map<string, BrowserWindow>()
/** Capas de salida activas por cue, para reabrir la ventana sin perder imagen. */
const outputLayers = new Map<string, OutputEvent & { type: 'show' }>()
/** Rejilla de ajuste activa por salida (se restaura al reabrir la ventana). */
const outputPatterns = new Map<string, boolean>()
/** Pantalla en la que se disparó cada cue (para enrutar clear/pause/resume). */
const cueDisplay = new Map<string, string>()

// Evita varias instancias peleando por el mismo archivo de show.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

// Un show no puede depender de un gesto del usuario para sonar.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'cuefile',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
      corsEnabled: true
    }
  }
])

const settingsPath = (): string => join(app.getPath('userData'), 'settings.json')
const draftPath = (): string => join(app.getPath('userData'), 'draft.json')

const defaultSettings: AppSettings = {
  lastShowPath: null,
  defaultFade: 0.25,
  defaultDeviceId: '',
  hotkeysEnabled: true,
  midiEnabled: true,
  artnetEnabled: false,
  artnetHost: '255.255.255.255',
  oscEnabled: false,
  oscHost: '127.0.0.1',
  oscPort: 8000,
  oscListenEnabled: false,
  oscListenPort: 9000,
  oscPrefix: '/showcue',
  oscGma3: false,
  artnetInEnabled: false,
  artnetInPort: 6454,
  speakerGroups: [],
  timelinePriority: 'go'
}

// ------------------------------------------------------------- Art-Net (DMX)
let dmxSocket: UdpSocket | null = null
let inputSocket: UdpSocket | null = null
let dmxSequence = 0

function ensureDmxSocket(): UdpSocket {
  if (dmxSocket) return dmxSocket
  const socket = createSocket('udp4')
  socket.on('error', (err) => console.error('Art-Net', err))
  socket.bind(() => {
    try {
      socket.setBroadcast(true)
    } catch (err) {
      console.error('Art-Net broadcast', err)
    }
  })
  dmxSocket = socket
  return socket
}

/**
 * Art-Net de entrada: escucha ArtDmx de la mesa o del nodo y lo reenvía a la
 * interfaz para el monitor y el modo directo del grid DMX.
 */
function stopArtnetInput(): void {
  if (!inputSocket) return
  try {
    inputSocket.close()
  } catch {
    /* ya cerrado */
  }
  inputSocket = null
}

function startArtnetInput(port: number): boolean {
  stopArtnetInput()
  const listenPort = Math.max(1024, Math.min(65535, Math.round(port) || 6454))
  try {
    const socket = createSocket({ type: 'udp4', reuseAddr: true })
    socket.on('message', (message, info) => {
      if (message.length < 18) return
      if (message.toString('latin1', 0, 8) !== 'Art-Net\0') return
      if (message.readUInt16LE(8) !== 0x5000) return
      const subUni = message.readUInt8(14)
      const net = message.readUInt8(15) & 0x7f
      const universe = (net << 8) | subUni
      const length = Math.min(512, message.readUInt16BE(16))
      const values = new Array<number>(512).fill(0)
      for (let index = 0; index < length; index += 1) values[index] = message.readUInt8(18 + index)
      mainWindow?.webContents.send('dmx:in', {
        universe,
        values,
        host: info.address,
        at: Date.now()
      })
    })
    socket.on('error', (err) => console.error('Art-Net entrada', err))
    socket.bind(listenPort)
    inputSocket = socket
    return true
  } catch (err) {
    console.error('Art-Net entrada', err)
    return false
  }
}

/** Paquete ArtDmx (OpCode 0x5000) con los 512 canales de un universo. */
function artnetPacket(universe: number, values: number[]): Buffer {
  const packet = Buffer.alloc(18 + 512)
  packet.write('Art-Net\0', 0, 'latin1')
  packet.writeUInt16LE(0x5000, 8)
  packet.writeUInt16BE(14, 10)
  packet.writeUInt8(dmxSequence++ & 0xff, 12)
  packet.writeUInt8(0, 13)
  // Art-Net numera los universos desde 0 (Port-Address 0x0000 = universo 1 de consola).
  const index = Math.max(0, Math.min(32767, Math.round(universe)))
  packet.writeUInt8(index & 0x0f, 14)
  packet.writeUInt8((index >> 4) & 0x7f, 15)
  packet.writeUInt16BE(512, 16)
  for (let i = 0; i < 512; i++) {
    packet[18 + i] = Math.max(0, Math.min(255, Math.round(values[i] ?? 0)))
  }
  return packet
}

function sendUdp(socket: UdpSocket, packet: Buffer, port: number, host: string): Promise<void> {
  return new Promise<void>((resolve) => {
    socket.send(packet, 0, packet.length, port, host, (err) => {
      if (err) console.error('UDP', host, port, err)
      resolve()
    })
  })
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// ------------------------------------------------------- OSC (gMA3, QLab…)
const OSC_DEFAULT_PORT = 8000

let oscSocket: UdpSocket | null = null
let oscListener: UdpSocket | null = null
let oscListenPort = 0

function normalizePrefix(prefix: string | undefined): string {
  const clean = (prefix ?? '').trim().replace(/\s+/g, '')
  if (!clean) return '/showcue'
  const withSlash = clean.startsWith('/') ? clean : `/${clean}`
  return withSlash.replace(/\/+$/, '') || '/showcue'
}

function clampPort(port: number, fallback: number): number {
  const value = Math.round(Number(port))
  return Number.isFinite(value) && value >= 1 && value <= 65535 ? value : fallback
}

/** Fragmento seguro para una dirección OSC (números de cue como "12.5" o "M1"). */
function oscPart(value: string): string {
  return (
    value
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\w.:\-]/g, '') || 'cue'
  )
}

function ensureOscSocket(): UdpSocket {
  if (oscSocket) return oscSocket
  const socket = createSocket('udp4')
  socket.on('error', (err) => console.error('OSC salida', err))
  oscSocket = socket
  return socket
}

/** Envía a la red los mensajes OSC del disparo (best effort, sin bloquear el GO). */
async function sendOscCue(
  cue: { number: string; name: string; type: string },
  action: 'go' | 'panic'
): Promise<void> {
  const settings = await readSettings()
  if (!settings.oscEnabled) return
  const host = settings.oscHost?.trim() || '127.0.0.1'
  const port = clampPort(settings.oscPort, OSC_DEFAULT_PORT)
  const prefix = normalizePrefix(settings.oscPrefix)
  const socket = ensureOscSocket()
  const messages: Buffer[] = []

  if (action === 'panic') {
    messages.push(encodeOscMessage(`${prefix}/panic`))
    messages.push(encodeOscMessage(`${prefix}/stop`, ['all']))
  } else {
    const number = cue.number ?? ''
    const name = cue.name ?? ''
    messages.push(encodeOscMessage(`${prefix}/go`, [number, name, cue.type ?? '']))
    messages.push(encodeOscMessage(`${prefix}/cue/${oscPart(number)}/go`, [number, name]))
    if (settings.oscGma3) {
      messages.push(encodeOscMessage('/gma3/cmd', [`Go+ Executor ${oscPart(number) || '1'}`]))
    }
  }

  for (const message of messages) await sendUdp(socket, message, port, host)
}

function stopOscListener(): void {
  if (!oscListener) return
  oscListener.removeAllListeners()
  try {
    oscListener.close()
  } catch {
    /* ya cerrado */
  }
  oscListener = null
  oscListenPort = 0
}

/** Escucha OSC entrante para disparar cues desde gMA3 u otro controlador. */
function ensureOscListener(port: number): void {
  const target = clampPort(port, 9000)
  if (oscListener && oscListenPort === target) return
  stopOscListener()

  const socket = createSocket({ type: 'udp4', reuseAddr: true })
  socket.on('message', (data) => {
    for (const message of decodeOsc(data)) void handleOscInput(message.address, message.args)
  })
  socket.on('error', (err) => console.error('OSC entrada', err))
  socket.bind(target, () => {
    oscListenPort = target
  })
  oscListener = socket
}

async function handleOscInput(address: string, args: OscArg[]): Promise<void> {
  const settings = await readSettings()
  if (!settings.oscListenEnabled) return
  const prefix = normalizePrefix(settings.oscPrefix)
  const route = address.trim().replace(/\/+$/, '')
  const trigger = (payload: OscTrigger): void => {
    mainWindow?.webContents.send('osc:trigger', payload)
  }

  if (route === `${prefix}/panic` || route === `${prefix}/stop`) {
    trigger({ action: 'panic' })
    return
  }

  if (route === `${prefix}/go`) {
    const first = args[0]
    const number = typeof first === 'string' ? first : typeof first === 'number' ? String(first) : ''
    trigger({ action: 'go', number })
    return
  }

  const match = /^(.*)\/cue\/([^/]+)\/go$/.exec(route)
  if (match && match[1] === prefix) {
    let number = match[2]
    try {
      number = decodeURIComponent(match[2])
    } catch {
      /* se queda el fragmento tal cual */
    }
    trigger({ action: 'go', number })
  }
}

// ----------------------------------------------------------- RDM sobre Art-Net
const ARTNET_PORT = 6454

let rdmSocket: UdpSocket | null = null
let rdmReady: Promise<void> | null = null
let rdmTransaction = 0
/** Receptor temporal de TOD durante un descubrimiento. */
let todSink: ((uids: string[], host: string) => void) | null = null
const rdmPending = new Map<number, (rdm: ParsedRdm) => void>()

function ensureRdmSocket(): Promise<void> {
  if (rdmReady) return rdmReady

  const socket = createSocket({ type: 'udp4', reuseAddr: true })
  rdmSocket = socket
  socket.on('message', (data, rinfo) => {
    if (data.length < 10 || data.toString('latin1', 0, 8) !== 'Art-Net\0') return
    const opcode = data.readUInt16LE(8)
    if (opcode === 0x8100) {
      const tod = parseTodData(data)
      if (tod && todSink) todSink(tod.uids, rinfo.address)
    } else if (opcode === 0x8300) {
      const parsed = parseArtRdm(data)
      if (!parsed) return
      const resolve = rdmPending.get(parsed.transaction)
      if (resolve) {
        rdmPending.delete(parsed.transaction)
        resolve(parsed)
      }
    }
  })
  socket.on('error', (err) => console.error('RDM', err))

  rdmReady = new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => {
      socket.off('error', onError)
      rdmReady = null
      rdmSocket = null
      try {
        socket.close()
      } catch {
        /* ya cerrado */
      }
      reject(
        new Error(
          `No se pudo escuchar el puerto ${ARTNET_PORT} para RDM (${err.message}). Cierra el programa que lo esté usando.`
        )
      )
    }
    socket.once('error', onError)
    socket.bind({ port: ARTNET_PORT, address: '0.0.0.0', exclusive: false }, () => {
      socket.off('error', onError)
      resolve()
    })
  })
  return rdmReady
}

/** Envía una petición RDM al nodo y espera su respuesta (o null si no llega). */
async function rdmRequest(
  uid: string,
  universe: number,
  host: string,
  command: 'get' | 'set',
  pid: number,
  payload: number[] = [],
  timeoutMs = 1000
): Promise<ParsedRdm | null> {
  await ensureRdmSocket()
  const socket = rdmSocket
  if (!socket) return null

  rdmTransaction = (rdmTransaction + 1) & 0xff
  const transaction = rdmTransaction
  const packet = artRdmPacket(universe, uid, command, pid, payload, transaction)
  if (!packet) return null

  return new Promise<ParsedRdm | null>((resolve) => {
    const timer = setTimeout(() => {
      rdmPending.delete(transaction)
      resolve(null)
    }, timeoutMs)
    rdmPending.set(transaction, (response) => {
      clearTimeout(timer)
      rdmPending.delete(transaction)
      resolve(response)
    })
    void sendUdp(socket, packet, ARTNET_PORT, host)
  })
}

const rdmWord = (data: number[], offset: number): number =>
  ((data[offset] ?? 0) << 8) | (data[offset + 1] ?? 0)

async function rdmReadDevice(uid: string, universe: number, host: string): Promise<RdmDevice> {
  const [info, address, label] = await Promise.all([
    rdmRequest(uid, universe, host, 'get', RDM_PID.DEVICE_INFO),
    rdmRequest(uid, universe, host, 'get', RDM_PID.DMX_START_ADDRESS),
    rdmRequest(uid, universe, host, 'get', RDM_PID.DEVICE_LABEL)
  ])
  const model = info ? parseDeviceInfo(info.data) : null
  const startAddress =
    address && address.data.length >= 2
      ? rdmWord(address.data, 0)
      : (model?.startAddress ?? 0)
  return {
    uid,
    universe,
    host,
    label: (label && rdmText(label.data)) || `RDM ${uid}`,
    startAddress,
    footprint: model?.footprint ?? 0,
    personality: model?.personality ?? 0
  }
}

async function rdmDiscover(universe: number): Promise<RdmDevice[]> {
  const settings = await readSettings()
  const host = settings.artnetHost?.trim() || '255.255.255.255'
  await ensureRdmSocket()
  const socket = rdmSocket
  if (!socket) return []

  const found = new Map<string, string>()
  const previous = todSink
  todSink = (uids, ip) => {
    for (const uid of uids) if (!found.has(uid)) found.set(uid, ip)
  }

  try {
    const request = artTodRequest(universe)
    // Varios envíos: si se pierde uno, el nodo igual contesta al siguiente.
    for (let attempt = 0; attempt < 3; attempt++) {
      await sendUdp(socket, request, ARTNET_PORT, host)
      await delay(180)
    }
    await delay(1400)
  } finally {
    todSink = previous
  }

  return Promise.all(
    [...found.entries()].map(([uid, ip]) => rdmReadDevice(uid, universe, ip))
  )
}

async function rdmSetStartAddress(
  uid: string,
  universe: number,
  host: string,
  address: number
): Promise<RdmDevice | null> {
  const value = Math.max(1, Math.min(512, Math.round(address)))
  const response = await rdmRequest(uid, universe, host, 'set', RDM_PID.DMX_START_ADDRESS, [
    (value >> 8) & 0xff,
    value & 0xff
  ])
  if (!response) return null
  return rdmReadDevice(uid, universe, host)
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    const raw = await fsp.readFile(path, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

async function readSettings(): Promise<AppSettings> {
  const stored = await readJson<Partial<AppSettings>>(settingsPath())
  return { ...defaultSettings, ...(stored ?? {}) }
}

async function writeSettings(settings: AppSettings): Promise<void> {
  try {
    await fsp.mkdir(app.getPath('userData'), { recursive: true })
    await fsp.writeFile(settingsPath(), JSON.stringify(settings, null, 2), 'utf8')
  } catch (err) {
    console.error('No se pudieron guardar los ajustes', err)
  }
}

const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/opus',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
}

const mimeFor = (path: string): string => MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'

function kindFor(path: string): MediaFile['kind'] | null {
  const mime = mimeFor(path)
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('image/')) return 'image'
  return null
}

/** Sirve archivos locales con soporte de Range (necesario para video y seek). */
function registerFileProtocol(): void {
  protocol.handle('cuefile', async (request) => {
    const url = new URL(request.url)
    const path = url.searchParams.get('p')
    if (!path) return new Response('Solicitud inválida', { status: 400 })

    let size = 0
    try {
      const stat = await fsp.stat(path)
      if (!stat.isFile()) return new Response('No es un archivo', { status: 400 })
      size = stat.size
    } catch {
      return new Response('Archivo no encontrado', { status: 404 })
    }

    const type = mimeFor(path)
    const range = request.headers.get('Range')
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range)
      if (match) {
        const start = match[1] ? parseInt(match[1], 10) : 0
        const end = match[2] ? Math.min(parseInt(match[2], 10), size - 1) : size - 1
        if (start >= size || start > end) {
          return new Response(null, {
            status: 416,
            headers: { 'Content-Range': `bytes */${size}` }
          })
        }
        const stream = createReadStream(path, { start, end })
        return new Response(Readable.toWeb(stream) as ReadableStream, {
          status: 206,
          headers: {
            'Content-Type': type,
            'Content-Length': String(end - start + 1),
            'Content-Range': `bytes ${start}-${end}/${size}`,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-cache'
          }
        })
      }
    }

    const stream = createReadStream(path)
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers: {
        'Content-Type': type,
        'Content-Length': String(size),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache'
      }
    })
  })
}

function rendererPath(hash: string): { url?: string; file?: string; hash: string } {
  if (isDev && RENDERER_URL) return { url: `${RENDERER_URL}#${hash}`, hash }
  return { file: join(__dirname, '../renderer/index.html'), hash }
}

function loadRenderer(win: BrowserWindow, hash: string): void {
  const target = rendererPath(hash)
  if (target.url) void win.loadURL(target.url)
  else if (target.file) void win.loadFile(target.file, { hash })
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1060,
    minHeight: 620,
    show: false,
    backgroundColor: '#0a0d12',
    title: 'ShowCue',
    autoHideMenuBar: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isDev || !url.startsWith(RENDERER_URL ?? '__none__')) event.preventDefault()
  })

  loadRenderer(mainWindow, 'main')
}

const outputKey = (displayId: string | undefined): string => (displayId ? displayId : '')

function displayForCue(cueId: string): string {
  return cueDisplay.get(cueId) ?? ''
}

function targetDisplayFor(ev: OutputEvent): string {
  if (ev.type === 'show') return outputKey(ev.payload.displayId)
  if (ev.type === 'pattern') return outputKey(ev.displayId)
  return displayForCue(ev.cueId)
}

function displayBounds(displayId: string): {
  x?: number
  y?: number
  width: number
  height: number
} {
  if (!displayId) return { width: 1120, height: 630 }
  const display = screen.getAllDisplays().find((item) => String(item.id) === displayId)
  if (!display) return { width: 1120, height: 630 }
  const area = display.workArea
  return { x: area.x, y: area.y, width: area.width, height: area.height }
}

function createOutputWindow(displayId: string): BrowserWindow {
  const key = outputKey(displayId)
  const existing = outputWindows.get(key)
  if (existing && !existing.isDestroyed()) {
    existing.show()
    existing.focus()
    return existing
  }

  const bounds = displayBounds(key)
  const win = new BrowserWindow({
    ...bounds,
    minWidth: 320,
    minHeight: 240,
    show: false,
    backgroundColor: '#000000',
    title: 'ShowCue — Salida',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  outputWindows.set(key, win)
  win.once('ready-to-show', () => win.show())
  win.webContents.on('did-finish-load', () => {
    for (const layer of outputLayers.values()) {
      if (outputKey(layer.payload.displayId) === key) win.webContents.send('output:event', layer)
    }
    const pattern = outputPatterns.get(key)
    if (pattern) win.webContents.send('output:event', { type: 'pattern', displayId: key, on: true })
  })
  win.on('closed', () => {
    outputWindows.delete(key)
    for (const [cueId, target] of [...cueDisplay]) {
      if (target !== key) continue
      cueDisplay.delete(cueId)
      outputLayers.delete(cueId)
    }
    if (outputWindows.size === 0) mainWindow?.webContents.send('output:closed')
  })

  loadRenderer(win, 'output')
  return win
}

function sendToOutput(ev: OutputEvent): void {
  const key = targetDisplayFor(ev)
  if (ev.type === 'show') {
    outputLayers.set(ev.payload.cueId, ev)
    cueDisplay.set(ev.payload.cueId, key)
  } else if (ev.type === 'clear') {
    outputLayers.delete(ev.cueId)
    cueDisplay.delete(ev.cueId)
  } else if (ev.type === 'pattern') {
    // Se recuerda para que la ventana la recupere si se vuelve a abrir.
    outputPatterns.set(key, ev.on)
  }

  const win = outputWindows.get(key)
  if (!win || win.isDestroyed()) {
    // Sólo "show" y "pattern" abren ventanas; la nueva reproduce el estado al cargar.
    if (ev.type === 'show' || ev.type === 'pattern') createOutputWindow(key)
    return
  }
  const wc = win.webContents
  if (wc.isLoading()) wc.once('did-finish-load', () => wc.send('output:event', ev))
  else wc.send('output:event', ev)
}

function focusedOutputWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused && [...outputWindows.values()].includes(focused)) return focused
  const first = [...outputWindows.values()].find((win) => !win.isDestroyed())
  return first ?? null
}

function buildMenu(): void {
  const send = (cmd: string) => mainWindow?.webContents.send('menu', cmd)

  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Archivo',
      submenu: [
        { label: 'Nuevo show', accelerator: 'CmdOrCtrl+N', click: () => send('new') },
        { label: 'Abrir show…', accelerator: 'CmdOrCtrl+O', click: () => send('open') },
        { type: 'separator' },
        { label: 'Guardar', accelerator: 'CmdOrCtrl+S', click: () => send('save') },
        { label: 'Guardar como…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('save-as') },
        { label: 'Exportar lista de cues (CSV)…', click: () => send('export-csv') },
        { type: 'separator' },
        { role: 'quit', label: 'Salir' }
      ]
    },
    {
      label: 'Edición',
      submenu: [
        // registerAccelerator:false muestra el atajo pero deja que la interfaz lo maneje.
        {
          label: 'Deshacer',
          accelerator: 'CmdOrCtrl+Z',
          registerAccelerator: false,
          click: () => send('undo')
        },
        {
          label: 'Rehacer',
          accelerator: 'CmdOrCtrl+Shift+Z',
          registerAccelerator: false,
          click: () => send('redo')
        },
        { type: 'separator' },
        {
          label: 'Bloquear / desbloquear atajos de teclado',
          accelerator: 'CmdOrCtrl+Alt+H',
          registerAccelerator: false,
          click: () => send('toggle-hotkeys')
        }
      ]
    },
    {
      label: 'Cue',
      submenu: [
        { label: 'Ejecutar cue en espera (GO)', accelerator: 'CmdOrCtrl+Return', click: () => send('go') },
        { label: 'Detener todo (PANIC)', accelerator: 'CmdOrCtrl+.', click: () => send('panic') },
        { type: 'separator' },
        { label: 'Añadir audio…', accelerator: 'CmdOrCtrl+1', click: () => send('add-audio') },
        { label: 'Añadir espera', accelerator: 'CmdOrCtrl+2', click: () => send('add-wait') },
        { label: 'Añadir grupo', accelerator: 'CmdOrCtrl+3', click: () => send('add-group') },
        { label: 'Añadir cue DMX', accelerator: 'CmdOrCtrl+4', click: () => send('add-dmx') },
        { type: 'separator' },
        { label: 'Duplicar cue', accelerator: 'CmdOrCtrl+D', click: () => send('duplicate') },
        { label: 'Eliminar cue', click: () => send('delete') }
      ]
    },
    {
      label: 'Ver',
      submenu: [
        { label: 'Ventana de salida', accelerator: 'CmdOrCtrl+Shift+O', click: () => send('output') },
        { label: 'Salida a pantalla completa', accelerator: 'F11', click: () => send('output-fullscreen') },
        { type: 'separator' },
        { role: 'reload', label: 'Recargar interfaz' },
        { role: 'toggleDevTools', label: 'Herramientas de desarrollo' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Zoom normal' },
        { role: 'zoomIn', label: 'Acercar' },
        { role: 'zoomOut', label: 'Alejar' }
      ]
    },
    {
      label: 'Ayuda',
      submenu: [
        { label: 'Atajos de teclado', click: () => send('shortcuts') },
        {
          label: 'Acerca de ShowCue',
          click: () => {
            if (!mainWindow) return
            void dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'ShowCue',
              message: `ShowCue ${app.getVersion()}`,
              detail:
                'Sistema de reproducción de cues para shows en vivo.\n\nEspacio = GO · Esc = detener todo · ↑/↓ = cue en espera\nCtrl+Alt+H = bloquear atajos'
            })
          }
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// --------------------------------------------------------------- librería DMX

const fixturesPath = (): string => join(app.getPath('userData'), 'fixtures.json')

async function readFixtures(): Promise<FixtureProfile[]> {
  const stored = await readJson<FixtureProfile[]>(fixturesPath())
  return Array.isArray(stored) ? stored : []
}

async function writeFixtures(list: FixtureProfile[]): Promise<void> {
  try {
    await fsp.mkdir(app.getPath('userData'), { recursive: true })
    await fsp.writeFile(fixturesPath(), JSON.stringify(list, null, 2), 'utf8')
  } catch (err) {
    console.error('No se pudo guardar la librería DMX', err)
  }
}


function registerIpc(): void {
  ipcMain.handle('app:startup', async (): Promise<StartupData> => {
    const settings = await readSettings()
    let show: ShowFile | null = null
    let path: string | null = null

    if (settings.lastShowPath && existsSync(settings.lastShowPath)) {
      const loaded = await readJson<ShowFile>(settings.lastShowPath)
      if (loaded && loaded.format === 'showcue') {
        show = loaded
        path = settings.lastShowPath
      }
    }
    if (!show) {
      const draft = await readJson<ShowFile>(draftPath())
      if (draft && draft.format === 'showcue' && Array.isArray(draft.cues)) show = draft
    }
    return { show, path, settings }
  })

  ipcMain.handle('app:allow-devices', async () => true)

  ipcMain.handle('show:open', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Abrir show',
      filters: [
        { name: 'Show de ShowCue', extensions: ['showcue', 'json'] },
        { name: 'Todos los archivos', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const path = result.filePaths[0]
    const show = await readJson<ShowFile>(path)
    if (!show || !Array.isArray(show.cues)) {
      await dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Archivo no válido',
        message: 'No se pudo leer ese archivo como show de ShowCue.'
      })
      return null
    }
    return { path, show }
  })

  ipcMain.handle('show:save', async (_e, path: string | null, json: string) => {
    let target = path
    if (!target) {
      if (!mainWindow) return null
      const parsed = await readJson<ShowFile>(draftPath())
      const suggested = (parsed?.title ?? 'show').replace(/[\\/:*?"<>|]/g, '-')
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Guardar show',
        defaultPath: `${suggested}.showcue`,
        filters: [{ name: 'Show de ShowCue', extensions: ['showcue'] }]
      })
      if (result.canceled || !result.filePath) return null
      target = result.filePath
    }
    try {
      await fsp.writeFile(target, json, 'utf8')
      const settings = await readSettings()
      await writeSettings({ ...settings, lastShowPath: target })
      return target
    } catch (err) {
      console.error('Error guardando show', err)
      return null
    }
  })

  ipcMain.handle('show:write', async (_e, path: string, json: string) => {
    try {
      await fsp.writeFile(path, json, 'utf8')
      return true
    } catch (err) {
      console.error('Error guardando show', err)
      return false
    }
  })

  ipcMain.handle('show:draft', async (_e, json: string) => {
    try {
      await fsp.mkdir(app.getPath('userData'), { recursive: true })
      await fsp.writeFile(draftPath(), json, 'utf8')
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('settings:save', async (_e, settings: AppSettings) => {
    await writeSettings(settings)
    if (settings.oscListenEnabled) ensureOscListener(settings.oscListenPort)
    else stopOscListener()
    if (settings.artnetInEnabled) startArtnetInput(settings.artnetInPort)
    else stopArtnetInput()
  })

  ipcMain.handle('dmx:input', async (_e, enabled: boolean, port: number) => {
    if (!enabled) {
      stopArtnetInput()
      return false
    }
    return startArtnetInput(port)
  })

  ipcMain.handle(
    'osc:cue',
    async (_e, cue: { number: string; name: string; type: string }, action: 'go' | 'panic') => {
      await sendOscCue(cue, action)
    }
  )

  ipcMain.handle('rdm:discover', async (_e, universe: number): Promise<RdmDevice[]> =>
    rdmDiscover(universe)
  )

  ipcMain.handle(
    'rdm:set-address',
    async (_e, uid: string, universe: number, host: string, address: number) =>
      rdmSetStartAddress(uid, universe, host, address)
  )

  ipcMain.handle('dmx:send', async (_e, universe: number, values: number[]) => {
    const settings = await readSettings()
    if (!settings.artnetEnabled) return
    const port = 6454
    const host = settings.artnetHost?.trim() || '255.255.255.255'
    const packet = artnetPacket(universe, values)
    const socket = ensureDmxSocket()
    await new Promise<void>((resolve) => {
      socket.send(packet, 0, packet.length, port, host, (err) => {
        if (err) console.error('Art-Net send', err)
        resolve()
      })
    })
  })

  ipcMain.handle('show:export-csv', async (_e, defaultName: string, csv: string) => {
    if (!mainWindow) return null
    const safe = (defaultName || 'show').replace(/[\\/:*?"<>|]/g, '-')
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Exportar lista de cues',
      defaultPath: `${safe}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (result.canceled || !result.filePath) return null
    try {
      await fsp.writeFile(result.filePath, csv, 'utf8')
      return result.filePath
    } catch (err) {
      console.error('Error exportando CSV', err)
      return null
    }
  })

  ipcMain.handle('media:pick', async (): Promise<MediaFile[]> => {
    if (!mainWindow) return []
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Añadir archivos de medios',
      filters: [
        {
          name: 'Audio, video e imágenes',
          extensions: [
            'mp3', 'wav', 'aiff', 'aif', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus',
            'mp4', 'm4v', 'mov', 'mkv', 'webm',
            'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'
          ]
        },
        { name: 'Todos los archivos', extensions: ['*'] }
      ],
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled) return []
    return result.filePaths
      .map((path) => {
        const kind = kindFor(path)
        return kind ? { path, name: basename(path).replace(extname(path), ''), kind } : null
      })
      .filter((f): f is MediaFile => f !== null)
  })

  ipcMain.handle('files:status', async (_e, paths: string[]) => {
    const out: Record<string, boolean> = {}
    for (const p of paths) out[p] = existsSync(p)
    return out
  })

  ipcMain.handle('output:ensure', async (_e, displayId?: string) => {
    createOutputWindow(displayId ?? '')
  })

  ipcMain.handle('output:event', async (_e, ev: OutputEvent) => {
    sendToOutput(ev)
  })

  ipcMain.handle('output:fullscreen', async (_e, on: boolean, displayId?: string) => {
    const win = displayId !== undefined ? createOutputWindow(displayId) : focusedOutputWindow()
    win?.setFullScreen(on)
  })

  ipcMain.handle('output:toggle-fullscreen', async (_e, displayId?: string) => {
    const win = displayId !== undefined ? createOutputWindow(displayId) : focusedOutputWindow()
    if (!win) return
    win.setFullScreen(!win.isFullScreen())
  })

  ipcMain.handle('output:displays', async (): Promise<DisplayInfo[]> => {
    const primary = screen.getPrimaryDisplay().id
    return screen.getAllDisplays().map((display, index) => ({
      id: String(display.id),
      label: `${display.label?.trim() || `Pantalla ${index + 1}`} · ${display.size.width}×${display.size.height}`,
      primary: display.id === primary,
      width: display.size.width,
      height: display.size.height,
      scaleFactor: display.scaleFactor
    }))
  })

  ipcMain.handle('fixtures:list', async (): Promise<FixtureProfile[]> => readFixtures())

  ipcMain.handle('fixtures:import', async (): Promise<FixtureProfile[]> => {
    if (!mainWindow) return readFixtures()
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Importar librería DMX',
      filters: [
        { name: 'Perfiles GDTF o librerías JSON', extensions: ['gdtf', 'json'] },
        { name: 'Todos los archivos', extensions: ['*'] }
      ],
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled) return readFixtures()

    const imported: FixtureProfile[] = []
    for (const path of result.filePaths) {
      try {
        if (extname(path).toLowerCase() === '.gdtf') {
          const buffer = await fsp.readFile(path)
          const xml = readZipEntry(buffer, 'description.xml')
          const profile = xml ? parseGdtf(xml, basename(path)) : null
          if (profile) imported.push(profile)
        } else {
          const raw = await fsp.readFile(path, 'utf8')
          imported.push(...parseLibraryJson(raw))
        }
      } catch (err) {
        console.error('No se pudo importar', path, err)
      }
    }
    if (imported.length === 0) return readFixtures()

    const existing = await readFixtures()
    const merged = [...existing]
    for (const profile of imported) {
      const index = merged.findIndex(
        (item) =>
          item.name.toLowerCase() === profile.name.toLowerCase() &&
          item.manufacturer.toLowerCase() === profile.manufacturer.toLowerCase()
      )
      if (index >= 0) merged[index] = { ...profile, id: merged[index].id }
      else merged.push(profile)
    }
    await writeFixtures(merged)
    return merged
  })

  ipcMain.handle('fixtures:remove', async (_e, id: string): Promise<FixtureProfile[]> => {
    const next = (await readFixtures()).filter((profile) => profile.id !== id)
    await writeFixtures(next)
    return next
  })
}

app.whenReady().then(() => {
  registerFileProtocol()

  // Un show controla audio y pantallas: no queremos diálogos de permiso en medio.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media')

  registerIpc()
  buildMenu()
  createMainWindow()

  // Preparar el socket Art-Net si el operador ya lo tenía activado.
  void readSettings().then((settings) => {
    if (settings.artnetEnabled) ensureDmxSocket()
    if (settings.artnetInEnabled) startArtnetInput(settings.artnetInPort)
    if (settings.oscListenEnabled) ensureOscListener(settings.oscListenPort)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})
