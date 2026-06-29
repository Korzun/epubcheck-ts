import { zipSync } from 'fflate'

export const enc = (s: string): Uint8Array => new TextEncoder().encode(s)

export const MIMETYPE = 'application/epub+zip'

export const CONTAINER =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">' +
  '<rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles>' +
  '</container>'

// A fully-valid EPUB 3 package document. Substrings below are stable targets for fixture .replace() edits.
export const OPF =
  '<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid">' +
  '<metadata>' +
  '<dc:identifier id="uid">urn:uuid:00000000-0000-0000-0000-000000000000</dc:identifier>' +
  '<dc:title>Title</dc:title>' +
  '<dc:language>en</dc:language>' +
  '<meta property="dcterms:modified">2020-01-01T00:00:00Z</meta>' +
  '</metadata>' +
  '<manifest>' +
  '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' +
  '<item id="content" href="content_001.xhtml" media-type="application/xhtml+xml"/>' +
  '</manifest>' +
  '<spine><itemref idref="content"/></spine>' +
  '</package>'

export const NAV =
  '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">' +
  '<head><title>t</title></head><body>' +
  '<nav epub:type="toc"><ol><li><a href="content_001.xhtml">Content</a></li></ol></nav>' +
  '</body></html>'

export const CONTENT =
  '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><p>Hello</p></body></html>'

export interface EpubOverrides {
  /** container-path → text content; overrides/extends the baseline. */
  files?: Record<string, string>
  /** container-paths to remove from the baseline (e.g. 'mimetype'). */
  omit?: string[]
  /** compress the mimetype entry (deflate) instead of storing it (for PKG-005). */
  mimetypeDeflate?: boolean
}

export function buildEpub(o: EpubOverrides = {}): Uint8Array {
  const base: Record<string, string> = {
    mimetype: MIMETYPE,
    'META-INF/container.xml': CONTAINER,
    'EPUB/package.opf': OPF,
    'EPUB/nav.xhtml': NAV,
    'EPUB/content_001.xhtml': CONTENT,
  }
  const merged: Record<string, string> = { ...base, ...(o.files ?? {}) }
  for (const k of o.omit ?? []) delete merged[k]

  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {}
  for (const [path, text] of Object.entries(merged)) {
    const level: 0 | 6 = path === 'mimetype' ? (o.mimetypeDeflate ? 6 : 0) : 6
    entries[path] = [enc(text), { level }]
  }
  return zipSync(entries)
}

/** Build a valid EPUB that links a stylesheet `EPUB/style.css` from the content doc. */
export function cssEpub(css: string, extra: Record<string, string> = {}): Uint8Array {
  return buildEpub({
    files: {
      'EPUB/package.opf': OPF.replace(
        '</manifest>',
        '<item id="css" href="style.css" media-type="text/css"/></manifest>',
      ),
      'EPUB/content_001.xhtml': CONTENT.replace(
        '<head><title>t</title></head>',
        '<head><title>t</title><link rel="stylesheet" href="style.css"/></head>',
      ),
      'EPUB/style.css': css,
      ...extra,
    },
  })
}
