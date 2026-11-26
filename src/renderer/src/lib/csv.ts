import type { Cue } from '@shared/types'
import { cueByIdMap, cueDuration, targetNames } from './format'
import { cueTypeLabel } from './cues'

function cell(value: string | number | boolean): string {
  const text = String(value)
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Lista de cues en CSV (separador «;», compatible con Excel en español). */
export function cuesToCsv(cues: Cue[]): string {
  const byId = cueByIdMap(cues)
  const rows: (string | number | boolean)[][] = [
    [
      'Número',
      'Tipo',
      'Nombre',
      'Archivo',
      'Destino',
      'Pre-espera',
      'Duración',
      'Post-espera',
      'Auto',
      'Armado',
      'Atajo',
      'MIDI',
      'Notas'
    ]
  ]

  for (const cue of cues) {
    const duration = cueDuration(cue, byId)
    rows.push([
      cue.number,
      cueTypeLabel(cue.type),
      cue.name,
      cue.type === 'audio' || cue.type === 'video' ? cue.filePath : '',
      targetNames(cue, byId),
      cue.preWait.toFixed(2),
      Number.isFinite(duration) ? duration.toFixed(2) : 'infinito',
      cue.postWait.toFixed(2),
      cue.autoContinue ? 'sí' : 'no',
      cue.armed === false ? 'no' : 'sí',
      cue.hotkey,
      cue.midiNote >= 0
        ? `${cue.midiNote}${cue.midiChannel > 0 ? ` (canal ${cue.midiChannel})` : ''}`
        : '',
      cue.notes.replace(/\n/g, ' ')
    ])
  }

  return `\ufeff${rows.map((row) => row.map(cell).join(';')).join('\r\n')}\r\n`
}
