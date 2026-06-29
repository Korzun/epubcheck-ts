import { parseXml, findDescendants, type XmlNode } from '../io/xml.js'
import { getResource, type EpubContainer } from '../io/zip.js'
import { resolvePath } from '../util/path.js'
import type { Location, Message } from '../messages/format.js'
import type { ManifestItem } from './opf.js'

const EPUB_TYPE_ATTR = 'epub:type'

export interface NavSection {
  types: string[]
  node: XmlNode
  loc: Location
}
export interface NavDocument {
  path: string
  root: XmlNode
  sections: NavSection[]
  loc: Location
}

function tokens(value: string | undefined): string[] {
  return value ? value.trim().split(/\s+/).filter(Boolean) : []
}

export function parseNav(
  navItem: ManifestItem,
  container: EpubContainer,
): { nav?: NavDocument; messages: Message[] } {
  const messages: Message[] = []
  const opfPath = container.rootfiles[0]
  if (!opfPath || !navItem.href) return { messages }

  const navPath = resolvePath(opfPath, navItem.href)
  const resource = getResource(container, navPath)
  // A missing nav file is reported as RSC-001 by the OPF manifest check; don't double-report.
  if (!resource) return { messages }

  const parsed = parseXml(resource.bytes, navPath)
  messages.push(...parsed.messages)
  const root = parsed.root
  if (!root) return { messages }

  const sections: NavSection[] = findDescendants(root, 'nav').map((node) => ({
    types: tokens(node.attrs?.[EPUB_TYPE_ATTR]),
    node,
    loc: node.loc,
  }))

  return { nav: { path: navPath, root, sections, loc: root.loc }, messages }
}
