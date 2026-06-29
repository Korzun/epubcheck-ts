import { describe, it, expect } from 'vitest'
import type { EpubContainer, Resource } from '../io/zip.js'
import type { ManifestItem } from './opf.js'
import { parseNav } from './nav.js'

const enc = (s: string) => new TextEncoder().encode(s)
const LOC = { path: 'EPUB/package.opf', line: 1, column: 1 }

function container(navXml: string | undefined, navPath = 'EPUB/nav.xhtml'): EpubContainer {
  const resources = new Map<string, Resource>()
  if (navXml !== undefined) resources.set(navPath, { path: navPath, bytes: enc(navXml), compression: 'deflate' })
  return { resources, rootfiles: ['EPUB/package.opf'], hasEncryption: false }
}
const navItem: ManifestItem = { id: 'nav', href: 'nav.xhtml', mediaType: 'application/xhtml+xml', properties: ['nav'], loc: LOC }

const NAV = (body: string) =>
  '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>t</title></head><body>' +
  body + '</body></html>'

describe('parseNav', () => {
  it('extracts nav sections with their epub:type tokens', () => {
    const { nav, messages } = parseNav(navItem, container(NAV(
      '<nav epub:type="toc"><ol><li><a href="c1.xhtml">One</a></li></ol></nav>' +
      '<nav epub:type="landmarks"><ol><li><a epub:type="bodymatter" href="c1.xhtml">Start</a></li></ol></nav>',
    )))
    expect(messages).toHaveLength(0)
    expect(nav?.path).toBe('EPUB/nav.xhtml')
    expect(nav?.sections).toHaveLength(2)
    expect(nav?.sections[0]?.types).toEqual(['toc'])
    expect(nav?.sections[1]?.types).toEqual(['landmarks'])
  })

  it('returns no nav and no messages when the nav resource is absent', () => {
    expect(parseNav(navItem, container(undefined))).toEqual({ messages: [] })
  })

  it('surfaces a parse error as RSC-005', () => {
    const { nav, messages } = parseNav(navItem, container(NAV('<nav epub:type="toc"><ol></nav>')))
    expect(nav).toBeUndefined()
    expect(messages[0]?.id).toBe('RSC-005')
  })
})
