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

  it('defines content-reference message ids', () => {
    expect(CATALOG['RSC-010']).toEqual({
      severity: 'ERROR',
      template: 'Reference to non-standard resource type found.',
    })
    expect(CATALOG['RSC-011']).toEqual({
      severity: 'ERROR',
      template: 'Found a reference to a resource that is not a spine item.',
    })
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

  it('defines the navigation reading-order message id', () => {
    expect(CATALOG['NAV-011']).toEqual({
      severity: 'WARNING',
      template: '"%1$s" nav must be in reading order; link target "%2$s" is before the previous link\'s target in %3$s order.',
    })
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

  it('defines the CSS-completeness message ids', () => {
    expect(CATALOG['CSS-003']).toEqual({ severity: 'WARNING', template: 'CSS document is encoded in UTF-16. It should be encoded in UTF-8 instead.' })
    expect(CATALOG['CSS-004']).toEqual({ severity: 'ERROR', template: 'CSS documents must be encoded in UTF-8, detected %1$s;' })
    expect(CATALOG['CSS-005']).toEqual({ severity: 'USAGE', template: 'Conflicting alternate style tags found: %1$s.' })
    expect(CATALOG['CSS-007']).toEqual({ severity: 'INFO', template: 'Font-face reference "%1$s" refers to non-standard font type "%2$s".' })
    expect(CATALOG['CSS-015']).toEqual({ severity: 'ERROR', template: 'Alternative style sheets must have a title.' })
  })

  it('defines manifest-completeness message ids', () => {
    expect(CATALOG['OPF-003']?.severity).toBe('USAGE')
    expect(CATALOG['PKG-001']?.severity).toBe('WARNING')
    expect(CATALOG['OPF-003']?.template).toContain('%1$s')
    expect(CATALOG['PKG-001']?.template).toContain('%2$s')
  })

  it('defines the foreign-resource-fallback message id', () => {
    expect(CATALOG['RSC-032']).toEqual({
      severity: 'ERROR',
      template: 'Fallback must be provided for foreign resources, but found none for resource "%1$s" of type "%2$s".',
    })
  })
})
