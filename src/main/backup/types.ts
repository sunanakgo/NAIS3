export const BACKUP_FORMAT_VERSION = 1 as const

export const BACKUP_TABLES = [
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
  'prompt_presets',
  'library_stacks',
  'library_images'
] as const

export type BackupTableName = (typeof BACKUP_TABLES)[number]
export type BackupRow = Record<string, string | number | null | Buffer>

export interface BackupFile {
  table: BackupTableName
  rowId: number
  column: 'file_path'
  extension: string
  data: Buffer
}

/**
 * Normalized in-memory backup model. Both .nais archives and legacy NAIS3 JSON
 * are converted to this type before restore.
 */
export interface BackupDatabaseV1 {
  version: typeof BACKUP_FORMAT_VERSION
  includedTables: BackupTableName[]
  tables: Partial<Record<BackupTableName, BackupRow[]>>
  mainParams: string | null
  files: BackupFile[]
}

export interface NaisArchiveManifestV1 {
  format: 'NAIS'
  formatVersion: typeof BACKUP_FORMAT_VERSION
  app: 'NAIS3'
  appVersion: string
  createdAt: string
  scope: 'workspace'
  tables: BackupTableName[]
  tableCounts: Partial<Record<BackupTableName, number>>
}

export function isBackupTableName(value: unknown): value is BackupTableName {
  return typeof value === 'string' && (BACKUP_TABLES as readonly string[]).includes(value)
}
