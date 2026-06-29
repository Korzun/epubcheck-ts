import { describe, it, expect } from 'vitest'
import { zipSync } from 'fflate'
import { validateEpub } from './validate.js'

const enc = (s: string) => new TextEncoder().encode(s)

describe('validateEpub', () => {
  it('returns a FATAL PKG-003 (never throws) for non-zip input', async () => {
    const report = await validateEpub(enc('not a zip'))
    expect(report.fatal).toBe(true)
    expect(report.messages[0]?.id).toBe('PKG-003')
  })

  it('runs OCF checks for a real archive', async () => {
    const bytes = zipSync({
      'META-INF/container.xml': [enc('<container/>'), { level: 6 }], // mimetype missing & not first
    })
    const report = await validateEpub(bytes)
    const ids = report.messages.map((m) => m.id)
    expect(ids).toContain('PKG-006')
  })

  it('runs OPF checks and reports the detected version', async () => {
    const opf =
      '<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid">' +
      '<metadata><dc:identifier id="uid">u</dc:identifier><dc:title>T</dc:title><dc:language>en</dc:language>' +
      '<meta property="dcterms:modified">2020-01-01T00:00:00Z</meta></metadata>' +
      '<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest>' +
      '<spine><itemref idref="missing"/></spine></package>'
    const bytes = zipSync({
      mimetype: [enc('application/epub+zip'), { level: 0 }],
      'META-INF/container.xml': [enc('<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'), { level: 6 }],
      'package.opf': [enc(opf), { level: 6 }],
      'nav.xhtml': [enc('<html/>'), { level: 6 }],
    })
    const report = await validateEpub(bytes)
    expect(report.epubVersion).toBe('3.0')
    expect(report.messages.map((m) => m.id)).toContain('OPF-049') // idref "missing"
  })

  it('runs nav checks for an EPUB 3 package', async () => {
    const opf =
      '<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid">' +
      '<metadata><dc:identifier id="uid">u</dc:identifier><dc:title>T</dc:title><dc:language>en</dc:language>' +
      '<meta property="dcterms:modified">2020-01-01T00:00:00Z</meta></metadata>' +
      '<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest>' +
      '<spine><itemref idref="nav"/></spine></package>'
    // nav doc whose toc links to a file not in the container -> RSC-007
    const nav =
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>t</title></head><body>' +
      '<nav epub:type="toc"><ol><li><a href="missing.xhtml">One</a></li></ol></nav></body></html>'
    const bytes = zipSync({
      mimetype: [enc('application/epub+zip'), { level: 0 }],
      'META-INF/container.xml': [enc('<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'), { level: 6 }],
      'package.opf': [enc(opf), { level: 6 }],
      'nav.xhtml': [enc(nav), { level: 6 }],
    })
    const report = await validateEpub(bytes)
    expect(report.messages.map((m) => m.id)).toContain('RSC-007')
  })
})
