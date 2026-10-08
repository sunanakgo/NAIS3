/**
 * Stored webp thumbnails are served by the nais-image protocol instead of being shipped
 * through IPC as base64, so list responses stay small and Chromium decodes images lazily.
 */
export const THUMBNAIL_SOURCES = ['image', 'library'] as const
export type ThumbnailSource = (typeof THUMBNAIL_SOURCES)[number]

export function isThumbnailSource(value: string | null): value is ThumbnailSource {
  return (THUMBNAIL_SOURCES as readonly string[]).includes(value ?? '')
}

/**
 * `version` must change whenever a row id could point at different content. INTEGER PRIMARY
 * KEY ids are reused after the newest row is deleted, so callers pass the row's created_at.
 */
export function thumbnailUrl(source: ThumbnailSource, id: number, version: string): string {
  return `nais-image://local/?thumb=${source}&id=${id}&v=${encodeURIComponent(version)}`
}
