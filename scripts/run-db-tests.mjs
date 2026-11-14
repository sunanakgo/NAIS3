import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Run the real SQLite integration tests in Electron's Node mode on every platform, with
// the same runtime and better-sqlite3 binary the app loads.
const require = createRequire(import.meta.url)
const electron = require('electron')
const vitest = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs')
const result = spawnSync(electron, [vitest, 'run', '--config', 'vitest.db.config.ts'], {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: 'inherit'
})
if (result.error) console.error(result.error.message)
process.exitCode = result.status ?? 1
