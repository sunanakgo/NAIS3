/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { open, readFile, readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import JSZip from 'jszip'
import { parse } from 'yaml'

export function verifyVersion(version, tag) {
  assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'Stable app version required')
  assert.equal(tag, `v${version}`, 'Release tag must match package.json version')
}

export function expectedAssets(version, target = 'all') {
  const platforms = {
    'win32-x64': [
      'latest.yml',
      `nais3-${version}-setup.exe`,
      `nais3-${version}-setup.exe.blockmap`
    ],
    'darwin-arm64': [`nais3-${version}-arm64.dmg`, `nais3-${version}-arm64-mac.zip`],
    'darwin-x64': [`nais3-${version}-x64.dmg`, `nais3-${version}-x64-mac.zip`],
    'linux-x64': ['latest-linux.yml', `nais3-${version}-x86_64.AppImage`]
  }
  assert.ok(target === 'all' || Object.hasOwn(platforms, target), `Unsupported target: ${target}`)
  return target === 'all' ? Object.values(platforms).flat() : platforms[target]
}

async function hashFile(path) {
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('base64')
}

export async function verifyAssets(directory, version, target = 'all') {
  const expected = expectedAssets(version, target)
  const names = await readdir(directory)
  const publicNames =
    target === 'all'
      ? names
      : names.filter(
          (name) =>
            /(?:\.exe(?:\.blockmap)?|\.dmg|-mac\.zip|\.AppImage)$/.test(name) ||
            /^latest(?:-linux)?\.yml$/.test(name)
        )
  assert.deepEqual(publicNames.sort(), [...expected].sort(), 'Unexpected or missing release assets')
  for (const name of expected) {
    const file = await stat(join(directory, name))
    assert.ok(file.isFile() && file.size > 0, `Empty or invalid asset: ${name}`)
  }

  const feeds = [
    ['latest.yml', `nais3-${version}-setup.exe`, 'Windows'],
    ['latest-linux.yml', `nais3-${version}-x86_64.AppImage`, 'Linux']
  ]
  for (const [feed, installer, label] of feeds.filter(([feed]) => expected.includes(feed))) {
    const file = join(directory, installer)
    const metadata = parse(await readFile(join(directory, feed), 'utf8'))
    assert.equal(metadata.version, version, `${label} update version mismatch`)
    assert.equal(metadata.path, installer, `${label} update path mismatch`)
    assert.equal(metadata.files?.length, 1, `Expected exactly one ${label} installer`)
    assert.equal(metadata.files[0].url, installer, `${label} update URL mismatch`)
    assert.equal(
      metadata.files[0].size,
      (await stat(file)).size,
      `${label} installer size mismatch`
    )
    const hash = await hashFile(file)
    assert.equal(metadata.sha512, hash, `${label} installer checksum mismatch`)
    assert.equal(metadata.files[0].sha512, hash, `${label} update file checksum mismatch`)
    assert.ok(Number.isFinite(Date.parse(metadata.releaseDate)), `Missing ${label} release date`)
  }

  for (const name of expected.filter((name) => name.endsWith('.AppImage'))) {
    // Type 2 AppImage: an ELF executable with the "AI\x02" marker at offset 8.
    const header = Buffer.alloc(11)
    const handle = await open(join(directory, name))
    try {
      await handle.read(header, 0, header.length, 0)
    } finally {
      await handle.close()
    }
    assert.ok(header.subarray(0, 4).equals(Buffer.from('\x7fELF', 'latin1')), `Not an ELF: ${name}`)
    assert.ok(
      header.subarray(8, 11).equals(Buffer.from('AI\x02', 'latin1')),
      `Not an AppImage: ${name}`
    )
  }

  for (const name of expected.filter((name) => name.endsWith('-mac.zip'))) {
    const zip = await JSZip.loadAsync(await readFile(join(directory, name)))
    const plistFile = zip.file('NAIS3.app/Contents/Info.plist')
    assert.ok(plistFile, `Missing NAIS3.app Info.plist: ${name}`)
    assert.ok(zip.file('NAIS3.app/Contents/MacOS/NAIS3'), `Missing app executable: ${name}`)
    assert.ok(zip.file('NAIS3.app/Contents/Resources/app.asar'), `Missing app code: ${name}`)
    const plist = await plistFile.async('string')
    const value = (key) =>
      plist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`))?.[1]
    assert.equal(value('CFBundleShortVersionString'), version, `Mac app version mismatch: ${name}`)
    assert.equal(value('CFBundleIdentifier'), 'com.sunanakgo.nais3', `Mac app ID mismatch: ${name}`)
    assert.equal(value('CFBundleExecutable'), 'NAIS3', `Mac executable mismatch: ${name}`)
  }
  return expected
}

/** A rerun must never replace assets of an already published release. */
export async function verifyDraftOnly(repo, tag, token, api = 'https://api.github.com') {
  assert.ok(repo && token, 'GITHUB_REPOSITORY and GH_TOKEN are required')
  const response = await fetch(`${api}/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
  })
  if (response.status === 404) return
  assert.ok(response.ok, `Unable to inspect release state: HTTP ${response.status}`)
  const release = await response.json()
  assert.equal(release.draft, true, 'Refusing to modify an already published release')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { version } = JSON.parse(await readFile('package.json', 'utf8'))
  const [mode, argument, directory = 'dist'] = process.argv.slice(2)
  if (mode === 'version') {
    verifyVersion(version, argument)
    assert.ok(
      (await readFile(`release-notes/${argument}.md`, 'utf8')).trim(),
      'Release notes are required'
    )
    console.log(`Release tag, app version and notes verified: ${argument}`)
  } else if (mode === 'assets') {
    const assets = await verifyAssets(directory, version, argument ?? 'all')
    console.log(`Verified ${assets.length} release assets for ${version}: ${assets.join(', ')}`)
  } else if (mode === 'draft') {
    verifyVersion(version, argument)
    await verifyDraftOnly(
      process.env.GITHUB_REPOSITORY,
      argument,
      process.env.GH_TOKEN,
      process.env.GITHUB_API_URL
    )
    console.log(`Release ${argument} is absent or still a draft`)
  } else {
    throw new Error(
      'Usage: verify-release.mjs version <tag> | assets <target|all> [directory] | draft <tag>'
    )
  }
}
