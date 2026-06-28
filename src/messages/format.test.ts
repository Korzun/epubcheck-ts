import { describe, it, expect } from 'vitest'
import { msg } from './format.js'

describe('msg', () => {
  it('builds a message from the catalog id and severity', () => {
    const m = msg('PKG-006', { path: 'OEBPS/book.epub' })
    expect(m.id).toBe('PKG-006')
    expect(m.severity).toBe('ERROR')
    expect(m.message).toContain('mimetype')
    expect(m.location?.path).toBe('OEBPS/book.epub')
  })

  it('substitutes positional placeholders', () => {
    const m = msg('RSC-005', { path: 'a.xhtml' }, 'a.xhtml', 'unexpected token')
    expect(m.message).toBe("Error while parsing file 'a.xhtml': unexpected token")
  })

  it('falls back to a readable string for unknown ids', () => {
    const m = msg('ZZZ-999', undefined)
    expect(m.id).toBe('ZZZ-999')
    expect(m.severity).toBe('ERROR')
    expect(m.message).toContain('ZZZ-999')
  })
})
