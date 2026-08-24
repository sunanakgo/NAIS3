import { extname } from 'path'
import {
  BACKUP_FORMAT_VERSION,
  type BackupDatabaseV1,
  type BackupFile,
  type BackupRow,
  type BackupTableName
} from './types'

export const LEGACY_BACKUP_TABLES = [
  'character_folders',
  'character_prompts',
  'fragment_folders',
  'fragments',
  'vibe_folders',
  'vibe_images',
  'charref_folders',
  'charref_images',
  'scene_presets',
  'gen_scenes',
  'prompt_presets'
] as const satisfies readonly BackupTableName[]

const FILE_BACKED_TABLES = new Set<BackupTableName>(['vibe_images', 'charref_images'])

type LegacyRow = Record<string, unknown>

function decodeLegacyValue(value: unknown): BackupRow[string] {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value)
    if (entries.length === 1 && entries[0][0] === '__blob' && typeof entries[0][1] === 'string') {
      return Buffer.from(entries[0][1], 'base64')
    }
  }
  if (value === null || typeof value === 'string' || typeof value === 'number') return value
  throw new Error('Legacy backup contains an invalid database value')
}

export function legacyNais3ToBackupDatabase(data: Record<string, unknown>): {
  database: BackupDatabaseV1
  skippedFiles: number
} {
  if (data._app !== 'NAIS3') throw new Error('This is not a NAIS3 JSON backup')
  if (typeof data._version === 'number' && data._version > 1) {
    throw new Error(`Unsupported legacy NAIS3 backup version: ${data._version}`)
  }
  if (!data.tables || typeof data.tables !== 'object' || Array.isArray(data.tables)) {
    throw new Error('Legacy NAIS3 backup is missing tables')
  }

  const sourceTables = data.tables as Record<string, unknown>
  const tables: BackupDatabaseV1['tables'] = {}
  const files: BackupFile[] = []
  let skippedFiles = 0

  for (const table of LEGACY_BACKUP_TABLES) {
    const sourceRows = sourceTables[table]
    if (!Array.isArray(sourceRows))
      throw new Error(`Legacy NAIS3 backup is missing table: ${table}`)
    const rows: BackupRow[] = []
    for (const value of sourceRows) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`Legacy NAIS3 backup contains an invalid ${table} row`)
      }
      const sourceRow = value as LegacyRow
      const row: BackupRow = {}
      for (const [column, columnValue] of Object.entries(sourceRow)) {
        if (column === '__image') continue
        row[column] = decodeLegacyValue(columnValue)
      }

      if (FILE_BACKED_TABLES.has(table)) {
        if (typeof row.id !== 'number') throw new Error(`${table} row is missing a numeric id`)
        if (typeof sourceRow.__image !== 'string') {
          skippedFiles++
          continue
        }
        files.push({
          table,
          rowId: row.id,
          column: 'file_path',
          extension: typeof row.file_path === 'string' ? extname(row.file_path) : '.bin',
          data: Buffer.from(sourceRow.__image, 'base64')
        })
        row.file_path = ''
      }
      rows.push(row)
    }
    tables[table] = rows
  }

  if (
    data.mainParams !== null &&
    data.mainParams !== undefined &&
    typeof data.mainParams !== 'string'
  ) {
    throw new Error('Legacy NAIS3 backup contains invalid mainParams')
  }
  return {
    database: {
      version: BACKUP_FORMAT_VERSION,
      includedTables: [...LEGACY_BACKUP_TABLES],
      tables,
      mainParams: data.mainParams ?? null,
      files
    },
    skippedFiles
  }
}
