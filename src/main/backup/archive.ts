import { createHash } from 'crypto'
import { extname } from 'path'
import JSZip from 'jszip'
import {
  BACKUP_FORMAT_VERSION,
  type BackupDatabaseV1,
  type BackupFile,
  type BackupRow,
  type BackupTableName,
  isBackupTableName,
  type NaisArchiveManifestV1
} from './types'

const MAX_ARCHIVE_ENTRIES = 100_000
const MAX_ENTRY_BYTES = 256 * 1024 * 1024
const MAX_TOTAL_BYTES = 8 * 1024 * 1024 * 1024

interface AssetReference {
  __asset: string
}

interface ChecksumEntry {
  sha256: string
  bytes: number
}

type Checksums = Record<string, ChecksumEntry>

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

function jsonBuffer(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf-8')
}

function safeSegment(value: string | number): string {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, '_') || 'item'
}

function safeExtension(value: string): string {
  const extension = (value.startsWith('.') ? value : extname(value)).toLowerCase()
  return /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : '.bin'
}

function assertSafeArchivePath(value: string): void {
  if (
    !value ||
    value.includes('\\') ||
    value.includes('\0') ||
    value.startsWith('/') ||
    /^[a-zA-Z]:/.test(value) ||
    value.split('/').some((part) => part === '..')
  ) {
    throw new Error(`Unsafe archive path: ${value}`)
  }
}

function isAssetReference(value: unknown): value is AssetReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entries = Object.entries(value)
  return entries.length === 1 && entries[0][0] === '__asset' && typeof entries[0][1] === 'string'
}

function parseJsonObject<T>(data: Buffer, label: string): T {
  try {
    const parsed = JSON.parse(data.toString('utf-8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('root value must be an object')
    }
    return parsed as T
  } catch (error) {
    throw new Error(
      `${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

function fileKey(table: BackupTableName, rowId: number, column: string): string {
  return `${table}:${rowId}:${column}`
}

function addEntry(
  zip: JSZip,
  checksums: Checksums,
  path: string,
  data: Buffer,
  store = false
): void {
  assertSafeArchivePath(path)
  zip.file(path, data, store ? { compression: 'STORE' } : undefined)
  checksums[path] = { sha256: sha256(data), bytes: data.byteLength }
}

export async function createNaisArchive(
  database: BackupDatabaseV1,
  appVersion: string,
  createdAt = new Date().toISOString()
): Promise<Buffer> {
  const zip = new JSZip()
  const checksums: Checksums = {}
  const files = new Map(
    database.files.map((file) => [fileKey(file.table, file.rowId, file.column), file])
  )
  const tableCounts: Partial<Record<BackupTableName, number>> = {}

  for (const table of database.includedTables) {
    const rows = database.tables[table]
    if (!Array.isArray(rows)) throw new Error(`Missing backup table: ${table}`)
    tableCounts[table] = rows.length
    const encodedRows = rows.map((row) => {
      const rowId = row.id
      if (typeof rowId !== 'number') throw new Error(`${table} row is missing a numeric id`)
      const encoded: Record<string, unknown> = {}
      for (const [column, value] of Object.entries(row)) {
        if (Buffer.isBuffer(value)) {
          const path = `assets/blobs/${table}/${safeSegment(rowId)}-${safeSegment(column)}.bin`
          addEntry(zip, checksums, path, value, true)
          encoded[column] = { __asset: path }
          continue
        }
        if (column === 'file_path') {
          const file = files.get(fileKey(table, rowId, column))
          if (!file) throw new Error(`Missing asset for ${table} row ${rowId}`)
          const path = `assets/files/${table}/${safeSegment(rowId)}${safeExtension(file.extension)}`
          addEntry(zip, checksums, path, file.data, true)
          encoded[column] = { __asset: path }
          continue
        }
        encoded[column] = value
      }
      return encoded
    })
    addEntry(zip, checksums, `data/tables/${table}.json`, jsonBuffer(encodedRows))
  }

  addEntry(zip, checksums, 'data/settings.json', jsonBuffer({ mainParams: database.mainParams }))
  const manifest: NaisArchiveManifestV1 = {
    format: 'NAIS',
    formatVersion: BACKUP_FORMAT_VERSION,
    app: 'NAIS3',
    appVersion,
    createdAt,
    scope: 'workspace',
    tables: [...database.includedTables],
    tableCounts
  }
  zip.file('manifest.json', jsonBuffer(manifest))
  zip.file('checksums.json', jsonBuffer(checksums))
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  })
}

export async function readNaisArchive(input: Buffer): Promise<BackupDatabaseV1> {
  const zip = await JSZip.loadAsync(input)
  const entries = Object.values(zip.files)
  if (entries.length > MAX_ARCHIVE_ENTRIES) throw new Error('Archive contains too many entries')
  for (const entry of entries) {
    assertSafeArchivePath(entry.unsafeOriginalName ?? entry.name)
    assertSafeArchivePath(entry.name)
  }

  async function readRaw(path: string): Promise<Buffer> {
    assertSafeArchivePath(path)
    const entry = zip.file(path)
    if (!entry) throw new Error(`Archive entry is missing: ${path}`)
    const data = await entry.async('nodebuffer')
    if (data.byteLength > MAX_ENTRY_BYTES) throw new Error(`Archive entry is too large: ${path}`)
    return data
  }

  const manifest = parseJsonObject<NaisArchiveManifestV1>(
    await readRaw('manifest.json'),
    'manifest.json'
  )
  if (manifest.format !== 'NAIS' || manifest.app !== 'NAIS3') {
    throw new Error('This is not a NAIS3 archive')
  }
  if (manifest.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error(`Unsupported NAIS archive version: ${String(manifest.formatVersion)}`)
  }
  if (!Array.isArray(manifest.tables) || !manifest.tables.every(isBackupTableName)) {
    throw new Error('manifest.json contains an invalid table list')
  }
  if (new Set(manifest.tables).size !== manifest.tables.length) {
    throw new Error('manifest.json contains duplicate tables')
  }

  const checksums = parseJsonObject<Checksums>(await readRaw('checksums.json'), 'checksums.json')
  let totalBytes = 0
  async function readChecked(path: string): Promise<Buffer> {
    const expected = checksums[path]
    if (
      !expected ||
      typeof expected.sha256 !== 'string' ||
      typeof expected.bytes !== 'number' ||
      expected.bytes < 0
    ) {
      throw new Error(`Checksum metadata is missing or invalid: ${path}`)
    }
    const data = await readRaw(path)
    totalBytes += data.byteLength
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error('Archive expands beyond the allowed size')
    if (data.byteLength !== expected.bytes || sha256(data) !== expected.sha256) {
      throw new Error(`Archive checksum mismatch: ${path}`)
    }
    return data
  }

  const settings = parseJsonObject<{ mainParams?: unknown }>(
    await readChecked('data/settings.json'),
    'data/settings.json'
  )
  if (settings.mainParams !== null && typeof settings.mainParams !== 'string') {
    throw new Error('data/settings.json contains invalid mainParams')
  }

  const tables: BackupDatabaseV1['tables'] = {}
  const files: BackupFile[] = []
  for (const table of manifest.tables) {
    const path = `data/tables/${table}.json`
    let parsed: unknown
    try {
      parsed = JSON.parse((await readChecked(path)).toString('utf-8'))
    } catch (error) {
      throw new Error(
        `${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    if (!Array.isArray(parsed)) throw new Error(`${path} must contain an array`)
    if (manifest.tableCounts?.[table] !== parsed.length) {
      throw new Error(`${path} row count does not match manifest.json`)
    }

    const rows: BackupRow[] = []
    for (const value of parsed) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${path} contains an invalid row`)
      }
      const decoded: BackupRow = {}
      for (const [column, columnValue] of Object.entries(value)) {
        if (isAssetReference(columnValue)) {
          if (!columnValue.__asset.startsWith('assets/')) {
            throw new Error(`Invalid asset reference in ${path}`)
          }
          const data = await readChecked(columnValue.__asset)
          if (column === 'file_path') {
            const rowId = (value as Record<string, unknown>).id
            if (typeof rowId !== 'number') throw new Error(`${path} row is missing a numeric id`)
            files.push({
              table,
              rowId,
              column: 'file_path',
              extension: safeExtension(columnValue.__asset),
              data
            })
            decoded[column] = ''
          } else {
            decoded[column] = data
          }
        } else if (
          columnValue === null ||
          typeof columnValue === 'string' ||
          typeof columnValue === 'number'
        ) {
          decoded[column] = columnValue
        } else {
          throw new Error(`${path} contains an invalid value for ${column}`)
        }
      }
      rows.push(decoded)
    }
    tables[table] = rows
  }

  return {
    version: BACKUP_FORMAT_VERSION,
    includedTables: [...manifest.tables],
    tables,
    mainParams: settings.mainParams ?? null,
    files
  }
}

export function hasZipSignature(input: Buffer): boolean {
  return input.length >= 4 && input[0] === 0x50 && input[1] === 0x4b
}
