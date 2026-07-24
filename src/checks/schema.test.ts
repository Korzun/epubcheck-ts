import { describe, it, expect } from 'vitest'
import { parseXml } from '../io/xml.js'
import { validateSchema } from './schema.js'
import type { PackageDocument } from '../parse/opf.js'

const OPF_NS = 'http://www.idpf.org/2007/opf'
const DC_NS = 'http://purl.org/dc/elements/1.1/'

const pkgDoc = (xml: string): PackageDocument =>
  ({
    path: 'EPUB/package.opf',
    root: parseXml(new TextEncoder().encode(xml), 'EPUB/package.opf').root!,
  }) as PackageDocument

const EPUB2 =
  `<package xmlns="${OPF_NS}" xmlns:dc="${DC_NS}" version="2.0" unique-identifier="uid">` +
  `<metadata><dc:identifier id="uid">u</dc:identifier><dc:title>T</dc:title><dc:language>en</dc:language></metadata>` +
  `<manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest>` +
  `<spine toc="ncx"><itemref idref="ncx"/></spine></package>`

const EPUB3 =
  `<package xmlns="${OPF_NS}" xmlns:dc="${DC_NS}" version="3.0" unique-identifier="uid">` +
  `<metadata><dc:identifier id="uid">u</dc:identifier><dc:title>T</dc:title><dc:language>en</dc:language>` +
  `<meta property="dcterms:modified">2019-01-01T00:00:00Z</meta></metadata>` +
  `<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest>` +
  `<spine><itemref idref="nav"/></spine></package>`

describe('validateSchema', () => {
  it('validates an EPUB 2 package against opf20', () => {
    expect(validateSchema(pkgDoc(EPUB2), '2.0')).toEqual([])
    expect(
      validateSchema(pkgDoc(EPUB2.replace('<spine toc="ncx">', '<spine>')), '2.0').map((m) => m.message),
    ).toEqual([
      "Error while parsing file 'EPUB/package.opf': element \"spine\" missing required attribute \"toc\"",
    ])
  })

  it('validates an EPUB 3 package against package-30', () => {
    expect(validateSchema(pkgDoc(EPUB3), '3.3')).toEqual([])
  })

  it('treats an unknown version as EPUB 3, matching the dcterms:modified gating', () => {
    expect(validateSchema(pkgDoc(EPUB3), undefined)).toEqual([])
  })

  it('applies the unique-id schematron rule', () => {
    const dup = EPUB2.replace('id="ncx"', 'id="uid"')
    expect(validateSchema(pkgDoc(dup), '2.0').filter((m) => m.message.includes('unique value'))).toHaveLength(2)
  })

  it('applies the duplicate-reference rule only to EPUB 2', () => {
    const withGuide = EPUB2.replace(
      '</package>',
      '<guide><reference type="text" href="a"/><reference type="text" href="a"/></guide></package>',
    )
    const messages = validateSchema(pkgDoc(withGuide), '2.0')
    // checkDuplicateReferences fires once per member of the offending group
    // (EPUBCheck's per-location schematron semantics), so a duplicate pair -> 2.
    expect(messages.filter((m) => m.id === 'RSC-017')).toHaveLength(2)
    // And none for a 3.x target (the rule lives in schema/20/sch/opf.sch only).
    expect(validateSchema(pkgDoc(withGuide), '3.3').filter((m) => m.id === 'RSC-017')).toHaveLength(0)
  })
})
