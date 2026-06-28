import { describe, it, expect } from 'vitest'
import { VERSION, validateEpub, openEpub, validateOcf } from './index.js'

describe('public API', () => {
  it('exports the entry points', () => {
    expect(typeof VERSION).toBe('string')
    expect(typeof validateEpub).toBe('function')
    expect(typeof openEpub).toBe('function')
    expect(typeof validateOcf).toBe('function')
  })
})
