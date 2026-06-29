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

describe('validateNav — links', () => {
  it('RSC-007 when a nav link target is not in the container', () => {
    expect(ids('<nav epub:type="toc"><ol><li><a href="missing.xhtml">x</a></li></ol></nav>'))
      .toContain('RSC-007')
  })
  it('NAV-010 when a nav link is remote', () => {
    expect(ids('<nav epub:type="toc"><ol><li><a href="https://example.com/x">x</a></li></ol></nav>'))
      .toContain('NAV-010')
  })
  it('RSC-008 when the target exists in the container but is not in the manifest', () => {
    // 'extra.xhtml' is added to the container targets but not to the manifest in navDoc().
    expect(ids('<nav epub:type="toc"><ol><li><a href="extra.xhtml">x</a></li></ol></nav>', ['EPUB/c1.xhtml', 'EPUB/extra.xhtml']))
      .toContain('RSC-008')
  })
  it('does not flag a resolvable, manifest-declared link', () => {
    expect(ids('<nav epub:type="toc"><ol><li><a href="c1.xhtml#frag">x</a></li></ol></nav>'))
      .toEqual([])
  })
})

describe('validateNav — reading order (NAV-011)', () => {
  // Build a nav + a two-item spine (c1 at position 0, c2 at position 1).
  function twoSpine(navBody: string): string[] {
    const navXml =
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>t</title></head><body>' +
      navBody + '</body></html>'
    const resources = new Map<string, Resource>()
    resources.set('EPUB/nav.xhtml', { path: 'EPUB/nav.xhtml', bytes: enc(navXml), compression: 'deflate' })
    resources.set('EPUB/c1.xhtml', { path: 'EPUB/c1.xhtml', bytes: enc('<html/>'), compression: 'deflate' })
    resources.set('EPUB/c2.xhtml', { path: 'EPUB/c2.xhtml', bytes: enc('<html/>'), compression: 'deflate' })
    const container: EpubContainer = { resources, rootfiles: ['EPUB/package.opf'], hasEncryption: false }
    const { nav } = parseNav(navItem, container)
    const pkg: PackageDocument = {
      path: 'EPUB/package.opf', version: '3.0', uniqueIdentifier: 'uid',
      metadata: { identifiers: [{ id: 'uid', value: 'u' }], titles: ['T'], languages: ['en'], modifiedCount: 1 },
      manifest: [
        navItem,
        { id: 'c1', href: 'c1.xhtml', mediaType: 'application/xhtml+xml', properties: [], loc: LOC },
        { id: 'c2', href: 'c2.xhtml', mediaType: 'application/xhtml+xml', properties: [], loc: LOC },
      ],
      spinePresent: true,
      spine: [
        { idref: 'c1', linear: true, properties: [], loc: LOC },
        { idref: 'c2', linear: true, properties: [], loc: LOC },
      ],
      loc: LOC,
    }
    return validateNav(nav!, pkg, container).map((m) => m.id)
  }

  it('NAV-011 when toc links go backwards in spine order', () => {
    const body = '<nav epub:type="toc"><ol><li><a href="c2.xhtml">2</a></li><li><a href="c1.xhtml">1</a></li></ol></nav>'
    expect(twoSpine(body)).toContain('NAV-011')
  })

  it('no NAV-011 when toc links follow spine order', () => {
    const body = '<nav epub:type="toc"><ol><li><a href="c1.xhtml">1</a></li><li><a href="c2.xhtml">2</a></li></ol></nav>'
    expect(twoSpine(body)).not.toContain('NAV-011')
  })

  it('skips non-spine link targets for reading order', () => {
    // c1 (pos 0), nav.xhtml (not in spine → skipped), c2 (pos 1) → still in order → no NAV-011.
    const body = '<nav epub:type="toc"><ol>' +
      '<li><a href="c1.xhtml">1</a></li><li><a href="nav.xhtml">n</a></li><li><a href="c2.xhtml">2</a></li></ol></nav>'
    expect(twoSpine(body)).not.toContain('NAV-011')
  })
})
