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

const BLESSED_CONTENT_TYPES: ReadonlySet<string> = new Set<string>([
  'application/xhtml+xml',
  'image/svg+xml',
  'application/x-dtbncx+xml', // deprecated-blessed
  'application/x-dtbook+xml', // deprecated-blessed
])

function isBlessedContentType(mediaType: string | undefined): boolean {
  return mediaType !== undefined && BLESSED_CONTENT_TYPES.has(mediaType)
}

// Walk the manifest `fallback` chain (each fallback is a manifest item id) and
// report whether any item in the chain is a blessed content-document type.
function hasFallbackToBlessed(item: ManifestItem, byId: Map<string, ManifestItem>): boolean {
  const seen = new Set<string>()
  let current = item.fallback
  while (current !== undefined && !seen.has(current)) {
    seen.add(current)
    const next = byId.get(current)
    if (next === undefined) return false
    if (isBlessedContentType(next.mediaType)) return true
    current = next.fallback
  }
  return false
}

function inSpine(item: ManifestItem, spineIdrefs: ReadonlySet<string>): boolean {
  return item.id !== undefined && spineIdrefs.has(item.id)
}

export function validateContentDocs(pkg: PackageDocument, container: EpubContainer): Message[] {
  const messages: Message[] = []
  const manifest = manifestPathMap(pkg)

  const byId = new Map<string, ManifestItem>()
  for (const item of pkg.manifest) {
    if (item.id !== undefined) byId.set(item.id, item)
  }
  const spineIdrefs = new Set<string>()
  for (const s of pkg.spine) {
    if (s.idref !== undefined) spineIdrefs.add(s.idref)
  }

  // Parse every XHTML content doc except the nav doc (validated by validateNav).
  const docs = new Map<string, ContentDocument>()
  for (const item of pkg.manifest) {
    if (item.mediaType !== 'application/xhtml+xml') continue
    if (item.properties.includes('nav')) continue
    const { doc, messages: m } = parseContent(item, container)
    messages.push(...m)
    if (doc) docs.set(doc.path, doc)
  }

  for (const doc of docs.values()) {
    messages.push(...checkReferences(doc, container, manifest, byId, spineIdrefs))
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
      if (!ids) continue // target XHTML wasn't parsed (e.g. the nav doc, which we skip)
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
  spineIdrefs: ReadonlySet<string>,
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
        } else if (!inSpine(item, spineIdrefs)) {
          messages.push(msg('RSC-011', ref.loc))
        }
      }
    }
  }
  return messages
}
