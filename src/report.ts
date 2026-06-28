import type { Message } from './messages/format.js'
import type { Severity } from './messages/catalog.js'

export interface Report {
  messages: Message[]
  epubVersion?: '2.0' | '3.0'
  counts: Record<Severity, number>
  fatal: boolean
  valid: boolean
}

export function buildReport(messages: Message[], epubVersion?: '2.0' | '3.0'): Report {
  const counts: Record<Severity, number> = { FATAL: 0, ERROR: 0, WARNING: 0, INFO: 0, USAGE: 0 }
  for (const message of messages) counts[message.severity]++
  return {
    messages,
    epubVersion,
    counts,
    fatal: counts.FATAL > 0,
    valid: counts.FATAL === 0 && counts.ERROR === 0,
  }
}
