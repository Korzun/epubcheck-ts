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

  it('defines OPF package message ids with severities', () => {
    expect(CATALOG['OPF-001']?.severity).toBe('ERROR')
    expect(CATALOG['OPF-030']?.severity).toBe('ERROR')
    expect(CATALOG['OPF-033']?.severity).toBe('ERROR')
    expect(CATALOG['OPF-048']?.severity).toBe('ERROR')
    expect(CATALOG['OPF-049']?.severity).toBe('ERROR')
    expect(CATALOG['OPF-074']?.severity).toBe('ERROR')
    expect(CATALOG['RSC-001']?.severity).toBe('ERROR')
  })

  it('OPF templates carry the expected placeholders', () => {
    expect(CATALOG['OPF-030']?.template).toContain('%1$s')
    expect(CATALOG['OPF-049']?.template).toContain('%1$s')
    expect(CATALOG['RSC-001']?.template).toContain('%1$s')
  })
})
