import { SaxesParser } from 'saxes'
import { msg, type Location, type Message } from '../messages/format.js'

/** One attribute with its namespace resolved. `xmlns` declarations are not attributes to a schema. */
export interface XmlAttr {
  /** Qualified name as written (`opf:role`, `id`). Schema messages echo this form. */
  qname: string
  local: string
  /** Resolved namespace URI; undefined for unprefixed attributes. */
  ns?: string
  value: string
}

export interface XmlNode {
  type: 'element' | 'text'
  name?: string
  ns?: string
  /** Namespace prefix as written, when the element carried one (schema messages echo it). */
  prefix?: string
  attrs?: Record<string, string>
  /** Attributes in document order, namespace-resolved, xmlns declarations excluded. */
  attributes?: XmlAttr[]
  children?: XmlNode[]
  text?: string
  loc: Location
}

function decode(bytes: Uint8Array): string {
  const text = new TextDecoder('utf-8').decode(bytes)
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

export function parseXml(bytes: Uint8Array, path: string): { root?: XmlNode; messages: Message[] } {
  const parser = new SaxesParser<{ xmlns: true; position?: boolean }>({ xmlns: true, position: true })
  const messages: Message[] = []

  // Synthetic root holds the document element as its single child.
  const document: XmlNode = { type: 'element', children: [], loc: { path } }
  const stack: XmlNode[] = [document]

  parser.on('opentag', (tag) => {
    const attrs: Record<string, string> = {}
    const attributes: XmlAttr[] = []
    for (const [key, value] of Object.entries(tag.attributes)) {
      attrs[key] = value.value
      if (key === 'xmlns' || key.startsWith('xmlns:')) continue
      attributes.push({
        qname: key,
        local: value.local,
        ...(value.uri ? { ns: value.uri } : {}),
        value: value.value,
      })
    }
    const node: XmlNode = {
      type: 'element',
      name: tag.local,
      ns: tag.uri || undefined,
      prefix: tag.prefix || undefined,
      attrs,
      attributes,
      children: [],
      loc: { path, line: parser.line, column: parser.column },
    }
    stack[stack.length - 1]!.children!.push(node)
    stack.push(node)
  })

  parser.on('text', (value: string) => {
    if (value.trim() === '') return
    stack[stack.length - 1]!.children!.push({ type: 'text', text: value, loc: { path } })
  })

  parser.on('closetag', (_tag) => {
    stack.pop()
  })

  let failed = false
  parser.on('error', (err: Error) => {
    if (failed) return
    failed = true
    messages.push(msg('RSC-005', { path, line: parser.line, column: parser.column }, path, err.message))
  })

  try {
    parser.write(decode(bytes)).close()
  } catch {
    // saxes throws after the error handler runs; the message is already recorded.
  }

  if (failed) return { messages }
  return { root: document.children![0], messages }
}

/** Element children of a node (text nodes filtered out). */
export function childElements(node: XmlNode): XmlNode[] {
  return (node.children ?? []).filter((c) => c.type === 'element')
}

/** All descendant elements (any depth) whose local name matches. */
export function findDescendants(node: XmlNode, localName: string): XmlNode[] {
  const out: XmlNode[] = []
  const walk = (n: XmlNode) => {
    for (const child of n.children ?? []) {
      if (child.type === 'element') {
        if (child.name === localName) out.push(child)
        walk(child)
      }
    }
  }
  walk(node)
  return out
}

/** All descendant text content of a node, concatenated (not trimmed). */
export function textContent(node: XmlNode): string {
  let out = ''
  const walk = (n: XmlNode) => {
    for (const child of n.children ?? []) {
      if (child.type === 'text') out += child.text ?? ''
      else walk(child)
    }
  }
  walk(node)
  return out
}
