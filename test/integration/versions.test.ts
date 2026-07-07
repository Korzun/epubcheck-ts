import { describe, it, expect } from 'vitest'
import { zipSync } from 'fflate'
import { validateEpub } from '../../src/index.js'

const enc = (s: string) => new TextEncoder().encode(s)
const CONTAINER =
  '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'

function build(files: Record<string, string>): Uint8Array {
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {
    mimetype: [enc('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': [enc(CONTAINER), { level: 6 }],
  }
  for (const [name, body] of Object.entries(files)) entries[name] = [enc(body), { level: 6 }]
  return zipSync(entries)
}

const NAV =
  '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>t</title></head><body><nav epub:type="toc"><ol><li><a href="nav.xhtml">N</a></li></ol></nav></body></html>'

describe('integration — per-revision targets', () => {
  it('flags a deprecated <bindings> at 3.3 but not at 3.0', async () => {
    const opf =
      '<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid">' +
      '<metadata><dc:identifier id="uid">u</dc:identifier><dc:title>T</dc:title><dc:language>en</dc:language>' +
      '<meta property="dcterms:modified">2020-01-01T00:00:00Z</meta></metadata>' +
      '<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest>' +
      '<spine><itemref idref="nav"/></spine>' +
      '<bindings><mediaType handler="nav" media-type="application/x-foo"/></bindings></package>'
    const bytes = build({ 'package.opf': opf, 'nav.xhtml': NAV })
    const at33 = await validateEpub(bytes, { version: '3.3' })
    const at30 = await validateEpub(bytes, { version: '3.0' })
    expect(at33.messages.some((m) => m.id === 'RSC-017')).toBe(true)
    expect(at30.messages.some((m) => m.id === 'RSC-017')).toBe(false)
  })

  it('accepts a WebP image without fallback at 3.3 but flags it (RSC-032) at 3.2', async () => {
    const opf =
      '<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid">' +
      '<metadata><dc:identifier id="uid">u</dc:identifier><dc:title>T</dc:title><dc:language>en</dc:language>' +
      '<meta property="dcterms:modified">2020-01-01T00:00:00Z</meta></metadata>' +
      '<manifest>' +
      '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' +
      '<item id="c" href="c.xhtml" media-type="application/xhtml+xml"/>' +
      '<item id="pic" href="pic.webp" media-type="image/webp"/>' +
      '</manifest>' +
      '<spine><itemref idref="nav"/><itemref idref="c"/></spine></package>'
    const content =
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>c</title></head><body><img src="pic.webp" alt="p"/></body></html>'
    const bytes = build({ 'package.opf': opf, 'nav.xhtml': NAV, 'c.xhtml': content, 'pic.webp': 'RIFF....WEBP' })
    const at33 = await validateEpub(bytes, { version: '3.3' })
    const at32 = await validateEpub(bytes, { version: '3.2' })
    expect(at33.messages.some((m) => m.id === 'RSC-032')).toBe(false)
    expect(at32.messages.some((m) => m.id === 'RSC-032')).toBe(true)
  })
})
