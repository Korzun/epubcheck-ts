import { SaxesParser } from 'saxes'
import { msg, type Location, type Message } from '../messages/format.js'

export interface XmlNode {
  type: 'element' | 'text'
  name?: string
  ns?: string
  attrs?: Record<string, string>
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
    for (const [key, value] of Object.entries(tag.attributes)) attrs[key] = value.value
    const node: XmlNode = {
      type: 'element',
      name: tag.local,
      ns: tag.uri || undefined,
      attrs,
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
  return { root: document.children![0] as XmlNode | undefined, messages }
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
