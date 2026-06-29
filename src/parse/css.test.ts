import { describe, it, expect } from 'vitest'
import type { EpubContainer, Resource } from '../io/zip.js'
import type { ManifestItem } from './opf.js'
import { parseCss, analyzeCss } from './css.js'

const enc = (s: string) => new TextEncoder().encode(s)
const LOC = { path: 'EPUB/package.opf' }
const item: ManifestItem = { id: 's', href: 'styles/s.css', mediaType: 'text/css', properties: [], loc: LOC }

function container(css: string | undefined, path = 'EPUB/styles/s.css'): EpubContainer {
  const resources = new Map<string, Resource>()
  if (css !== undefined) resources.set(path, { path, bytes: enc(css), compression: 'deflate' })
  return { resources, rootfiles: ['EPUB/package.opf'], hasEncryption: false }
}

describe('parseCss', () => {
  it('extracts url() references with their types', () => {
    const { css, messages } = parseCss(item, container(
      '@import "base.css";\n' +
      '@font-face { font-family: F; src: url("../fonts/f.woff2"); }\n' +
      'body { background-image: url(bg.png); }',
    ))
    expect(messages).toHaveLength(0)
    const byType = (t: string) => css!.refs.filter((r) => r.type === t).map((r) => r.url)
    expect(byType('import')).toEqual(['base.css'])
    expect(byType('font')).toEqual(['../fonts/f.woff2'])
    expect(byType('generic')).toEqual(['bg.png'])
  })

  it('collects declarations of interest and font-face info', () => {
    const { css } = parseCss(item, container('p { direction: rtl; position: fixed; }\n@font-face {}'))
    const props = css!.declarations.map((d) => d.property)
    expect(props).toContain('direction')
    expect(props).toContain('position')
    expect(css!.fontFaces[0]?.declarationCount).toBe(0)
  })

  it('handles malformed CSS without throwing', () => {
    // css-tree is error-tolerant; this verifies graceful handling (CSS-008 is emitted
    // opportunistically when css-tree's onParseError fires) and the never-throw contract.
    const result = parseCss(item, container('p { color: }} @@@ broken {'))
    expect(Array.isArray(result.messages)).toBe(true)
  })

  it('reports CSS-002 for an empty url()', () => {
    const { messages } = parseCss(item, container('p { background: url(); }'))
    expect(messages.some((m) => m.id === 'CSS-002')).toBe(true)
  })

  it('returns no doc when the resource is absent', () => {
    expect(parseCss(item, container(undefined))).toEqual({ messages: [] })
  })
})

describe('analyzeCss', () => {
  it('analyzes a full stylesheet (context: stylesheet)', () => {
    const a = analyzeCss('@import "x.css"; body { background: url(bg.png); direction: rtl; }', 'EPUB/c1.xhtml', 'stylesheet')
    expect(a.refs.map((r) => r.type).sort()).toEqual(['generic', 'import'])
    expect(a.declarations.some((d) => d.property === 'direction')).toBe(true)
    expect(a.messages).toHaveLength(0)
  })
  it('analyzes a style-attribute value (context: declarationList)', () => {
    const a = analyzeCss('position: fixed; background: url(bg.png)', 'EPUB/c1.xhtml', 'declarationList')
    expect(a.declarations.map((d) => d.property)).toContain('position')
    expect(a.refs.map((r) => r.url)).toEqual(['bg.png'])
    expect(a.refs[0]?.type).toBe('generic')
  })
})
