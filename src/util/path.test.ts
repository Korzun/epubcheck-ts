import { describe, it, expect } from 'vitest'
import { resolvePath } from './path.js'
import { isRemote } from './path.js'

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

describe('isRemote', () => {
  it('detects scheme-based remote urls', () => {
    expect(isRemote('https://example.com/x')).toBe(true)
    expect(isRemote('http://example.com/x')).toBe(true)
    expect(isRemote('data:image/png;base64,AAA')).toBe(false) // no //
  })
  it('treats relative paths as local', () => {
    expect(isRemote('chapter.xhtml')).toBe(false)
    expect(isRemote('../img/a.png')).toBe(false)
  })
})

import { hasScheme } from './path.js'

describe('hasScheme', () => {
  it('detects any url scheme', () => {
    expect(hasScheme('https://x')).toBe(true)
    expect(hasScheme('data:text/css,a')).toBe(true)
    expect(hasScheme('mailto:a@b.com')).toBe(true)
  })
  it('treats relative paths as scheme-less', () => {
    expect(hasScheme('a/b.css')).toBe(false)
    expect(hasScheme('../x.png')).toBe(false)
    expect(hasScheme('#frag')).toBe(false)
  })
})
