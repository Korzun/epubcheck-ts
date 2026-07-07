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

describe('parseContent — intrinsic fallback', () => {
  const refFor = (body: string, url: string) => {
    const { doc } = parseContent(item, container(DOC(body)))
    return doc!.refs.find((r) => r.url === url)
  }

  it('marks <img> and <source> inside <picture> as having intrinsic fallback', () => {
    const body = '<picture><source srcset="a.webp"/><img src="a.png"/></picture>'
    expect(refFor(body, 'a.png')?.hasIntrinsicFallback).toBe(true)
    expect(refFor(body, 'a.webp')?.hasIntrinsicFallback).toBe(true)
  })

  it('marks a bare <img> as having no intrinsic fallback', () => {
    expect(refFor('<p><img src="b.png"/></p>', 'b.png')?.hasIntrinsicFallback).toBe(false)
  })

  it('marks <source> inside <audio> as having intrinsic fallback', () => {
    expect(refFor('<audio><source src="a.ogg"/></audio>', 'a.ogg')?.hasIntrinsicFallback).toBe(true)
  })

  it('marks <source> inside <video> and a bare <video src> as having no intrinsic fallback', () => {
    expect(refFor('<video src="v.mp4"><source src="v2.webm"/></video>', 'v2.webm')?.hasIntrinsicFallback).toBe(false)
    expect(refFor('<video src="v.mp4"></video>', 'v.mp4')?.hasIntrinsicFallback).toBe(false)
  })

  it('marks <object> as having intrinsic fallback and <iframe> as not', () => {
    expect(refFor('<object data="x.pdf"></object>', 'x.pdf')?.hasIntrinsicFallback).toBe(true)
    expect(refFor('<iframe src="y.xhtml"></iframe>', 'y.xhtml')?.hasIntrinsicFallback).toBe(false)
  })
})

describe('parseContent — deprecated elements', () => {
  it('captures epub:switch and epub:trigger occurrences', () => {
    const xhtml =
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:ev="http://www.w3.org/2001/xml-events">' +
      '<head><title>t</title></head><body>' +
      '<epub:switch><epub:case>a</epub:case></epub:switch>' +
      '<epub:trigger ev:observer="x"/>' +
      '</body></html>'
    const { doc } = parseContent(item, container(xhtml))
    const names = (doc?.deprecatedElements ?? []).map((d) => d.name).sort()
    expect(names).toEqual(['switch', 'trigger'])
  })

  it('has empty deprecatedElements for a plain document', () => {
    const { doc } = parseContent(item, container(DOC('<p>x</p>')))
    expect(doc?.deprecatedElements).toEqual([])
  })
})

describe('parseContent — id positions', () => {
  it('records 1-based id positions in document order', () => {
    const { doc } = parseContent(item, container(DOC('<h2 id="a">A</h2><p id="b">B</p><h2 id="c">C</h2>')))
    expect(doc!.idPositions.get('a')).toBe(1)
    expect(doc!.idPositions.get('b')).toBe(2)
    expect(doc!.idPositions.get('c')).toBe(3)
    expect(doc!.idPositions.get('missing')).toBeUndefined()
  })

  it('keeps the first occurrence for duplicate ids', () => {
    const { doc } = parseContent(item, container(DOC('<p id="x">1</p><p id="y">2</p><p id="x">3</p>')))
    expect(doc!.idPositions.get('x')).toBe(1)
    expect(doc!.idPositions.get('y')).toBe(2)
  })
})
