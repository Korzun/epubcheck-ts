import type { Message } from './messages/format.js'
import { SEVERITY_RANK, type Severity } from './messages/catalog.js'
import type { EpubVersion } from './versions.js'

/**
 * Rejection threshold: the least-severe level that still marks a report
 * invalid. `NONE` never rejects; `USAGE` rejects on any message at all.
 * Frozen const object + derived union (no TS enum) so callers get named
 * constants while raw strings still type-check.
 */
export const ValidationThreshold = {
  NONE: 'NONE',
  FATAL: 'FATAL',
  ERROR: 'ERROR',
  WARNING: 'WARNING',
  INFO: 'INFO',
  USAGE: 'USAGE',
} as const

export type ValidationThreshold = (typeof ValidationThreshold)[keyof typeof ValidationThreshold]

export interface Report {
  messages: Message[]
  epubVersion?: EpubVersion
  counts: Record<Severity, number>
  threshold: ValidationThreshold
  fatal: boolean
  valid: boolean
}

export function buildReport(
  messages: Message[],
  epubVersion?: EpubVersion,
  threshold: ValidationThreshold = 'ERROR',
): Report {
  const counts: Record<Severity, number> = { FATAL: 0, ERROR: 0, WARNING: 0, INFO: 0, USAGE: 0 }
  for (const message of messages) counts[message.severity]++
  const valid =
    threshold === 'NONE'
      ? true
      : !messages.some((message) => SEVERITY_RANK[message.severity] >= SEVERITY_RANK[threshold])
  return {
    messages,
    epubVersion,
    counts,
    threshold,
    fatal: counts.FATAL > 0,
    valid,
  }
}
