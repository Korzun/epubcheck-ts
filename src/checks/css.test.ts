import { describe, it, expect } from 'vitest'
import type { EpubContainer, Resource } from '../io/zip.js'
import type { PackageDocument, ManifestItem } from '../parse/opf.js'
import { validateCssDocs, validateCss } from './css.js'
import { manifestPathMap } from '../parse/opf.js'

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
    manifest, spinePresent: true, spine: [], guide: [], loc: LOC,
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

describe('validateCssDocs — properties', () => {
  it('CSS-001 for direction / unicode-bidi', () => {
    expect(ids('p { direction: rtl; }')).toContain('CSS-001')
    expect(ids('p { unicode-bidi: bidi-override; }')).toContain('CSS-001')
  })
  it('CSS-006 for position: fixed', () => {
    expect(ids('div { position: fixed; }')).toContain('CSS-006')
  })
  it('does not flag position: absolute', () => {
    expect(ids('div { position: absolute; }')).not.toContain('CSS-006')
  })
  it('CSS-019 for an empty @font-face', () => {
    expect(ids('@font-face {}')).toContain('CSS-019')
  })
})

describe('validateCss (reusable)', () => {
  it('runs reference + property checks on a synthesized CssDocument', () => {
    const { pkg, container } = setup('') // reuse the existing test helper; the .css resource content is irrelevant here
    const manifest = manifestPathMap(pkg)
    const css = {
      path: 'EPUB/c1.xhtml',
      refs: [{ url: 'missing.png', type: 'generic' as const, loc: { path: 'EPUB/c1.xhtml' } }],
      declarations: [{ property: 'position', value: 'fixed', loc: { path: 'EPUB/c1.xhtml' } }],
      fontFaces: [],
    }
    const ids = validateCss(css, container, manifest).map((m) => m.id)
    expect(ids).toContain('RSC-007') // missing.png unresolved relative to EPUB/c1.xhtml
    expect(ids).toContain('CSS-006') // position: fixed
  })
})

describe('validateCssDocs — font-face type (CSS-007)', () => {
  it('CSS-007 when a @font-face src targets a non-font media type', () => {
    const out = ids('@font-face { font-family: F; src: url(f.bin); }', { present: ['f.bin'], declared: ['f.bin'] })
    expect(out).toContain('CSS-007')
  })

  it('no CSS-007 when the @font-face src targets a blessed font type', () => {
    const { pkg, container } = setup('@font-face { font-family: F; src: url(f.woff2); }')
    pkg.manifest.push({ id: 'fnt', href: 'f.woff2', mediaType: 'font/woff2', properties: [], loc: LOC })
    container.resources.set('EPUB/f.woff2', { path: 'EPUB/f.woff2', bytes: enc('x'), compression: 'deflate' })
    expect(validateCssDocs(pkg, container).map((m) => m.id)).not.toContain('CSS-007')
  })

  it('no CSS-007 for a non-font url() (only @font-face src is checked)', () => {
    const out = ids('body { background: url(pic.bin); }', { present: ['pic.bin'], declared: ['pic.bin'] })
    expect(out).not.toContain('CSS-007')
  })

  it('no CSS-007 when the @font-face src targets a manifest item with no media-type', () => {
    const { pkg, container } = setup('@font-face { font-family: F; src: url(f.bin); }')
    // Deliberately omit mediaType to simulate a manifest item declared with no media-type.
    pkg.manifest.push({ id: 'fnt', href: 'f.bin', properties: [], loc: LOC })
    container.resources.set('EPUB/f.bin', { path: 'EPUB/f.bin', bytes: enc('x'), compression: 'deflate' })
    expect(validateCssDocs(pkg, container).map((m) => m.id)).not.toContain('CSS-007')
  })
})

describe('CSS-007 version awareness', () => {
  // @font-face src → declared local item with media-type 'application/x-font-opentype',
  // blessed under the EPUB 2 prefix predicate but not in the 3.x exact-match set.
  function setupOpentypeFont(): { pkg: PackageDocument; container: EpubContainer } {
    const { pkg, container } = setup('@font-face { font-family: F; src: url(f.otf); }')
    pkg.manifest.push({ id: 'fnt', href: 'f.otf', mediaType: 'application/x-font-opentype', properties: [], loc: LOC })
    container.resources.set('EPUB/f.otf', { path: 'EPUB/f.otf', bytes: enc('x'), compression: 'deflate' })
    return { pkg, container }
  }

  it('v2 prefix predicate accepts application/x-font-opentype (no CSS-007) via validateCssDocs', () => {
    const { pkg, container } = setupOpentypeFont()
    expect(validateCssDocs(pkg, container, '2.0').map((m) => m.id)).not.toContain('CSS-007')
  })

  it('3.x exact set rejects it (CSS-007) via validateCssDocs; default unchanged', () => {
    const { pkg, container } = setupOpentypeFont()
    expect(validateCssDocs(pkg, container, '3.3').map((m) => m.id)).toContain('CSS-007')
    expect(validateCssDocs(pkg, container).map((m) => m.id)).toContain('CSS-007') // default unchanged
  })

  it('validateCss itself honors the version parameter for CSS-007', () => {
    const { pkg, container } = setupOpentypeFont()
    const manifest = manifestPathMap(pkg)
    const css = {
      path: 'EPUB/s.css',
      refs: [{ url: 'f.otf', type: 'font' as const, loc: { path: 'EPUB/s.css' } }],
      declarations: [],
      fontFaces: [],
    }
    expect(validateCss(css, container, manifest, '2.0').map((m) => m.id)).not.toContain('CSS-007')
    expect(validateCss(css, container, manifest, '3.3').map((m) => m.id)).toContain('CSS-007')
    expect(validateCss(css, container, manifest).map((m) => m.id)).toContain('CSS-007') // default unchanged
  })
})
