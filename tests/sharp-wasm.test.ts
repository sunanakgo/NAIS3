import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

const installedVersion = (name: string): string =>
  JSON.parse(readFileSync(`node_modules/${name}/package.json`, 'utf8')).version

describe('sharp WebAssembly fallback', () => {
  // src/main/sharp.ts loads @img/sharp-wasm32 under Electron on Linux; sharp expects its own version.
  it('matches the installed sharp version', () => {
    expect(installedVersion('@img/sharp-wasm32')).toBe(installedVersion('sharp'))
  })
})
