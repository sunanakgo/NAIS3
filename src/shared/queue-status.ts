import type { QueueItem } from './types'

/** How many finished (done/failed/cancelled) items the queue keeps — enough for renderer diffs and completion UI */
export const MAX_FINISHED_QUEUE_ITEMS = 50

/**
 * Tracks the order in which queue items finished. If items pile up for the whole session,
 * broadcast payloads and per-event iteration keep growing, so the oldest finished items are
 * dropped first. Pruning follows finish order rather than queue order, so a just-finished item
 * always survives its own broadcast (the renderer never misses a completion).
 */
export class FinishedQueueLog {
  private ids: string[] = []

  constructor(private readonly keep = MAX_FINISHED_QUEUE_ITEMS) {}

  /** Records a just-finished item and returns the ids that now exceed the limit and must be removed */
  record(id: string): string[] {
    this.ids.push(id)
    const overflow = this.ids.length - this.keep
    return overflow > 0 ? this.ids.splice(0, overflow) : []
  }
}

/**
 * Broadcast snapshot — the i2i/inpaint source is only needed by the generator, so it is dropped.
 * It is several MB of base64 per item, and cloning it over IPC on every state change gets
 * more expensive the longer the batch.
 */
export function queueItemSnapshot(item: QueueItem): QueueItem {
  if (!item.request.source) return { ...item }
  const request = { ...item.request }
  delete request.source
  return { ...item, request }
}
