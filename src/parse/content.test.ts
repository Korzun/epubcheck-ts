import { describe, it, expect } from 'vitest'
import type { EpubContainer, Resource } from '../io/zip.js'
import type { ManifestItem } from './opf.js'
import { parseContent } from './content.js'

const enc = (s: string) => new TextEncoder().encode(s)
const LOC = { path: 'EPUB/package.opf', line: 1, column: 1 }
const item: ManifestItem = { id: 'c1', href: 'c1.xhtml', mediaType: 'application/xhtml+xml', properties: [], loc: LOC }

function container(xml: string | undefined, path = 'EPUB/c1.xhtml'): EpubContainer {
  const resources = new Map<string, Resource>()
  if (xml !== undefined) resources.set(path, { path, bytes: enc(xml), compression: 'deflate' })
  return { resources, rootfiles: ['EPUB/package.opf'], hasEncryption: false }
}
const DOC = (body: string) =>
  '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:xlink="http://www.w3.org/1999/xlink"><head><title>t</title></head><body>' +
  body + '</body></html>'

describe('parseContent', () => {
  it('extracts references with their types', () => {
    const { doc, messages } = parseContent(item, container(DOC(
      '<p id="top"><a href="c2.xhtml#x">link</a> <img src="a.png" srcset="b.png 2x, c.png 3x"/></p>' +
      '<link rel="stylesheet" href="s.css"/><script src="app.js"></script>',
    )))
    expect(messages).toHaveLength(0)
    const byType = (t: string) => doc!.refs.filter((r) => r.type === t).map((r) => r.url)
    expect(byType('hyperlink')).toEqual(['c2.xhtml#x'])
    expect(byType('image')).toEqual(['a.png', 'b.png', 'c.png'])
    expect(byType('stylesheet')).toEqual(['s.css'])
    expect(byType('generic')).toEqual(['app.js'])
    expect(doc!.ids.has('top')).toBe(true)
  })

  it('types source/@src by its audio/video parent', () => {
    const { doc } = parseContent(item, container(DOC(
      '<audio><source src="a.mp3"/></audio><video src="v.mp4" poster="p.png"><source src="v2.webm"/></video>',
    )))
    expect(doc!.refs.filter((r) => r.type === 'audio').map((r) => r.url)).toEqual(['a.mp3'])
    expect(doc!.refs.filter((r) => r.type === 'video').map((r) => r.url).sort()).toEqual(['v.mp4', 'v2.webm'])
    expect(doc!.refs.filter((r) => r.type === 'image').map((r) => r.url)).toEqual(['p.png'])
  })

  it('reports RSC-005 for an undeclared named entity (matches epubcheck)', () => {
    const { doc, messages } = parseContent(item, container(DOC('<p>x&nbsp;y</p>')))
    expect(doc).toBeUndefined()
    expect(messages[0]?.id).toBe('RSC-005')
  })

  it('returns no doc when the resource is absent', () => {
    expect(parseContent(item, container(undefined))).toEqual({ messages: [] })
  })
})

describe('parseContent — inline styles', () => {
  it('collects <style> element contents and style="" attribute values', () => {
    const { doc } = parseContent(item, container(DOC(
      '<style>body { color: red; }</style><p style="position: fixed">x</p>',
    )))
    const sheets = doc!.inlineStyles.filter((s) => s.context === 'stylesheet').map((s) => s.text)
    const attrs = doc!.inlineStyles.filter((s) => s.context === 'declarationList').map((s) => s.text)
    expect(sheets).toEqual(['body { color: red; }'])
    expect(attrs).toEqual(['position: fixed'])
  })
})
