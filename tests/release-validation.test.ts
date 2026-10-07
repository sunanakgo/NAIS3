import { createHash } from 'crypto'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import JSZip from 'jszip'
import { parse, stringify } from 'yaml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  expectedAssets,
  verifyAssets,
  verifyDraftOnly,
  verifyVersion
} from '../scripts/verify-release.mjs'

const version = '1.0.26'
let directory: string

async function macZip(arch: string, bundleVersion = version): Promise<void> {
  const zip = new JSZip()
  zip.file(
    'NAIS3.app/Contents/Info.plist',
    `<plist><dict>
    <key>CFBundleShortVersionString</key><string>${bundleVersion}</string>
    <key>CFBundleIdentifier</key><string>com.sunanakgo.nais3</string>
    <key>CFBundleExecutable</key><string>NAIS3</string>
  </dict></plist>`
  )
  zip.file('NAIS3.app/Contents/MacOS/NAIS3', 'fixture executable')
  zip.file('NAIS3.app/Contents/Resources/app.asar', 'fixture archive')
  await writeFile(
    join(directory, `nais3-${version}-${arch}-mac.zip`),
    await zip.generateAsync({ type: 'nodebuffer' })
  )
}

async function updateFeed(feed: string, installer: string): Promise<void> {
  const bytes = await readFile(join(directory, installer))
  const sha512 = createHash('sha512').update(bytes).digest('base64')
  await writeFile(
    join(directory, feed),
    stringify({
      version,
      path: installer,
      sha512,
      releaseDate: '2026-09-13T00:00:00.000Z',
      files: [{ url: installer, sha512, size: bytes.length }]
    })
  )
}

const appImage = `nais3-${version}-x86_64.AppImage`
// ELF magic, then the type 2 AppImage marker at offset 8.
const appImageHeader = Buffer.from('\x7fELF\x02\x01\x01\x00AI\x02', 'latin1')

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'nais3-release-test-'))
  for (const name of expectedAssets(version)) await writeFile(join(directory, name), 'fixture data')
  await writeFile(
    join(directory, appImage),
    Buffer.concat([appImageHeader, Buffer.from('fixture data')])
  )
  await updateFeed('latest.yml', `nais3-${version}-setup.exe`)
  await updateFeed('latest-linux.yml', appImage)
  await macZip('arm64')
  await macZip('x64')
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await rm(directory, { recursive: true, force: true })
})

describe('release validation gates', () => {
  it('requires the exact stable version instead of allowing mismatched or prerelease tags', () => {
    expect(() => verifyVersion(version, 'v1.0.26')).not.toThrow()
    expect(() => verifyVersion(version, 'v1.0.25')).toThrow()
    expect(() => verifyVersion(version, 'v1.0.26-rc.1')).toThrow()
    expect(() => verifyVersion('1.0.26-rc.1', 'v1.0.26-rc.1')).toThrow()
  })

  it('accepts the complete nine-file release contract', async () => {
    expect(await verifyAssets(directory, version)).toHaveLength(9)
  })

  it('rejects a non-AppImage file and a stale Linux update feed', async () => {
    await writeFile(join(directory, appImage), 'fixture data')
    await updateFeed('latest-linux.yml', appImage)
    await expect(verifyAssets(directory, version)).rejects.toThrow('Not an ELF')
    await writeFile(
      join(directory, appImage),
      Buffer.from('\x7fELF\x02\x01\x01\x00\x00\x00\x00', 'latin1')
    )
    await updateFeed('latest-linux.yml', appImage)
    await expect(verifyAssets(directory, version)).rejects.toThrow('Not an AppImage')
    await writeFile(
      join(directory, appImage),
      Buffer.concat([appImageHeader, Buffer.from('modified')])
    )
    await expect(verifyAssets(directory, version)).rejects.toThrow('Linux installer')
  })

  it('blocks missing files and unexpected public assets', async () => {
    const file = join(directory, `nais3-${version}-arm64.dmg`)
    await rm(file)
    await expect(verifyAssets(directory, version)).rejects.toThrow('Unexpected or missing')
    await writeFile(file, 'fixture')
    await writeFile(join(directory, 'unexpected.txt'), 'not a release asset')
    await expect(verifyAssets(directory, version)).rejects.toThrow('Unexpected or missing')
  })

  it('rejects empty assets and an installer modified after generating latest.yml', async () => {
    const blockmap = join(directory, `nais3-${version}-setup.exe.blockmap`)
    await writeFile(blockmap, '')
    await expect(verifyAssets(directory, version)).rejects.toThrow('Empty or invalid')
    await writeFile(blockmap, 'fixture')
    // Same byte count, different content: checksum verification must catch it.
    await writeFile(join(directory, `nais3-${version}-setup.exe`), 'FIXTURE DATA')
    await expect(verifyAssets(directory, version)).rejects.toThrow('checksum mismatch')
  })

  it('rejects stale update metadata and a stale Mac bundle inside a correctly named ZIP', async () => {
    await macZip('x64', '1.0.25')
    await expect(verifyAssets(directory, version)).rejects.toThrow('Mac app version mismatch')
    await macZip('x64')
    const metadata = parse(await readFile(join(directory, 'latest.yml'), 'utf8'))
    metadata.version = '1.0.25'
    await writeFile(join(directory, 'latest.yml'), stringify(metadata))
    await expect(verifyAssets(directory, version)).rejects.toThrow(
      'Windows update version mismatch'
    )
  })

  it('permits absent/draft releases but rejects published releases and API failures', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    fetch.mockResolvedValueOnce(new Response(null, { status: 404 }))
    await expect(verifyDraftOnly('owner/repo', 'v1.0.26', 'fixture-token')).resolves.toBeUndefined()
    fetch.mockResolvedValueOnce(Response.json({ draft: true }))
    await expect(verifyDraftOnly('owner/repo', 'v1.0.26', 'fixture-token')).resolves.toBeUndefined()
    fetch.mockResolvedValueOnce(Response.json({ draft: false }))
    await expect(verifyDraftOnly('owner/repo', 'v1.0.26', 'fixture-token')).rejects.toThrow(
      'already published'
    )
    fetch.mockResolvedValueOnce(new Response(null, { status: 403 }))
    await expect(verifyDraftOnly('owner/repo', 'v1.0.26', 'fixture-token')).rejects.toThrow(
      'HTTP 403'
    )
  })
})
