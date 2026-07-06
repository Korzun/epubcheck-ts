import { describe, it, expect } from 'vitest'
import type { EpubContainer, Resource } from '../io/zip.js'
import { parseOpf } from './opf.js'

const enc = (s: string) => new TextEncoder().encode(s)

function container(opfXml: string | undefined, opfPath = 'EPUB/package.opf'): EpubContainer {
  const resources = new Map<string, Resource>()
  if (opfXml !== undefined) {
    resources.set(opfPath, { path: opfPath, bytes: enc(opfXml), compression: 'deflate' })
  }
  return { resources, rootfiles: opfXml === undefined ? [] : [opfPath], hasEncryption: false }
}

const PKG = (inner: string, attrs = 'version="3.0" unique-identifier="uid"') =>
  `<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" ${attrs}>${inner}</package>`

const META =
  '<metadata>' +
  '<dc:identifier id="uid">urn:isbn:123</dc:identifier>' +
  '<dc:title>T</dc:title><dc:language>en</dc:language>' +
  '<meta property="dcterms:modified">2020-01-01T00:00:00Z</meta>' +
  '</metadata>'

describe('parseOpf', () => {
  it('parses version, unique-identifier and metadata', () => {
    const { pkg, messages } = parseOpf(
      container(PKG(META + '<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="nav"/></spine>')),
    )
    expect(messages).toHaveLength(0)
    expect(pkg?.version).toBe('3.0')
    expect(pkg?.uniqueIdentifier).toBe('uid')
    expect(pkg?.metadata.identifiers).toEqual([{ id: 'uid', value: 'urn:isbn:123' }])
    expect(pkg?.metadata.titles).toEqual(['T'])
    expect(pkg?.metadata.languages).toEqual(['en'])
    expect(pkg?.metadata.modifiedCount).toBe(1)
  })

  it('parses manifest items with properties and spine itemrefs', () => {
    const { pkg } = parseOpf(
      container(PKG(META + '<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="nav" linear="no"/></spine>')),
    )
    expect(pkg?.manifest).toHaveLength(2)
    expect(pkg?.manifest[0]?.properties).toEqual(['nav'])
    expect(pkg?.spine).toHaveLength(2)
    expect(pkg?.spine[0]?.idref).toBe('c1')
    expect(pkg?.spine[0]?.linear).toBe(true)
    expect(pkg?.spine[1]?.linear).toBe(false)
    expect(pkg?.spinePresent).toBe(true)
  })

  it('reports RSC-001 when the rootfile OPF resource is missing', () => {
    const c: EpubContainer = { resources: new Map(), rootfiles: ['EPUB/package.opf'], hasEncryption: false }
    const { pkg, messages } = parseOpf(c)
    expect(pkg).toBeUndefined()
    expect(messages[0]?.id).toBe('RSC-001')
  })

  it('returns no pkg and no messages when there is no rootfile', () => {
    expect(parseOpf(container(undefined))).toEqual({ messages: [] })
  })

  it('surfaces a parse error as RSC-005', () => {
    const { pkg, messages } = parseOpf(container('<package><metadata></package>'))
    expect(pkg).toBeUndefined()
    expect(messages[0]?.id).toBe('RSC-005')
  })

  it('captures the <bindings> element location when present', () => {
    const { pkg } = parseOpf(
      container(
        PKG(
          META +
            '<manifest><item id="x" href="x.xhtml" media-type="application/xhtml+xml"/></manifest>' +
            '<spine><itemref idref="x"/></spine>' +
            '<bindings><mediaType handler="h" media-type="application/x-foo"/></bindings>',
        ),
      ),
    )
    expect(pkg?.bindings).toBeDefined()
  })

  it('leaves bindings undefined when the element is absent', () => {
    const { pkg } = parseOpf(
      container(
        PKG(
          META +
            '<manifest><item id="x" href="x.xhtml" media-type="application/xhtml+xml"/></manifest>' +
            '<spine><itemref idref="x"/></spine>',
        ),
      ),
    )
    expect(pkg?.bindings).toBeUndefined()
  })
})

import { manifestPathMap } from './opf.js'

describe('manifestPathMap', () => {
  it('maps resolved container paths to manifest items (non-remote)', () => {
    const loc = { path: 'EPUB/package.opf' }
    const pkg = {
      path: 'EPUB/package.opf', version: '3.0' as const, uniqueIdentifier: 'u',
      metadata: { identifiers: [], titles: [], languages: [], modifiedCount: 1 },
      manifest: [
        { id: 'a', href: 'x/a.xhtml', mediaType: 'application/xhtml+xml', properties: [], loc },
        { id: 'r', href: 'https://example.com/r.png', mediaType: 'image/png', properties: [], loc },
      ],
      spinePresent: true, spine: [], loc,
    }
    const map = manifestPathMap(pkg)
    expect(map.get('EPUB/x/a.xhtml')?.id).toBe('a')
    expect([...map.keys()]).not.toContain('https://example.com/r.png') // remote excluded
  })
})
