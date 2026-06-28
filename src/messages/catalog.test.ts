import { describe, it, expect } from 'vitest'
import { CATALOG } from './catalog.js'

describe('CATALOG', () => {
  it('defines OCF/container message ids with severities', () => {
    expect(CATALOG['PKG-006']?.severity).toBe('ERROR')
    expect(CATALOG['RSC-002']?.severity).toBe('FATAL')
    expect(CATALOG['CHK-001']?.severity).toBe('FATAL')
  })

  it('templates carry positional placeholders where needed', () => {
    expect(CATALOG['RSC-005']?.template).toContain('%1$s')
  })
})
