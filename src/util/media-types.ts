/** EPUB 3 blessed font media types (epubcheck OPFChecker30.isBlessedFontType). */
export const BLESSED_FONT_TYPES: ReadonlySet<string> = new Set<string>([
  'font/ttf',
  'font/otf',
  'font/woff',
  'font/woff2',
  'application/font-sfnt',
  'application/vnd.ms-opentype',
  'application/font-woff',
  'application/x-font-ttf',
])

export function isBlessedFontType(mediaType: string | undefined): boolean {
  return mediaType !== undefined && BLESSED_FONT_TYPES.has(mediaType)
}
