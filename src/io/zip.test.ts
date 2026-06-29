import { describe, it, expect } from 'vitest'
import { zipSync } from 'fflate'
import { openEpub, getResource } from './zip.js'

const enc = (s: string) => new TextEncoder().encode(s)

function makeEpub(extra: Record<string, [Uint8Array, { level: 0 | 6 }]> = {}) {
  return zipSync({
    mimetype: [enc('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': [
      enc(
        '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">' +
          '<rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles>' +
          '</container>',
      ),
      { level: 6 },
    ],
    ...extra,
  })
}

describe('openEpub', () => {
  it('reads resources in order and marks compression', async () => {
    const c = await openEpub(makeEpub())
    const names = [...c.resources.keys()]
    expect(names[0]).toBe('mimetype')
    expect(getResource(c, 'mimetype')?.compression).toBe('stored')
    expect(getResource(c, 'META-INF/container.xml')?.compression).toBe('deflate')
  })

  it('extracts rootfiles from container.xml', async () => {
    const c = await openEpub(makeEpub())
    expect(c.rootfiles).toEqual(['EPUB/package.opf'])
  })

  it('flags encryption when META-INF/encryption.xml is present', async () => {
    const c = await openEpub(makeEpub({ 'META-INF/encryption.xml': [enc('<encryption/>'), { level: 6 }] }))
    expect(c.hasEncryption).toBe(true)
  })

  it('accepts an ArrayBuffer', async () => {
    const bytes = makeEpub()
    const c = await openEpub(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    expect(c.resources.has('mimetype')).toBe(true)
  })

  it('excludes ZIP directory entries from resources', async () => {
    const bytes = zipSync({
      mimetype: [enc('application/epub+zip'), { level: 0 }],
      'EPUB/': [new Uint8Array(0), { level: 0 }], // explicit directory entry
      'EPUB/content.xhtml': [enc('<html/>'), { level: 6 }],
      'EPUB/empty.css': [new Uint8Array(0), { level: 0 }], // empty but real file — must be retained
    })
    const c = await openEpub(bytes)
    expect(c.resources.has('EPUB/content.xhtml')).toBe(true)
    expect(c.resources.has('EPUB/empty.css')).toBe(true) // empty file kept (key on slash, not length)
    expect(c.resources.has('EPUB/')).toBe(false) // directory entry excluded
  })
})
