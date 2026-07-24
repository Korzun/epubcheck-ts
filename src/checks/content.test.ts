import { describe, it, expect } from 'vitest'
import type { EpubContainer, Resource } from '../io/zip.js'
import type { PackageDocument, ManifestItem } from '../parse/opf.js'
import { validateContentDocs } from './content.js'

const enc = (s: string) => new TextEncoder().encode(s)
const LOC = { path: 'EPUB/package.opf', line: 1, column: 1 }
const DOC = (body: string) =>
  '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
  'xmlns:epub="http://www.idpf.org/2007/ops" xmlns:ev="http://www.w3.org/2001/xml-events">' +
  '<head><title>t</title></head><body>' +
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
    root: { type: 'element', name: 'package', loc: LOC },
    manifest,
    spinePresent: true,
    spine: manifest.map((m) => ({ idref: m.id, linear: true, properties: [], loc: LOC })),
    guide: [],
    loc: LOC,
  }
  return { pkg, container }
}
const ids = (docs: Record<string, string>, extras?: string[]) => {
  const { pkg, container } = setup(docs, extras)
  return validateContentDocs(pkg, container, '3.3').map((m) => m.id)
}

// An <img> pointing at a WebP manifest item, with no <picture> intrinsic fallback
// and no manifest fallback — used to probe revision-sensitive RSC-032 gating.
function setupWebp(): { pkg: PackageDocument; container: EpubContainer } {
  const { pkg, container } = setup({ 'c1.xhtml': '<img src="pic.webp"/>' })
  pkg.manifest.push({ id: 'webp', href: 'pic.webp', mediaType: 'image/webp', properties: [], loc: LOC })
  container.resources.set('EPUB/pic.webp', { path: 'EPUB/pic.webp', bytes: enc('x'), compression: 'deflate' })
  return { pkg, container }
}

// A bare <audio src> pointing at an Opus manifest item, with no <source> intrinsic
// fallback and no manifest fallback — used to probe revision-sensitive RSC-032 gating.
function setupOpus(): { pkg: PackageDocument; container: EpubContainer } {
  const { pkg, container } = setup({ 'c1.xhtml': '<audio src="a.opus"></audio>' })
  pkg.manifest.push({ id: 'opus', href: 'a.opus', mediaType: 'audio/ogg; codecs=opus', properties: [], loc: LOC })
  container.resources.set('EPUB/a.opus', { path: 'EPUB/a.opus', bytes: enc('x'), compression: 'deflate' })
  return { pkg, container }
}

// A single content doc whose body is the given fragment; DOC() already declares
// xmlns:epub and xmlns:ev so epub:switch/epub:trigger parse cleanly.
function setupBody(body: string): { pkg: PackageDocument; container: EpubContainer } {
  return setup({ 'c1.xhtml': body })
}

describe('validateContentDocs — references', () => {
  it('passes when every reference resolves and is declared', () => {
    // c1 links to c2 (a declared content doc) and an image that is declared+present
    const pkg = setup({ 'c1.xhtml': '<a href="c2.xhtml">x</a><img src="a.png"/>', 'c2.xhtml': '<p>two</p>' })
    pkg.pkg.manifest.push({ id: 'img', href: 'a.png', mediaType: 'image/png', properties: [], loc: LOC })
    pkg.container.resources.set('EPUB/a.png', { path: 'EPUB/a.png', bytes: enc('x'), compression: 'deflate' })
    expect(validateContentDocs(pkg.pkg, pkg.container, '3.3').map((m) => m.id)).toEqual([])
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
    const msgs = (() => { const { pkg, container } = setup({ 'c1.xhtml': '<frobnicate>x</frobnicate>' }); return validateContentDocs(pkg, container, '3.3') })()
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
    const out = validateContentDocs(pkg, container, '3.3').map((m) => m.id)
    expect(out).toContain('RSC-010')
    expect(out).not.toContain('RSC-011')
  })

  it('RSC-011 for a hyperlink to a content document that is not in the spine', () => {
    const { pkg, container } = setup({ 'c1.xhtml': '<a href="c2.xhtml">x</a>' })
    // c2 is a declared, present XHTML doc, but is intentionally NOT added to the spine.
    pkg.manifest.push({ id: 'c2', href: 'c2.xhtml', mediaType: 'application/xhtml+xml', properties: [], loc: LOC })
    container.resources.set('EPUB/c2.xhtml', { path: 'EPUB/c2.xhtml', bytes: enc(DOC('<p>2</p>')), compression: 'deflate' })
    const out = validateContentDocs(pkg, container, '3.3').map((m) => m.id)
    expect(out).toContain('RSC-011')
    expect(out).not.toContain('RSC-010')
  })

  it('no RSC-010/011 for a hyperlink to a spine content document', () => {
    // c1 and c2 are both content docs; setup() puts both in the spine.
    const { pkg, container } = setup({ 'c1.xhtml': '<a href="c2.xhtml">x</a>', 'c2.xhtml': '<p>2</p>' })
    const out = validateContentDocs(pkg, container, '3.3').map((m) => m.id)
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
    expect(validateContentDocs(pkg, container, '3.3').map((m) => m.id)).not.toContain('RSC-010')
  })

  it('RSC-011 (not RSC-010) for a hyperlink to a text/html doc not in the spine — text/html is deprecated-blessed', () => {
    const { pkg, container } = setup({ 'c1.xhtml': '<a href="c2.html">x</a>' })
    // c2 is a declared text/html doc (deprecated-blessed content type), present but NOT in the spine.
    pkg.manifest.push({ id: 'c2', href: 'c2.html', mediaType: 'text/html', properties: [], loc: LOC })
    container.resources.set('EPUB/c2.html', { path: 'EPUB/c2.html', bytes: enc('<html></html>'), compression: 'deflate' })
    const out = validateContentDocs(pkg, container, '3.3').map((m) => m.id)
    expect(out).toContain('RSC-011')
    expect(out).not.toContain('RSC-010')
  })

  it('RSC-010 for a hyperlink to application/x-dtbncx+xml — NCX is not a blessed content type', () => {
    const { pkg, container } = setup({ 'c1.xhtml': '<a href="toc.ncx">x</a>' })
    pkg.manifest.push({ id: 'ncx', href: 'toc.ncx', mediaType: 'application/x-dtbncx+xml', properties: [], loc: LOC })
    container.resources.set('EPUB/toc.ncx', { path: 'EPUB/toc.ncx', bytes: enc('<ncx/>'), compression: 'deflate' })
    const out = validateContentDocs(pkg, container, '3.3').map((m) => m.id)
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

describe('validateContentDocs — foreign-resource fallback', () => {
  it('RSC-032 for an <img> whose target is a non-core media type with no fallback', () => {
    const { pkg, container } = setup({ 'c1.xhtml': '<img src="diagram.tiff"/>' })
    pkg.manifest.push({ id: 'tiff', href: 'diagram.tiff', mediaType: 'image/tiff', properties: [], loc: LOC })
    container.resources.set('EPUB/diagram.tiff', { path: 'EPUB/diagram.tiff', bytes: enc('x'), compression: 'deflate' })
    expect(validateContentDocs(pkg, container, '3.3').map((m) => m.id)).toContain('RSC-032')
  })

  it('no RSC-032 when the image target is a core media type', () => {
    const { pkg, container } = setup({ 'c1.xhtml': '<img src="ok.png"/>' })
    pkg.manifest.push({ id: 'png', href: 'ok.png', mediaType: 'image/png', properties: [], loc: LOC })
    container.resources.set('EPUB/ok.png', { path: 'EPUB/ok.png', bytes: enc('x'), compression: 'deflate' })
    expect(validateContentDocs(pkg, container, '3.3').map((m) => m.id)).not.toContain('RSC-032')
  })

  it('no RSC-032 when the non-core target has a core-media-type fallback in the manifest', () => {
    const { pkg, container } = setup({ 'c1.xhtml': '<img src="diagram.tiff"/>' })
    pkg.manifest.push({ id: 'tiff', href: 'diagram.tiff', mediaType: 'image/tiff', properties: [], fallback: 'png', loc: LOC })
    pkg.manifest.push({ id: 'png', href: 'ok.png', mediaType: 'image/png', properties: [], loc: LOC })
    container.resources.set('EPUB/diagram.tiff', { path: 'EPUB/diagram.tiff', bytes: enc('x'), compression: 'deflate' })
    container.resources.set('EPUB/ok.png', { path: 'EPUB/ok.png', bytes: enc('x'), compression: 'deflate' })
    expect(validateContentDocs(pkg, container, '3.3').map((m) => m.id)).not.toContain('RSC-032')
  })

  it('no RSC-032 for a non-core image inside <picture> (intrinsic fallback)', () => {
    const { pkg, container } = setup({ 'c1.xhtml': '<picture><img src="diagram.tiff"/></picture>' })
    pkg.manifest.push({ id: 'tiff', href: 'diagram.tiff', mediaType: 'image/tiff', properties: [], loc: LOC })
    container.resources.set('EPUB/diagram.tiff', { path: 'EPUB/diagram.tiff', bytes: enc('x'), compression: 'deflate' })
    expect(validateContentDocs(pkg, container, '3.3').map((m) => m.id)).not.toContain('RSC-032')
  })

  it('no RSC-032 for a video/* target (all video types are core media types)', () => {
    const { pkg, container } = setup({ 'c1.xhtml': '<video src="m.mkv"></video>' })
    pkg.manifest.push({ id: 'vid', href: 'm.mkv', mediaType: 'video/x-matroska', properties: [], loc: LOC })
    container.resources.set('EPUB/m.mkv', { path: 'EPUB/m.mkv', bytes: enc('x'), compression: 'deflate' })
    expect(validateContentDocs(pkg, container, '3.3').map((m) => m.id)).not.toContain('RSC-032')
  })
})

describe('validateContentDocs — link elements (CSS-005/015)', () => {
  it('CSS-015 when an alternate stylesheet link has no title', () => {
    expect(ids({ 'c1.xhtml': '<link rel="alternate stylesheet" href="alt.css"/>' })).toContain('CSS-015')
  })

  it('no CSS-015 when the alternate stylesheet link has a title', () => {
    expect(ids({ 'c1.xhtml': '<link rel="alternate stylesheet" href="alt.css" title="Night"/>' })).not.toContain('CSS-015')
  })

  it('no CSS-015 for an ordinary (non-alternate) stylesheet link', () => {
    expect(ids({ 'c1.xhtml': '<link rel="stylesheet" href="s.css"/>' })).not.toContain('CSS-015')
  })

  it('CSS-005 when a link class has conflicting alternate-style vocabulary', () => {
    expect(ids({ 'c1.xhtml': '<link rel="stylesheet" href="s.css" class="vertical horizontal"/>' })).toContain('CSS-005')
    expect(ids({ 'c1.xhtml': '<link rel="stylesheet" href="s.css" class="day night"/>' })).toContain('CSS-005')
  })

  it('no CSS-005 for non-conflicting link classes', () => {
    expect(ids({ 'c1.xhtml': '<link rel="stylesheet" href="s.css" class="vertical day"/>' })).not.toContain('CSS-005')
  })
})

describe('validateContentDocs — revision-sensitive core media types', () => {
  it('RSC-032 for a WebP image target under 3.2 (WebP not yet core)', () => {
    const { pkg, container } = setupWebp()
    expect(validateContentDocs(pkg, container, '3.2').map((m) => m.id)).toContain('RSC-032')
  })
  it('no RSC-032 for a WebP image target under 3.3 (WebP is core)', () => {
    const { pkg, container } = setupWebp()
    expect(validateContentDocs(pkg, container, '3.3').map((m) => m.id)).not.toContain('RSC-032')
  })
  it('RSC-032 for an Opus audio target under 3.2 (Opus not yet core)', () => {
    const { pkg, container } = setupOpus()
    expect(validateContentDocs(pkg, container, '3.2').map((m) => m.id)).toContain('RSC-032')
  })
  it('no RSC-032 for an Opus audio target under 3.3 (Opus is core)', () => {
    const { pkg, container } = setupOpus()
    expect(validateContentDocs(pkg, container, '3.3').map((m) => m.id)).not.toContain('RSC-032')
  })
})

describe('validateContentDocs — deprecated content elements (RSC-017)', () => {
  it('warns for epub:switch/epub:trigger at 3.2+ but not at 3.0', () => {
    const body =
      '<epub:switch><epub:case>a</epub:case></epub:switch><epub:trigger ev:observer="o"/>'
    const { pkg, container } = setupBody(body)
    expect(validateContentDocs(pkg, container, '3.2').filter((m) => m.id === 'RSC-017').length).toBe(2)
    expect(validateContentDocs(pkg, container, '3.0').some((m) => m.id === 'RSC-017')).toBe(false)
  })
})

describe('EPUB 2 gating', () => {
  const msgIds = (pkg: PackageDocument, container: EpubContainer, version: '2.0' | '3.3') =>
    validateContentDocs(pkg, container, version).map((m) => m.id)

  it('RSC-006 for a remote audio ref under a 2.0 target (allowed under 3.x)', () => {
    const { pkg, container } = setup({ 'c1.xhtml': '<audio src="https://x.example/a.mp3"></audio>' })
    expect(msgIds(pkg, container, '2.0')).toContain('RSC-006')
    expect(msgIds(pkg, container, '3.3')).not.toContain('RSC-006')
  })

  it('no RSC-031 https advice under a 2.0 target', () => {
    const { pkg, container } = setup({ 'c1.xhtml': '<blockquote cite="http://x.example/q"></blockquote>' })
    expect(msgIds(pkg, container, '3.3')).toContain('RSC-031')
    expect(msgIds(pkg, container, '2.0')).not.toContain('RSC-031')
  })

  it('RSC-010 blessed set is version-aware: SVG hyperlink target is blessed in 3.x, not 2.0', () => {
    const { pkg, container } = setup({ 'c1.xhtml': '<a href="pic.svg">x</a>' })
    pkg.manifest.push({ id: 'svg', href: 'pic.svg', mediaType: 'image/svg+xml', properties: [], loc: LOC })
    pkg.spine.push({ idref: 'svg', linear: true, properties: [], loc: LOC })
    container.resources.set('EPUB/pic.svg', { path: 'EPUB/pic.svg', bytes: enc('x'), compression: 'deflate' })
    expect(msgIds(pkg, container, '3.3')).not.toContain('RSC-010')
    expect(msgIds(pkg, container, '2.0')).toContain('RSC-010')
  })

  it('RSC-032 still fires under a 2.0 target (epubcheck v2 suite expects it)', () => {
    const { pkg, container } = setup({ 'c1.xhtml': '<img src="chart.bmp"/>' })
    pkg.manifest.push({ id: 'bmp', href: 'chart.bmp', mediaType: 'image/bmp', properties: [], loc: LOC })
    container.resources.set('EPUB/chart.bmp', { path: 'EPUB/chart.bmp', bytes: enc('x'), compression: 'deflate' })
    expect(msgIds(pkg, container, '2.0')).toContain('RSC-032')
  })
})
