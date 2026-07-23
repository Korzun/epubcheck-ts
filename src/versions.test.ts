import { describe, it, expect } from 'vitest'
import { majorVersion, atLeast, coreMediaTypes, blessedContentTypes, EPUB2_IMAGE_TYPES, EPUB2_STYLE_TYPES, NCX_MEDIA_TYPE, type EpubVersion } from './versions.js'

describe('majorVersion', () => {
  it('maps revisions to their major version', () => {
    expect(majorVersion('2.0')).toBe('2.0')
    expect(majorVersion('2.0.1')).toBe('2.0')
    expect(majorVersion('3.0')).toBe('3.0')
    expect(majorVersion('3.0.1')).toBe('3.0')
    expect(majorVersion('3.2')).toBe('3.0')
    expect(majorVersion('3.3')).toBe('3.0')
  })
})

describe('atLeast', () => {
  it('orders revisions by rank, treating same-profile revisions as equal', () => {
    expect(atLeast('3.2', '3.2')).toBe(true)
    expect(atLeast('3.3', '3.2')).toBe(true)
    expect(atLeast('3.0', '3.2')).toBe(false)
    expect(atLeast('3.0.1', '3.0')).toBe(true) // same rank
    expect(atLeast('2.0.1', '2.0')).toBe(true) // same rank
    expect(atLeast('2.0', '3.0')).toBe(false)
  })
})

describe('coreMediaTypes', () => {
  it('adds application/javascript at 3.2', () => {
    expect(coreMediaTypes('3.0').has('application/javascript')).toBe(false)
    expect(coreMediaTypes('3.2').has('application/javascript')).toBe(true)
  })
  it('adds WebP and application/ecmascript at 3.3', () => {
    expect(coreMediaTypes('3.2').has('image/webp')).toBe(false)
    expect(coreMediaTypes('3.3').has('image/webp')).toBe(true)
    expect(coreMediaTypes('3.2').has('application/ecmascript')).toBe(false)
    expect(coreMediaTypes('3.3').has('application/ecmascript')).toBe(true)
  })
  it('removes application/pls+xml at 3.3', () => {
    expect(coreMediaTypes('3.2').has('application/pls+xml')).toBe(true)
    expect(coreMediaTypes('3.3').has('application/pls+xml')).toBe(false)
  })
  it('keeps common images and text/css across revisions', () => {
    for (const v of ['3.0', '3.2', '3.3'] as EpubVersion[]) {
      expect(coreMediaTypes(v).has('image/png')).toBe(true)
      expect(coreMediaTypes(v).has('text/css')).toBe(true)
    }
  })
})

describe('blessedContentTypes', () => {
  it('EPUB 2 blesses XHTML and DTBook plus deprecated OEB types, not SVG', () => {
    const v2 = blessedContentTypes('2.0')
    expect(v2.has('application/xhtml+xml')).toBe(true)
    expect(v2.has('application/x-dtbook+xml')).toBe(true)
    expect(v2.has('text/x-oeb1-document')).toBe(true)
    expect(v2.has('text/html')).toBe(true)
    expect(v2.has('image/svg+xml')).toBe(false)
  })

  it('EPUB 3 blesses XHTML and SVG plus deprecated OEB types, not DTBook', () => {
    const v3 = blessedContentTypes('3.3')
    expect(v3.has('application/xhtml+xml')).toBe(true)
    expect(v3.has('image/svg+xml')).toBe(true)
    expect(v3.has('text/x-oeb1-document')).toBe(true)
    expect(v3.has('text/html')).toBe(true)
    expect(v3.has('application/x-dtbook+xml')).toBe(false)
  })

  it('exports the EPUB 2 image/style sets and the NCX media type', () => {
    expect(EPUB2_IMAGE_TYPES.has('image/gif')).toBe(true)
    expect(EPUB2_IMAGE_TYPES.has('image/svg+xml')).toBe(true)
    expect(EPUB2_IMAGE_TYPES.has('image/webp')).toBe(false)
    expect(EPUB2_STYLE_TYPES.has('text/css')).toBe(true)
    expect(EPUB2_STYLE_TYPES.has('text/x-oeb1-css')).toBe(true)
    expect(NCX_MEDIA_TYPE).toBe('application/x-dtbncx+xml')
  })
})
