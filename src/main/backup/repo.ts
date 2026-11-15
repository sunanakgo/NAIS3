import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { extname, join } from 'path'
import { readNaisArchive, writeNaisArchive } from './archive'
import { legacyNais3ToBackupDatabase, LEGACY_BACKUP_TABLES } from './legacy'
import {
  BACKUP_FORMAT_VERSION,
  BACKUP_TABLES,
  type BackupArchiveSource,
  type BackupDatabaseV1,
  type BackupFile,
  type BackupRow,
  type BackupSourceFile,
  type BackupTableName
} from './types'
import { getDb } from '../db'
import { getSetting, setSetting } from '../db/settings'
import { libraryRoot } from '../images/storage'
import { sceneEvents } from '../scenes/events'

const FILE_BACKED_TABLES = new Set<BackupTableName>([
  'vibe_images',
  'charref_images',
  'library_images'
])

type DbRow = Record<string, string | number | null | Buffer>

function encodeLegacyValue(value: DbRow[string]): unknown {
  if (Buffer.isBuffer(value)) return { __blob: value.toString('base64') }
  return value
}

function normalizedExtension(value: string): string {
  const extension = (value.startsWith('.') ? value : extname(value)).toLowerCase()
  return /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : '.bin'
}

/** Preserve the original NAIS3 JSON export shape for older application versions. */
export function exportLegacyJson(): Record<string, unknown> {
  const db = getDb()
  const tables: Record<string, Record<string, unknown>[]> = {}
  for (const table of LEGACY_BACKUP_TABLES) {
    const rows = db.prepare(`SELECT * FROM ${table}`).all() as DbRow[]
    tables[table] = rows.map((row) => {
      const output: Record<string, unknown> = {}
      for (const [column, value] of Object.entries(row)) output[column] = encodeLegacyValue(value)
      if (FILE_BACKED_TABLES.has(table) && typeof row.file_path === 'string') {
        try {
          output.__image = readFileSync(row.file_path).toString('base64')
        } catch {
          output.__image = null
        }
      }
      return output
    })
  }
  return {
    _app: 'NAIS3',
    _version: 1,
    mainParams: getSetting('main_params') || null,
    tables
  }
}

/**
 * Capture all portable workspace rows in one synchronous pass, so the snapshot is consistent.
 * File-backed rows keep only their source path; the files are streamed later by the writer.
 */
export function captureBackupSource(): BackupArchiveSource {
  const db = getDb()
  const tables: BackupArchiveSource['tables'] = {}
  const files: BackupSourceFile[] = []

  for (const table of BACKUP_TABLES) {
    const sourceRows = db.prepare(`SELECT * FROM ${table}`).all() as DbRow[]
    const rows: BackupRow[] = []
    for (const sourceRow of sourceRows) {
      const row = { ...sourceRow }
      if (FILE_BACKED_TABLES.has(table)) {
        if (typeof row.id !== 'number' || typeof row.file_path !== 'string') {
          throw new Error(`${table} contains an invalid file row`)
        }
        files.push({
          table,
          rowId: row.id,
          column: 'file_path',
          extension: normalizedExtension(row.file_path),
          sourcePath: row.file_path
        })
        row.file_path = ''
      }
      rows.push(row)
    }
    tables[table] = rows
  }

  return {
    version: BACKUP_FORMAT_VERSION,
    includedTables: [...BACKUP_TABLES],
    tables,
    mainParams: getSetting('main_params') || null,
    files
  }
}

/**
 * In-memory snapshot with every file read, for restoring without an archive round trip.
 * Rows whose source file is missing are skipped.
 */
export function captureBackupDatabase(): {
  database: BackupDatabaseV1
  skippedFiles: number
} {
  const source = captureBackupSource()
  const sources = new Map(source.files.map((file) => [`${file.table}:${file.rowId}`, file]))
  const files: BackupFile[] = []
  const tables: BackupDatabaseV1['tables'] = {}
  let skippedFiles = 0

  for (const table of source.includedTables) {
    tables[table] = (source.tables[table] ?? []).filter((row) => {
      const file = sources.get(`${table}:${row.id}`)
      if (!file) return true
      try {
        files.push({
          table,
          rowId: file.rowId,
          column: 'file_path',
          extension: file.extension,
          data: readFileSync(file.sourcePath)
        })
        return true
      } catch {
        skippedFiles++
        return false
      }
    })
  }

  return { database: { ...source, tables, files }, skippedFiles }
}

/** Write a .nais archive of the workspace to `destination` (replaced only once it is complete). */
export async function exportNais(
  destination: string,
  appVersion: string
): Promise<{ skippedFiles: number }> {
  return writeNaisArchive(destination, captureBackupSource(), appVersion)
}

function tableColumns(table: BackupTableName): Set<string> {
  const rows = getDb().prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return new Set(rows.map((row) => row.name))
}

function validateRows(database: BackupDatabaseV1): Partial<Record<BackupTableName, BackupRow[]>> {
  if (database.version !== BACKUP_FORMAT_VERSION) {
    throw new Error(`Unsupported backup database version: ${database.version}`)
  }
  if (new Set(database.includedTables).size !== database.includedTables.length) {
    throw new Error('Backup database contains duplicate tables')
  }

  const result: Partial<Record<BackupTableName, BackupRow[]>> = {}
  for (const table of database.includedTables) {
    const rows = database.tables[table]
    if (!Array.isArray(rows)) throw new Error(`Backup database is missing table: ${table}`)
    const allowedColumns = tableColumns(table)
    result[table] = rows.map((sourceRow) => {
      const row: BackupRow = {}
      for (const [column, value] of Object.entries(sourceRow)) {
        if (!allowedColumns.has(column)) throw new Error(`Unknown ${table} column: ${column}`)
        if (
          value !== null &&
          typeof value !== 'string' &&
          typeof value !== 'number' &&
          !Buffer.isBuffer(value)
        ) {
          throw new Error(`Invalid ${table}.${column} value`)
        }
        row[column] = value
      }
      if (typeof row.id !== 'number') throw new Error(`${table} row is missing a numeric id`)
      return row
    })
  }
  return result
}

/**
 * Generation history (`images`) is not part of a backup, but `images.scene_id` references
 * `gen_scenes(id) ON DELETE SET NULL`. Replacing `gen_scenes` during restore would therefore
 * unlink every image from its scene. A `PRAGMA foreign_key_list` audit of every table after
 * all migrations shows this is the only foreign key from a table outside BACKUP_TABLES into
 * one inside it (the folder links point between backup tables, and gen_scenes.preset_id has
 * no declared FK), so nothing else is nulled or cascaded.
 *
 * A link is put back only when the restored data holds what is recognisably the same scene:
 * the same id and the same creation time. A numeric id alone is not trusted, because a backup
 * from another machine or an older state can reuse an id for an unrelated scene; such images
 * stay unlinked (NULL) rather than joining the wrong gallery. `created_at` is set once when the
 * scene is created, never edited, and travels in every backup, so it tells those scenes apart.
 * Names are deliberately not compared: renaming a scene or its preset after taking the backup
 * must not unlink the scene's own images.
 * Scene covers and image counts are derived from `images.scene_id` by the scene queries,
 * so restoring the links keeps them consistent as well.
 */
const SCENE_IDENTITY_SQL = 'SELECT id, created_at FROM gen_scenes'

function captureSceneLinks(db: ReturnType<typeof getDb>): {
  /** created_at of every scene before the restore, by id */
  scenes: Map<number, string>
  images: { id: number; scene_id: number }[]
} {
  const images = db.prepare('SELECT id, scene_id FROM images WHERE scene_id IS NOT NULL').all() as {
    id: number
    scene_id: number
  }[]
  const rows = db.prepare(SCENE_IDENTITY_SQL).all() as { id: number; created_at: string }[]
  return { scenes: new Map(rows.map((row) => [row.id, row.created_at])), images }
}

/** Relink images to scenes that survived the restore; returns the ids of those scenes. */
function restoreSceneLinks(
  db: ReturnType<typeof getDb>,
  captured: ReturnType<typeof captureSceneLinks>
): Set<number> {
  const restoredCreatedAt = db.prepare('SELECT created_at FROM gen_scenes WHERE id = ?').pluck()
  const same = new Set<number>()
  for (const [id, createdAt] of captured.scenes) {
    if (restoredCreatedAt.get(id) === createdAt) same.add(id)
  }
  const relink = db.prepare('UPDATE images SET scene_id = ? WHERE id = ?')
  for (const image of captured.images) {
    if (same.has(image.scene_id)) relink.run(image.scene_id, image.id)
  }
  return same
}

/** Restore a validated snapshot, replacing only the tables declared by that format. */
export function restoreBackupDatabase(database: BackupDatabaseV1): { imported: number } {
  const tables = validateRows(database)
  const fileMap = new Map(
    database.files.map((file) => [`${file.table}:${file.rowId}:${file.column}`, file])
  )
  const importRoot = join(libraryRoot(), '_imported', randomUUID())
  let wroteFiles = false

  try {
    for (const table of database.includedTables) {
      if (!FILE_BACKED_TABLES.has(table)) continue
      for (const row of tables[table] ?? []) {
        const file = fileMap.get(`${table}:${row.id}:file_path`)
        if (!file) throw new Error(`Backup is missing the file for ${table} row ${row.id}`)
        const destination = join(
          importRoot,
          `${table}_${row.id}${normalizedExtension(file.extension)}`
        )
        mkdirSync(importRoot, { recursive: true })
        writeFileSync(destination, file.data, { flag: 'wx' })
        row.file_path = destination
        wroteFiles = true
      }
    }

    let imported = 0
    const db = getDb()
    const included = new Set(database.includedTables)
    let replacedSceneIds: number[] = []
    const transaction = db.transaction(() => {
      const sceneLinks = included.has('gen_scenes') ? captureSceneLinks(db) : null
      for (const table of [...BACKUP_TABLES].reverse()) {
        if (included.has(table)) db.prepare(`DELETE FROM ${table}`).run()
      }
      for (const table of BACKUP_TABLES) {
        if (!included.has(table)) continue
        for (const row of tables[table] ?? []) {
          const columns = Object.keys(row)
          if (columns.length === 0) throw new Error(`${table} contains an empty row`)
          const placeholders = columns.map(() => '?').join(', ')
          db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`).run(
            ...columns.map((column) => row[column])
          )
          imported++
        }
      }
      if (sceneLinks) {
        // A scene that is recognisably the same keeps its links and its queued jobs; only the
        // ones that were really replaced count as deleted for the generation queue.
        const kept = restoreSceneLinks(db, sceneLinks)
        replacedSceneIds = [...sceneLinks.scenes.keys()].filter((id) => !kept.has(id))
      }
      if (typeof database.mainParams === 'string') {
        setSetting('main_params', database.mainParams)
      }
    })
    transaction()
    if (replacedSceneIds.length > 0) sceneEvents.emit('deleted', replacedSceneIds)
    return { imported }
  } catch (error) {
    if (wroteFiles && existsSync(importRoot)) {
      rmSync(importRoot, { recursive: true, force: true })
    }
    throw error
  }
}

export async function importNais(input: Buffer): Promise<{ imported: number }> {
  return restoreBackupDatabase(await readNaisArchive(input))
}

export function importLegacyJson(data: Record<string, unknown>): {
  imported: number
  skippedFiles: number
} {
  const { database, skippedFiles } = legacyNais3ToBackupDatabase(data)
  return { ...restoreBackupDatabase(database), skippedFiles }
}

// Compatibility exports for existing main-process call sites.
export const exportAll = exportLegacyJson
export function importAll(data: Record<string, unknown>): { imported: number } {
  return importLegacyJson(data)
}
