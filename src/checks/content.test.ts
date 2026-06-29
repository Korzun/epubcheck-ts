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
    manifest,
    spinePresent: true,
    spine: manifest.map((m) => ({ idref: m.id, linear: true, properties: [], loc: LOC })),
    loc: LOC,
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

describe('validateContentDocs — elements', () => {
  it('RSC-005 for an unknown XHTML-namespace element', () => {
    const msgs = (() => { const { pkg, container } = setup({ 'c1.xhtml': '<frobnicate>x</frobnicate>' }); return validateContentDocs(pkg, container) })()
    expect(msgs.some((m) => m.id === 'RSC-005' && m.message.includes('frobnicate'))).toBe(true)
  })
  it('does not flag known elements or custom (hyphenated) elements', () => {
    expect(ids({ 'c1.xhtml': '<section><my-widget>x</my-widget></section>' })).toEqual([])
  })
  it('does not flag SVG-namespace elements', () => {
    expect(ids({ 'c1.xhtml': '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>' })).toEqual([])
  })
})

describe('validateContentDocs — inline CSS', () => {
  it('RSC-007 for a missing url() in a <style> element', () => {
    expect(ids({ 'c1.xhtml': '<style>body { background: url(missing.png); }</style>' })).toContain('RSC-007')
  })
  it('CSS-006 for position:fixed in a style attribute', () => {
    expect(ids({ 'c1.xhtml': '<p style="position: fixed">x</p>' })).toContain('CSS-006')
  })
  it('CSS-001 for direction in a <style> element', () => {
    expect(ids({ 'c1.xhtml': '<style>p { direction: rtl; }</style>' })).toContain('CSS-001')
  })
})

describe('validateContentDocs — hyperlink targets', () => {
  it('RSC-010 for a hyperlink to a non-content-document resource type', () => {
    const { pkg, container } = setup({ 'c1.xhtml': '<a href="photo.jpg">x</a>' })
    pkg.manifest.push({ id: 'photo', href: 'photo.jpg', mediaType: 'image/jpeg', properties: [], loc: LOC })
    container.resources.set('EPUB/photo.jpg', { path: 'EPUB/photo.jpg', bytes: enc('x'), compression: 'deflate' })
    const out = validateContentDocs(pkg, container).map((m) => m.id)
    expect(out).toContain('RSC-010')
    expect(out).not.toContain('RSC-011')
  })

  it('RSC-011 for a hyperlink to a content document that is not in the spine', () => {
    const { pkg, container } = setup({ 'c1.xhtml': '<a href="c2.xhtml">x</a>' })
    // c2 is a declared, present XHTML doc, but is intentionally NOT added to the spine.
    pkg.manifest.push({ id: 'c2', href: 'c2.xhtml', mediaType: 'application/xhtml+xml', properties: [], loc: LOC })
    container.resources.set('EPUB/c2.xhtml', { path: 'EPUB/c2.xhtml', bytes: enc(DOC('<p>2</p>')), compression: 'deflate' })
    const out = validateContentDocs(pkg, container).map((m) => m.id)
    expect(out).toContain('RSC-011')
    expect(out).not.toContain('RSC-010')
  })

  it('no RSC-010/011 for a hyperlink to a spine content document', () => {
    // c1 and c2 are both content docs; setup() puts both in the spine.
    const { pkg, container } = setup({ 'c1.xhtml': '<a href="c2.xhtml">x</a>', 'c2.xhtml': '<p>2</p>' })
    const out = validateContentDocs(pkg, container).map((m) => m.id)
    expect(out).not.toContain('RSC-010')
    expect(out).not.toContain('RSC-011')
  })

  it('RSC-010 is suppressed when the non-content target has a content-document fallback', () => {
    const { pkg, container } = setup({ 'c1.xhtml': '<a href="photo.jpg">x</a>' })
    // photo.jpg (non-blessed) falls back to fb (xhtml) via the manifest fallback chain.
    pkg.manifest.push({ id: 'photo', href: 'photo.jpg', mediaType: 'image/jpeg', properties: [], fallback: 'fb', loc: LOC })
    pkg.manifest.push({ id: 'fb', href: 'fb.xhtml', mediaType: 'application/xhtml+xml', properties: [], loc: LOC })
    container.resources.set('EPUB/photo.jpg', { path: 'EPUB/photo.jpg', bytes: enc('x'), compression: 'deflate' })
    container.resources.set('EPUB/fb.xhtml', { path: 'EPUB/fb.xhtml', bytes: enc(DOC('<p>fb</p>')), compression: 'deflate' })
    expect(validateContentDocs(pkg, container).map((m) => m.id)).not.toContain('RSC-010')
  })

  it('RSC-011 (not RSC-010) for a hyperlink to a text/html doc not in the spine — text/html is deprecated-blessed', () => {
    const { pkg, container } = setup({ 'c1.xhtml': '<a href="c2.html">x</a>' })
    // c2 is a declared text/html doc (deprecated-blessed content type), present but NOT in the spine.
    pkg.manifest.push({ id: 'c2', href: 'c2.html', mediaType: 'text/html', properties: [], loc: LOC })
    container.resources.set('EPUB/c2.html', { path: 'EPUB/c2.html', bytes: enc('<html></html>'), compression: 'deflate' })
    const out = validateContentDocs(pkg, container).map((m) => m.id)
    expect(out).toContain('RSC-011')
    expect(out).not.toContain('RSC-010')
  })

  it('RSC-010 for a hyperlink to application/x-dtbncx+xml — NCX is not a blessed content type', () => {
    const { pkg, container } = setup({ 'c1.xhtml': '<a href="toc.ncx">x</a>' })
    pkg.manifest.push({ id: 'ncx', href: 'toc.ncx', mediaType: 'application/x-dtbncx+xml', properties: [], loc: LOC })
    container.resources.set('EPUB/toc.ncx', { path: 'EPUB/toc.ncx', bytes: enc('<ncx/>'), compression: 'deflate' })
    const out = validateContentDocs(pkg, container).map((m) => m.id)
    expect(out).toContain('RSC-010')
    expect(out).not.toContain('RSC-011')
  })
})

describe('validateContentDocs — remote HTTPS', () => {
  it('RSC-031 for a remote audio reference over HTTP', () => {
    const out = ids({ 'c1.xhtml': '<audio src="http://example.com/a.mp3"></audio>' })
    expect(out).toContain('RSC-031')
    expect(out).not.toContain('RSC-006') // audio is allowed to be remote
  })

  it('no RSC-031 for a remote audio reference over HTTPS', () => {
    expect(ids({ 'c1.xhtml': '<audio src="https://example.com/a.mp3"></audio>' })).not.toContain('RSC-031')
  })

  it('no RSC-031 for a remote hyperlink over HTTP', () => {
    expect(ids({ 'c1.xhtml': '<a href="http://example.com/">x</a>' })).not.toContain('RSC-031')
  })
})
