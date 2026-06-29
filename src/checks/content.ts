import { parseContent, type ContentDocument, type RefType } from '../parse/content.js'
import { getResource, type EpubContainer } from '../io/zip.js'
import { resolvePath, isRemote, hasScheme } from '../util/path.js'
import { msg, type Message } from '../messages/format.js'
import { manifestPathMap, type ManifestItem, type PackageDocument } from '../parse/opf.js'
import type { XmlNode } from '../io/xml.js'
import { isKnownHtmlElement } from '../util/html-elements.js'
import { analyzeCss } from '../parse/css.js'
import { validateCss } from './css.js'

const REMOTE_ALLOWED: ReadonlySet<RefType> = new Set<RefType>(['hyperlink', 'cite', 'audio', 'video'])
const HTML_NS = 'http://www.w3.org/1999/xhtml'

// EPUB 3 blessed content-document types (epubcheck isBlessedItemType v3) plus
// deprecated-blessed types (epubcheck isDeprecatedBlessedItemType).
const BLESSED_CONTENT_TYPES: ReadonlySet<string> = new Set<string>([
  'application/xhtml+xml',
  'image/svg+xml',
  'text/x-oeb1-document', // deprecated-blessed
  'text/html', // deprecated-blessed
])

function isBlessedContentType(mediaType: string | undefined): boolean {
  return mediaType !== undefined && BLESSED_CONTENT_TYPES.has(mediaType)
}

const CORE_MEDIA_TYPES: ReadonlySet<string> = new Set<string>([
  // images
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/svg+xml',
  // audio
  'audio/mpeg',
  'audio/mp4',
  // fonts
  'font/ttf',
  'font/otf',
  'font/woff',
  'font/woff2',
  'application/font-sfnt',
  'application/vnd.ms-opentype',
  'application/font-woff',
  'application/x-font-ttf',
  // blessed content / script / style / other core types
  'application/xhtml+xml',
  'text/javascript',
  'application/javascript',
  'application/ecmascript',
  'text/css',
  'application/pls+xml',
  'application/smil+xml',
])

function isCoreMediaType(mediaType: string | undefined): boolean {
  if (mediaType === undefined) return false
  if (CORE_MEDIA_TYPES.has(mediaType)) return true
  if (mediaType.startsWith('video/')) return true // all video/* are EPUB 3 core media types
  if (/^audio\/ogg\s*;\s*codecs=opus$/i.test(mediaType)) return true // Opus in Ogg
  return false
}

// Walk the manifest `fallback` chain (each fallback is a manifest item id) and
// report whether any item in the chain satisfies the predicate. Cycle-guarded.
function hasFallbackTo(
  item: ManifestItem,
  byId: Map<string, ManifestItem>,
  predicate: (i: ManifestItem) => boolean,
): boolean {
  const seen = new Set<string>()
  let current = item.fallback
  while (current !== undefined && !seen.has(current)) {
    seen.add(current)
    const next = byId.get(current)
    if (next === undefined) return false
    if (predicate(next)) return true
    current = next.fallback
  }
  return false
}

function hasFallbackToBlessed(item: ManifestItem, byId: Map<string, ManifestItem>): boolean {
  return hasFallbackTo(item, byId, (i) => isBlessedContentType(i.mediaType))
}

export function validateContentDocs(pkg: PackageDocument, container: EpubContainer): Message[] {
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
    messages.push(...checkReferences(doc, container, manifest, byId, spinePaths))
    messages.push(...checkFragments(doc, docs, manifest))
    messages.push(...checkElements(doc))
    for (const style of doc.inlineStyles) {
      const a = analyzeCss(style.text, doc.path, style.context)
      messages.push(...a.messages)
      messages.push(
        ...validateCss(
          { path: doc.path, refs: a.refs, declarations: a.declarations, fontFaces: a.fontFaces },
          container,
          manifest,
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

function checkReferences(
  doc: ContentDocument,
  container: EpubContainer,
  manifest: Map<string, ManifestItem>,
  byId: Map<string, ManifestItem>,
  spinePaths: ReadonlySet<string>,
): Message[] {
  const messages: Message[] = []
  for (const ref of doc.refs) {
    const url = ref.url
    if (url.startsWith('#')) continue // same-document fragment; handled by the fragment check
    if (isRemote(url)) {
      if (!REMOTE_ALLOWED.has(ref.type)) {
        messages.push(msg('RSC-006', ref.loc, url))
      } else if (ref.type !== 'hyperlink') {
        // Remote-allowed non-hyperlink refs (audio/video/cite) must use HTTPS.
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
        if (!isBlessedContentType(item.mediaType) && !hasFallbackToBlessed(item, byId)) {
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
        !isCoreMediaType(item.mediaType) &&
        !hasFallbackTo(item, byId, (i) => isCoreMediaType(i.mediaType))
      ) {
        messages.push(msg('RSC-032', ref.loc, target, item.mediaType ?? ''))
      }
    }
  }
  return messages
}
