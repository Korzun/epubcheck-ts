import { describe, it, expect } from 'vitest'
import { parseXml, findDescendants, childElements } from './xml.js'
import { textContent } from './xml.js'
import type { XmlNode } from './xml.js'

const enc = (s: string) => new TextEncoder().encode(s)

describe('parseXml', () => {
  it('builds a positioned element tree', () => {
    const { root, messages } = parseXml(enc('<root><a>hi</a></root>'), 'm.xml')
    expect(messages).toHaveLength(0)
    expect(root?.name).toBe('root')
    const a = childElements(root!)[0]!
    expect(a.name).toBe('a')
    expect(a.loc.path).toBe('m.xml')
    expect(typeof a.loc.line).toBe('number')
  })

  it('exposes attributes and resolved namespaces', () => {
    const xml = '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfile full-path="a.opf"/></container>'
    const { root } = parseXml(enc(xml), 'container.xml')
    expect(root?.ns).toBe('urn:oasis:names:tc:opendocument:xmlns:container')
    const rootfile = findDescendants(root!, 'rootfile')[0]!
    expect(rootfile.attrs?.['full-path']).toBe('a.opf')
  })

  it('reports a message on malformed XML instead of throwing', () => {
    const { root, messages } = parseXml(enc('<root><a></root>'), 'bad.xml')
    expect(root).toBeUndefined()
    expect(messages[0]?.id).toBe('RSC-005')
    expect(messages[0]?.location?.path).toBe('bad.xml')
  })
})

describe('textContent', () => {
  it('concatenates nested text', () => {
    const { root } = parseXml(new TextEncoder().encode('<a>Hello <b>World</b>!</a>'), 'm.xml')
    expect(textContent(root!)).toBe('Hello World!')
  })
})

describe('namespace-aware attributes', () => {
  const doc = (s: string): XmlNode =>
    parseXml(new TextEncoder().encode(s), 'p.opf').root!

  it('records qname, local, ns and value in document order', () => {
    const root = doc(
      '<package xmlns="http://www.idpf.org/2007/opf" xmlns:opf="http://www.idpf.org/2007/opf">' +
        '<meta id="a" opf:role="aut" xml:lang="en" scheme="s"/></package>',
    )
    const meta = root.children!.find((c) => c.name === 'meta')!
    expect(meta.attributes).toEqual([
      { qname: 'id', local: 'id', value: 'a' },
      { qname: 'opf:role', local: 'role', ns: 'http://www.idpf.org/2007/opf', value: 'aut' },
      { qname: 'xml:lang', local: 'lang', ns: 'http://www.w3.org/XML/1998/namespace', value: 'en' },
      { qname: 'scheme', local: 'scheme', value: 's' },
    ])
  })

  it('excludes xmlns declarations', () => {
    const root = doc('<package xmlns="http://x" xmlns:opf="http://y" id="p"/>')
    expect(root.attributes).toEqual([{ qname: 'id', local: 'id', value: 'p' }])
  })

  it('leaves the legacy attrs map untouched', () => {
    const root = doc('<package xmlns="http://x" id="p"/>')
    expect(root.attrs).toEqual({ xmlns: 'http://x', id: 'p' })
  })
})
