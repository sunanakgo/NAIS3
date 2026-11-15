import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hasZipSignature, readNaisArchive, writeNaisArchive } from '../src/main/backup/archive'
import { legacyNais3ToBackupDatabase } from '../src/main/backup/legacy'
import type { BackupArchiveSource } from '../src/main/backup/types'

let directory: string
let vibePath: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'nais3-backup-archive-'))
  vibePath = join(directory, 'vibe.webp')
  writeFileSync(vibePath, 'webp-data')
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

async function createNaisArchive(
  source: BackupArchiveSource,
  appVersion: string,
  createdAt?: string
): Promise<Buffer> {
  const destination = join(directory, 'backup.nais')
  await writeNaisArchive(destination, source, appVersion, createdAt)
  return readFileSync(destination)
}

function fixture(): BackupArchiveSource {
  return {
    version: 1,
    includedTables: ['character_folders', 'character_prompts', 'vibe_images'],
    tables: {
      character_folders: [{ id: 1, name: 'People', sort_order: 0, collapsed: 0, color: null }],
      character_prompts: [
        {
          id: 2,
          name: 'Alice',
          prompt: 'alice',
          negative_prompt: '',
          thumbnail: Buffer.from('thumbnail'),
          settings_json: '{}',
          sort_order: 0,
          created_at: '2026-08-24',
          updated_at: '2026-08-24',
          enabled: 1,
          center_x: 0.5,
          center_y: 0.5,
          folder_id: 1,
          folder: null
        }
      ],
      vibe_images: [
        {
          id: 3,
          name: 'Vibe',
          file_path: '/original/vibe.webp',
          thumbnail: null,
          enabled: 0,
          strength: 0.6,
          info_extracted: 0.7,
          encoded: null,
          encoded_ie: null,
          folder_id: null,
          sort_order: 0,
          created_at: '2026-08-24'
        }
      ]
    },
    mainParams: '{"prompt":"hello"}',
    files: [
      {
        table: 'vibe_images',
        rowId: 3,
        column: 'file_path',
        extension: '.webp',
        sourcePath: vibePath
      }
    ]
  }
}

describe('.nais backup archive', () => {
  it('round-trips split JSON, blobs, and file assets', async () => {
    const buffer = await createNaisArchive(fixture(), '1.0.23', '2026-08-24T00:00:00.000Z')
    expect(hasZipSignature(buffer)).toBe(true)

    const zip = await JSZip.loadAsync(buffer)
    expect(zip.file('manifest.json')).not.toBeNull()
    expect(zip.file('data/tables/character_prompts.json')).not.toBeNull()
    expect(zip.file('assets/files/vibe_images/3.webp')).not.toBeNull()

    const restored = await readNaisArchive(buffer)
    expect(restored.mainParams).toBe('{"prompt":"hello"}')
    expect(restored.tables.character_prompts?.[0].thumbnail).toEqual(Buffer.from('thumbnail'))
    expect(restored.files).toEqual([
      expect.objectContaining({
        table: 'vibe_images',
        rowId: 3,
        extension: '.webp',
        data: Buffer.from('webp-data')
      })
    ])
  })

  it('leaves out a row whose file disappeared before it was written', async () => {
    rmSync(vibePath)
    const destination = join(directory, 'backup.nais')

    const { skippedFiles } = await writeNaisArchive(destination, fixture(), '1.0.23')

    expect(skippedFiles).toBe(1)
    const restored = await readNaisArchive(readFileSync(destination))
    expect(restored.tables.vibe_images).toEqual([])
    expect(restored.tables.character_prompts).toHaveLength(1)
    expect(restored.files).toEqual([])
  })

  it('keeps an existing file and leaves no partial archive when writing fails', async () => {
    const destination = join(directory, 'backup.nais')
    writeFileSync(destination, 'previous backup')
    const source = fixture()
    source.tables.vibe_images = [{ ...source.tables.vibe_images![0], id: 'not a number' }]

    await expect(writeNaisArchive(destination, source, '1.0.23')).rejects.toThrow(
      'missing a numeric id'
    )

    expect(readFileSync(destination, 'utf-8')).toBe('previous backup')
    expect(readdirSync(directory).sort()).toEqual(['backup.nais', 'vibe.webp'])
  })

  it('rejects an asset modified without updating its checksum', async () => {
    const zip = await JSZip.loadAsync(await createNaisArchive(fixture(), '1.0.23'))
    zip.file('assets/files/vibe_images/3.webp', Buffer.from('tampered'))
    const tampered = await zip.generateAsync({ type: 'nodebuffer' })

    await expect(readNaisArchive(tampered)).rejects.toThrow('checksum mismatch')
  })

  it('rejects unsupported archive versions', async () => {
    const zip = await JSZip.loadAsync(await createNaisArchive(fixture(), '1.0.23'))
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
    manifest.formatVersion = 999
    zip.file('manifest.json', JSON.stringify(manifest))

    await expect(readNaisArchive(await zip.generateAsync({ type: 'nodebuffer' }))).rejects.toThrow(
      'Unsupported NAIS archive version'
    )
  })

  it('normalizes the existing NAIS3 JSON format without touching newer tables', () => {
    const legacyTables = Object.fromEntries(
      [
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
      ].map((table) => [table, []])
    )
    legacyTables.character_prompts = [
      { id: 1, name: 'Alice', thumbnail: { __blob: Buffer.from('thumb').toString('base64') } }
    ]
    legacyTables.vibe_images = [
      {
        id: 2,
        name: 'Vibe',
        file_path: '/old/vibe.webp',
        __image: Buffer.from('vibe').toString('base64')
      }
    ]

    const { database, skippedFiles } = legacyNais3ToBackupDatabase({
      _app: 'NAIS3',
      _version: 1,
      mainParams: '{}',
      tables: legacyTables
    })

    expect(skippedFiles).toBe(0)
    expect(database.includedTables).not.toContain('library_images')
    expect(database.tables.character_prompts?.[0].thumbnail).toEqual(Buffer.from('thumb'))
    expect(database.files[0]).toEqual(
      expect.objectContaining({ table: 'vibe_images', rowId: 2, data: Buffer.from('vibe') })
    )
  })
})
