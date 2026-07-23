import { describe, it, expect } from 'vitest'
import type { EpubContainer, Resource } from '../io/zip.js'
import type { ManifestItem } from './opf.js'
import { parseNcx } from './ncx.js'

const enc = (s: string) => new TextEncoder().encode(s)
const LOC = { path: 'EPUB/package.opf', line: 1, column: 1 }

function buildContainer(ncxXml: string | undefined, ncxPath = 'EPUB/toc.ncx'): EpubContainer {
  const resources = new Map<string, Resource>()
  if (ncxXml !== undefined) resources.set(ncxPath, { path: ncxPath, bytes: enc(ncxXml), compression: 'deflate' })
  return { resources, rootfiles: ['EPUB/package.opf'], hasEncryption: false }
}
const ncxItem: ManifestItem = { id: 'ncx', href: 'toc.ncx', mediaType: 'application/x-dtbncx+xml', properties: [], loc: LOC }

const NCX =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">' +
  '<head><meta name="dtb:uid" content=" urn:uuid:x "/></head>' +
  '<docTitle><text>Title</text></docTitle>' +
  '<navMap>' +
  '<navPoint id="np1" playOrder="1"><navLabel><text>One</text></navLabel><content src="content_001.xhtml"/></navPoint>' +
  '<navPoint id="np2" playOrder="2"><navLabel><text></text></navLabel></navPoint>' +
  '</navMap>' +
  '</ncx>'

describe('parseNcx', () => {
  it('captures uid untrimmed, navMap, navPoints, and text labels', () => {
    const { ncx, messages } = parseNcx(ncxItem, buildContainer(NCX))
    expect(messages).toEqual([])
    expect(ncx?.uid).toBe(' urn:uuid:x ')
    expect(ncx?.navMapPresent).toBe(true)
    expect(ncx?.navPoints).toHaveLength(2)
    expect(ncx?.navPoints[0]).toMatchObject({ hasLabel: true, hasContent: true, src: 'content_001.xhtml' })
    expect(ncx?.navPoints[1]).toMatchObject({ hasLabel: true, hasContent: false, src: undefined })
    // 3 <text> elements: docTitle 'Title', 'One', ''
    expect(ncx?.textLabels.map((t) => t.text)).toEqual(['Title', 'One', ''])
  })

  it('reports navMapPresent false when navMap is missing', () => {
    const { ncx } = parseNcx(ncxItem, buildContainer(NCX.replace(/<navMap>[\s\S]*<\/navMap>/, '')))
    expect(ncx?.navMapPresent).toBe(false)
    expect(ncx?.navPoints).toEqual([])
  })

  it('is total: missing resource yields no ncx and no messages', () => {
    const { ncx, messages } = parseNcx({ ...ncxItem, href: 'ghost.ncx' }, buildContainer(NCX))
    expect(ncx).toBeUndefined()
    expect(messages).toEqual([]) // missing file is RSC-001 territory (OPF manifest check)
  })

  it('surfaces XML parse errors as RSC-005 messages without throwing', () => {
    const { ncx, messages } = parseNcx(ncxItem, buildContainer('<ncx><unclosed'))
    expect(ncx).toBeUndefined()
    expect(messages.some((m) => m.id === 'RSC-005')).toBe(true)
  })
})
