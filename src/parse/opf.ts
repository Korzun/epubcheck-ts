import { parseXml, childElements, type XmlNode } from '../io/xml.js'
import { getResource, type EpubContainer } from '../io/zip.js'
import { msg, type Location, type Message } from '../messages/format.js'
import { resolvePath, isRemote } from '../util/path.js'

const DC_NS = 'http://purl.org/dc/elements/1.1/'
const OPF_NS = 'http://www.idpf.org/2007/opf'

export interface DcIdentifier {
  id?: string
  value: string
}
export interface Metadata {
  identifiers: DcIdentifier[]
  titles: string[]
  languages: string[]
  modifiedCount: number
}
/**
 * An OPF-namespace `<meta>` from `<metadata>`, retained so the OPF 2.0 content
 * model can be checked. Metas in a foreign namespace are not collected: the
 * OPF 2.0 schema permits them, so they carry no content model of their own.
 */
export interface OpfMeta {
  /** Element name as written (`meta`, or `opf:meta` when explicitly prefixed). */
  qname: string
  /** Attributes in document order, keyed by qualified name; xmlns declarations excluded. */
  attrs: Record<string, string>
  /** True when the element holds text (parseXml already discards whitespace-only text). */
  hasText: boolean
  loc: Location
}
export interface ManifestItem {
  id?: string
  href?: string
  mediaType?: string
  properties: string[]
  fallback?: string
  loc: Location
}
export interface SpineItem {
  idref?: string
  linear: boolean
  properties: string[]
  loc: Location
}
export interface GuideReference {
  type?: string
  title?: string
  href?: string
  loc: Location
}
export interface PackageDocument {
  path: string
  version?: string
  uniqueIdentifier?: string
  metadata: Metadata
  /** OPF-namespace `<meta>` elements from `<metadata>`, in document order. */
  metas: OpfMeta[]
  manifest: ManifestItem[]
  spinePresent: boolean
  spine: SpineItem[]
  /** <spine toc="…"> idref (EPUB 2 NCX pointer); undefined when absent. */
  spineToc?: string
  /** Location of the <spine> element (for RSC-005 on a missing toc attribute). */
  spineLoc?: Location
  guide: GuideReference[]
  bindings?: Location
  loc: Location
}

function firstChild(node: XmlNode, localName: string): XmlNode | undefined {
  return childElements(node).find((c) => c.name === localName)
}
function splitProps(value: string | undefined): string[] {
  return value ? value.trim().split(/\s+/).filter(Boolean) : []
}
/** Element attributes minus namespace declarations, which are not attributes to a schema. */
function schemaAttrs(node: XmlNode): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(node.attrs ?? {})) {
    if (name === 'xmlns' || name.startsWith('xmlns:')) continue
    out[name] = value
  }
  return out
}
function textOf(node: XmlNode): string {
  return (node.children ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('')
    .trim()
}

export function parseOpf(container: EpubContainer): { pkg?: PackageDocument; messages: Message[] } {
  const messages: Message[] = []
  const opfPath = container.rootfiles[0]
  if (!opfPath) return { messages } // OCF already reported the missing rootfile

  const resource = getResource(container, opfPath)
  if (!resource) {
    messages.push(msg('RSC-001', { path: opfPath }, opfPath))
    return { messages }
  }

  const parsed = parseXml(resource.bytes, opfPath)
  messages.push(...parsed.messages)
  const root = parsed.root
  if (!root || root.name !== 'package') return { messages }

  const metadataEl = firstChild(root, 'metadata')
  const manifestEl = firstChild(root, 'manifest')
  const spineEl = firstChild(root, 'spine')
  const bindingsEl = firstChild(root, 'bindings')
  const guideEl = firstChild(root, 'guide')

  const metadata: Metadata = { identifiers: [], titles: [], languages: [], modifiedCount: 0 }
  const metas: OpfMeta[] = []
  if (metadataEl) {
    for (const el of childElements(metadataEl)) {
      if (el.name === 'meta' && el.ns === OPF_NS) {
        metas.push({
          qname: el.prefix ? `${el.prefix}:${el.name}` : el.name,
          attrs: schemaAttrs(el),
          hasText: (el.children ?? []).some((c) => c.type === 'text'),
          loc: el.loc,
        })
      }
      if (el.ns === DC_NS && el.name === 'identifier') {
        metadata.identifiers.push({ id: el.attrs?.['id'], value: textOf(el) })
      } else if (el.ns === DC_NS && el.name === 'title') {
        metadata.titles.push(textOf(el))
      } else if (el.ns === DC_NS && el.name === 'language') {
        metadata.languages.push(textOf(el))
      } else if (
        el.name === 'meta' &&
        el.attrs?.['property'] === 'dcterms:modified' &&
        !el.attrs['refines']
      ) {
        metadata.modifiedCount++
      }
    }
  }

  const manifest: ManifestItem[] = manifestEl
    ? childElements(manifestEl)
        .filter((el) => el.name === 'item')
        .map((el) => ({
          id: el.attrs?.['id'],
          href: el.attrs?.['href'],
          mediaType: el.attrs?.['media-type'],
          properties: splitProps(el.attrs?.['properties']),
          fallback: el.attrs?.['fallback'],
          loc: el.loc,
        }))
    : []

  const spine: SpineItem[] = spineEl
    ? childElements(spineEl)
        .filter((el) => el.name === 'itemref')
        .map((el) => ({
          idref: el.attrs?.['idref'],
          linear: el.attrs?.['linear'] !== 'no',
          properties: splitProps(el.attrs?.['properties']),
          loc: el.loc,
        }))
    : []

  const guide: GuideReference[] = guideEl
    ? childElements(guideEl)
        .filter((el) => el.name === 'reference')
        .map((el) => ({
          type: el.attrs?.['type'],
          title: el.attrs?.['title'],
          href: el.attrs?.['href'],
          loc: el.loc,
        }))
    : []

  const pkg: PackageDocument = {
    path: opfPath,
    version: root.attrs?.['version'],
    uniqueIdentifier: root.attrs?.['unique-identifier'],
    metadata,
    metas,
    manifest,
    spinePresent: spineEl !== undefined,
    spine,
    spineToc: spineEl?.attrs?.['toc'],
    spineLoc: spineEl?.loc,
    guide,
    bindings: bindingsEl?.loc,
    loc: root.loc,
  }
  return { pkg, messages }
}

/** Resolved-container-path → manifest item, for non-remote manifest hrefs. */
export function manifestPathMap(pkg: PackageDocument): Map<string, ManifestItem> {
  const map = new Map<string, ManifestItem>()
  for (const item of pkg.manifest) {
    if (item.href && !isRemote(item.href)) map.set(resolvePath(pkg.path, item.href), item)
  }
  return map
}

/**
 * Walk the manifest `fallback` chain (each fallback is a manifest item id) and
 * report whether any item in the chain satisfies the predicate. Cycle-guarded.
 */
export function hasFallbackTo(
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
