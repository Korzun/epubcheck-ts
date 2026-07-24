import { describe, it, expect } from 'vitest'
import type { EpubContainer, Resource } from '../io/zip.js'
import type { PackageDocument, ManifestItem } from '../parse/opf.js'
import type { NcxDocument } from '../parse/ncx.js'
import { validateNcx } from './ncx.js'

const enc = (s: string) => new TextEncoder().encode(s)
const loc = { path: 'EPUB/toc.ncx', line: 1, column: 1 }
const LOC = { path: 'EPUB/package.opf', line: 1, column: 1 }

const XHTML = (body: string) =>
  '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>' + body + '</body></html>'

const ncxItem: ManifestItem = { id: 'ncx', href: 'toc.ncx', mediaType: 'application/x-dtbncx+xml', properties: [], loc: LOC }
const contentItem: ManifestItem = { id: 'content', href: 'content_001.xhtml', mediaType: 'application/xhtml+xml', properties: [], loc: LOC }

// Baseline: pkg2 with uniqueIdentifier 'uid', identifiers [{ id: 'uid', value: 'urn:uuid:x' }],
// manifest [ncx item, content item (application/xhtml+xml, href 'content_001.xhtml')],
// spine [itemref content]; container holding EPUB/content_001.xhtml (valid XHTML with id 'frag').
function baseSetup(): { pkg2: PackageDocument; container: EpubContainer } {
  const resources = new Map<string, Resource>()
  resources.set('EPUB/content_001.xhtml', {
    path: 'EPUB/content_001.xhtml',
    bytes: enc(XHTML('<p id="frag">x</p>')),
    compression: 'deflate',
  })
  const container: EpubContainer = { resources, rootfiles: ['EPUB/package.opf'], hasEncryption: false }
  const pkg2: PackageDocument = {
    path: 'EPUB/package.opf',
    version: '2.0',
    uniqueIdentifier: 'uid',
    metadata: { identifiers: [{ id: 'uid', value: 'urn:uuid:x' }], titles: ['T'], languages: ['en'], modifiedCount: 0 },
    root: { type: 'element', name: 'package', loc: LOC },
    manifest: [ncxItem, contentItem],
    spinePresent: true,
    spine: [{ idref: 'content', linear: true, properties: [], loc: LOC }],
    guide: [],
    loc: LOC,
  }
  return { pkg2, container }
}

// ncx: uid 'urn:uuid:x', navMapPresent true,
// navPoints [{ hasLabel: true, hasContent: true, src: 'content_001.xhtml', loc }].
function baseNcx(): NcxDocument {
  return {
    path: 'EPUB/toc.ncx',
    root: { type: 'element', name: 'ncx', loc },
    uid: 'urn:uuid:x',
    uidLoc: loc,
    navMapPresent: true,
    navPoints: [{ hasLabel: true, hasContent: true, src: 'content_001.xhtml', loc }],
    textLabels: [],
    loc,
  }
}

describe('validateNcx', () => {
  it('valid NCX yields no messages', () => {
    const ncx = baseNcx()
    const { pkg2, container } = baseSetup()
    expect(validateNcx(ncx, pkg2, container, '2.0')).toEqual([])
  })

  it('NCX-001 on uid mismatch (trimmed compare, raw uid reported)', () => {
    const ncx = baseNcx()
    const { pkg2, container } = baseSetup()
    const m = validateNcx({ ...ncx, uid: ' urn:uuid:OTHER ' }, pkg2, container, '2.0')
    const ncx001 = m.find((x) => x.id === 'NCX-001')
    expect(ncx001?.message).toContain(' urn:uuid:OTHER ')
    expect(ncx001?.message).toContain('urn:uuid:x')
    // whitespace also triggers NCX-004
    expect(m.map((x) => x.id)).toContain('NCX-004')
  })

  it('NCX-004 only (no NCX-001) when uid matches after trimming', () => {
    const ncx = baseNcx()
    const { pkg2, container } = baseSetup()
    const m = validateNcx({ ...ncx, uid: ' urn:uuid:x ' }, pkg2, container, '2.0')
    expect(m.map((x) => x.id)).toEqual(['NCX-004'])
  })

  it('no NCX-001 when the OPF unique identifier is empty (jar parity)', () => {
    // An empty dc:identifier resolves the OPF id to "" and is already reported as
    // RSC-005 by the schema layer; epubcheck does not additionally flag an NCX
    // mismatch against a blank OPF identifier.
    const ncx = baseNcx()
    const { pkg2, container } = baseSetup()
    const emptyIdPkg: PackageDocument = {
      ...pkg2,
      metadata: { ...pkg2.metadata, identifiers: [{ id: 'uid', value: '' }] },
    }
    const m = validateNcx({ ...ncx, uid: 'urn:uuid:x' }, emptyIdPkg, container, '2.0')
    expect(m.map((x) => x.id)).not.toContain('NCX-001')
  })

  it('NCX-006 per empty text label', () => {
    const ncx = baseNcx()
    const { pkg2, container } = baseSetup()
    const m = validateNcx(
      { ...ncx, textLabels: [{ text: '', loc }, { text: 'ok', loc }, { text: '', loc }] },
      pkg2,
      container,
      '2.0',
    )
    expect(m.filter((x) => x.id === 'NCX-006')).toHaveLength(2)
  })

  it('RSC-005 for missing navMap and malformed navPoints', () => {
    const ncx = baseNcx()
    const { pkg2, container } = baseSetup()
    const m = validateNcx({ ...ncx, navMapPresent: false, navPoints: [] }, pkg2, container, '2.0')
    expect(m.map((x) => x.id)).toEqual(['RSC-005'])
    const m2 = validateNcx({ ...ncx, navPoints: [{ hasLabel: false, hasContent: false, loc }] }, pkg2, container, '2.0')
    expect(m2.filter((x) => x.id === 'RSC-005')).toHaveLength(2) // no label + no content
  })

  it('RSC-007 for a src to a missing resource', () => {
    const ncx = baseNcx()
    const { pkg2, container } = baseSetup()
    const m = validateNcx(
      { ...ncx, navPoints: [{ hasLabel: true, hasContent: true, src: 'ghost.xhtml', loc }] },
      pkg2,
      container,
      '2.0',
    )
    expect(m.map((x) => x.id)).toEqual(['RSC-007'])
    // epubcheck embeds the NCX-directory-resolved path, not the raw src.
    expect(m[0]?.message).toBe('Referenced resource "EPUB/ghost.xhtml" could not be found in the EPUB.')
  })

  it('RSC-008 for a src present in the zip but undeclared', () => {
    const ncx = baseNcx()
    const { pkg2, container } = baseSetup()
    container.resources.set('EPUB/extra.xhtml', { path: 'EPUB/extra.xhtml', bytes: enc(XHTML('')), compression: 'deflate' })
    const m = validateNcx(
      { ...ncx, navPoints: [{ hasLabel: true, hasContent: true, src: 'extra.xhtml', loc }] },
      pkg2,
      container,
      '2.0',
    )
    expect(m.map((x) => x.id)).toEqual(['RSC-008'])
    expect(m[0]?.message).toBe('Referenced resource "EPUB/extra.xhtml" is not declared in the OPF manifest.')
  })

  it('RSC-010 for a src to a non-content-document (v2 blessed set)', () => {
    const ncx = baseNcx()
    const { pkg2, container } = baseSetup()
    pkg2.manifest.push({ id: 'img', href: 'pic.gif', mediaType: 'image/gif', properties: [], loc: LOC })
    container.resources.set('EPUB/pic.gif', { path: 'EPUB/pic.gif', bytes: enc('gif-bytes'), compression: 'deflate' })
    const m = validateNcx(
      { ...ncx, navPoints: [{ hasLabel: true, hasContent: true, src: 'pic.gif', loc }] },
      pkg2,
      container,
      '2.0',
    )
    expect(m.map((x) => x.id)).toEqual(['RSC-010'])
  })

  it('RSC-011 for a src to a content doc not in the spine', () => {
    const ncx = baseNcx()
    const { pkg2, container } = baseSetup()
    pkg2.manifest.push({ id: 'c2', href: 'c2.xhtml', mediaType: 'application/xhtml+xml', properties: [], loc: LOC })
    container.resources.set('EPUB/c2.xhtml', { path: 'EPUB/c2.xhtml', bytes: enc(XHTML('<p>2</p>')), compression: 'deflate' })
    // Intentionally not added to pkg2.spine.
    const m = validateNcx(
      { ...ncx, navPoints: [{ hasLabel: true, hasContent: true, src: 'c2.xhtml', loc }] },
      pkg2,
      container,
      '2.0',
    )
    expect(m.map((x) => x.id)).toEqual(['RSC-011'])
  })

  it('RSC-012 for a src with a missing fragment', () => {
    const ncx = baseNcx()
    const { pkg2, container } = baseSetup()
    const m = validateNcx(
      { ...ncx, navPoints: [{ hasLabel: true, hasContent: true, src: 'content_001.xhtml#nope', loc }] },
      pkg2,
      container,
      '2.0',
    )
    expect(m.map((x) => x.id)).toEqual(['RSC-012'])
  })

  it('no RSC-012 when the fragment exists', () => {
    const ncx = baseNcx()
    const { pkg2, container } = baseSetup()
    const m = validateNcx(
      { ...ncx, navPoints: [{ hasLabel: true, hasContent: true, src: 'content_001.xhtml#frag', loc }] },
      pkg2,
      container,
      '2.0',
    )
    expect(m).toEqual([])
  })

  it('remote srcs are skipped (hyperlink refs may be remote)', () => {
    const ncx = baseNcx()
    const { pkg2, container } = baseSetup()
    const m = validateNcx(
      { ...ncx, navPoints: [{ hasLabel: true, hasContent: true, src: 'https://x.example/y', loc }] },
      pkg2,
      container,
      '2.0',
    )
    expect(m).toEqual([])
  })
})
