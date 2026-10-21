import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { extractFile, listPackage } from '@electron/asar'

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

// On Linux the app hides sharp's native binary and runs @img/sharp-wasm32 instead
// (src/main/sharp-loader.ts). Repeat that hook here without the native fallback, so a
// missing or broken WebAssembly build fails the release instead of passing silently.
// Keep the pattern equal to NATIVE_LINUX_BINARY; tests/sharp-wasm.test.ts checks it.
const NATIVE_LINUX_BINARY = /^@img\/sharp-linux(musl)?-[^/]+\/sharp\.node$/
if (platform === 'linux') {
  const wasmOutput = execFileSync(
    executable,
    [
      '-e',
      `
      const assert = require('node:assert/strict');
      const Module = require('node:module');
      const path = require('node:path');
      const [root, pattern] = process.argv.slice(1);
      const nativeBinary = new RegExp(pattern);
      const resolveFilename = Module._resolveFilename;
      Module._resolveFilename = function (request, ...rest) {
        if (nativeBinary.test(request)) {
          throw Object.assign(new Error("Cannot find module '" + request + "'"), {
            code: 'MODULE_NOT_FOUND'
          });
        }
        return resolveFilename.call(this, request, ...rest);
      };
      let sharp;
      try {
        sharp = require(path.join(root, 'node_modules/sharp'));
      } finally {
        Module._resolveFilename = resolveFilename;
      }
      const loaded = Object.keys(require.cache).filter(file => /[\\/]@img[\\/]/.test(file));
      assert.ok(loaded.some(file => /[\\/]@img[\\/]sharp-wasm32[\\/]/.test(file)),
        'sharp did not load @img/sharp-wasm32: ' + loaded.join(', '));
      assert.ok(!loaded.some(file => /[\\/]@img[\\/]sharp-linux(musl)?-/.test(file)),
        'sharp loaded a native Linux binary: ' + loaded.join(', '));
      sharp({create:{width:64,height:48,channels:4,background:{r:255,g:0,b:0,alpha:0.5}}}).png().toBuffer()
        .then(async png => {
          const webp = await sharp(png).resize(32).webp({quality:90}).toBuffer({resolveWithObject:true});
          assert.equal(webp.info.format, 'webp');
          assert.equal(webp.info.width, 32);
          assert.equal(webp.info.height, 24);
          const back = await sharp(webp.data).png().toBuffer();
          const metadata = await sharp(back).metadata();
          assert.equal(metadata.format, 'png');
          assert.equal(metadata.width, 32);
          console.log('Packaged WebAssembly sharp passed: ' + process.platform + ' ' + process.arch);
        }).catch(error => { console.error(error); process.exitCode = 1; });
    `,
      asar,
      NATIVE_LINUX_BINARY.source
    ],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf8',
      timeout: 60_000
    }
  )
  console.log(wasmOutput.trim())
}
// The app migrates the database in a worker thread (src/main/db/migrate.worker.ts). Run the
// shipped worker from app.asar: it must load better-sqlite3 inside a worker and apply every
// migration. The target version comes from the worker itself, which rejects a newer database.
const [migrationWorker, ...extraWorkers] = listPackage(asar, { isPack: false }).filter((file) =>
  /^[\\/]out[\\/]main[\\/]migrate\.worker-[^\\/]+\.js$/.test(file)
)
assert.ok(migrationWorker && extraWorkers.length === 0, 'Expected one packaged migration worker')
const workspace = mkdtempSync(join(tmpdir(), 'nais3-packaged-worker-'))
try {
  const workerOutput = execFileSync(
    executable,
    [
      '-e',
      `
      const assert = require('node:assert/strict');
      const path = require('node:path');
      const { Worker } = require('node:worker_threads');
      const [root, workerFile, directory] = process.argv.slice(1);
      const Database = require(path.join(root, 'node_modules/better-sqlite3'));
      const backupDir = path.join(directory, 'backups');
      // Resolves with every message once the worker exits; fails on a worker error.
      const run = file => new Promise((resolve, reject) => {
        const messages = [];
        const worker = new Worker(path.join(root, workerFile), {
          workerData: { path: file, backupDir }
        });
        worker.on('message', message => messages.push(message));
        worker.once('error', reject);
        worker.once('exit', code => code === 0 ? resolve(messages) : reject(new Error('exit ' + code)));
      });
      const userVersion = file => {
        const db = new Database(file, { readonly: true });
        try { return db.pragma('user_version', { simple: true }); } finally { db.close(); }
      };
      (async () => {
        const fresh = path.join(directory, 'fresh.db');
        new Database(fresh).close();
        assert.deepEqual(await run(fresh), [
          { type: 'opened', pending: false, uiLanguage: undefined },
          { type: 'done' }
        ]);
        const target = userVersion(fresh);
        const newer = path.join(directory, 'newer.db');
        const db = new Database(newer);
        db.pragma('user_version = ' + (target + 1));
        db.close();
        const [opened, rejected, ...rest] = await run(newer);
        assert.deepEqual(opened, { type: 'opened', pending: false, uiLanguage: undefined });
        assert.equal(rejected.type, 'error');
        assert.ok(rejected.message.includes('app supports (' + target + ')'), rejected.message);
        assert.deepEqual(rest, []);
        assert.equal(userVersion(newer), target + 1);
        console.log('Packaged migration worker passed: ' + process.platform + ' ' + process.arch +
          ', user_version ' + target);
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `,
      asar,
      migrationWorker,
      workspace
    ],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf8',
      timeout: 60_000
    }
  )
  console.log(workerOutput.trim())
} finally {
  rmSync(workspace, { recursive: true, force: true })
}
console.log(`Packaged app version verified: ${version}`)
