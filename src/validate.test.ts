import { describe, it, expect } from 'vitest'
import { zipSync } from 'fflate'
import { validateEpub } from './validate.js'
import { buildEpub2, NCX2, buildEpub, OPF } from '../test/fixtures/build.js'

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
    expect(report.epubVersion).toBe('3.3') // default target for an unspecified EPUB 3 file
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

  it('runs content checks for an EPUB 3 package', async () => {
    const opf =
      '<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid">' +
      '<metadata><dc:identifier id="uid">u</dc:identifier><dc:title>T</dc:title><dc:language>en</dc:language>' +
      '<meta property="dcterms:modified">2020-01-01T00:00:00Z</meta></metadata>' +
      '<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' +
      '<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>' +
      '<spine><itemref idref="c1"/></spine></package>'
    const nav = '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>t</title></head><body><nav epub:type="toc"><ol><li><a href="c1.xhtml">One</a></li></ol></nav></body></html>'
    // c1 references an image that is not in the archive -> RSC-007
    const c1 = '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><img src="missing.png"/></body></html>'
    const bytes = zipSync({
      mimetype: [enc('application/epub+zip'), { level: 0 }],
      'META-INF/container.xml': [enc('<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'), { level: 6 }],
      'package.opf': [enc(opf), { level: 6 }],
      'nav.xhtml': [enc(nav), { level: 6 }],
      'c1.xhtml': [enc(c1), { level: 6 }],
    })
    const report = await validateEpub(bytes)
    expect(report.messages.map((m) => m.id)).toContain('RSC-007')
  })

  it('runs CSS checks for an EPUB 3 package', async () => {
    const opf =
      '<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid">' +
      '<metadata><dc:identifier id="uid">u</dc:identifier><dc:title>T</dc:title><dc:language>en</dc:language>' +
      '<meta property="dcterms:modified">2020-01-01T00:00:00Z</meta></metadata>' +
      '<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' +
      '<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>' +
      '<item id="css" href="s.css" media-type="text/css"/></manifest>' +
      '<spine><itemref idref="c1"/></spine></package>'
    const nav = '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>t</title></head><body><nav epub:type="toc"><ol><li><a href="c1.xhtml">One</a></li></ol></nav></body></html>'
    const c1 = '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><p>hi</p></body></html>'
    const css = 'body { background-image: url(missing.png); }' // -> RSC-007
    const bytes = zipSync({
      mimetype: [enc('application/epub+zip'), { level: 0 }],
      'META-INF/container.xml': [enc('<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'), { level: 6 }],
      'package.opf': [enc(opf), { level: 6 }],
      'nav.xhtml': [enc(nav), { level: 6 }],
      'c1.xhtml': [enc(c1), { level: 6 }],
      's.css': [enc(css), { level: 6 }],
    })
    const report = await validateEpub(bytes)
    expect(report.messages.map((m) => m.id)).toContain('RSC-007')
  })

  it('reports OPF-003 for a container file not in the manifest', async () => {
    const opf =
      '<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid">' +
      '<metadata><dc:identifier id="uid">u</dc:identifier><dc:title>T</dc:title><dc:language>en</dc:language>' +
      '<meta property="dcterms:modified">2020-01-01T00:00:00Z</meta></metadata>' +
      '<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest>' +
      '<spine><itemref idref="nav"/></spine></package>'
    const nav = '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>t</title></head><body><nav epub:type="toc"><ol><li><a href="nav.xhtml">N</a></li></ol></nav></body></html>'
    const bytes = zipSync({
      mimetype: [enc('application/epub+zip'), { level: 0 }],
      'META-INF/container.xml': [enc('<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'), { level: 6 }],
      'package.opf': [enc(opf), { level: 6 }],
      'nav.xhtml': [enc(nav), { level: 6 }],
      'orphan.txt': [enc('x'), { level: 6 }], // present, undeclared
    })
    const report = await validateEpub(bytes)
    expect(report.messages.some((m) => m.id === 'OPF-003' && m.severity === 'USAGE')).toBe(true)
  })

  it('reports PKG-001 when options.version differs from the detected version', async () => {
    const opf =
      '<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid">' +
      '<metadata><dc:identifier id="uid">u</dc:identifier><dc:title>T</dc:title><dc:language>en</dc:language>' +
      '<meta property="dcterms:modified">2020-01-01T00:00:00Z</meta></metadata>' +
      '<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest>' +
      '<spine><itemref idref="nav"/></spine></package>'
    const nav = '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>t</title></head><body><nav epub:type="toc"><ol><li><a href="nav.xhtml">N</a></li></ol></nav></body></html>'
    const bytes = zipSync({
      mimetype: [enc('application/epub+zip'), { level: 0 }],
      'META-INF/container.xml': [enc('<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'), { level: 6 }],
      'package.opf': [enc(opf), { level: 6 }],
      'nav.xhtml': [enc(nav), { level: 6 }],
    })
    const report = await validateEpub(bytes, { version: '2.0' })
    expect(report.messages.some((m) => m.id === 'PKG-001' && m.severity === 'WARNING')).toBe(true)
  })

  it('validates against an explicit revision without a PKG-001 mismatch', async () => {
    const opf =
      '<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid">' +
      '<metadata><dc:identifier id="uid">u</dc:identifier><dc:title>T</dc:title><dc:language>en</dc:language>' +
      '<meta property="dcterms:modified">2020-01-01T00:00:00Z</meta></metadata>' +
      '<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest>' +
      '<spine><itemref idref="nav"/></spine></package>'
    const nav = '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>t</title></head><body><nav epub:type="toc"><ol><li><a href="nav.xhtml">N</a></li></ol></nav></body></html>'
    const bytes = zipSync({
      mimetype: [enc('application/epub+zip'), { level: 0 }],
      'META-INF/container.xml': [enc('<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'), { level: 6 }],
      'package.opf': [enc(opf), { level: 6 }],
      'nav.xhtml': [enc(nav), { level: 6 }],
    })
    const report = await validateEpub(bytes, { version: '3.3' })
    expect(report.epubVersion).toBe('3.3')
    expect(report.messages.some((m) => m.id === 'PKG-001')).toBe(false)
  })

  it('fires PKG-001 when the target major differs from the detected major', async () => {
    // same fixture bytes as above (version="3.0"), but force a 2.0 target
    const opf =
      '<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid">' +
      '<metadata><dc:identifier id="uid">u</dc:identifier><dc:title>T</dc:title><dc:language>en</dc:language>' +
      '<meta property="dcterms:modified">2020-01-01T00:00:00Z</meta></metadata>' +
      '<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest>' +
      '<spine><itemref idref="nav"/></spine></package>'
    const nav = '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>t</title></head><body><nav epub:type="toc"><ol><li><a href="nav.xhtml">N</a></li></ol></nav></body></html>'
    const bytes = zipSync({
      mimetype: [enc('application/epub+zip'), { level: 0 }],
      'META-INF/container.xml': [enc('<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'), { level: 6 }],
      'package.opf': [enc(opf), { level: 6 }],
      'nav.xhtml': [enc(nav), { level: 6 }],
    })
    const report = await validateEpub(bytes, { version: '2.0' })
    expect(report.messages.some((m) => m.id === 'PKG-001')).toBe(true)
  })

  it('respects a NONE threshold — no rejection even on FATAL', async () => {
    const report = await validateEpub(enc('not a zip'), { threshold: 'NONE' })
    expect(report.fatal).toBe(true)
    expect(report.valid).toBe(true)
    expect(report.threshold).toBe('NONE')
  })

  it('rejects a FATAL under the default threshold (contrast with NONE)', async () => {
    const report = await validateEpub(enc('not a zip'))
    expect(report.fatal).toBe(true)
    expect(report.valid).toBe(false)
    expect(report.threshold).toBe('ERROR')
  })
})

describe('EPUB 2 pipeline', () => {
  it('a valid EPUB 2 book produces zero messages', async () => {
    const report = await validateEpub(buildEpub2())
    expect(report.messages).toEqual([])
    expect(report.epubVersion).toBe('2.0')
  })

  it('validates the NCX: uid mismatch → NCX-001', async () => {
    const epub = buildEpub2({
      files: { 'EPUB/toc.ncx': NCX2.replace('urn:uuid:00000000-0000-0000-0000-000000000000', 'urn:uuid:mismatch') },
    })
    const report = await validateEpub(epub)
    expect(report.messages.map((m) => m.id)).toContain('NCX-001')
  })

  it('runs the content layer for EPUB 2: broken hyperlink → RSC-007', async () => {
    const epub = buildEpub2({
      files: {
        'EPUB/content_001.xhtml':
          '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><a href="ghost.xhtml">x</a></body></html>',
      },
    })
    const report = await validateEpub(epub)
    expect(report.messages.map((m) => m.id)).toContain('RSC-007')
  })

  it('validates a legacy NCX in an EPUB 3 book', async () => {
    const epub = buildEpub({
      files: {
        'EPUB/package.opf': OPF.replace(
          '</manifest>',
          '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest>',
        ),
        'EPUB/toc.ncx': NCX2.replace('urn:uuid:00000000-0000-0000-0000-000000000000', 'urn:uuid:mismatch'),
      },
    })
    const report = await validateEpub(epub)
    expect(report.messages.map((m) => m.id)).toContain('NCX-001')
  })
})
