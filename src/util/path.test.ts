import { describe, it, expect } from 'vitest'
import { resolvePath } from './path.js'

describe('resolvePath', () => {
  it('resolves a sibling-dir href relative to the OPF', () => {
    expect(resolvePath('EPUB/package.opf', 'xhtml/c1.xhtml')).toBe('EPUB/xhtml/c1.xhtml')
  })
  it('resolves parent traversal', () => {
    expect(resolvePath('EPUB/package.opf', '../images/a.png')).toBe('images/a.png')
  })
  it('resolves a leading ./', () => {
    expect(resolvePath('EPUB/package.opf', './style.css')).toBe('EPUB/style.css')
  })
  it('handles an OPF at the container root', () => {
    expect(resolvePath('package.opf', 'c1.xhtml')).toBe('c1.xhtml')
  })
  it('strips a fragment', () => {
    expect(resolvePath('EPUB/package.opf', 'c1.xhtml#frag')).toBe('EPUB/c1.xhtml')
  })
  it('decodes percent-encoding', () => {
    expect(resolvePath('EPUB/package.opf', 'a%20b.xhtml')).toBe('EPUB/a b.xhtml')
  })
  it('treats a leading slash as container-root-relative', () => {
    expect(resolvePath('EPUB/package.opf', '/EPUB/c1.xhtml')).toBe('EPUB/c1.xhtml')
  })
})
