import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { extractFile } from '@electron/asar'

const [platform = process.platform, arch = process.arch, suppliedDirectory] = process.argv.slice(2)
assert.equal(platform, process.platform, 'Run the packaged app on its target OS')
assert.equal(arch, process.arch, 'Run the packaged app on its target architecture')
const directory = resolve(
  suppliedDirectory ??
    (platform === 'win32'
      ? 'dist/win-unpacked'
      : platform === 'linux'
        ? arch === 'x64'
          ? 'dist/linux-unpacked'
          : `dist/linux-${arch}-unpacked`
        : arch === 'arm64'
          ? 'dist/mac-arm64'
          : 'dist/mac')
)
const app = platform === 'darwin' ? join(directory, 'NAIS3.app', 'Contents') : directory
const resources = join(app, platform === 'darwin' ? 'Resources' : 'resources')
const executable =
  platform === 'darwin'
    ? join(app, 'MacOS', 'NAIS3')
    : platform === 'linux'
      ? join(app, 'nais3')
      : join(app, 'NAIS3.exe')
const asar = join(resources, 'app.asar')
const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
const packaged = JSON.parse(extractFile(asar, 'package.json').toString('utf8'))
assert.equal(packaged.version, version, 'Packaged app version mismatch')
assert.equal(packaged.name, 'nais3', 'Packaged app name mismatch')

// Load the shipped dependencies straight from app.asar, exactly as the app does at
// runtime. Extracting the archive first would hide native libraries that were left
// packed inside app.asar (dlopen cannot read them there). Node mode avoids opening
// the GUI, touching userData, or invoking the updater.
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
    asar,
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
