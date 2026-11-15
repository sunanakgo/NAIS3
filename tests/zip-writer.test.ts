import { createHash, randomBytes } from 'crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import JSZip from 'jszip'
import { Readable } from 'stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeZipFile } from '../src/main/zip-writer'

// A source path ending in .broken opens normally but fails partway through reading
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>()
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args)
      if (!String(args[0]).endsWith('.broken')) return handle
      return Object.assign(Object.create(handle), {
        createReadStream: () =>
          new Readable({
            read() {
              this.push(Buffer.alloc(1024))
              this.destroy(new Error('read failed'))
            }
          }),
        close: () => handle.close()
      })
    }
  }
})

let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'nais3-zip-writer-'))
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

describe('streaming ZIP writer', () => {
  it('streams files and buffers into an archive JSZip can read', async () => {
    // Larger than one read chunk, so the file is hashed across several chunks
    const image = randomBytes(300 * 1024)
    const imagePath = join(directory, 'source.png')
    writeFileSync(imagePath, image)
    const destination = join(directory, 'out.zip')

    const digest = await writeZipFile(destination, async (zip) => {
      const result = await zip.addFile('씬 이름.png', imagePath, { compress: false })
      zip.addBuffer('data.json', Buffer.from('{"a":1}'), { compress: true })
      return result
    })

    expect(digest).toEqual({ sha256: sha256(image), bytes: image.byteLength })
    const archive = await JSZip.loadAsync(readFileSync(destination))
    expect(await archive.file('씬 이름.png')!.async('nodebuffer')).toEqual(image)
    expect(await archive.file('data.json')!.async('string')).toBe('{"a":1}')
    expect(readdirSync(directory).sort()).toEqual(['out.zip', 'source.png'])
  })

  it('adds nothing for a missing file or a directory', async () => {
    mkdirSync(join(directory, 'folder'))
    const destination = join(directory, 'out.zip')

    const results = await writeZipFile(destination, async (zip) => [
      await zip.addFile('missing.png', join(directory, 'missing.png'), { compress: false }),
      await zip.addFile('folder.png', join(directory, 'folder'), { compress: false })
    ])

    expect(results).toEqual([null, null])
    const archive = await JSZip.loadAsync(readFileSync(destination))
    expect(Object.keys(archive.files)).toEqual([])
  })

  it('keeps the existing destination and removes the partial file on failure', async () => {
    const imagePath = join(directory, 'source.png')
    writeFileSync(imagePath, randomBytes(64 * 1024))
    const destination = join(directory, 'out.zip')
    writeFileSync(destination, 'previous export')

    await expect(
      writeZipFile(destination, async (zip) => {
        await zip.addFile('source.png', imagePath, { compress: false })
        throw new Error('stopped')
      })
    ).rejects.toThrow('stopped')

    expect(readFileSync(destination, 'utf-8')).toBe('previous export')
    expect(readdirSync(directory).sort()).toEqual(['out.zip', 'source.png'])
  })

  it('rejects an invalid entry path without leaving the source open or a partial file', async () => {
    const imagePath = join(directory, 'source.png')
    writeFileSync(imagePath, 'png')
    const destination = join(directory, 'out.zip')

    await expect(
      writeZipFile(destination, (zip) =>
        zip.addFile('../escape.png', imagePath, { compress: false })
      )
    ).rejects.toThrow('invalid relative path')

    expect(readdirSync(directory)).toEqual(['source.png'])
  })

  it('fails instead of waiting forever when a file stops reading partway', async () => {
    const brokenPath = join(directory, 'source.broken')
    writeFileSync(brokenPath, 'data')
    const destination = join(directory, 'out.zip')

    await expect(
      writeZipFile(destination, (zip) => zip.addFile('source.png', brokenPath, { compress: false }))
    ).rejects.toThrow('read failed')

    expect(readdirSync(directory)).toEqual(['source.broken'])
  })
})
