import { readFileSync } from 'fs'
import type { IncomingMessage, ServerResponse } from 'http'
import { resolve } from 'path'
import JSZip from 'jszip'
import sharp from 'sharp'
import type { Plugin } from 'vite'
import type { GenerationRequest, SubscriptionInfo } from '../shared/types'
import { analyzeArtists } from '../main/images/artists'
import {
  buildGenerateImagePayload,
  type BuildOptions,
  type CharacterReferenceOptions,
  type VibeOptions
} from '../main/nai/payload'
import { ENDPOINTS } from '../main/nai/endpoints'

const API_PREFIX = '/__nais/api/'
const MAX_BODY_BYTES = 64 * 1024 * 1024

interface SubscriptionResponse {
  tier?: number
  trainingStepsLeft?: { fixedTrainingStepsLeft?: number; purchasedTrainingSteps?: number }
  usage?: SubscriptionInfo['usage']
}

function naiHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token.trim()}`,
    'Content-Type': 'application/json',
    'x-correlation-id': Math.random().toString(36).slice(2, 8)
  }
}

function parseSubscription(data: SubscriptionResponse): SubscriptionInfo {
  const tiers = ['paper', 'tablet', 'scroll', 'opus'] as const
  return {
    tier: tiers[data.tier ?? 0] ?? 'paper',
    anlasFixed: data.trainingStepsLeft?.fixedTrainingStepsLeft ?? 0,
    anlasPurchased: data.trainingStepsLeft?.purchasedTrainingSteps ?? 0,
    ...(data.usage ? { usage: data.usage } : {})
  }
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('Request body is too large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(body))
}

async function subscription(token: string, signal?: AbortSignal): Promise<Response> {
  return fetch(ENDPOINTS.subscription, { headers: naiHeaders(token), signal })
}

async function extractZipImage(response: Response): Promise<Buffer> {
  const zip = await JSZip.loadAsync(await response.arrayBuffer())
  const name = Object.keys(zip.files).find((entry) => !zip.files[entry]?.dir)
  if (!name) throw new Error('NovelAI response did not contain an image')
  return Buffer.from(await zip.file(name)!.async('nodebuffer'))
}

interface BrowserVibeInput {
  id: number
  imageBase64: string
  strength: number
  informationExtracted: number
  encodedBase64?: string
}

interface BrowserCharRefInput {
  imageBase64: string
  referenceType: CharacterReferenceOptions['referenceType']
  strength: number
  fidelity: number
}

async function prepareVibes(
  token: string,
  model: string,
  inputs: BrowserVibeInput[],
  signal?: AbortSignal
): Promise<{ options: VibeOptions[]; encodings: { id: number; encodedBase64: string }[] }> {
  const options: VibeOptions[] = []
  const encodings: { id: number; encodedBase64: string }[] = []
  for (const input of inputs) {
    let encoded = input.encodedBase64
    if (!encoded) {
      const response = await fetch(ENDPOINTS.encodeVibe, {
        method: 'POST',
        headers: naiHeaders(token),
        body: JSON.stringify({
          image: input.imageBase64,
          information_extracted: input.informationExtracted,
          model
        }),
        signal
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`Vibe encoding failed ${response.status}: ${detail.slice(0, 200)}`)
      }
      encoded = Buffer.from(await response.arrayBuffer()).toString('base64')
      encodings.push({ id: input.id, encodedBase64: encoded })
    }
    options.push({ strength: input.strength, encodedVibeBase64: encoded })
  }
  return { options, encodings }
}

async function prepareCharRefs(
  inputs: BrowserCharRefInput[]
): Promise<CharacterReferenceOptions[]> {
  return Promise.all(
    inputs.map(async (input) => {
      const image = sharp(Buffer.from(input.imageBase64, 'base64'))
      const metadata = await image.metadata()
      const ratio = (metadata.width ?? 1) / (metadata.height ?? 1)
      const canvas =
        ratio > 1.2
          ? { width: 1536, height: 1024 }
          : ratio < 1 / 1.2
            ? { width: 1024, height: 1536 }
            : { width: 1472, height: 1472 }
      const processed = await image
        .resize(canvas.width, canvas.height, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0 }
        })
        .png()
        .toBuffer()
      return {
        referenceType: input.referenceType,
        strength: input.strength,
        fidelity: input.fidelity,
        imageBase64: processed.toString('base64')
      }
    })
  )
}

async function route(
  path: string,
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<unknown> {
  if (path === 'verify-token') {
    const token = String(body.token ?? '')
    const response = await subscription(token, signal)
    if (response.status === 401) return { valid: false, error: 'Invalid API token' }
    if (!response.ok) return { valid: false, error: `API error: ${response.status}` }
    return {
      valid: true,
      subscription: parseSubscription((await response.json()) as SubscriptionResponse)
    }
  }

  if (path === 'balance') {
    const response = await subscription(String(body.token ?? ''), signal)
    if (!response.ok) return { anlas: null, tier: null }
    const parsed = parseSubscription((await response.json()) as SubscriptionResponse)
    return {
      anlas: parsed.anlasFixed + parsed.anlasPurchased,
      tier: parsed.tier,
      ...(parsed.usage ? { usage: parsed.usage } : {})
    }
  }

  if (path === 'generate') {
    const token = String(body.token ?? '')
    const request = body.request as GenerationRequest
    const source = request.source
    const preparedVibes = await prepareVibes(
      token,
      request.model,
      (body.vibes as BrowserVibeInput[] | undefined) ?? [],
      signal
    )
    const characterReferences = await prepareCharRefs(
      (body.characterReferences as BrowserCharRefInput[] | undefined) ?? []
    )
    const buildOptions: BuildOptions = {
      ...(source
        ? {
            i2i: {
              strength: source.strength,
              noise: source.noise,
              extraNoiseSeed: request.seed - 1,
              colorCorrect: false,
              imageBase64: source.imageBase64,
              ...(source.maskBase64 ? { maskBase64: source.maskBase64 } : {})
            }
          }
        : {}),
      transparentBackground: request.transparentBackground,
      vibes: preparedVibes.options,
      characterReferences
    }
    const payload = buildGenerateImagePayload(request, buildOptions)
    const sentPayload = JSON.stringify(payload)
    const response = await fetch(ENDPOINTS.generateImage, {
      method: 'POST',
      headers: naiHeaders(token),
      body: sentPayload,
      signal
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`Generation failed ${response.status}: ${detail.slice(0, 300)}`)
    }
    const png = await extractZipImage(response)
    return {
      base64: png.toString('base64'),
      payloadJson: sentPayload,
      vibeEncodings: preparedVibes.encodings
    }
  }

  if (path === 'director') {
    const token = String(body.token ?? '')
    const input = Buffer.from(String(body.imageBase64 ?? '').replace(/^data:[^,]+,/, ''), 'base64')
    const metadata = await sharp(input).metadata()
    const requestBody: Record<string, unknown> = {
      req_type: String(body.method ?? ''),
      image: input.toString('base64'),
      width: metadata.width ?? 0,
      height: metadata.height ?? 0
    }
    if (body.prompt !== undefined) requestBody.prompt = body.prompt
    if (body.defry !== undefined) requestBody.defry = body.defry
    const response = await fetch(ENDPOINTS.augmentImage, {
      method: 'POST',
      headers: naiHeaders(token),
      body: JSON.stringify(requestBody),
      signal
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`Director request failed ${response.status}: ${detail.slice(0, 300)}`)
    }
    return { base64: (await extractZipImage(response)).toString('base64') }
  }

  if (path === 'upscale') {
    const token = String(body.token ?? '')
    const input = Buffer.from(String(body.imageBase64 ?? '').replace(/^data:[^,]+,/, ''), 'base64')
    const metadata = await sharp(input).metadata()
    const response = await fetch(ENDPOINTS.upscale, {
      method: 'POST',
      headers: naiHeaders(token),
      body: JSON.stringify({
        image: input.toString('base64'),
        width: metadata.width ?? 0,
        height: metadata.height ?? 0,
        scale: Number(body.scale)
      }),
      signal
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`Upscale failed ${response.status}: ${detail.slice(0, 300)}`)
    }
    return { base64: (await extractZipImage(response)).toString('base64') }
  }

  if (path === 'analyze-artists') {
    const image = Buffer.from(String(body.imageBase64 ?? '').replace(/^data:[^,]+,/, ''), 'base64')
    const artistTags = await analyzeArtists(image)
    return artistTags.length > 0 ? { tags: artistTags } : { error: 'No artist tags found' }
  }

  if (path === 'tokens') {
    const texts = Array.isArray(body.texts) ? body.texts.map(String) : []
    return { counts: texts.map(countTokens) }
  }

  if (path === 'tags') {
    const query = String(body.query ?? '')
      .trim()
      .toLowerCase()
      .replace(/_/g, ' ')
    const limit = Math.max(1, Math.min(50, Number(body.limit) || 8))
    if (query.length < 2) return { items: [] }
    const matches = tags()
      .filter((entry) => entry.tag.startsWith(query) || entry.tag.includes(query))
      .sort(
        (a, b) =>
          Number(b.tag.startsWith(query)) - Number(a.tag.startsWith(query)) || b.count - a.count
      )
      .slice(0, limit)
    return { items: matches }
  }

  throw new Error(`Unknown browser gateway route: ${path}`)
}

export function browserGateway(): Plugin {
  return {
    name: 'nais-browser-gateway',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = request.url ?? ''
        if (!url.startsWith(API_PREFIX)) {
          next()
          return
        }
        const expectedOrigin = `http://${request.headers.host}`
        const origin = request.headers.origin
        if (origin && origin !== expectedOrigin) {
          json(response, 403, { error: 'Origin rejected' })
          return
        }
        if (request.method !== 'POST') {
          json(response, 405, { error: 'Method not allowed' })
          return
        }
        try {
          const controller = new AbortController()
          response.on('close', () => {
            if (!response.writableEnded) controller.abort()
          })
          const body = await readJson(request)
          json(
            response,
            200,
            await route(url.slice(API_PREFIX.length).split('?')[0], body, controller.signal)
          )
        } catch (error) {
          json(response, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      })
    }
  }
}

interface TagEntry {
  tag: string
  count: number
  type: string
}

let tagCache: TagEntry[] | null = null
function tags(): TagEntry[] {
  if (tagCache) return tagCache
  const source = JSON.parse(readFileSync(resolve('resources/tags.json'), 'utf8')) as {
    value: string
    count: number
    type: string
  }[]
  tagCache = source.map((entry) => ({ tag: entry.value, count: entry.count, type: entry.type }))
  return tagCache
}

interface TokenizerDef {
  model: { vocab: [string, number][] }
}

let tokenVocab: { pieces: Map<string, number>; maxLength: number; unknown: number } | null = null
function tokenizer(): NonNullable<typeof tokenVocab> {
  if (tokenVocab) return tokenVocab
  const definition = JSON.parse(
    readFileSync(resolve('resources/t5_tokenizer.json'), 'utf8')
  ) as TokenizerDef
  const pieces = new Map<string, number>()
  let maxLength = 0
  let minimum = Infinity
  for (const [piece, score] of definition.model.vocab) {
    pieces.set(piece, score)
    maxLength = Math.max(maxLength, piece.length)
    minimum = Math.min(minimum, score)
  }
  tokenVocab = { pieces, maxLength, unknown: minimum - 10 }
  return tokenVocab
}

function countPiece(value: string): number {
  const vocab = tokenizer()
  const scores = new Float64Array(value.length + 1).fill(-Infinity)
  const counts = new Int32Array(value.length + 1)
  scores[0] = 0
  for (let start = 0; start < value.length; start += 1) {
    if (scores[start] === -Infinity) continue
    let matched = false
    for (let length = 1; length <= Math.min(vocab.maxLength, value.length - start); length += 1) {
      const score = vocab.pieces.get(value.slice(start, start + length))
      if (score === undefined) continue
      matched = true
      if (scores[start] + score > scores[start + length]) {
        scores[start + length] = scores[start] + score
        counts[start + length] = counts[start] + 1
      }
    }
    if (!matched && scores[start] + vocab.unknown > scores[start + 1]) {
      scores[start + 1] = scores[start] + vocab.unknown
      counts[start + 1] = counts[start] + 1
    }
  }
  return counts[value.length]
}

function countTokens(text: string): number {
  const cleaned = text.replace(/[[\]{}]/g, '').replace(/-?\d*\.?\d*::/g, '')
  return cleaned
    .split(/\s+/)
    .filter(Boolean)
    .reduce((total, part) => total + countPiece(`▁${part}`), 1)
}
