import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, getDb, initDb } from '../src/main/db'
import { addRefImagesFrom, createRefFolder } from '../src/main/refs/repo'
import sharp from '../src/main/sharp'

const environment = vi.hoisted(() => ({ directory: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => environment.directory, getLocale: () => 'en-US' },
  BrowserWindow: {},
  dialog: {},
  safeStorage: { isEncryptionAvailable: () => false }
}))

function png(): Promise<Buffer> {
  return sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 40, b: 90 } }
  })
    .png()
    .toBuffer()
}

async function writeImage(path: string): Promise<string> {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, await png())
  return path
}

describe('adding references from existing images', () => {
  let root: string
  let outputDir: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'nais3-ref-images-'))
    environment.directory = root
    // app.getPath('pictures') is the same temp root, so the default save folder is under it
    outputDir = join(root, 'NAIS3', 'NAIS3_output')
    initDb()
  })
  afterEach(() => {
    closeDb()
    rmSync(root, { recursive: true, force: true })
  })

  it('copies an image from the save folder into the vibe library', async () => {
    const src = await writeImage(join(outputDir, 'portrait.png'))
    const result = await addRefImagesFrom('vibe', null, [src], [])
    expect(result).toEqual({ count: 1, failed: 0 })
    const rows = getDb().prepare('SELECT name, file_path, thumbnail FROM vibe_images').all() as {
      name: string
      file_path: string
      thumbnail: Buffer | null
    }[]
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('portrait')
    expect(rows[0].file_path.startsWith(join(root, 'refs'))).toBe(true)
    expect(rows[0].file_path).not.toBe(src)
    expect(rows[0].thumbnail?.length).toBeGreaterThan(0)
  })

  it('rejects paths outside the image folders, relative paths and non-images', async () => {
    const outside = await writeImage(join(root, 'elsewhere', 'secret.png'))
    mkdirSync(outputDir, { recursive: true })
    const textFile = join(outputDir, 'notes.txt')
    writeFileSync(textFile, 'not an image')
    const fakePng = join(outputDir, 'broken.png')
    writeFileSync(fakePng, 'not an image either')
    const result = await addRefImagesFrom(
      'charref',
      null,
      [outside, 'NAIS3/NAIS3_output/portrait.png', textFile, fakePng, join(outputDir, 'gone.png')],
      []
    )
    expect(result).toEqual({ count: 0, failed: 5 })
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM charref_images').get()).toEqual({ n: 0 })
  })

  it('adds dropped base64 images and skips undecodable ones', async () => {
    const dataUrl = `data:image/png;base64,${(await png()).toString('base64')}`
    const result = await addRefImagesFrom(
      'charref',
      null,
      [],
      [
        { name: 'dropped.png', base64: dataUrl },
        { name: 'text.png', base64: Buffer.from('hello').toString('base64') },
        { name: 'empty.png', base64: '' }
      ]
    )
    expect(result).toEqual({ count: 1, failed: 2 })
    const row = getDb().prepare('SELECT name, file_path FROM charref_images').get() as {
      name: string
      file_path: string
    }
    expect(row.name).toBe('dropped')
    expect(row.file_path.endsWith('.png')).toBe(true)
  })

  it('keeps an existing folder and falls back to the root for unknown folders', async () => {
    const src = await writeImage(join(outputDir, 'a.png'))
    const folderId = createRefFolder('vibe', 'Folder')
    await addRefImagesFrom('vibe', folderId, [src], [])
    await addRefImagesFrom('vibe', folderId + 100, [src], [])
    const folders = getDb()
      .prepare('SELECT folder_id FROM vibe_images ORDER BY sort_order')
      .all() as { folder_id: number | null }[]
    expect(folders.map((r) => r.folder_id)).toEqual([folderId, null])
  })
})
