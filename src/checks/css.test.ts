import { describe, it, expect } from 'vitest'
import type { EpubContainer, Resource } from '../io/zip.js'
import type { PackageDocument, ManifestItem } from '../parse/opf.js'
import { validateCssDocs } from './css.js'

const enc = (s: string) => new TextEncoder().encode(s)
const LOC = { path: 'EPUB/package.opf' }

// One stylesheet at EPUB/s.css plus declared/present extra resources.
function setup(css: string, opts: { present?: string[]; declared?: string[] } = {}): { pkg: PackageDocument; container: EpubContainer } {
  const resources = new Map<string, Resource>()
  resources.set('EPUB/s.css', { path: 'EPUB/s.css', bytes: enc(css), compression: 'deflate' })
  const manifest: ManifestItem[] = [{ id: 's', href: 's.css', mediaType: 'text/css', properties: [], loc: LOC }]
  for (const p of opts.present ?? []) resources.set(`EPUB/${p}`, { path: `EPUB/${p}`, bytes: enc('x'), compression: 'deflate' })
  for (const href of opts.declared ?? []) manifest.push({ id: href, href, mediaType: 'application/octet-stream', properties: [], loc: LOC })
  const container: EpubContainer = { resources, rootfiles: ['EPUB/package.opf'], hasEncryption: false }
  const pkg: PackageDocument = {
    path: 'EPUB/package.opf', version: '3.0', uniqueIdentifier: 'uid',
    metadata: { identifiers: [{ id: 'uid', value: 'u' }], titles: ['T'], languages: ['en'], modifiedCount: 1 },
    manifest, spinePresent: true, spine: [], loc: LOC,
  }
  return { pkg, container }
}
const ids = (css: string, opts?: { present?: string[]; declared?: string[] }) => {
  const { pkg, container } = setup(css, opts)
  return validateCssDocs(pkg, container).map((m) => m.id)
}

describe('validateCssDocs — references', () => {
  it('passes when a url() resolves and is declared', () => {
    expect(ids('body { background: url(bg.png); }', { present: ['bg.png'], declared: ['bg.png'] })).toEqual([])
  })
  it('RSC-007 when a url() target is missing', () => {
    expect(ids('body { background: url(missing.png); }')).toContain('RSC-007')
  })
  it('RSC-008 when a url() target exists but is not declared', () => {
    expect(ids('body { background: url(extra.png); }', { present: ['extra.png'] })).toContain('RSC-008')
  })
  it('RSC-006 for a remote background image', () => {
    expect(ids('body { background: url(https://example.com/a.png); }')).toContain('RSC-006')
  })
  it('allows a remote @font-face src but warns RSC-031 when not HTTPS', () => {
    const idsOut = ids('@font-face { font-family: F; src: url(http://example.com/f.woff2); }')
    expect(idsOut).not.toContain('RSC-006')
    expect(idsOut).toContain('RSC-031')
  })
  it('RSC-030 for a file: url', () => {
    expect(ids('body { background: url(file:///etc/passwd); }')).toContain('RSC-030')
  })
  it('RSC-013 for an @import with a fragment', () => {
    expect(ids('@import "base.css#x";', { present: ['base.css'], declared: ['base.css'] })).toContain('RSC-013')
  })
})
