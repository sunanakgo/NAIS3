import { getDb } from '../db'
import type { GenerationQueue } from '../queue/generation-queue'
import { readNaisArchive } from './archive'
import { legacyNais3ToBackupDatabase } from './legacy'
import { restoreBackupDatabase } from './repo'
import type { BackupDatabaseV1 } from './types'

/**
 * Restore a snapshot and then detach queued generation jobs from the scenes it replaced.
 * The restored rows keep their backup IDs, so a queued job for an old scene ID would
 * otherwise run (spending Anlas) and attach its image to an unrelated restored scene.
 * Only a successful restore detaches anything: a failed one rolls back and keeps the scenes.
 */
export function restoreBackupDetachingScenes(
  queue: GenerationQueue,
  database: BackupDatabaseV1
): { imported: number } {
  const replacedSceneIds = database.includedTables.includes('gen_scenes')
    ? (getDb().prepare('SELECT id FROM gen_scenes').pluck().all() as number[])
    : []
  const result = restoreBackupDatabase(database)
  queue.detachDeletedScenes(replacedSceneIds)
  return result
}

export async function importNaisDetachingScenes(
  queue: GenerationQueue,
  input: Buffer
): Promise<{ imported: number }> {
  return restoreBackupDetachingScenes(queue, await readNaisArchive(input))
}

export function importLegacyJsonDetachingScenes(
  queue: GenerationQueue,
  data: Record<string, unknown>
): { imported: number; skippedFiles: number } {
  const { database, skippedFiles } = legacyNais3ToBackupDatabase(data)
  return { ...restoreBackupDetachingScenes(queue, database), skippedFiles }
}
