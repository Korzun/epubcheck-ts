import { CATALOG, type Severity } from './catalog.js'

export interface Location {
  path: string
  line?: number
  column?: number
}

export interface Message {
  id: string
  severity: Severity
  message: string
  location?: Location
  suggestion?: string
}

/** Replace %N$s placeholders (1-based) with the corresponding argument. */
function applyTemplate(template: string, args: unknown[]): string {
  return template.replace(/%(\d+)\$s/g, (_match, n: string) => {
    const value = args[Number(n) - 1]
    return value === undefined ? '' : String(value)
  })
}

export function msg(id: string, location: Location | undefined, ...args: unknown[]): Message {
  const entry = CATALOG[id]
  if (!entry) {
    return {
      id,
      severity: 'ERROR',
      message: `Unknown message id ${id}${args.length ? ` (${args.join(', ')})` : ''}`,
      location,
    }
  }
  return {
    id,
    severity: entry.severity,
    message: applyTemplate(entry.template, args),
    location,
  }
}
