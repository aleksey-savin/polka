import type { SourceAdapter, SourceKey } from './types'

/** Реальные источники. Единственное место подсистемы, где живёт сеть. */
export const ADAPTERS: Partial<Record<SourceKey, SourceAdapter>> = {}
