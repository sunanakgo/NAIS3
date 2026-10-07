import Module, { createRequire } from 'node:module'
import type SharpModule from 'sharp'

type ResolveFilename = (request: string, ...rest: unknown[]) => string

// Electron on Linux links the system GLib, while sharp's prebuilt libvips bundles its own.
// Two GLib type systems in one process print GLib-GObject-CRITICAL spam and may misbehave,
// so on Linux Electron we hide the native binary and sharp falls back to @img/sharp-wasm32.
const NATIVE_LINUX_BINARY = /^@img\/sharp-linux(musl)?-[^/]+\/sharp\.node$/

function loadSharp(): typeof SharpModule {
  const load = createRequire(__filename)
  if (process.platform !== 'linux' || !process.versions.electron) return load('sharp')

  const internal = Module as unknown as { _resolveFilename: ResolveFilename }
  const resolveFilename = internal._resolveFilename
  internal._resolveFilename = function (request, ...rest) {
    if (NATIVE_LINUX_BINARY.test(request)) {
      throw Object.assign(new Error(`Cannot find module '${request}'`), {
        code: 'MODULE_NOT_FOUND'
      })
    }
    return resolveFilename.call(this, request, ...rest)
  }
  try {
    return load('sharp')
  } finally {
    internal._resolveFilename = resolveFilename
  }
}

const sharp = loadSharp()
export default sharp
