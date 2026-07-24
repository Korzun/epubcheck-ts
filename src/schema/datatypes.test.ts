import { describe, it, expect } from 'vitest'
import { DT_ID, DT_IDREF, DT_ANY_URI, DT_NON_EMPTY, dtEnum, DT_TEXT } from './datatypes.js'

describe('DT_ID', () => {
  it('accepts XML names without colons', () => {
    expect(DT_ID.allows('uid')).toBe(true)
    expect(DT_ID.allows('_x-1.2')).toBe(true)
  })
  it('rejects names starting with a digit or containing a colon', () => {
    expect(DT_ID.allows('1')).toBe(false)
    expect(DT_ID.allows('a:b')).toBe(false)
  })
  it('describes itself the way EPUBCheck does', () => {
    expect(DT_ID.describe('1')).toBe('an XML name without colons')
  })
})

describe('DT_NON_EMPTY', () => {
  it('rejects empty and whitespace-only values', () => {
    expect(DT_NON_EMPTY.allows('')).toBe(false)
    expect(DT_NON_EMPTY.allows('   ')).toBe(false)
    expect(DT_NON_EMPTY.allows('x')).toBe(true)
  })
  it('reports the actual token length', () => {
    expect(DT_NON_EMPTY.describe('')).toBe(
      'a string with length at least 1 (actual length was 0)',
    )
  })
})

describe('dtEnum', () => {
  it('accepts only the listed values', () => {
    const dt = dtEnum(['yes', 'no'])
    expect(dt.allows('yes')).toBe(true)
    expect(dt.allows('maybe')).toBe(false)
  })
  it('describes alternatives alphabetically', () => {
    expect(dtEnum(['yes', 'no']).describe('maybe')).toBe('equal to "no" or "yes"')
    expect(dtEnum(['2.0']).describe('2.1')).toBe('equal to "2.0"')
  })
})

describe('DT_IDREF', () => {
  it('is an alias for DT_ID (same object)', () => {
    expect(DT_IDREF).toBe(DT_ID)
  })
  it('accepts XML names without colons', () => {
    expect(DT_IDREF.allows('ref_123')).toBe(true)
  })
  it('rejects names starting with a digit or containing a colon', () => {
    expect(DT_IDREF.allows('123ref')).toBe(false)
    expect(DT_IDREF.allows('x:y')).toBe(false)
  })
  it('uses the same description as DT_ID', () => {
    expect(DT_IDREF.describe('123')).toBe('an XML name without colons')
  })
})

describe('DT_ANY_URI', () => {
  it('is an alias for DT_TEXT (same object)', () => {
    expect(DT_ANY_URI).toBe(DT_TEXT)
  })
  it('accepts anything including empty strings', () => {
    expect(DT_ANY_URI.allows('')).toBe(true)
    expect(DT_ANY_URI.allows('http://example.com')).toBe(true)
    expect(DT_ANY_URI.allows('urn:isbn:0451450523')).toBe(true)
    expect(DT_ANY_URI.allows('   spaces   ')).toBe(true)
  })
  it('describes as text', () => {
    expect(DT_ANY_URI.describe('anything')).toBe('text')
  })
})

describe('DT_TEXT', () => {
  it('accepts anything', () => {
    expect(DT_TEXT.allows('')).toBe(true)
    expect(DT_TEXT.allows('anything')).toBe(true)
    expect(DT_TEXT.allows('   ')).toBe(true)
  })
  it('describes as text', () => {
    expect(DT_TEXT.describe('value')).toBe('text')
  })
})
