import { describe, it, expect } from 'vitest'
import { buildReport, ValidationThreshold } from './report.js'
import type { Message } from './messages/format.js'

const m = (severity: Message['severity']): Message => ({ id: 'X', severity, message: '' })

describe('buildReport', () => {
  it('counts messages by severity', () => {
    const r = buildReport([m('ERROR'), m('ERROR'), m('WARNING')])
    expect(r.counts.ERROR).toBe(2)
    expect(r.counts.WARNING).toBe(1)
    expect(r.counts.FATAL).toBe(0)
  })

  it('defaults to the ERROR threshold (legacy behavior)', () => {
    expect(buildReport([m('ERROR')]).valid).toBe(false)
    expect(buildReport([m('FATAL')]).valid).toBe(false)
    expect(buildReport([m('FATAL')]).fatal).toBe(true)
    expect(buildReport([m('WARNING')]).valid).toBe(true)
    expect(buildReport([]).valid).toBe(true)
    expect(buildReport([m('ERROR')]).threshold).toBe('ERROR')
  })

  it('NONE never rejects, even on FATAL', () => {
    const r = buildReport([m('FATAL')], undefined, ValidationThreshold.NONE)
    expect(r.valid).toBe(true)
    expect(r.fatal).toBe(true)
    expect(r.threshold).toBe('NONE')
  })

  it('WARNING rejects on a warning but not on info', () => {
    expect(buildReport([m('WARNING')], undefined, 'WARNING').valid).toBe(false)
    expect(buildReport([m('INFO')], undefined, 'WARNING').valid).toBe(true)
  })

  it('USAGE rejects on any single message', () => {
    expect(buildReport([m('USAGE')], undefined, ValidationThreshold.USAGE).valid).toBe(false)
    expect(buildReport([], undefined, 'USAGE').valid).toBe(true)
  })

  it('FATAL threshold rejects only on FATAL', () => {
    expect(buildReport([m('FATAL')], undefined, 'FATAL').valid).toBe(false)
    expect(buildReport([m('ERROR')], undefined, 'FATAL').valid).toBe(true)
  })

  it('INFO threshold rejects on info but not usage', () => {
    expect(buildReport([m('INFO')], undefined, 'INFO').valid).toBe(false)
    expect(buildReport([m('USAGE')], undefined, 'INFO').valid).toBe(true)
  })

  it('records the epub version when provided', () => {
    expect(buildReport([], '3.0').epubVersion).toBe('3.0')
  })
})
