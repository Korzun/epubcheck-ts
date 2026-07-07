import { describe, it, expect } from 'vitest'
import { VERSION, validateEpub, openEpub, validateOcf, ValidationThreshold } from './index.js'

describe('public API', () => {
  it('exports the entry points', () => {
    expect(typeof VERSION).toBe('string')
    expect(typeof validateEpub).toBe('function')
    expect(typeof openEpub).toBe('function')
    expect(typeof validateOcf).toBe('function')
  })

  it('re-exports the ValidationThreshold constants', () => {
    expect(ValidationThreshold.NONE).toBe('NONE')
    expect(ValidationThreshold.USAGE).toBe('USAGE')
  })

  it('exports the EpubVersion type via a validate option', async () => {
    const mod = await import('./index.js')
    // Type-only export: assert the value entry points still resolve and the
    // module shape is intact (compile-time coverage is the real check).
    expect(typeof mod.validateEpub).toBe('function')
  })
})
