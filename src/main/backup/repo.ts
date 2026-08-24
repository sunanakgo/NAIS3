import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { extname, join } from 'path'
import { createNaisArchive, readNaisArchive } from './archive'
import { legacyNais3ToBackupDatabase, LEGACY_BACKUP_TABLES } from './legacy'
import {
  BACKUP_FORMAT_VERSION,
  BACKUP_TABLES,
  type BackupDatabaseV1,
  type BackupFile,
  type BackupRow,
  type BackupTableName
} from './types'
import { getDb } from '../db'
import { getSetting, setSetting } from '../db/settings'
import { imagesRoot } from '../images/storage'

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

/** Capture all portable workspace data. Rows whose required source file is missing are skipped. */
export function captureBackupDatabase(): {
  database: BackupDatabaseV1
  skippedFiles: number
} {
  const db = getDb()
  const tables: BackupDatabaseV1['tables'] = {}
  const files: BackupFile[] = []
  let skippedFiles = 0

  for (const table of BACKUP_TABLES) {
    const sourceRows = db.prepare(`SELECT * FROM ${table}`).all() as DbRow[]
    const rows: BackupRow[] = []
    for (const sourceRow of sourceRows) {
      const row = { ...sourceRow }
      if (FILE_BACKED_TABLES.has(table)) {
        if (typeof row.id !== 'number' || typeof row.file_path !== 'string') {
          throw new Error(`${table} contains an invalid file row`)
        }
        try {
          files.push({
            table,
            rowId: row.id,
            column: 'file_path',
            extension: normalizedExtension(row.file_path),
            data: readFileSync(row.file_path)
          })
          row.file_path = ''
        } catch {
          skippedFiles++
          continue
        }
      }
      rows.push(row)
    }
    tables[table] = rows
  }

  return {
    database: {
      version: BACKUP_FORMAT_VERSION,
      includedTables: [...BACKUP_TABLES],
      tables,
      mainParams: getSetting('main_params') || null,
      files
    },
    skippedFiles
  }
}

export async function exportNais(appVersion: string): Promise<{
  archive: Buffer
  skippedFiles: number
}> {
  const { database, skippedFiles } = captureBackupDatabase()
  return { archive: await createNaisArchive(database, appVersion), skippedFiles }
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

/** Restore a validated snapshot, replacing only the tables declared by that format. */
export function restoreBackupDatabase(database: BackupDatabaseV1): { imported: number } {
  const tables = validateRows(database)
  const fileMap = new Map(
    database.files.map((file) => [`${file.table}:${file.rowId}:${file.column}`, file])
  )
  const importRoot = join(imagesRoot(), '_imported', randomUUID())
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
    const transaction = db.transaction(() => {
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
      if (typeof database.mainParams === 'string') {
        setSetting('main_params', database.mainParams)
      }
    })
    transaction()
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
