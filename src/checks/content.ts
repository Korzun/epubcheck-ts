import { parseContent, type ContentDocument, type RefType } from '../parse/content.js'
import { getResource, type EpubContainer } from '../io/zip.js'
import { resolvePath, isRemote } from '../util/path.js'
import { msg, type Message } from '../messages/format.js'
import type { ManifestItem, PackageDocument } from '../parse/opf.js'

const REMOTE_ALLOWED: ReadonlySet<RefType> = new Set<RefType>(['hyperlink', 'cite', 'audio', 'video'])

/** A URL carrying any scheme (https:, data:, mailto:, tel:, …). */
function hasScheme(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url)
}

/** Map of resolved-container-path → manifest item, for declared local resources. */
function resolvedManifest(pkg: PackageDocument): Map<string, ManifestItem> {
  const map = new Map<string, ManifestItem>()
  for (const item of pkg.manifest) {
    if (item.href && !isRemote(item.href)) map.set(resolvePath(pkg.path, item.href), item)
  }
  return map
}

export function validateContentDocs(pkg: PackageDocument, container: EpubContainer): Message[] {
  const messages: Message[] = []
  const manifest = resolvedManifest(pkg)

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
  }
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
