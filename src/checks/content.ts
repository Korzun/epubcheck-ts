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

export function validateContentDocs(pkg: PackageDocument, container: EpubContainer): Message[] {
  const messages: Message[] = []
  const manifest = manifestPathMap(pkg)

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
    messages.push(...checkReferences(doc, container, manifest))
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
): Message[] {
  const messages: Message[] = []
  for (const ref of doc.refs) {
    const url = ref.url
    if (url.startsWith('#')) continue // same-document fragment; handled by the fragment check
    if (isRemote(url)) {
      if (!REMOTE_ALLOWED.has(ref.type)) messages.push(msg('RSC-006', ref.loc, url))
      continue
    }
    if (hasScheme(url)) continue // data:, mailto:, tel:, … — not container-relative
    const target = resolvePath(doc.path, url)
    if (!getResource(container, target)) {
      messages.push(msg('RSC-007', ref.loc, url))
    } else if (!manifest.has(target)) {
      messages.push(msg('RSC-008', ref.loc, url))
    }
  }
  return messages
}
