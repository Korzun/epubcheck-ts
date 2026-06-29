import { describe, it, expect } from 'vitest'
import { validateEpub } from '../../src/index.js'
import { buildEpub } from './build.js'

describe('buildEpub baseline', () => {
  it('produces a fully-valid EPUB 3 (zero messages)', async () => {
    const report = await validateEpub(buildEpub())
    expect(report.messages).toEqual([])
    expect(report.valid).toBe(true)
  })
})
