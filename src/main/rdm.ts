/**
 * RDM sobre Art-Net: construcción y lectura de los paquetes
 * ArtTodRequest (0x8000), ArtTodData (0x8100) y ArtRdm (0x8300),
 * más el mensaje RDM encapsulado (GET/SET).
 *
 * El descubrimiento real de dispositivos lo hace el nodo/gateway Art-Net
 * (Luminex, Enttec, etc.); ShowCue pide la tabla de dispositivos (TOD) y
 * luego habla RDM con cada UID.
 */

export interface ParsedRdm {
  destination: string
  source: string
  transaction: number
  commandClass: number
  pid: number
  data: number[]
}

/** UID de ShowCue como controlador RDM (ID de desarrollo 0x7FF0). */
export const CONTROLLER_UID = '0x7ff0:0x53484f57'

export const RDM_COMMAND = {
  get: 0x20,
  set: 0x30,
  getResponse: 0x21,
  setResponse: 0x31
} as const

export const RDM_PID = {
  DEVICE_INFO: 0x0060,
  DEVICE_MODEL_DESCRIPTION: 0x0080,
  MANUFACTURER_LABEL: 0x0081,
  DEVICE_LABEL: 0x0082,
  SOFTWARE_VERSION_LABEL: 0x00c0,
  DMX_START_ADDRESS: 0x00f0
} as const

export interface RdmTod {
  universe: number
  uids: string[]
}

const HEADER = 'Art-Net\0'

function writeHeader(packet: Buffer, opcode: number): void {
  packet.write(HEADER, 0, 'latin1')
  packet.writeUInt16LE(opcode, 8)
  packet.writeUInt8(0, 10)
  packet.writeUInt8(14, 11)
}

export function universeNet(universe: number): number {
  return (Math.max(0, Math.min(32767, Math.round(universe))) >> 8) & 0x7f
}

export function universeAddress(universe: number): number {
  return Math.max(0, Math.min(32767, Math.round(universe))) & 0xff
}

function uidBytes(uid: string): number[] | null {
  const match = /^(?:0x)?([0-9a-f]{1,4})\s*[:\-]\s*(?:0x)?([0-9a-f]{1,8})$/i.exec(uid.trim())
  if (!match) return null
  const manufacturer = parseInt(match[1], 16)
  const device = parseInt(match[2], 16)
  return [
    (manufacturer >> 8) & 0xff,
    manufacturer & 0xff,
    (device >>> 24) & 0xff,
    (device >>> 16) & 0xff,
    (device >>> 8) & 0xff,
    device & 0xff
  ]
}

export function writeUid(uid: string, target: Buffer, offset: number): boolean {
  const bytes = uidBytes(uid)
  if (!bytes) return false
  for (let i = 0; i < 6; i++) target[offset + i] = bytes[i]
  return true
}

export function readUid(data: Buffer, offset: number): string {
  const hex = (value: number): string => value.toString(16).padStart(2, '0')
  let manufacturer = ''
  for (let i = 0; i < 2; i++) manufacturer += hex(data[offset + i] ?? 0)
  let device = ''
  for (let i = 2; i < 6; i++) device += hex(data[offset + i] ?? 0)
  return `0x${manufacturer}:0x${device}`
}

/** ArtTodRequest: 56 bytes, pide al nodo su tabla de dispositivos RDM. */
export function artTodRequest(universe: number): Buffer {
  const packet = Buffer.alloc(56)
  writeHeader(packet, 0x8000)
  packet.writeUInt8(0, 12) // filler 1
  packet.writeUInt8(0, 13) // filler 2
  packet.writeUInt8(universeNet(universe), 21)
  packet.writeUInt8(0x00, 22) // TodFull
  packet.writeUInt8(1, 23) // cantidad de direcciones
  packet.writeUInt8(universeAddress(universe), 24)
  return packet
}

/** Lee un ArtTodData (0x8100) y devuelve los UID anunciados por el nodo. */
export function parseTodData(packet: Buffer): RdmTod | null {
  if (packet.length < 28 || packet.toString('latin1', 0, 8) !== HEADER) return null
  if (packet.readUInt16LE(8) !== 0x8100) return null
  const universe = (packet[21] << 8) | packet[23]
  const count = Math.min(packet[27] ?? 0, Math.floor((packet.length - 28) / 6))
  const uids: string[] = []
  for (let i = 0; i < count; i++) uids.push(readUid(packet, 28 + i * 6))
  return { universe, uids }
}

function rdmChecksum(message: Buffer): number {
  let sum = 0
  for (let i = 0; i < message.length - 2; i++) sum += message[i]
  return sum & 0xffff
}

/** Mensaje RDM completo (start code + cabecera + payload + checksum). */
function rdmMessage(
  destination: string,
  commandClass: number,
  pid: number,
  payload: number[],
  transaction: number
): Buffer | null {
  if (payload.length > 231) return null
  const message = Buffer.alloc(26 + payload.length)
  message[0] = 0xcc
  message[1] = 0x01
  message[2] = 24 + payload.length
  if (!writeUid(destination, message, 3)) return null
  if (!writeUid(CONTROLLER_UID, message, 9)) return null
  message[15] = transaction & 0xff
  message[16] = 1 // Port ID
  message[17] = 0 // Message count
  message.writeUInt16BE(0, 18) // sub-device
  message[20] = commandClass
  message.writeUInt16BE(pid & 0xffff, 21)
  message[23] = payload.length
  for (let i = 0; i < payload.length; i++) message[24 + i] = payload[i] & 0xff
  const checksum = rdmChecksum(message)
  message.writeUInt16BE(checksum, message.length - 2)
  return message
}

/** ArtRdm: envuelve un mensaje RDM para un universo Art-Net concreto. */
export function artRdmPacket(
  universe: number,
  uid: string,
  command: 'get' | 'set',
  pid: number,
  payload: number[],
  transaction: number
): Buffer | null {
  const inner = rdmMessage(
    uid,
    command === 'get' ? RDM_COMMAND.get : RDM_COMMAND.set,
    pid,
    payload,
    transaction
  )
  if (!inner) return null
  const packet = Buffer.alloc(24 + inner.length)
  writeHeader(packet, 0x8300)
  packet[12] = 1 // RDM estándar v1.0
  packet[13] = 0 // filler
  packet[19] = 0 // FIFO disponible
  packet[20] = 0 // FIFO máximo
  packet[21] = universeNet(universe)
  packet[22] = 0 // ArProcess
  packet[23] = universeAddress(universe)
  inner.copy(packet, 24)
  return packet
}

/** Lee un ArtRdm recibido (respuesta del nodo) y extrae el mensaje RDM. */
export function parseArtRdm(packet: Buffer): ParsedRdm | null {
  if (packet.length < 48 || packet.toString('latin1', 0, 8) !== HEADER) return null
  if (packet.readUInt16LE(8) !== 0x8300) return null
  return parseRdmMessage(packet, 24)
}

export function parseRdmMessage(packet: Buffer, offset: number): ParsedRdm | null {
  if (packet.length < offset + 26) return null
  if (packet[offset] !== 0xcc || packet[offset + 1] !== 0x01) return null
  const length = packet[offset + 2]
  const total = length + 2
  if (offset + total > packet.length || total < 26) return null
  const dataLength = packet[offset + 23]
  const data: number[] = []
  for (let i = 0; i < dataLength; i++) data.push(packet[offset + 24 + i] ?? 0)
  return {
    destination: readUid(packet, offset + 3),
    source: readUid(packet, offset + 9),
    transaction: packet[offset + 15],
    commandClass: packet[offset + 20],
    pid: packet.readUInt16BE(offset + 21),
    data
  }
}

/** Texto ASCII de un parámetro RDM (etiquetas, versión de software…). */
export function rdmText(data: number[]): string {
  return String.fromCharCode(...data.filter((byte) => byte >= 32 && byte < 127)).trim()
}

export interface RdmDeviceInfo {
  startAddress: number
  footprint: number
  personality: number
  modelId: number
}

export function parseDeviceInfo(data: number[]): RdmDeviceInfo | null {
  if (data.length < 18) return null
  const word = (offset: number): number => ((data[offset] ?? 0) << 8) | (data[offset + 1] ?? 0)
  return {
    startAddress: word(16),
    footprint: word(10),
    personality: word(12),
    modelId: word(2)
  }
}
