import { describe, it, expect } from 'vitest'
import { zipSync } from 'fflate'
import { validateEpub } from './validate.js'

const enc = (s: string) => new TextEncoder().encode(s)

describe('validateEpub', () => {
  it('returns a FATAL PKG-003 (never throws) for non-zip input', async () => {
    const report = await validateEpub(enc('not a zip'))
    expect(report.fatal).toBe(true)
    expect(report.messages[0]?.id).toBe('PKG-003')
  })

  it('runs OCF checks for a real archive', async () => {
    const bytes = zipSync({
      'META-INF/container.xml': [enc('<container/>'), { level: 6 }], // mimetype missing & not first
    })
    const report = await validateEpub(bytes)
    const ids = report.messages.map((m) => m.id)
    expect(ids).toContain('PKG-006')
  })
})
