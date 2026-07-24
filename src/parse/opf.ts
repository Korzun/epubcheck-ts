import { parseXml, childElements, type XmlNode } from '../io/xml.js'
import { getResource, type EpubContainer } from '../io/zip.js'
import { msg, type Location, type Message } from '../messages/format.js'
import { resolvePath, isRemote } from '../util/path.js'

const DC_NS = 'http://purl.org/dc/elements/1.1/'

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
  /**
   * The parsed package document, retained so the schema layer can validate the
   * whole tree. The typed projections below stay for the semantic checks.
   */
  root: XmlNode
  version?: string
  uniqueIdentifier?: string
  metadata: Metadata
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
  if (metadataEl) {
    for (const el of childElements(metadataEl)) {
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
    root,
    version: root.attrs?.['version'],
    uniqueIdentifier: root.attrs?.['unique-identifier'],
    metadata,
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
