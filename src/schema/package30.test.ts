import { describe, it, expect } from 'vitest'
import { parseXml } from '../io/xml.js'
import { validateAgainst } from './validate.js'
import { PACKAGE30 } from './package30.js'

const OPF_NS = 'http://www.idpf.org/2007/opf'
const DC_NS = 'http://purl.org/dc/elements/1.1/'

const PKG = (metadata: string) =>
  `<package xmlns="${OPF_NS}" xmlns:dc="${DC_NS}" version="3.0" unique-identifier="uid">` +
  `<metadata>${metadata}</metadata>` +
  `<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest>` +
  `<spine><itemref idref="nav"/></spine></package>`

const BASE =
  `<dc:identifier id="uid">urn:uuid:0</dc:identifier><dc:title>T</dc:title><dc:language>en</dc:language>` +
  `<meta property="dcterms:modified">2019-01-01T00:00:00Z</meta>`

const run = (xml: string) =>
  validateAgainst(PACKAGE30, parseXml(new TextEncoder().encode(xml), 'p.opf').root!, 'p.opf')
    .map((m) => m.message.replace("Error while parsing file 'p.opf': ", ''))

describe('package-30 grammar', () => {
  it('accepts a minimal valid EPUB 3 package', () => {
    expect(run(PKG(BASE))).toEqual([])
  })

  it('accepts the legacy name/content meta form', () => {
    expect(run(PKG(`${BASE}<meta name="cover" content="nav"/>`))).toEqual([])
  })

  it('accepts link, refines and i18n attributes', () => {
    expect(run(PKG(`${BASE}<link rel="cc:license" href="http://example.com/l"/><dc:title id="t" dir="ltr" xml:lang="en">T2</dc:title>`))).toEqual([])
  })

  it('accepts spine page-progression-direction and itemref properties', () => {
    expect(run(PKG(BASE).replace('<spine>', '<spine page-progression-direction="rtl">'))).toEqual([])
  })

  it('rejects an OPF 2.0 spine toc idref datatype violation', () => {
    expect(run(PKG(BASE).replace('<spine>', '<spine toc="1">'))).toEqual([
      'value of attribute "toc" is invalid; must be an XML name without colons',
    ])
  })

  it('rejects an unknown attribute on item', () => {
    expect(run(PKG(BASE).replace('properties="nav"', 'properties="nav" bogus="x"'))).toEqual([
      'attribute "bogus" not allowed here; expected attribute "fallback" or "media-overlay"',
    ])
  })

  it('rejects a meta that is neither form', () => {
    expect(run(PKG(`${BASE}<meta scheme="s">v</meta>`))).toEqual([
      'element "meta" missing required attribute "property"',
    ])
  })

  it('rejects dir outside its enumeration', () => {
    expect(run(PKG(`${BASE}<dc:title dir="sideways">T2</dc:title>`))).toEqual([
      'value of attribute "dir" is invalid; must be equal to "auto", "ltr" or "rtl"',
    ])
  })

  it('requires dc:title', () => {
    expect(run(PKG(`<dc:identifier id="uid">u</dc:identifier><dc:language>en</dc:language>`))).toEqual([
      'element "metadata" incomplete; missing required element "dc:title"',
    ])
  })

  // --- Additional coverage beyond the brief ---

  it('accepts dir="rtl" (the positive case of the enumeration test above)', () => {
    expect(run(PKG(`${BASE}<dc:title dir="rtl">T2</dc:title>`))).toEqual([])
  })

  it('accepts spine without @toc, unlike OPF 2.0 where it is required', () => {
    expect(run(PKG(BASE))).toEqual([])
  })

  it('accepts a metadata block with both the EPUB 3 and legacy meta forms present together', () => {
    expect(
      run(PKG(`${BASE}<meta property="belongs-to-collection">A</meta><meta name="cover" content="nav"/>`)),
    ).toEqual([])
  })

  it('accepts nested collections without hanging or throwing', () => {
    const nested =
      '<collection role="index">' +
      '<collection role="index"><link href="a.xhtml"/></collection>' +
      '</collection>'
    expect(run(PKG(BASE).replace('</spine>', `</spine>${nested}`))).toEqual([])
  })

  it('reports what an EPUB 3 meta with empty content produces', () => {
    expect(run(PKG(`${BASE}<meta property="dcterms:creator"></meta>`))).toEqual([
      'character content of element "meta" invalid; must be a string with length at least 1 (actual length was 0)',
    ])
  })

  it('reports what a foreign-namespace element directly under metadata produces', () => {
    // Unlike OPF 2.0 (which has an explicit any-other-element wildcard), package-30's
    // opf.metadata.content has no such escape hatch: a foreign element is rejected.
    expect(
      run(
        PKG(`${BASE}<foo:bar xmlns:foo="http://example.com/foo">x</foo:bar>`),
      ),
    ).toEqual([
      'element "foo:bar" not allowed anywhere; expected the element end-tag or element ' +
        '"dc:contributor", "dc:coverage", "dc:creator", "dc:date", "dc:description", "dc:format", ' +
        '"dc:identifier", "dc:language", "dc:publisher", "dc:relation", "dc:rights", "dc:source", ' +
        '"dc:subject", "dc:title", "dc:type", "link" or "meta"',
    ])
  })
})
