import { createHash, randomUUID } from 'crypto'
import { createWriteStream } from 'fs'
import { open, rename, rm, type FileHandle } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { Transform, type Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { ZipFile } from 'yazl'

export interface ZipEntryDigest {
  sha256: string
  bytes: number
}

export interface ZipStreamWriter {
  /** Queues an in-memory entry. `compress` deflates it; off stores it as is (already-compressed images). */
  addBuffer(path: string, data: Buffer, options: { compress: boolean }): void
  /**
   * Streams a file from disk into the archive and resolves once it has been read through, so
   * only one source file is open at a time. Resolves null and adds nothing when the file cannot
   * be opened (deleted or moved since the rows were read) or is not a regular file.
   * A read error after the entry has started rejects: the archive can no longer be completed.
   */
  addFile(
    path: string,
    sourcePath: string,
    options: { compress: boolean }
  ): Promise<ZipEntryDigest | null>
}

async function openRegularFile(sourcePath: string): Promise<FileHandle | null> {
  let handle: FileHandle
  try {
    handle = await open(sourcePath, 'r')
  } catch {
    return null
  }
  try {
    if ((await handle.stat()).isFile()) return handle
  } catch {
    // treated as unreadable below
  }
  await handle.close().catch(() => {})
  return null
}

/**
 * Writes a ZIP archive to `destination` entry by entry. Memory stays near one read buffer instead
 * of holding every source file and the finished archive at once, and the event loop keeps serving
 * other requests between chunks. The archive goes to a temporary file beside the destination and
 * is renamed into place only when complete, so a failure never leaves a truncated archive there
 * (and never replaces an existing file at that path).
 */
export async function writeZipFile<T>(
  destination: string,
  build: (zip: ZipStreamWriter) => Promise<T>
): Promise<T> {
  const temporary = join(dirname(destination), `.${basename(destination)}.${randomUUID()}.partial`)
  const zip = new ZipFile()
  const output = zip.outputStream as Readable
  const written = pipeline(output, createWriteStream(temporary, { flags: 'wx' }))
  // yazl reports failures as 'error' events; one without a listener would crash the main process.
  // Any failure of the archive or of the output file must also stop a pending addFile().
  const failure = new Promise<never>((_, reject) => {
    zip.on('error', reject)
    written.catch(reject)
  })
  failure.catch(() => {})
  const mtime = new Date()

  const writer: ZipStreamWriter = {
    addBuffer(path, data, { compress }) {
      zip.addBuffer(data, path, { mtime, compress })
    },
    async addFile(path, sourcePath, { compress }) {
      const handle = await openRegularFile(sourcePath)
      if (!handle) return null
      const source = handle.createReadStream()
      const hash = createHash('sha256')
      let bytes = 0
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          hash.update(chunk)
          bytes += chunk.length
          callback(null, chunk)
        }
      })
      // pipe() does not forward source errors, and yazl does not watch the stream it is given,
      // so a read error is caught here; otherwise the archive would wait for the entry forever.
      const readThrough = new Promise<void>((resolve, reject) => {
        source.once('error', reject)
        meter.once('end', resolve)
      })
      readThrough.catch(() => {}) // settled through the race below; never left unhandled
      try {
        zip.addReadStream(meter, path, { mtime, compress }) // throws on an invalid entry path
        source.pipe(meter)
        await Promise.race([readThrough, failure])
      } catch (error) {
        source.destroy()
        throw error
      }
      return { sha256: hash.digest('hex'), bytes }
    }
  }

  try {
    const result = await build(writer)
    zip.end()
    await Promise.race([written, failure])
    await rename(temporary, destination)
    return result
  } catch (error) {
    output.destroy(error instanceof Error ? error : new Error(String(error)))
    await written.catch(() => {})
    await rm(temporary, { force: true })
    throw error
  }
}
