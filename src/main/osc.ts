/**
 * OSC 1.0 mínimo: codificar y decodificar mensajes por UDP sin dependencias.
 * Sirve para integrarse con gMA3, QLab, TouchDesigner o cualquier consola
 * que hable OSC.
 */

export type OscArg = string | number | boolean | null

export interface OscMessage {
  address: string
  args: OscArg[]
}

const padding = (length: number): number => (4 - (length % 4)) % 4

function encodeString(value: string): Buffer {
  const body = Buffer.from(`${value}\0`, 'utf8')
  const pad = padding(body.length)
  return pad > 0 ? Buffer.concat([body, Buffer.alloc(pad)]) : body
}

function readString(data: Buffer, offset: number): { value: string; next: number } | null {
  let end = offset
  while (end < data.length && data[end] !== 0) end++
  if (end >= data.length) return null
  const value = data.toString('utf8', offset, end)
  const next = Math.min(data.length, end + 1 + padding(end + 1 - offset))
  return { value, next }
}

export function encodeOscMessage(address: string, args: OscArg[] = []): Buffer {
  const tags = args
    .map((arg) => {
      if (typeof arg === 'string') return 's'
      if (typeof arg === 'number') return Number.isInteger(arg) ? 'i' : 'f'
      if (typeof arg === 'boolean') return arg ? 'T' : 'F'
      return 'N'
    })
    .join('')

  const parts: Buffer[] = [encodeString(address), encodeString(`,${tags}`)]
  for (const arg of args) {
    if (typeof arg === 'string') {
      parts.push(encodeString(arg))
    } else if (typeof arg === 'number') {
      const buffer = Buffer.alloc(4)
      if (Number.isInteger(arg)) buffer.writeInt32BE(Math.max(-2147483648, Math.min(2147483647, arg)), 0)
      else buffer.writeFloatBE(arg, 0)
      parts.push(buffer)
    }
    // booleanos y null viajan sólo en los type tags.
  }
  return Buffer.concat(parts)
}

function decodeMessage(data: Buffer, offset = 0): { message: OscMessage; next: number } | null {
  const address = readString(data, offset)
  if (!address || !address.value.startsWith('/')) return null
  const tags = readString(data, address.next)
  if (!tags) return { message: { address: address.value, args: [] }, next: address.next }

  const args: OscArg[] = []
  let cursor = tags.next
  const types = tags.value.startsWith(',') ? tags.value.slice(1) : tags.value
  for (const type of types) {
    if (type === 'i') {
      if (cursor + 4 > data.length) break
      args.push(data.readInt32BE(cursor))
      cursor += 4
    } else if (type === 'f') {
      if (cursor + 4 > data.length) break
      args.push(data.readFloatBE(cursor))
      cursor += 4
    } else if (type === 's') {
      const text = readString(data, cursor)
      if (!text) break
      args.push(text.value)
      cursor = text.next
    } else if (type === 'T') {
      args.push(true)
    } else if (type === 'F') {
      args.push(false)
    } else if (type === 'N') {
      args.push(null)
    }
  }
  return { message: { address: address.value, args }, next: cursor }
}

/** Decodifica un mensaje o un bundle (hasta 8 niveles de anidación). */
export function decodeOsc(data: Buffer, depth = 0): OscMessage[] {
  if (data.length >= 8 && data.toString('latin1', 0, 7) === '#bundle') {
    if (depth > 8) return []
    const messages: OscMessage[] = []
    let offset = 8
    while (offset + 4 <= data.length) {
      const size = data.readInt32BE(offset)
      offset += 4
      if (size <= 0 || offset + size > data.length) break
      messages.push(...decodeOsc(data.subarray(offset, offset + size), depth + 1))
      offset += size
    }
    return messages
  }
  const decoded = decodeMessage(data)
  return decoded ? [decoded.message] : []
}
