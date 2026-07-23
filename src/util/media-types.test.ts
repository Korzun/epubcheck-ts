import { describe, it, expect } from 'vitest'
import { isBlessedFontMimetype20 } from './media-types.js'

describe('isBlessedFontMimetype20', () => {
  it('accepts prefix-matched EPUB 2 font types (epubcheck isBlessedFontMimetype20)', () => {
    expect(isBlessedFontMimetype20('font/otf')).toBe(true)
    expect(isBlessedFontMimetype20('application/font-woff')).toBe(true)
    expect(isBlessedFontMimetype20('application/x-font-opentype')).toBe(true)
    expect(isBlessedFontMimetype20('application/vnd.ms-opentype')).toBe(true)
  })
  it('rejects non-font types and undefined', () => {
    expect(isBlessedFontMimetype20('image/png')).toBe(false)
    expect(isBlessedFontMimetype20(undefined)).toBe(false)
  })
})
