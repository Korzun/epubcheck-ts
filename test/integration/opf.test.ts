import { describe, it, expect } from 'vitest'
import { zipSync } from 'fflate'
import { validateEpub } from '../../src/index.js'
import { buildEpub2, OPF2 } from '../fixtures/build.js'

const enc = (s: string) => new TextEncoder().encode(s)

const CONTAINER = enc(
  '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">' +
    '<rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles>' +
    '</container>',
)

function epub(opf: string, files: Record<string, Uint8Array> = {}) {
  return zipSync({
    mimetype: [enc('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': [CONTAINER, { level: 6 }],
    'EPUB/package.opf': [enc(opf), { level: 6 }],
    ...Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [v, { level: 6 }] as [Uint8Array, { level: 6 }]])),
  })
}

const VALID_OPF =
  '<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid">' +
  '<metadata><dc:identifier id="uid">urn:isbn:1</dc:identifier><dc:title>T</dc:title><dc:language>en</dc:language>' +
  '<meta property="dcterms:modified">2020-01-01T00:00:00Z</meta></metadata>' +
  '<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest>' +
  '<spine><itemref idref="nav"/></spine></package>'

const VALID_NAV = enc(
  '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">' +
    '<head><title>t</title></head><body>' +
    '<nav epub:type="toc"><ol><li><a href="nav.xhtml">Nav</a></li></ol></nav>' +
    '</body></html>',
)

describe('integration: OPF validation', () => {
  it('reports no OPF errors for a valid EPUB 3 package', async () => {
    const report = await validateEpub(epub(VALID_OPF, { 'EPUB/nav.xhtml': VALID_NAV }))
    const opfIds = report.messages.map((m) => m.id).filter((id) => id.startsWith('OPF') || id === 'RSC-001' || id === 'RSC-005')
    expect(opfIds).toEqual([])
    expect(report.epubVersion).toBe('3.3') // default target for an unspecified EPUB 3 file
  })

  it('reports an EPUB 3 property meta in an EPUB 2 package with EPUBCheck wording', async () => {
    const report = await validateEpub(
      buildEpub2({
        files: {
          'EPUB/package.opf': OPF2.replace(
            '</metadata>',
            '<meta property="dcterms:modified">2020-01-01T00:00:00Z</meta></metadata>',
          ),
        },
      }),
    )
    expect(report.valid).toBe(false)
    expect(report.messages.map((m) => `${m.severity} ${m.id}: ${m.message}`)).toEqual([
      `ERROR RSC-005: Error while parsing file 'EPUB/package.opf': attribute "property" not allowed here; expected attribute "content", "id", "name", "scheme" or "xml:lang"`,
      `ERROR RSC-005: Error while parsing file 'EPUB/package.opf': element "meta" missing required attributes "content" and "name"`,
      `ERROR RSC-005: Error while parsing file 'EPUB/package.opf': text not allowed here; expected the element end-tag`,
    ])
  })

  it('flags a manifest item whose file is missing', async () => {
    // Add a manifest item pointing at a file that is not in the container.
    const opf = VALID_OPF.replace(
      '</manifest>',
      '<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>',
    )
    const report = await validateEpub(epub(opf, { 'EPUB/nav.xhtml': VALID_NAV }))
    expect(report.messages.map((m) => m.id)).toContain('RSC-001')
    expect(report.valid).toBe(false)
  })
})
