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

  it('defines navigation message ids with severities', () => {
    expect(CATALOG['RSC-007']?.severity).toBe('ERROR')
    expect(CATALOG['RSC-008']?.severity).toBe('ERROR')
    expect(CATALOG['NAV-010']?.severity).toBe('ERROR')
  })

  it('NAV-010 template carries two placeholders', () => {
    expect(CATALOG['NAV-010']?.template).toContain('%1$s')
    expect(CATALOG['NAV-010']?.template).toContain('%2$s')
  })

  it('defines content-reference message ids', () => {
    expect(CATALOG['RSC-006']?.severity).toBe('ERROR')
    expect(CATALOG['RSC-012']?.severity).toBe('ERROR')
    expect(CATALOG['RSC-006']?.template).toContain('%1$s')
  })

  it('defines CSS message ids', () => {
    expect(CATALOG['CSS-001']?.severity).toBe('ERROR')
    expect(CATALOG['CSS-002']?.severity).toBe('ERROR')
    expect(CATALOG['CSS-006']?.severity).toBe('USAGE')
    expect(CATALOG['CSS-008']?.severity).toBe('ERROR')
    expect(CATALOG['CSS-019']?.severity).toBe('WARNING')
    expect(CATALOG['RSC-013']?.severity).toBe('ERROR')
    expect(CATALOG['RSC-030']?.severity).toBe('ERROR')
    expect(CATALOG['RSC-031']?.severity).toBe('WARNING')
  })
})
