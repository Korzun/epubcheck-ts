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
  '<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>' +
  '<spine><itemref idref="c1"/></spine></package>'

function epub(navBody: string) {
  const nav =
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>t</title></head><body>' +
    navBody + '</body></html>'
  return zipSync({
    mimetype: [enc('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': [CONTAINER, { level: 6 }],
    'EPUB/package.opf': [enc(OPF), { level: 6 }],
    'EPUB/nav.xhtml': [enc(nav), { level: 6 }],
    'EPUB/c1.xhtml': [enc('<html/>'), { level: 6 }],
  })
}

describe('integration: nav validation', () => {
  it('reports no nav errors for a valid toc', async () => {
    const report = await validateEpub(epub('<nav epub:type="toc"><ol><li><a href="c1.xhtml">One</a></li></ol></nav>'))
    const navIds = report.messages.map((m) => m.id).filter((id) => id.startsWith('NAV') || id === 'RSC-005' || id === 'RSC-007' || id === 'RSC-008')
    expect(navIds).toEqual([])
  })

  it('flags a missing toc nav', async () => {
    const report = await validateEpub(epub('<nav epub:type="landmarks"><ol><li><a epub:type="bodymatter" href="c1.xhtml">Start</a></li></ol></nav>'))
    expect(report.messages.some((m) => m.id === 'RSC-005' && m.message.includes('"toc"'))).toBe(true)
    expect(report.valid).toBe(false)
  })
})
