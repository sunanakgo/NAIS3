import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { extractAll, extractFile } from '@electron/asar'

const [platform = process.platform, arch = process.arch, suppliedDirectory] = process.argv.slice(2)
assert.equal(platform, process.platform, 'Run the packaged app on its target OS')
assert.equal(arch, process.arch, 'Run the packaged app on its target architecture')
const defaultDirectory = {
  win32: 'dist/win-unpacked',
  darwin: arch === 'arm64' ? 'dist/mac-arm64' : 'dist/mac',
  linux: arch === 'x64' ? 'dist/linux-unpacked' : `dist/linux-${arch}-unpacked`
}[platform]
assert.ok(suppliedDirectory ?? defaultDirectory, `Unsupported platform: ${platform}`)
const directory = resolve(suppliedDirectory ?? defaultDirectory)
const app = platform === 'darwin' ? join(directory, 'NAIS3.app', 'Contents') : directory
const resources = join(app, platform === 'darwin' ? 'Resources' : 'resources')
const executable = {
  win32: join(app, 'NAIS3.exe'),
  darwin: join(app, 'MacOS', 'NAIS3'),
  linux: join(app, 'nais3')
}[platform]
const asar = join(resources, 'app.asar')
const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
const packaged = JSON.parse(extractFile(asar, 'package.json').toString('utf8'))
assert.equal(packaged.version, version, 'Packaged app version mismatch')
assert.equal(packaged.name, 'nais3', 'Packaged app name mismatch')

const extracted = mkdtempSync(join(tmpdir(), 'nais3-package-smoke-'))
try {
  extractAll(asar, extracted)
  // Exercise the shipped dependencies with the shipped Electron executable. Node
  // mode avoids opening the GUI, touching userData, or invoking the updater.
  const output = execFileSync(
    executable,
    [
      '-e',
      `
    const assert = require('node:assert/strict');
    const path = require('node:path');
    const root = process.argv[1];
    assert.equal(process.arch, process.argv[2]);
    const Database = require(path.join(root, 'node_modules/better-sqlite3'));
    const db = new Database(':memory:');
    db.exec('CREATE TABLE smoke (value INTEGER); INSERT INTO smoke VALUES (42)');
    assert.equal(db.prepare('SELECT value FROM smoke').get().value, 42);
    db.close();
    const sharp = require(path.join(root, 'node_modules/sharp'));
    sharp({create:{width:2,height:2,channels:4,background:'#ffffff'}}).png().toBuffer()
      .then(async png => {
        const metadata = await sharp(png).metadata();
        assert.equal(metadata.width, 2);
        console.log('Packaged native runtime passed: ' + process.platform + ' ' + process.arch);
      }).catch(error => { console.error(error); process.exitCode = 1; });
  `,
      extracted,
      arch
    ],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf8',
      timeout: 60_000
    }
  )
  console.log(output.trim())
  console.log(`Packaged app version verified: ${version}`)
} finally {
  rmSync(extracted, { recursive: true, force: true })
}
