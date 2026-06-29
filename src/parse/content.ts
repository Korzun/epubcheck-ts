import { parseXml, textContent, type XmlNode } from '../io/xml.js'
import { getResource, type EpubContainer } from '../io/zip.js'
import { resolvePath } from '../util/path.js'
import type { Location, Message } from '../messages/format.js'
import type { ManifestItem } from './opf.js'

export type RefType =
  | 'hyperlink'
  | 'image'
  | 'audio'
  | 'video'
  | 'stylesheet'
  | 'generic'
  | 'cite'
  | 'track'

export interface ContentRef {
  url: string
  type: RefType
  loc: Location
  /**
   * True when the referencing context itself supplies a fallback (e.g. an
   * <img> inside <picture>, a <source> inside <audio>, an <object> with
   * fallback content). Used to suppress RSC-032.
   */
  hasIntrinsicFallback: boolean
}
export interface InlineStyle {
  context: 'stylesheet' | 'declarationList'
  text: string
  loc: Location
}

export interface ContentDocument {
  path: string
  root: XmlNode
  refs: ContentRef[]
  ids: Set<string>
  inlineStyles: InlineStyle[]
}

/** Extract the URL of each srcset candidate ("url descriptor, url descriptor"). */
function parseSrcset(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim().split(/\s+/)[0] ?? '')
    .filter((u) => u !== '')
}

function addRefs(
  el: XmlNode,
  parent: string | undefined,
  attrs: Record<string, string>,
  refs: ContentRef[],
): void {
  const push = (url: string | undefined, type: RefType, intrinsic = false): void => {
    if (url) refs.push({ url, type, loc: el.loc, hasIntrinsicFallback: intrinsic })
  }
  const pushAll = (urls: string[], type: RefType, intrinsic = false): void => {
    for (const url of urls) refs.push({ url, type, loc: el.loc, hasIntrinsicFallback: intrinsic })
  }
  const inPicture = parent === 'picture'

  switch (el.name) {
    case 'a':
    case 'area':
      push(attrs['href'] ?? attrs['xlink:href'], 'hyperlink')
      break
    case 'img':
      push(attrs['src'], 'image', inPicture)
      if (attrs['srcset']) pushAll(parseSrcset(attrs['srcset']), 'image', inPicture)
      break
    case 'image': // SVG <image>
      push(attrs['xlink:href'] ?? attrs['href'], 'image')
      break
    case 'source':
      if (attrs['srcset']) pushAll(parseSrcset(attrs['srcset']), 'image', inPicture)
      else if (parent === 'audio') push(attrs['src'], 'audio', true)
      else if (parent === 'video') push(attrs['src'], 'video', false)
      else push(attrs['src'], 'image', true) // <source> in <picture>
      break
    case 'audio':
      push(attrs['src'], 'audio')
      break
    case 'video':
      push(attrs['src'], 'video')
      push(attrs['poster'], 'image')
      break
    case 'track':
      push(attrs['src'], 'track')
      break
    case 'link':
      if ((attrs['rel'] ?? '').split(/\s+/).includes('stylesheet')) push(attrs['href'], 'stylesheet')
      break
    case 'script':
      push(attrs['src'], 'generic')
      break
    case 'object':
      push(attrs['data'], 'generic', true)
      break
    case 'iframe':
    case 'embed':
    case 'input':
      push(attrs['src'], 'generic')
      break
    case 'blockquote':
    case 'q':
    case 'ins':
    case 'del':
      push(attrs['cite'], 'cite')
      break
    case 'math':
      push(attrs['altimg'], 'image')
      break
    default:
      break
  }
}

function collect(
  node: XmlNode,
  parent: string | undefined,
  refs: ContentRef[],
  ids: Set<string>,
  inlineStyles: InlineStyle[],
): void {
  for (const child of node.children ?? []) {
    if (child.type !== 'element') continue
    const attrs = child.attrs ?? {}
    const id = attrs['id']
    if (id) ids.add(id)
    addRefs(child, parent, attrs, refs)
    if (child.name === 'style') {
      inlineStyles.push({ context: 'stylesheet', text: textContent(child), loc: child.loc })
    }
    const styleAttr = attrs['style']
    if (styleAttr) {
      inlineStyles.push({ context: 'declarationList', text: styleAttr, loc: child.loc })
    }
    collect(child, child.name, refs, ids, inlineStyles)
  }
}

export function parseContent(
  item: ManifestItem,
  container: EpubContainer,
): { doc?: ContentDocument; messages: Message[] } {
  const messages: Message[] = []
  const opfPath = container.rootfiles[0]
  if (!opfPath || !item.href) return { messages }

  const path = resolvePath(opfPath, item.href)
  const resource = getResource(container, path)
  if (!resource) return { messages } // missing file is reported as RSC-001 by the OPF manifest check

  const parsed = parseXml(resource.bytes, path)
  messages.push(...parsed.messages)
  const root = parsed.root
  if (!root) return { messages }

  const refs: ContentRef[] = []
  const ids = new Set<string>()
  const inlineStyles: InlineStyle[] = []
  collect(root, undefined, refs, ids, inlineStyles)
  return { doc: { path, root, refs, ids, inlineStyles }, messages }
}
