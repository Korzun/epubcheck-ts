import { describe, it, expect } from 'vitest'
import { zipSync } from 'fflate'
import { validateEpub } from '../../src/index.js'

const enc = (s: string) => new TextEncoder().encode(s)

const CONTAINER = enc(
  '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">' +
    '<rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles>' +
    '</container>',
)
const OPF =
  '<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid">' +
  '<metadata><dc:identifier id="uid">urn:isbn:1</dc:identifier><dc:title>T</dc:title><dc:language>en</dc:language>' +
  '<meta property="dcterms:modified">2020-01-01T00:00:00Z</meta></metadata>' +
  '<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' +
  '<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>' +
  '<item id="css" href="s.css" media-type="text/css"/></manifest>' +
  '<spine><itemref idref="c1"/></spine></package>'
const NAV = '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>t</title></head><body><nav epub:type="toc"><ol><li><a href="c1.xhtml">One</a></li></ol></nav></body></html>'

function epub(c1Body: string) {
  const c1 = '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title><link rel="stylesheet" href="s.css"/></head><body>' + c1Body + '</body></html>'
  return zipSync({
    mimetype: [enc('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': [CONTAINER, { level: 6 }],
    'EPUB/package.opf': [enc(OPF), { level: 6 }],
    'EPUB/nav.xhtml': [enc(NAV), { level: 6 }],
    'EPUB/c1.xhtml': [enc(c1), { level: 6 }],
    'EPUB/s.css': [enc('p{}'), { level: 6 }],
  })
}

describe('integration: content validation', () => {
  it('reports no content errors for a clean content document', async () => {
    const report = await validateEpub(epub('<p id="a">hello</p><a href="#a">self</a>'))
    const ids = report.messages.map((m) => m.id).filter((id) => id === 'RSC-006' || id === 'RSC-007' || id === 'RSC-008' || id === 'RSC-012')
    expect(ids).toEqual([])
  })
  it('flags a broken cross-reference and a missing fragment', async () => {
    const report = await validateEpub(epub('<a href="gone.xhtml">x</a><a href="#missing">y</a>'))
    const ids = report.messages.map((m) => m.id)
    expect(ids).toContain('RSC-007')
    expect(ids).toContain('RSC-012')
    expect(report.valid).toBe(false)
  })
})
