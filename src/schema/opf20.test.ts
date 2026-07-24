import { describe, it, expect } from 'vitest'
import { parseXml } from '../io/xml.js'
import { validateAgainst } from './validate.js'
import { OPF20 } from './opf20.js'

const OPF_NS = 'http://www.idpf.org/2007/opf'
const DC_NS = 'http://purl.org/dc/elements/1.1/'

const PKG = (metadata: string, rest = '') =>
  `<package xmlns="${OPF_NS}" xmlns:dc="${DC_NS}" xmlns:opf="${OPF_NS}" ` +
  `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="2.0" unique-identifier="uid">` +
  `<metadata>${metadata}</metadata>` +
  `<manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest>` +
  `<spine toc="ncx"><itemref idref="ncx"/></spine>${rest}</package>`

const BASE =
  `<dc:identifier id="uid">urn:uuid:0</dc:identifier><dc:title>T</dc:title><dc:language>en</dc:language>`

const run = (xml: string) =>
  validateAgainst(OPF20, parseXml(new TextEncoder().encode(xml), 'p.opf').root!, 'p.opf')
    .map((m) => m.message.replace("Error while parsing file 'p.opf': ", ''))

describe('OPF 2.0 grammar', () => {
  it('accepts a minimal valid package', () => {
    expect(run(PKG(BASE))).toEqual([])
  })

  // These four are the false-positive cases the design doc flags as highest risk.
  it('accepts opf: attributes on their sanctioned dc elements', () => {
    expect(run(PKG(`${BASE}<dc:creator opf:role="aut" opf:file-as="D, J">J D</dc:creator>`))).toEqual([])
    expect(run(PKG(`${BASE}<dc:date opf:event="publication">2001</dc:date>`))).toEqual([])
    expect(
      run(PKG(`<dc:identifier id="uid" opf:scheme="ISBN">9780000000000</dc:identifier><dc:title>T</dc:title><dc:language>en</dc:language>`)),
    ).toEqual([])
    expect(run(PKG(`${BASE}<dc:date xsi:type="dcterms:W3CDTF">2001</dc:date>`))).toEqual([])
  })

  it('accepts an unknown guide reference type and an absent title', () => {
    expect(run(PKG(BASE, '<guide><reference type="banana" href="a.xhtml"/></guide>'))).toEqual([])
  })

  it('accepts foreign-namespace elements inside metadata, in any position', () => {
    expect(run(PKG(`${BASE}<x:foo xmlns:x="http://example.com/x">v</x:foo>`))).toEqual([])
    expect(run(PKG(`<x:foo xmlns:x="http://example.com/x"/>${BASE}`))).toEqual([])
  })

  it('accepts metadata children in any order', () => {
    expect(
      run(PKG(`<dc:language>en</dc:language><dc:title>T</dc:title><dc:identifier id="uid">u</dc:identifier>`)),
    ).toEqual([])
  })

  it('rejects opf:file-as on dc:title', () => {
    expect(run(PKG(`<dc:identifier id="uid">u</dc:identifier><dc:title opf:file-as="T">T</dc:title><dc:language>en</dc:language>`))).toEqual([
      'attribute "opf:file-as" not allowed here; expected attribute "id" or "xml:lang"',
    ])
  })

  it('rejects an EPUB 3 meta three ways', () => {
    expect(run(PKG(`${BASE}<meta property="dcterms:modified">2019-01-01T00:00:00Z</meta>`))).toEqual([
      'attribute "property" not allowed here; expected attribute "content", "id", "name", "scheme" or "xml:lang"',
      'element "meta" missing required attributes "content" and "name"',
      'text not allowed here; expected the element end-tag',
    ])
  })

  it('rejects EPUB 3 attributes on item and itemref', () => {
    const xml = PKG(BASE).replace('media-type="application/x-dtbncx+xml"', 'media-type="application/x-dtbncx+xml" properties="nav"')
    expect(run(xml)).toEqual([
      'attribute "properties" not allowed here; expected attribute "fallback", "fallback-style", "required-modules" or "required-namespace"',
    ])
  })

  it('requires the spine toc attribute', () => {
    expect(run(PKG(BASE).replace('<spine toc="ncx">', '<spine>'))).toEqual([
      'element "spine" missing required attribute "toc"',
    ])
  })

  it('reports an empty dc:identifier', () => {
    expect(run(PKG(`<dc:identifier id="uid"></dc:identifier><dc:title>T</dc:title><dc:language>en</dc:language>`))).toEqual([
      'character content of element "dc:identifier" invalid; must be a string with length at least 1 (actual length was 0)',
    ])
  })

  it('reports missing required metadata one at a time', () => {
    expect(run(PKG(`<dc:identifier id="uid">u</dc:identifier><dc:language>en</dc:language>`))).toEqual([
      'element "metadata" incomplete; missing required element "dc:title"',
    ])
  })

  it('enforces package child order', () => {
    const xml = PKG(BASE, '<guide><reference type="text" href="a.xhtml"/></guide>')
      .replace('<spine toc="ncx"><itemref idref="ncx"/></spine>', '')
    expect(run(xml)).toEqual([
      'element "guide" not allowed yet; missing required element "spine"',
    ])
  })

  // Jar ground truth (EPUBCheck 5.3.0). The `not allowed yet` recovery consumes the
  // offender as well as forgiving the missing predecessor, so what follows is measured
  // against the position AFTER the misplaced element: past `guide` nothing remains,
  // hence the bare end-tag expectation on the spine. See `skipRequired`.
  it('recovers from a guide placed before the spine, leaving nothing expected after it', () => {
    const xml = PKG(BASE).replace(
      '<spine toc="ncx"><itemref idref="ncx"/></spine>',
      '<guide><reference type="text" href="a.xhtml"/></guide>' +
        '<spine toc="ncx"><itemref idref="ncx"/></spine>',
    )
    expect(run(xml)).toEqual([
      'element "guide" not allowed yet; missing required element "spine"',
      'element "spine" not allowed here; expected the element end-tag',
    ])
  })

  // The same recovery one position earlier: past `tours` the optional `guide` is still
  // to come, so the jar names it.
  it('recovers from a tours placed before the spine, leaving the optional guide expected', () => {
    const xml = PKG(BASE).replace(
      '<spine toc="ncx"><itemref idref="ncx"/></spine>',
      '<tours><tour id="t1" title="Tour 1"><site title="S" href="a.xhtml"/></tour></tours>' +
        '<spine toc="ncx"><itemref idref="ncx"/></spine>',
    )
    expect(run(xml)).toEqual([
      'element "tours" not allowed yet; missing required element "spine"',
      'element "spine" not allowed here; expected the element end-tag or element "guide"',
    ])
  })

  // Beyond the brief: the recursive any-other-element production.
  it('accepts a foreign-namespace element nested inside another, inside metadata', () => {
    expect(
      run(
        PKG(
          `${BASE}<x:foo xmlns:x="http://example.com/x"><x:bar>inner</x:bar></x:foo>`,
        ),
      ),
    ).toEqual([])
  })

  // Beyond the brief: tours/tour/site.
  it('accepts a valid tours block', () => {
    expect(
      run(
        PKG(
          BASE,
          '<tours><tour id="t1" title="Tour 1"><site title="Site 1" href="a.xhtml"/></tour></tours>',
        ),
      ),
    ).toEqual([])
  })

  it('reports a tour missing its required title', () => {
    expect(
      run(
        PKG(
          BASE,
          '<tours><tour id="t1"><site title="Site 1" href="a.xhtml"/></tour></tours>',
        ),
      ),
    ).toEqual(['element "tour" missing required attribute "title"'])
  })

  // Beyond the brief: dc:identifier with empty content.
  it('rejects a dc:identifier with only whitespace content the same as empty', () => {
    expect(
      run(PKG(`<dc:identifier id="uid"> </dc:identifier><dc:title>T</dc:title><dc:language>en</dc:language>`)),
    ).toEqual([
      'character content of element "dc:identifier" invalid; must be a string with length at least 1 (actual length was 0)',
    ])
  })

  // Beyond the brief: a schema-namespaced attribute written unprefixed must not be accepted.
  it('rejects file-as written unprefixed (unnamespaced) on dc:creator', () => {
    expect(
      run(PKG(`${BASE}<dc:creator file-as="D, J">J D</dc:creator>`)),
    ).toEqual([
      'attribute "file-as" not allowed here; expected attribute "id", "opf:file-as", "opf:role" or "xml:lang"',
    ])
  })

  // The OEB 1.2 branch: dc-metadata (+ optional x-metadata), previously entirely untested.
  it('accepts a valid dc-metadata wrapper', () => {
    expect(run(PKG(`<dc-metadata>${BASE}</dc-metadata>`))).toEqual([])
  })

  it('accepts dc-metadata plus x-metadata', () => {
    expect(
      run(
        PKG(
          `<dc-metadata>${BASE}</dc-metadata><x-metadata><meta name="cover" content="cover.jpg"/></x-metadata>`,
        ),
      ),
    ).toEqual([])
  })

  it('rejects mixing the OEB 1.2 branch with an EPUB 2 branch element', () => {
    expect(
      run(
        PKG(`<dc-metadata>${BASE}</dc-metadata><meta name="cover" content="cover.jpg"/>`),
      ),
    ).toEqual([
      'element "meta" not allowed here; expected the element end-tag or element "x-metadata"',
    ])
  })

  it('rejects x-metadata without a preceding dc-metadata wrapper', () => {
    expect(
      run(
        PKG(`${BASE}<x-metadata><meta name="cover" content="cover.jpg"/></x-metadata>`),
      ),
    ).toEqual([
      'element "x-metadata" not allowed here; expected the element end-tag, element "dc:contributor", "dc:coverage", "dc:creator", "dc:date", "dc:description", "dc:format", "dc:identifier", "dc:language", "dc:publisher", "dc:relation", "dc:rights", "dc:source", "dc:subject", "dc:title", "dc:type" or "meta" or an element from another namespace',
    ])
  })

  // Minor finding: required-modules is legal on item only alongside required-namespace.
  it('requires required-namespace when an item carries required-modules', () => {
    const xml = PKG(BASE).replace(
      'media-type="application/x-dtbncx+xml"',
      'media-type="application/x-dtbncx+xml" required-modules="foo"',
    )
    expect(run(xml)).toEqual([
      'element "item" missing required attribute "required-namespace"',
    ])
  })
})
