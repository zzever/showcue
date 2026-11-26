import { inflateRawSync } from 'node:zlib'
import type { FixtureChannel, FixtureMode, FixtureProfile } from '../shared/types'

const uid = (): string => Math.random().toString(36).slice(2) + Date.now().toString(36)

/** Extrae un archivo de un .gdtf (ZIP) usando la cabecera local del entry. */
export function readZipEntry(buffer: Buffer, wanted: string): string | null {
  let offset = 0
  while (offset + 30 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break
    const method = buffer.readUInt16LE(offset + 8)
    const compressedSize = buffer.readUInt32LE(offset + 18)
    const nameLength = buffer.readUInt16LE(offset + 26)
    const extraLength = buffer.readUInt16LE(offset + 28)
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8')
    const dataStart = offset + 30 + nameLength + extraLength
    if (compressedSize === 0) break
    if (name.toLowerCase() === wanted.toLowerCase()) {
      const data = buffer.subarray(dataStart, dataStart + compressedSize)
      return method === 0 ? data.toString('utf8') : inflateRawSync(data).toString('utf8')
    }
    offset = dataStart + compressedSize
  }
  return null
}

function xmlAttr(text: string, name: string): string {
  const match = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i').exec(text)
  return match ? match[1].trim() : ''
}

/** Convierte el description.xml de un GDTF en un perfil utilizable. */
export function parseGdtf(xml: string, fileName: string): FixtureProfile | null {
  const fixtureTag = /<FixtureType\b([^>]*)>/i.exec(xml)
  const name = xmlAttr(fixtureTag?.[1] ?? '', 'Name') || fileName.replace(/\.gdtf$/i, '')
  const manufacturer = xmlAttr(fixtureTag?.[1] ?? '', 'Manufacturer') || 'Sin fabricante'
  const modes: FixtureMode[] = []
  const modeRe = /<DMXMode\b([^>]*)>([\s\S]*?)<\/DMXMode>/gi
  let modeMatch: RegExpExecArray | null

  while ((modeMatch = modeRe.exec(xml))) {
    const modeName = xmlAttr(modeMatch[1], 'Name') || `Modo ${modes.length + 1}`
    const channels: FixtureChannel[] = []
    const channelRe = /<DMXChannel\b([^>]*)>([\s\S]*?)<\/DMXChannel>/gi
    let channelMatch: RegExpExecArray | null
    while ((channelMatch = channelRe.exec(modeMatch[2]))) {
      // Offset puede ser "1", "1,2" (varios sub-canales) o "None".
      const first = (xmlAttr(channelMatch[1], 'Offset').split(/[,;]/)[0] ?? '').trim()
      const offset = Number.parseInt(first, 10)
      if (!Number.isFinite(offset) || offset < 1) continue
      const attribute = xmlAttr(channelMatch[2], 'Attribute') || 'Canal'
      channels.push({ offset, name: attribute, attribute })
    }
    channels.sort((a, b) => a.offset - b.offset)
    if (channels.length > 0) modes.push({ name: modeName, channels })
  }

  if (modes.length === 0) return null
  return { id: uid(), name, manufacturer, modes, source: 'gdtf', importedAt: Date.now() }
}

interface RawLibraryFixture {
  name?: string
  manufacturer?: string
  modes?: { name?: string; channels?: Partial<FixtureChannel>[] }[]
}

export function parseLibraryJson(raw: string): FixtureProfile[] {
  const parsed = JSON.parse(raw) as { fixtures?: RawLibraryFixture[] } | RawLibraryFixture[]
  const list = Array.isArray(parsed) ? parsed : parsed.fixtures
  if (!Array.isArray(list)) return []

  const profiles: FixtureProfile[] = []
  for (const item of list) {
    if (!item || typeof item.name !== 'string') continue
    const modes: FixtureMode[] = []
    for (const mode of item.modes ?? []) {
      const channels: FixtureChannel[] = []
      for (const channel of mode.channels ?? []) {
        const offset = Number(channel.offset)
        if (!Number.isFinite(offset) || offset < 1) continue
        const label = channel.name || channel.attribute || `Canal ${offset}`
        channels.push({ offset, name: label, attribute: channel.attribute || label })
      }
      channels.sort((a, b) => a.offset - b.offset)
      if (channels.length > 0) modes.push({ name: mode.name || 'Modo', channels })
    }
    if (modes.length === 0) continue
    profiles.push({
      id: uid(),
      name: item.name,
      manufacturer: item.manufacturer || 'Sin fabricante',
      modes,
      source: 'library',
      importedAt: Date.now()
    })
  }
  return profiles
}
