import { describe, it, expect } from 'vitest'
import type { EpubContainer, Resource } from '../io/zip.js'
import type { PackageDocument, ManifestItem, SpineItem, GuideReference } from '../parse/opf.js'
import type { Message } from '../messages/format.js'
import type { EpubVersion } from '../versions.js'
import { validateOpf, checkUndeclaredResources } from './opf.js'

const enc = (s: string) => new TextEncoder().encode(s)
const LOC = { path: 'EPUB/package.opf', line: 1, column: 1 }

function emptyContainer(paths: string[] = []): EpubContainer {
  const resources = new Map<string, Resource>()
  for (const p of paths) resources.set(p, { path: p, bytes: enc(''), compression: 'deflate' })
  return { resources, rootfiles: ['EPUB/package.opf'], hasEncryption: false }
}

// A package that is fully valid; individual tests mutate one field to trigger one rule.
function validPkg(overrides: Partial<PackageDocument> = {}): PackageDocument {
  const navItem: ManifestItem = { id: 'nav', href: 'nav.xhtml', mediaType: 'application/xhtml+xml', properties: ['nav'], loc: LOC }
  const spineItem: SpineItem = { idref: 'nav', linear: true, properties: [], loc: LOC }
  return {
    path: 'EPUB/package.opf',
    version: '3.0',
    uniqueIdentifier: 'uid',
    metadata: { identifiers: [{ id: 'uid', value: 'urn:isbn:1' }], titles: ['T'], languages: ['en'], modifiedCount: 1 },
    root: { type: 'element', name: 'package', loc: LOC },
    manifest: [navItem],
    spinePresent: true,
    spine: [spineItem],
    guide: [],
    loc: LOC,
    ...overrides,
  }
}

const ids = (pkg: PackageDocument, version: EpubVersion = '3.3', c: EpubContainer = emptyContainer(['EPUB/nav.xhtml'])) =>
  validateOpf(pkg, c, version).map((m) => m.id)

describe('validateOpf — package level', () => {
  it('passes a valid package (no package-level messages)', () => {
    expect(ids(validPkg())).toEqual([])
  })
  it('OPF-001 when version is missing', () => {
    expect(ids(validPkg({ version: undefined }))).toContain('OPF-001')
  })
  it('OPF-001 when version is unsupported', () => {
    expect(ids(validPkg({ version: '4.0' }))).toContain('OPF-001')
  })
  it('OPF-048 when unique-identifier attribute is absent', () => {
    expect(ids(validPkg({ uniqueIdentifier: undefined }))).toContain('OPF-048')
  })
  it('OPF-030 when unique-identifier does not match a dc:identifier id', () => {
    expect(ids(validPkg({ uniqueIdentifier: 'other' }))).toContain('OPF-030')
  })
  it('RSC-005 when dcterms:modified is not present exactly once', () => {
    const pkg = validPkg({ metadata: { identifiers: [{ id: 'uid', value: 'u' }], titles: ['T'], languages: ['en'], modifiedCount: 0 } })
    expect(validateOpf(pkg, emptyContainer(['EPUB/nav.xhtml']), '3.3').some((m) => m.id === 'RSC-005' && m.message.includes('dcterms:modified'))).toBe(true)
  })
})

describe('validateOpf — manifest', () => {
  const navItem: ManifestItem = { id: 'nav', href: 'nav.xhtml', mediaType: 'application/xhtml+xml', properties: ['nav'], loc: LOC }

  it('OPF-074 when two items resolve to the same href', () => {
    const a: ManifestItem = { id: 'a', href: 'c1.xhtml', mediaType: 'application/xhtml+xml', properties: [], loc: LOC }
    const b: ManifestItem = { id: 'b', href: './c1.xhtml', mediaType: 'application/xhtml+xml', properties: [], loc: LOC }
    const pkg = validPkg({ manifest: [navItem, a, b] })
    expect(validateOpf(pkg, emptyContainer(['EPUB/nav.xhtml', 'EPUB/c1.xhtml']), '3.3').map((m) => m.id)).toContain('OPF-074')
  })

  it('RSC-001 when an item href is not present in the container', () => {
    const missing: ManifestItem = { id: 'm', href: 'gone.xhtml', mediaType: 'application/xhtml+xml', properties: [], loc: LOC }
    const pkg = validPkg({ manifest: [navItem, missing] })
    expect(validateOpf(pkg, emptyContainer(['EPUB/nav.xhtml']), '3.3').map((m) => m.id)).toContain('RSC-001')
  })

  it('does not report RSC-001 for a remote href', () => {
    const remote: ManifestItem = { id: 'r', href: 'https://example.com/x.mp4', mediaType: 'video/mp4', properties: [], loc: LOC }
    const pkg = validPkg({ manifest: [navItem, remote] })
    expect(validateOpf(pkg, emptyContainer(['EPUB/nav.xhtml']), '3.3').map((m) => m.id)).not.toContain('RSC-001')
  })
})

describe('validateOpf — spine and nav', () => {
  const navItem: ManifestItem = { id: 'nav', href: 'nav.xhtml', mediaType: 'application/xhtml+xml', properties: ['nav'], loc: LOC }
  const c = emptyContainer(['EPUB/nav.xhtml'])

  it('OPF-049 when an itemref idref has no manifest item', () => {
    const pkg = validPkg({ spine: [{ idref: 'missing', linear: true, properties: [], loc: LOC }] })
    expect(validateOpf(pkg, c, '3.3').map((m) => m.id)).toContain('OPF-049')
  })
  it('OPF-033 when no spine item is linear', () => {
    const pkg = validPkg({ spine: [{ idref: 'nav', linear: false, properties: [], loc: LOC }] })
    expect(validateOpf(pkg, c, '3.3').map((m) => m.id)).toContain('OPF-033')
  })
  it('RSC-005 when there is not exactly one nav item', () => {
    const pkg = validPkg({ manifest: [{ ...navItem, properties: [] }] })
    expect(validateOpf(pkg, c, '3.3').some((m) => m.id === 'RSC-005' && m.message.includes('"nav" property'))).toBe(true)
  })
  it('RSC-005 when the nav item is not XHTML', () => {
    const pkg = validPkg({ manifest: [{ ...navItem, mediaType: 'text/html' }] })
    expect(validateOpf(pkg, c, '3.3').some((m) => m.id === 'RSC-005' && m.message.includes('Navigation Document'))).toBe(true)
  })
})

describe('validateOpf — bindings deprecation (RSC-017)', () => {
  it('warns at 3.2+ when a bindings element is present', () => {
    const pkg = validPkg({ bindings: LOC })
    expect(ids(pkg, '3.2')).toContain('RSC-017')
    expect(ids(pkg, '3.3')).toContain('RSC-017')
  })
  it('does not warn at 3.0 (bindings not yet deprecated)', () => {
    const pkg = validPkg({ bindings: LOC })
    expect(ids(pkg, '3.0')).not.toContain('RSC-017')
  })
  it('does not warn when there is no bindings element', () => {
    expect(ids(validPkg(), '3.3')).not.toContain('RSC-017')
  })
  it('the RSC-017 message names the bindings element', () => {
    const out = validateOpf(validPkg({ bindings: LOC }), emptyContainer(['EPUB/nav.xhtml']), '3.3')
    expect(out.some((m) => m.id === 'RSC-017' && m.message.includes('bindings element is deprecated'))).toBe(true)
  })
})

describe('checkUndeclaredResources', () => {
  const LOC2 = { path: 'EPUB/package.opf' }
  function pkgWith(): PackageDocument {
    return {
      path: 'EPUB/package.opf', version: '3.0', uniqueIdentifier: 'uid',
      metadata: { identifiers: [{ id: 'uid', value: 'u' }], titles: ['T'], languages: ['en'], modifiedCount: 1 },
      root: { type: 'element', name: 'package', loc: LOC },
      manifest: [{ id: 'nav', href: 'nav.xhtml', mediaType: 'application/xhtml+xml', properties: ['nav'], loc: LOC2 }],
      spinePresent: true, spine: [], guide: [], loc: LOC2,
    }
  }
  function containerWith(paths: string[]): EpubContainer {
    const resources = new Map<string, Resource>()
    for (const p of paths) resources.set(p, { path: p, bytes: enc(''), compression: 'deflate' })
    return { resources, rootfiles: ['EPUB/package.opf'], hasEncryption: false }
  }

  it('OPF-003 for a container file not declared in the manifest', () => {
    const msgs = checkUndeclaredResources(pkgWith(), containerWith(['EPUB/nav.xhtml', 'EPUB/orphan.txt']))
    expect(msgs.map((m) => m.id)).toEqual(['OPF-003'])
    expect(msgs[0]?.severity).toBe('USAGE')
  })

  it('does not flag mimetype, META-INF/*, the rootfile OPF, or declared items', () => {
    const msgs = checkUndeclaredResources(
      pkgWith(),
      containerWith(['mimetype', 'META-INF/container.xml', 'META-INF/encryption.xml', 'EPUB/package.opf', 'EPUB/nav.xhtml']),
    )
    expect(msgs).toEqual([])
  })
})

describe('EPUB 2 rules', () => {
  const ids = (ms: Message[]): string[] => ms.map((m) => m.id)

  const ncxItem: ManifestItem = { id: 'ncx', href: 'toc.ncx', mediaType: 'application/x-dtbncx+xml', properties: [], loc: LOC }
  const contentItem: ManifestItem = { id: 'content', href: 'content.xhtml', mediaType: 'application/xhtml+xml', properties: [], loc: LOC }
  const contentRef: SpineItem = { idref: 'content', linear: true, properties: [], loc: LOC }

  // A minimal, fully valid EPUB 2 package: individual tests mutate one field to trigger one rule.
  function validPkg2(overrides: Partial<PackageDocument> = {}): PackageDocument {
    return {
      path: 'EPUB/package.opf',
      version: '2.0',
      uniqueIdentifier: 'uid',
      metadata: { identifiers: [{ id: 'uid', value: 'urn:isbn:1' }], titles: ['T'], languages: ['en'], modifiedCount: 0 },
      root: { type: 'element', name: 'package', loc: LOC },
      manifest: [ncxItem, contentItem],
      spinePresent: true,
      spine: [contentRef],
      spineToc: 'ncx',
      spineLoc: LOC,
      guide: [],
      loc: LOC,
      ...overrides,
    }
  }

  const container2 = emptyContainer(['EPUB/toc.ncx', 'EPUB/content.xhtml'])

  it('passes a valid EPUB 2 package with zero messages', () => {
    expect(validateOpf(validPkg2(), container2, '2.0')).toEqual([])
  })

  it('does not require dcterms:modified for a 2.0 target', () => {
    const messages = validateOpf(validPkg2(), container2, '2.0')
    expect(messages.filter((m) => m.message.includes('dcterms:modified'))).toHaveLength(0)
  })

  it('still requires dcterms:modified for a 3.x target', () => {
    const pkg3NoModified: PackageDocument = {
      path: 'EPUB/package.opf',
      version: '3.0',
      uniqueIdentifier: 'uid',
      metadata: { identifiers: [{ id: 'uid', value: 'u' }], titles: ['T'], languages: ['en'], modifiedCount: 0 },
      root: { type: 'element', name: 'package', loc: LOC },
      manifest: [{ id: 'nav', href: 'nav.xhtml', mediaType: 'application/xhtml+xml', properties: ['nav'], loc: LOC }],
      spinePresent: true,
      spine: [{ idref: 'nav', linear: true, properties: [], loc: LOC }],
      guide: [],
      loc: LOC,
    }
    const messages = validateOpf(pkg3NoModified, emptyContainer(['EPUB/nav.xhtml']), '3.3')
    expect(messages.some((m) => m.message.includes('dcterms:modified'))).toBe(true)
  })

  it('OPF-031: guide reference to an undeclared file', () => {
    const ref: GuideReference = { type: 'text', href: 'nowhere.xhtml', loc: LOC }
    const pkg = validPkg2({ guide: [ref] })
    expect(ids(validateOpf(pkg, container2, '2.0'))).toContain('OPF-031')
  })

  it('OPF-032: guide reference to a non-content-document type', () => {
    const imageItem: ManifestItem = { id: 'cover', href: 'cover.gif', mediaType: 'image/gif', properties: [], loc: LOC }
    const ref: GuideReference = { type: 'cover', href: 'cover.gif', loc: LOC }
    const pkg = validPkg2({ manifest: [ncxItem, contentItem, imageItem], guide: [ref] })
    const container = emptyContainer(['EPUB/toc.ncx', 'EPUB/content.xhtml', 'EPUB/cover.gif'])
    expect(ids(validateOpf(pkg, container, '2.0'))).toContain('OPF-032')
  })

  it('OPF-034: duplicate spine idref', () => {
    const pkg = validPkg2({ spine: [contentRef, contentRef] })
    expect(ids(validateOpf(pkg, container2, '2.0'))).toContain('OPF-034')
  })

  it('OPF-035/OPF-037: html and deprecated media types', () => {
    const htmlItem: ManifestItem = { id: 'html', href: 'html.html', mediaType: 'text/html', properties: [], loc: LOC }
    const oeb1CssItem: ManifestItem = { id: 'oeb1css', href: 'oeb1.css', mediaType: 'text/x-oeb1-css', properties: [], loc: LOC }
    const pkg = validPkg2({ manifest: [ncxItem, contentItem, htmlItem, oeb1CssItem] })
    const container = emptyContainer(['EPUB/toc.ncx', 'EPUB/content.xhtml', 'EPUB/html.html', 'EPUB/oeb1.css'])
    const out = ids(validateOpf(pkg, container, '2.0'))
    expect(out).toContain('OPF-035')
    expect(out).toContain('OPF-037')
  })

  it('OPF-042: image type in the spine', () => {
    const imageItem: ManifestItem = { id: 'cover', href: 'cover.gif', mediaType: 'image/gif', properties: [], loc: LOC }
    const imageRef: SpineItem = { idref: 'cover', linear: true, properties: [], loc: LOC }
    const pkg = validPkg2({ manifest: [ncxItem, contentItem, imageItem], spine: [contentRef, imageRef] })
    const container = emptyContainer(['EPUB/toc.ncx', 'EPUB/content.xhtml', 'EPUB/cover.gif'])
    expect(ids(validateOpf(pkg, container, '2.0'))).toContain('OPF-042')
  })

  it('OPF-043/OPF-044: foreign spine item without / with non-resolving fallback', () => {
    const pdfItem: ManifestItem = { id: 'pdf', href: 'doc.pdf', mediaType: 'application/pdf', properties: [], loc: LOC }
    const pdfRef: SpineItem = { idref: 'pdf', linear: true, properties: [], loc: LOC }
    const noFallbackPkg = validPkg2({ manifest: [ncxItem, contentItem, pdfItem], spine: [contentRef, pdfRef] })
    const noFallbackContainer = emptyContainer(['EPUB/toc.ncx', 'EPUB/content.xhtml', 'EPUB/doc.pdf'])
    expect(ids(validateOpf(noFallbackPkg, noFallbackContainer, '2.0'))).toContain('OPF-043')

    const imageItem: ManifestItem = { id: 'cover', href: 'cover.gif', mediaType: 'image/gif', properties: [], loc: LOC }
    const pdfWithFallback: ManifestItem = { ...pdfItem, fallback: 'cover' }
    const fallbackPkg = validPkg2({ manifest: [ncxItem, contentItem, pdfWithFallback, imageItem], spine: [contentRef, pdfRef] })
    const fallbackContainer = emptyContainer(['EPUB/toc.ncx', 'EPUB/content.xhtml', 'EPUB/doc.pdf', 'EPUB/cover.gif'])
    expect(ids(validateOpf(fallbackPkg, fallbackContainer, '2.0'))).toContain('OPF-044')
  })

  it('OPF-040: fallback idref not found (any version)', () => {
    const ghostFallbackItem: ManifestItem = { id: 'pdf', href: 'doc.pdf', mediaType: 'application/pdf', properties: [], loc: LOC, fallback: 'ghost' }
    for (const version of ['2.0', '3.3'] as const) {
      const pkg = validPkg2({ manifest: [ncxItem, contentItem, ghostFallbackItem], version })
      const container = emptyContainer(['EPUB/toc.ncx', 'EPUB/content.xhtml', 'EPUB/doc.pdf'])
      expect(ids(validateOpf(pkg, container, version))).toContain('OPF-040')
    }
  })

  it('OPF-099: manifest lists the package document (any version)', () => {
    const selfItem: ManifestItem = { id: 'self', href: 'package.opf', mediaType: 'application/oebps-package+xml', properties: [], loc: LOC }
    for (const version of ['2.0', '3.3'] as const) {
      const pkg = validPkg2({ manifest: [ncxItem, contentItem, selfItem], version })
      expect(ids(validateOpf(pkg, container2, version))).toContain('OPF-099')
    }
  })

  it('OPF-049 / OPF-050 for the spine toc attribute', () => {
    const ghostTocPkg = validPkg2({ spineToc: 'ghost' })
    expect(ids(validateOpf(ghostTocPkg, container2, '2.0'))).toContain('OPF-049')

    const wrongTypeTocPkg = validPkg2({ spineToc: 'content' })
    expect(ids(validateOpf(wrongTypeTocPkg, container2, '2.0'))).toContain('OPF-050')
  })


  it('emits none of the EPUB 2 rules for a 3.x target', () => {
    const imageItem: ManifestItem = { id: 'cover', href: 'cover.gif', mediaType: 'image/gif', properties: [], loc: LOC }
    const imageRef: SpineItem = { idref: 'cover', linear: true, properties: [], loc: LOC }
    const htmlItem: ManifestItem = { id: 'html', href: 'html.html', mediaType: 'text/html', properties: [], loc: LOC }
    const oeb1CssItem: ManifestItem = { id: 'oeb1css', href: 'oeb1.css', mediaType: 'text/x-oeb1-css', properties: [], loc: LOC }
    const pdfItem: ManifestItem = { id: 'pdf', href: 'doc.pdf', mediaType: 'application/pdf', properties: [], loc: LOC }
    const pdfRef: SpineItem = { idref: 'pdf', linear: true, properties: [], loc: LOC }
    const badGuideRef: GuideReference = { type: 'text', href: 'nowhere.xhtml', loc: LOC }

    const pkg = validPkg2({
      manifest: [ncxItem, contentItem, imageItem, htmlItem, oeb1CssItem, pdfItem],
      spine: [contentRef, contentRef, imageRef, pdfRef],
      spineToc: 'content', // wrong media type were this checked at 3.x
      guide: [badGuideRef],
    })
    const container = emptyContainer(['EPUB/toc.ncx', 'EPUB/content.xhtml', 'EPUB/cover.gif', 'EPUB/html.html', 'EPUB/oeb1.css', 'EPUB/doc.pdf'])
    const out = ids(validateOpf(pkg, container, '3.3'))
    for (const forbidden of ['OPF-031', 'OPF-032', 'OPF-034', 'OPF-035', 'OPF-037', 'OPF-042', 'OPF-043', 'OPF-044', 'OPF-050']) {
      expect(out).not.toContain(forbidden)
    }
  })
})
