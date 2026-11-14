import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { extractAll } from '@electron/asar'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function walk(dir) {
  const files = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) files.push(...walk(path))
    else files.push(path)
  }
  return files
}

const appDir = resolve(
  process.argv[2] ?? (process.arch === 'arm64' ? 'dist/mac-arm64' : 'dist/mac')
)
const executable = join(appDir, 'NAIS3.app', 'Contents', 'MacOS', 'NAIS3')
const asarPath = join(appDir, 'NAIS3.app', 'Contents', 'Resources', 'app.asar')
const executableInfo = execFileSync('file', [executable], { encoding: 'utf8' })
const expected = executableInfo.includes('arm64')
  ? { arch: 'arm64', fileToken: 'arm64' }
  : executableInfo.includes('x86_64')
    ? { arch: 'x64', fileToken: 'x86_64' }
    : null

if (!expected) throw new Error(`지원하지 않는 앱 실행 파일: ${executableInfo.trim()}`)

const extracted = mkdtempSync(join(tmpdir(), 'nais3-asar-'))
try {
  extractAll(asarPath, extracted)
  const nativeModules = walk(join(extracted, 'node_modules')).filter(
    (path) =>
      path.endsWith('.node') && (path.includes('/sharp-') || path.includes('/better-sqlite3/'))
  )
  if (!nativeModules.some((path) => path.includes('/sharp-'))) {
    throw new Error('sharp 네이티브 모듈을 찾지 못했습니다.')
  }
  // better-sqlite3 13+ loads prebuilds/<platform>-<arch>.node instead of build/Release
  if (!nativeModules.some((path) => path.includes('/better-sqlite3/'))) {
    throw new Error('better-sqlite3 네이티브 모듈을 찾지 못했습니다.')
  }

  for (const path of nativeModules) {
    const info = execFileSync('file', [path], { encoding: 'utf8' })
    if (!info.includes(expected.fileToken)) {
      throw new Error(`네이티브 모듈 아키텍처 불일치: 앱=${expected.arch}, 모듈=${info.trim()}`)
    }
  }

  console.log(`macOS ${expected.arch} 네이티브 모듈 검증 완료 (${nativeModules.length}개)`)
} finally {
  rmSync(extracted, { recursive: true, force: true })
}
