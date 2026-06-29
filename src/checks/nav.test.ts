import { describe, it, expect } from 'vitest'
import type { EpubContainer, Resource } from '../io/zip.js'
import type { PackageDocument } from '../parse/opf.js'
import { parseNav, type NavDocument } from '../parse/nav.js'
import type { ManifestItem } from '../parse/opf.js'
import { validateNav } from './nav.js'

const enc = (s: string) => new TextEncoder().encode(s)
const LOC = { path: 'EPUB/package.opf', line: 1, column: 1 }
const navItem: ManifestItem = { id: 'nav', href: 'nav.xhtml', mediaType: 'application/xhtml+xml', properties: ['nav'], loc: LOC }

// Build a NavDocument from body XML, plus a container holding the link targets.
function navDoc(body: string, targets: string[] = ['EPUB/c1.xhtml']): { nav: NavDocument; pkg: PackageDocument; container: EpubContainer } {
  const navXml =
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>t</title></head><body>' +
    body + '</body></html>'
  const resources = new Map<string, Resource>()
  resources.set('EPUB/nav.xhtml', { path: 'EPUB/nav.xhtml', bytes: enc(navXml), compression: 'deflate' })
  for (const t of targets) resources.set(t, { path: t, bytes: enc('<html/>'), compression: 'deflate' })
  const container: EpubContainer = { resources, rootfiles: ['EPUB/package.opf'], hasEncryption: false }
  const { nav } = parseNav(navItem, container)
  const pkg: PackageDocument = {
    path: 'EPUB/package.opf', version: '3.0', uniqueIdentifier: 'uid',
    metadata: { identifiers: [{ id: 'uid', value: 'u' }], titles: ['T'], languages: ['en'], modifiedCount: 1 },
    manifest: [navItem, { id: 'c1', href: 'c1.xhtml', mediaType: 'application/xhtml+xml', properties: [], loc: LOC }],
    spinePresent: true, spine: [{ idref: 'c1', linear: true, properties: [], loc: LOC }], loc: LOC,
  }
  return { nav: nav!, pkg, container }
}
const ids = (body: string, targets?: string[]) => {
  const { nav, pkg, container } = navDoc(body, targets)
  return validateNav(nav, pkg, container).map((m) => m.id)
}
const msgs = (body: string, targets?: string[]) => {
  const { nav, pkg, container } = navDoc(body, targets)
  return validateNav(nav, pkg, container)
}

const TOC = '<nav epub:type="toc"><ol><li><a href="c1.xhtml">One</a></li></ol></nav>'

describe('validateNav — occurrence', () => {
  it('passes a valid toc-only nav', () => {
    expect(ids(TOC)).toEqual([])
  })
  it('RSC-005 when the toc nav is missing', () => {
    expect(msgs('<nav epub:type="landmarks"><ol><li><a epub:type="x" href="c1.xhtml">L</a></li></ol></nav>')
      .some((m) => m.id === 'RSC-005' && m.message.includes('"toc"'))).toBe(true)
  })
  it('RSC-005 on duplicate page-list navs', () => {
    const body = TOC +
      '<nav epub:type="page-list"><ol><li><a href="c1.xhtml">1</a></li></ol></nav>' +
      '<nav epub:type="page-list"><ol><li><a href="c1.xhtml">2</a></li></ol></nav>'
    expect(msgs(body).some((m) => m.id === 'RSC-005' && m.message.includes('page-list'))).toBe(true)
  })
  it('RSC-005 when the toc nav has no ol', () => {
    expect(msgs('<nav epub:type="toc"><p>no list</p></nav>')
      .some((m) => m.id === 'RSC-005' && m.message.includes('ol element'))).toBe(true)
  })
})

describe('validateNav — content', () => {
  it('RSC-005 when an anchor has no href', () => {
    expect(msgs('<nav epub:type="toc"><ol><li><a>No link</a></li></ol></nav>')
      .some((m) => m.id === 'RSC-005' && m.message.includes('href attribute'))).toBe(true)
  })
  it('RSC-005 when an anchor has empty text', () => {
    expect(msgs('<nav epub:type="toc"><ol><li><a href="c1.xhtml"></a></li></ol></nav>')
      .some((m) => m.id === 'RSC-005' && m.message.includes('Anchors within nav'))).toBe(true)
  })
  it('RSC-005 when a span has empty text', () => {
    expect(msgs('<nav epub:type="toc"><ol><li><span></span><ol><li><a href="c1.xhtml">x</a></li></ol></li></ol></nav>')
      .some((m) => m.id === 'RSC-005' && m.message.includes('Spans within nav'))).toBe(true)
  })
  it('RSC-005 when a landmarks anchor has no epub:type', () => {
    const body = '<nav epub:type="toc"><ol><li><a href="c1.xhtml">x</a></li></ol></nav>' +
      '<nav epub:type="landmarks"><ol><li><a href="c1.xhtml">Start</a></li></ol></nav>'
    expect(msgs(body).some((m) => m.id === 'RSC-005' && m.message.includes('Missing epub:type'))).toBe(true)
  })
  it('RSC-005 on duplicate landmark epub:type + href', () => {
    const body = '<nav epub:type="toc"><ol><li><a href="c1.xhtml">x</a></li></ol></nav>' +
      '<nav epub:type="landmarks"><ol>' +
      '<li><a epub:type="bodymatter" href="c1.xhtml">A</a></li>' +
      '<li><a epub:type="bodymatter" href="c1.xhtml">B</a></li></ol></nav>'
    expect(msgs(body).some((m) => m.id === 'RSC-005' && m.message.includes('Another landmark'))).toBe(true)
  })
})
