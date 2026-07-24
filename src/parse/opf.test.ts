import { describe, it, expect } from 'vitest'
import type { EpubContainer, Resource } from '../io/zip.js'
import { parseOpf, hasFallbackTo, type ManifestItem } from './opf.js'

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

  it('collects OPF-namespace metas with their attributes in document order', () => {
    const { pkg } = parseOpf(
      container(
        PKG(
          '<metadata><meta id="i" xml:lang="en" name="calibre:series" content="X" scheme="s"/></metadata>' +
            '<manifest/><spine/>',
        ),
      ),
    )
    expect(pkg?.metas).toHaveLength(1)
    expect(Object.keys(pkg!.metas[0]!.attrs)).toEqual(['id', 'xml:lang', 'name', 'content', 'scheme'])
    expect(pkg?.metas[0]?.attrs['name']).toBe('calibre:series')
    expect(pkg?.metas[0]?.qname).toBe('meta')
  })

  it('records the qualified name of an explicitly prefixed meta', () => {
    const { pkg } = parseOpf(
      container(
        PKG(
          '<metadata xmlns:opf="http://www.idpf.org/2007/opf"><opf:meta name="n" content="c"/></metadata>' +
            '<manifest/><spine/>',
        ),
      ),
    )
    expect(pkg?.metas[0]?.qname).toBe('opf:meta')
  })

  it('excludes xmlns declarations from meta attributes', () => {
    const { pkg } = parseOpf(
      container(
        PKG('<metadata><meta xmlns:foo="http://example.org/f" name="n" content="c" foo:bar="b"/></metadata><manifest/><spine/>'),
      ),
    )
    expect(Object.keys(pkg!.metas[0]!.attrs)).toEqual(['name', 'content', 'foo:bar'])
  })

  it('ignores metas outside the OPF namespace', () => {
    const { pkg } = parseOpf(
      container(
        PKG('<metadata><meta xmlns="http://example.org/x" property="dcterms:modified">2020</meta></metadata><manifest/><spine/>'),
      ),
    )
    expect(pkg?.metas).toEqual([])
  })

  it('records whether a meta holds non-whitespace text', () => {
    const { pkg } = parseOpf(
      container(
        PKG(
          '<metadata>' +
            '<meta name="a" content="c">text</meta>' +
            '<meta name="b" content="c">   </meta>' +
            '<meta name="d" content="c"/>' +
            '</metadata><manifest/><spine/>',
        ),
      ),
    )
    expect(pkg?.metas.map((m) => m.hasText)).toEqual([true, false, false])
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

describe('guide and spine toc parsing', () => {
  it('captures guide references and the spine toc attribute', () => {
    const { pkg } = parseOpf(
      container(
        PKG(
          META +
            '<manifest><item id="content" href="content.xhtml" media-type="application/xhtml+xml"/></manifest>' +
            '<spine toc="ncx"><itemref idref="content"/></spine>' +
            '<guide><reference type="text" title="Start" href="content.xhtml"/></guide>',
        ),
      ),
    )
    expect(pkg?.spineToc).toBe('ncx')
    expect(pkg?.spineLoc).toBeDefined()
    expect(pkg?.guide).toHaveLength(1)
    expect(pkg?.guide[0]).toMatchObject({ type: 'text', title: 'Start', href: 'content.xhtml' })
  })

  it('yields an empty guide and undefined spineToc when absent', () => {
    const { pkg } = parseOpf(
      container(
        PKG(
          META +
            '<manifest><item id="content" href="content.xhtml" media-type="application/xhtml+xml"/></manifest>' +
            '<spine><itemref idref="content"/></spine>',
        ),
      ),
    )
    expect(pkg?.guide).toEqual([])
    expect(pkg?.spineToc).toBeUndefined()
  })
})

describe('hasFallbackTo', () => {
  const item = (id: string, mediaType: string, fallback?: string): ManifestItem =>
    ({ id, href: `${id}.bin`, mediaType, properties: [], fallback, loc: { path: 'p.opf' } })

  it('walks the chain to a matching item', () => {
    const a = item('a', 'application/pdf', 'b')
    const b = item('b', 'application/xhtml+xml')
    const byId = new Map([['a', a], ['b', b]])
    expect(hasFallbackTo(a, byId, (i) => i.mediaType === 'application/xhtml+xml')).toBe(true)
  })

  it('is cycle-safe and returns false on a dangling id', () => {
    const a = item('a', 'application/pdf', 'b')
    const b = item('b', 'application/pdf', 'a')
    const byId = new Map([['a', a], ['b', b]])
    expect(hasFallbackTo(a, byId, () => false)).toBe(false)
    expect(hasFallbackTo(item('c', 'x/y', 'nope'), byId, () => true)).toBe(false)
  })
})

import { manifestPathMap } from './opf.js'

describe('manifestPathMap', () => {
  it('maps resolved container paths to manifest items (non-remote)', () => {
    const loc = { path: 'EPUB/package.opf' }
    const pkg = {
      path: 'EPUB/package.opf', version: '3.0' as const, uniqueIdentifier: 'u',
      metadata: { identifiers: [], titles: [], languages: [], modifiedCount: 1 },
      metas: [],
      manifest: [
        { id: 'a', href: 'x/a.xhtml', mediaType: 'application/xhtml+xml', properties: [], loc },
        { id: 'r', href: 'https://example.com/r.png', mediaType: 'image/png', properties: [], loc },
      ],
      spinePresent: true, spine: [], guide: [], loc,
    }
    const map = manifestPathMap(pkg)
    expect(map.get('EPUB/x/a.xhtml')?.id).toBe('a')
    expect([...map.keys()]).not.toContain('https://example.com/r.png') // remote excluded
  })
})
