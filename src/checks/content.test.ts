import { describe, it, expect } from 'vitest'
import type { EpubContainer, Resource } from '../io/zip.js'
import type { PackageDocument, ManifestItem } from '../parse/opf.js'
import { validateContentDocs } from './content.js'

const enc = (s: string) => new TextEncoder().encode(s)
const LOC = { path: 'EPUB/package.opf', line: 1, column: 1 }
const DOC = (body: string) =>
  '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:xlink="http://www.w3.org/1999/xlink"><head><title>t</title></head><body>' +
  body + '</body></html>'

// Build a package + container from a map of content-doc bodies and extra resource paths.
function setup(docs: Record<string, string>, extras: string[] = []): { pkg: PackageDocument; container: EpubContainer } {
  const resources = new Map<string, Resource>()
  const manifest: ManifestItem[] = []
  for (const [href, body] of Object.entries(docs)) {
    const path = `EPUB/${href}`
    resources.set(path, { path, bytes: enc(DOC(body)), compression: 'deflate' })
    manifest.push({ id: href, href, mediaType: 'application/xhtml+xml', properties: [], loc: LOC })
  }
  for (const p of extras) resources.set(`EPUB/${p}`, { path: `EPUB/${p}`, bytes: enc('x'), compression: 'deflate' })
  const container: EpubContainer = { resources, rootfiles: ['EPUB/package.opf'], hasEncryption: false }
  const pkg: PackageDocument = {
    path: 'EPUB/package.opf', version: '3.0', uniqueIdentifier: 'uid',
    metadata: { identifiers: [{ id: 'uid', value: 'u' }], titles: ['T'], languages: ['en'], modifiedCount: 1 },
    manifest, spinePresent: true, spine: [], loc: LOC,
  }
  return { pkg, container }
}
const ids = (docs: Record<string, string>, extras?: string[]) => {
  const { pkg, container } = setup(docs, extras)
  return validateContentDocs(pkg, container).map((m) => m.id)
}

describe('validateContentDocs — references', () => {
  it('passes when every reference resolves and is declared', () => {
    // c1 links to c2 (a declared content doc) and an image that is declared+present
    const pkg = setup({ 'c1.xhtml': '<a href="c2.xhtml">x</a><img src="a.png"/>', 'c2.xhtml': '<p>two</p>' })
    pkg.pkg.manifest.push({ id: 'img', href: 'a.png', mediaType: 'image/png', properties: [], loc: LOC })
    pkg.container.resources.set('EPUB/a.png', { path: 'EPUB/a.png', bytes: enc('x'), compression: 'deflate' })
    expect(validateContentDocs(pkg.pkg, pkg.container).map((m) => m.id)).toEqual([])
  })
  it('RSC-007 when a referenced file is missing', () => {
    expect(ids({ 'c1.xhtml': '<img src="missing.png"/>' })).toContain('RSC-007')
  })
  it('RSC-008 when a referenced file exists but is not in the manifest', () => {
    expect(ids({ 'c1.xhtml': '<img src="extra.png"/>' }, ['extra.png'])).toContain('RSC-008')
  })
  it('RSC-006 for a remote image reference (not allowed)', () => {
    expect(ids({ 'c1.xhtml': '<img src="https://example.com/a.png"/>' })).toContain('RSC-006')
  })
  it('allows a remote hyperlink (no RSC-006)', () => {
    expect(ids({ 'c1.xhtml': '<a href="https://example.com/">x</a>' })).not.toContain('RSC-006')
  })
  it('ignores mailto: and same-document fragment links', () => {
    expect(ids({ 'c1.xhtml': '<a href="mailto:a@b.com">m</a><a href="#top">t</a><span id="top"/>' })).toEqual([])
  })
})

describe('validateContentDocs — fragments', () => {
  it('RSC-012 when a same-document fragment id is missing', () => {
    expect(ids({ 'c1.xhtml': '<a href="#nope">x</a>' })).toContain('RSC-012')
  })
  it('passes when a same-document fragment id exists', () => {
    expect(ids({ 'c1.xhtml': '<a href="#here">x</a><span id="here"/>' })).toEqual([])
  })
  it('RSC-012 when a cross-document fragment id is missing', () => {
    expect(ids({ 'c1.xhtml': '<a href="c2.xhtml#nope">x</a>', 'c2.xhtml': '<p id="other">2</p>' })).toContain('RSC-012')
  })
  it('passes when a cross-document fragment id exists', () => {
    expect(ids({ 'c1.xhtml': '<a href="c2.xhtml#ok">x</a>', 'c2.xhtml': '<p id="ok">2</p>' })).toEqual([])
  })
})
