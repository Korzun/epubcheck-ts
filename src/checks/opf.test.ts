import { describe, it, expect } from 'vitest'
import type { EpubContainer, Resource } from '../io/zip.js'
import type { PackageDocument, ManifestItem, SpineItem } from '../parse/opf.js'
import { validateOpf } from './opf.js'

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
    loc: LOC,
    ...overrides,
  }
}

const ids = (pkg: PackageDocument, c: EpubContainer = emptyContainer(['EPUB/nav.xhtml'])) =>
  validateOpf(pkg, c).map((m) => m.id)

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
    const msgs = validateOpf(pkg, emptyContainer(['EPUB/nav.xhtml']))
    expect(msgs.filter((m) => m.id === 'RSC-005').length).toBeGreaterThanOrEqual(3)
  })
  it('RSC-005 when dcterms:modified is not present exactly once', () => {
    const pkg = validPkg({ metadata: { identifiers: [{ id: 'uid', value: 'u' }], titles: ['T'], languages: ['en'], modifiedCount: 0 } })
    expect(validateOpf(pkg, emptyContainer(['EPUB/nav.xhtml'])).some((m) => m.id === 'RSC-005' && m.message.includes('dcterms:modified'))).toBe(true)
  })
})
