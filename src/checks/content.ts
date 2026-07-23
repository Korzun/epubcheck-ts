import { parseContent, type ContentDocument, type RefType } from '../parse/content.js'
import { getResource, type EpubContainer } from '../io/zip.js'
import { resolvePath, isRemote, hasScheme } from '../util/path.js'
import { msg, type Message } from '../messages/format.js'
import { manifestPathMap, hasFallbackTo, type ManifestItem, type PackageDocument } from '../parse/opf.js'
import { findDescendants, type XmlNode } from '../io/xml.js'
import { isKnownHtmlElement } from '../util/html-elements.js'
import { analyzeCss } from '../parse/css.js'
import { validateCss } from './css.js'
import { coreMediaTypes, atLeast, majorVersion, blessedContentTypes, type EpubVersion } from '../versions.js'

// Remote references EPUB 3 permits without RSC-006. EPUB 2 forbids remote
// publication resources outright; only hyperlink/cite (which are not
// publication resources) escape (epubcheck ResourceReferencesChecker).
const REMOTE_ALLOWED_V3: ReadonlySet<RefType> = new Set<RefType>(['hyperlink', 'cite', 'audio', 'video'])
const REMOTE_ALLOWED_V2: ReadonlySet<RefType> = new Set<RefType>(['hyperlink', 'cite'])
const HTML_NS = 'http://www.w3.org/1999/xhtml'

export function validateContentDocs(
  pkg: PackageDocument,
  container: EpubContainer,
  version: EpubVersion,
): Message[] {
  const messages: Message[] = []
  const manifest = manifestPathMap(pkg)

  const byId = new Map<string, ManifestItem>()
  for (const item of pkg.manifest) {
    if (item.id !== undefined) byId.set(item.id, item)
  }
  // Container paths of every in-spine manifest item. Path-based (not id-based) so a
  // resource that is in the spine under one manifest item but duplicated under another,
  // not-in-spine item is still correctly treated as in-spine.
  const spinePaths = new Set<string>()
  for (const s of pkg.spine) {
    if (s.idref === undefined) continue
    const item = byId.get(s.idref)
    if (item?.href && !isRemote(item.href)) spinePaths.add(resolvePath(pkg.path, item.href))
  }

  // Parse every XHTML content document, including the nav doc (its links and
  // inline styles get the same reference/CSS checks; validateNav additionally
  // checks nav-specific structure, NAV-010 remote links, and NAV-011 order).
  const docs = new Map<string, ContentDocument>()
  for (const item of pkg.manifest) {
    if (item.mediaType !== 'application/xhtml+xml') continue
    const { doc, messages: m } = parseContent(item, container)
    messages.push(...m)
    if (doc) docs.set(doc.path, doc)
  }

  for (const doc of docs.values()) {
    messages.push(...checkReferences(doc, container, manifest, byId, spinePaths, version))
    messages.push(...checkFragments(doc, docs, manifest))
    messages.push(...checkElements(doc))
    messages.push(...checkLinkElements(doc))
    messages.push(...checkDeprecatedElements(doc, version))
    for (const style of doc.inlineStyles) {
      const a = analyzeCss(style.text, doc.path, style.context)
      messages.push(...a.messages)
      messages.push(
        ...validateCss(
          { path: doc.path, refs: a.refs, declarations: a.declarations, fontFaces: a.fontFaces },
          container,
          manifest,
          version,
        ),
      )
    }
  }
  return messages
}

function isFragmentCheckable(mediaType: string | undefined): boolean {
  return mediaType === 'application/xhtml+xml'
}

function checkFragments(
  doc: ContentDocument,
  docs: Map<string, ContentDocument>,
  manifest: Map<string, ManifestItem>,
): Message[] {
  const messages: Message[] = []
  for (const ref of doc.refs) {
    const hash = ref.url.indexOf('#')
    if (hash < 0) continue
    const frag = ref.url.slice(hash + 1)
    if (frag === '') continue
    const base = ref.url.slice(0, hash)

    let ids: Set<string> | undefined
    if (base === '') {
      ids = doc.ids // same-document
    } else {
      if (isRemote(ref.url) || hasScheme(base)) continue
      const target = resolvePath(doc.path, base)
      const item = manifest.get(target)
      if (!item || !isFragmentCheckable(item.mediaType)) continue // only id-check XHTML targets
      ids = docs.get(target)?.ids
      if (!ids) continue // target XHTML wasn't parsed
    }

    if (!ids.has(frag)) messages.push(msg('RSC-012', ref.loc))
  }
  return messages
}

function checkElements(doc: ContentDocument): Message[] {
  const messages: Message[] = []
  const walk = (node: XmlNode): void => {
    for (const child of node.children ?? []) {
      if (child.type !== 'element') continue
      const name = child.name ?? ''
      // Only flag elements explicitly in the XHTML namespace; skip custom elements (contain "-").
      if (child.ns === HTML_NS && !name.includes('-') && !isKnownHtmlElement(name)) {
        messages.push(msg('RSC-005', child.loc, doc.path, `Unknown element "${name}" in the XHTML namespace.`))
      }
      walk(child)
    }
  }
  walk(doc.root)
  return messages
}

function checkDeprecatedElements(doc: ContentDocument, version: EpubVersion): Message[] {
  if (!atLeast(version, '3.2')) return []
  return doc.deprecatedElements.map((d) =>
    msg('RSC-017', d.loc, `The "epub:${d.name}" element is deprecated.`),
  )
}

// EPUB alternate-style-sheet vocabulary terms that conflict when both appear.
const ALTCSS_CONFLICTS: ReadonlyArray<readonly [string, string]> = [
  ['vertical', 'horizontal'],
  ['day', 'night'],
]

function checkLinkElements(doc: ContentDocument): Message[] {
  const messages: Message[] = []
  for (const link of findDescendants(doc.root, 'link')) {
    if (link.ns !== HTML_NS) continue
    const attrs = link.attrs ?? {}
    const rel = (attrs['rel'] ?? '').split(/\s+/).filter(Boolean)
    if (rel.includes('alternate') && rel.includes('stylesheet') && (attrs['title'] ?? '').trim() === '') {
      messages.push(msg('CSS-015', link.loc))
    }
    const classes = new Set((attrs['class'] ?? '').split(/\s+/).filter(Boolean))
    if (ALTCSS_CONFLICTS.some(([a, b]) => classes.has(a) && classes.has(b))) {
      messages.push(msg('CSS-005', link.loc, attrs['class'] ?? ''))
    }
  }
  return messages
}

function checkReferences(
  doc: ContentDocument,
  container: EpubContainer,
  manifest: Map<string, ManifestItem>,
  byId: Map<string, ManifestItem>,
  spinePaths: ReadonlySet<string>,
  version: EpubVersion,
): Message[] {
  const messages: Message[] = []
  const core = coreMediaTypes(version)
  const isCore = (mediaType: string | undefined): boolean => {
    if (mediaType === undefined) return false
    if (core.has(mediaType)) return true
    if (mediaType.startsWith('video/')) return true // all video/* are core in every 3.x
    if (atLeast(version, '3.3') && /^audio\/ogg\s*;\s*codecs=opus$/i.test(mediaType)) return true // Opus added in 3.3
    return false
  }
  const major = majorVersion(version)
  const remoteAllowed = major === '2.0' ? REMOTE_ALLOWED_V2 : REMOTE_ALLOWED_V3
  const blessed = blessedContentTypes(version)
  const isBlessedContent = (mediaType: string | undefined): boolean =>
    mediaType !== undefined && blessed.has(mediaType)
  for (const ref of doc.refs) {
    const url = ref.url
    if (url.startsWith('#')) continue // same-document fragment; handled by the fragment check
    if (isRemote(url)) {
      if (!remoteAllowed.has(ref.type)) {
        messages.push(msg('RSC-006', ref.loc, url))
      } else if (ref.type !== 'hyperlink' && major === '3.0') {
        // Remote-allowed non-hyperlink refs (audio/video/cite) must use HTTPS. EPUB 3 only.
        const scheme = url.slice(0, url.indexOf(':')).toLowerCase()
        if (scheme !== 'https' && scheme !== 'file') messages.push(msg('RSC-031', ref.loc, url))
      }
      continue
    }
    if (hasScheme(url)) continue // data:, mailto:, tel:, … — not container-relative
    const target = resolvePath(doc.path, url)
    if (!getResource(container, target)) {
      messages.push(msg('RSC-007', ref.loc, url))
    } else if (!manifest.has(target)) {
      messages.push(msg('RSC-008', ref.loc, url))
    } else if (ref.type === 'hyperlink') {
      const item = manifest.get(target)
      if (item) {
        if (!isBlessedContent(item.mediaType) && !hasFallbackTo(item, byId, (i) => isBlessedContent(i.mediaType))) {
          messages.push(msg('RSC-010', ref.loc))
        } else if (!spinePaths.has(target)) {
          messages.push(msg('RSC-011', ref.loc))
        }
      }
    } else if (ref.type === 'image' || ref.type === 'audio' || ref.type === 'video' || ref.type === 'generic') {
      const item = manifest.get(target)
      if (
        item &&
        !ref.hasIntrinsicFallback &&
        !isCore(item.mediaType) &&
        !hasFallbackTo(item, byId, (i) => isCore(i.mediaType))
      ) {
        messages.push(msg('RSC-032', ref.loc, target, item.mediaType ?? ''))
      }
    }
  }
  return messages
}
