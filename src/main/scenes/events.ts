import { EventEmitter } from 'events'

/** Synchronous lifecycle events, published only after successful database mutations. */
export const sceneEvents = new EventEmitter()
