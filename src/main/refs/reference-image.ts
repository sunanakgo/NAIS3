import type SharpModule from 'sharp'
import { directorReferenceBucket } from '../../shared/precise-reference'

type Sharp = typeof SharpModule

/**
 * Prepares a Precise Reference image for the model's reference format and returns
 * base64 PNG. Takes the sharp module so the Electron loader and the browser dev
 * gateway share one implementation.
 *
 * - canvas (V4.5): pad to 1024×1536 / 1536×1024 / 1472×1472 with black, by aspect ratio
 *   (OpenAPI spec).
 * - bucket (V5): scale to cover the nearest ~1 MP bucket and center-crop
 *   (web bundle, 2026-11-25).
 */
export async function prepareReferenceImage(
  sharp: Sharp,
  input: Buffer,
  mode: 'canvas' | 'bucket'
): Promise<string> {
  const meta = await sharp(input).metadata()
  const width = meta.width ?? 1
  const height = meta.height ?? 1

  if (mode === 'bucket') {
    const bucket = directorReferenceBucket(width, height)
    const image = sharp(input)
    const png = bucket.unchanged
      ? await image.png().toBuffer()
      : await image
          .resize(bucket.resizeWidth, bucket.resizeHeight, { fit: 'fill' })
          .extract({
            left: bucket.left,
            top: bucket.top,
            width: bucket.width,
            height: bucket.height
          })
          .png()
          .toBuffer()
    return png.toString('base64')
  }

  const ratio = width / height
  const canvas =
    ratio > 1.2
      ? { w: 1536, h: 1024 }
      : ratio < 1 / 1.2
        ? { w: 1024, h: 1536 }
        : { w: 1472, h: 1472 }
  const png = await sharp(input)
    .resize(canvas.w, canvas.h, { fit: 'contain', background: { r: 0, g: 0, b: 0 } })
    .png()
    .toBuffer()
  return png.toString('base64')
}
