import { describe, it, expect } from 'vitest'
import type { EpubContainer, Resource } from '../io/zip.js'
import type { PackageDocument, ManifestItem, SpineItem } from '../parse/opf.js'
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
  it('RSC-005 when dc:identifier / dc:title / dc:language are missing', () => {
    const pkg = validPkg({ metadata: { identifiers: [], titles: [], languages: [], modifiedCount: 1 } })
    const msgs = validateOpf(pkg, emptyContainer(['EPUB/nav.xhtml']), '3.3')
    expect(msgs.filter((m) => m.id === 'RSC-005').length).toBeGreaterThanOrEqual(3)
  })
  it('RSC-005 when dcterms:modified is not present exactly once', () => {
    const pkg = validPkg({ metadata: { identifiers: [{ id: 'uid', value: 'u' }], titles: ['T'], languages: ['en'], modifiedCount: 0 } })
    expect(validateOpf(pkg, emptyContainer(['EPUB/nav.xhtml']), '3.3').some((m) => m.id === 'RSC-005' && m.message.includes('dcterms:modified'))).toBe(true)
  })
})

describe('validateOpf — manifest', () => {
  const navItem: ManifestItem = { id: 'nav', href: 'nav.xhtml', mediaType: 'application/xhtml+xml', properties: ['nav'], loc: LOC }

  it('RSC-005 when an item is missing a required attribute', () => {
    const bad: ManifestItem = { id: 'c1', href: undefined, mediaType: 'application/xhtml+xml', properties: [], loc: LOC }
    const pkg = validPkg({ manifest: [navItem, bad], spine: [{ idref: 'nav', linear: true, properties: [], loc: LOC }] })
    expect(validateOpf(pkg, emptyContainer(['EPUB/nav.xhtml']), '3.3').some((m) => m.id === 'RSC-005' && m.message.includes('required attribute'))).toBe(true)
  })

  it('RSC-005 on a duplicate manifest item id', () => {
    const dup: ManifestItem = { id: 'nav', href: 'c1.xhtml', mediaType: 'application/xhtml+xml', properties: [], loc: LOC }
    const pkg = validPkg({ manifest: [navItem, dup] })
    expect(validateOpf(pkg, emptyContainer(['EPUB/nav.xhtml', 'EPUB/c1.xhtml']), '3.3').some((m) => m.id === 'RSC-005' && m.message.includes('Duplicate manifest item id'))).toBe(true)
  })

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

  it('RSC-005 when there is no spine', () => {
    const pkg = validPkg({ spinePresent: false, spine: [] })
    expect(validateOpf(pkg, c, '3.3').some((m) => m.id === 'RSC-005' && m.message.includes('spine element'))).toBe(true)
  })
  it('RSC-005 when the spine has no itemref', () => {
    const pkg = validPkg({ spinePresent: true, spine: [] })
    expect(validateOpf(pkg, c, '3.3').some((m) => m.id === 'RSC-005' && m.message.includes('at least one itemref'))).toBe(true)
  })
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
