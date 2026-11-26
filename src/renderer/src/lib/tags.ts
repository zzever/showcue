import type { Cue } from '@shared/types'

/** Paleta de etiquetas; el color se deriva del nombre para que no haya que asignarlo. */
const PALETTE = [
  '#5ad2ff',
  '#2fd07a',
  '#ffb454',
  '#ff8fa3',
  '#b98bff',
  '#7ee787',
  '#f778ba',
  '#8ab4f8',
  '#ffd166',
  '#4fd1c5'
]

export function tagColor(name: string): string {
  let hash = 0
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0
  }
  return PALETTE[hash % PALETTE.length]
}

/** Todas las etiquetas usadas en el show, sin repetir y en orden alfabético. */
export function allTags(cues: Cue[]): string[] {
  const set = new Set<string>()
  for (const cue of cues) {
    for (const tag of cue.tags ?? []) set.add(tag)
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'es'))
}

/** Limpia el texto tecleado: sin espacios sobrantes y con un máximo razonable. */
export function cleanTag(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, 24)
}

/** Añade una etiqueta a la lista si no estaba (comparando sin distinguir mayúsculas). */
export function addTag(tags: string[], tag: string): string[] {
  const clean = cleanTag(tag)
  if (!clean) return tags
  if (tags.some((item) => item.toLowerCase() === clean.toLowerCase())) return tags
  return [...tags, clean]
}
