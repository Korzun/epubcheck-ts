import { parseXml, childElements, findDescendants, textContent, type XmlNode } from '../io/xml.js'
import { getResource, type EpubContainer } from '../io/zip.js'
import { resolvePath } from '../util/path.js'
import type { Location, Message } from '../messages/format.js'
import type { ManifestItem } from './opf.js'

const NCX_NS = 'http://www.daisy.org/z3986/2005/ncx/'

export interface NcxNavPoint {
  hasLabel: boolean
  hasContent: boolean
  src?: string
  loc: Location
}
export interface NcxTextLabel {
  text: string
  loc: Location
}
export interface NcxDocument {
  path: string
  root: XmlNode
  /** dtb:uid meta content, untrimmed — NCX-004 checks raw whitespace. */
  uid?: string
  uidLoc?: Location
  navMapPresent: boolean
  navPoints: NcxNavPoint[]
  /** Every <text> element in the NCX namespace (docTitle + navLabels), for NCX-006. */
  textLabels: NcxTextLabel[]
  loc: Location
}

export function parseNcx(
  item: ManifestItem,
  container: EpubContainer,
): { ncx?: NcxDocument; messages: Message[] } {
  const messages: Message[] = []
  const opfPath = container.rootfiles[0]
  if (!opfPath || !item.href) return { messages }

  const path = resolvePath(opfPath, item.href)
  const resource = getResource(container, path)
  // A missing NCX file is reported as RSC-001 by the OPF manifest check; don't double-report.
  if (!resource) return { messages }

  const parsed = parseXml(resource.bytes, path)
  messages.push(...parsed.messages)
  const root = parsed.root
  if (!root) return { messages }

  const uidMeta = findDescendants(root, 'meta').find((m) => m.attrs?.['name'] === 'dtb:uid')
  const navMap = childElements(root).find((c) => c.name === 'navMap')

  const navPoints: NcxNavPoint[] = navMap
    ? findDescendants(navMap, 'navPoint').map((np) => {
        const content = childElements(np).find((c) => c.name === 'content')
        const label = childElements(np).find((c) => c.name === 'navLabel')
        return {
          hasLabel: label !== undefined,
          hasContent: content !== undefined,
          src: content?.attrs?.['src'],
          loc: np.loc,
        }
      })
    : []

  const textLabels: NcxTextLabel[] = findDescendants(root, 'text')
    .filter((t) => t.ns === NCX_NS)
    .map((t) => ({ text: textContent(t).trim(), loc: t.loc }))

  return {
    ncx: {
      path,
      root,
      uid: uidMeta?.attrs?.['content'],
      uidLoc: uidMeta?.loc,
      navMapPresent: navMap !== undefined,
      navPoints,
      textLabels,
      loc: root.loc,
    },
    messages,
  }
}
