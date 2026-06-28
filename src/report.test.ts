import { describe, it, expect } from 'vitest'
import { buildReport } from './report.js'
import type { Message } from './messages/format.js'

const m = (severity: Message['severity']): Message => ({ id: 'X', severity, message: '' })

describe('buildReport', () => {
  it('counts messages by severity', () => {
    const r = buildReport([m('ERROR'), m('ERROR'), m('WARNING')])
    expect(r.counts.ERROR).toBe(2)
    expect(r.counts.WARNING).toBe(1)
    expect(r.counts.FATAL).toBe(0)
  })

  it('is invalid when there is any ERROR or FATAL', () => {
    expect(buildReport([m('ERROR')]).valid).toBe(false)
    expect(buildReport([m('FATAL')]).fatal).toBe(true)
    expect(buildReport([m('WARNING')]).valid).toBe(true)
    expect(buildReport([]).valid).toBe(true)
  })

  it('records the epub version when provided', () => {
    expect(buildReport([], '3.0').epubVersion).toBe('3.0')
  })
})
