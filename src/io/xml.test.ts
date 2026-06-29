import { describe, it, expect } from 'vitest'
import { parseXml, findDescendants, childElements } from './xml.js'
import { textContent } from './xml.js'

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
