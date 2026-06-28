import { describe, it, expect } from 'vitest'
import type { EpubContainer, Resource } from '../io/zip.js'
import { validateOcf } from './ocf.js'

const enc = (s: string) => new TextEncoder().encode(s)

function container(
  entries: Array<[string, Partial<Resource> & { bytes?: Uint8Array }]>,
  opts: { rootfiles?: string[]; hasEncryption?: boolean } = {},
): EpubContainer {
  const resources = new Map<string, Resource>()
  for (const [path, r] of entries) {
    resources.set(path, {
      path,
      bytes: r.bytes ?? new Uint8Array(),
      compression: r.compression ?? 'deflate',
    })
  }
  return { resources, rootfiles: opts.rootfiles ?? [], hasEncryption: opts.hasEncryption ?? false }
}

const ids = (c: EpubContainer) => validateOcf(c).map((m) => m.id)

describe('validateOcf', () => {
  const goodMimetype: [string, Partial<Resource>] = [
    'mimetype',
    { bytes: enc('application/epub+zip'), compression: 'stored' },
  ]

  it('passes a well-formed container', () => {
    const c = container(
      [goodMimetype, ['META-INF/container.xml', { bytes: enc('<container/>') }]],
      { rootfiles: ['EPUB/package.opf'] },
    )
    expect(ids(c)).toEqual([])
  })

  it('flags PKG-006 when mimetype is not first', () => {
    const c = container(
      [['META-INF/container.xml', {}], goodMimetype],
      { rootfiles: ['EPUB/package.opf'] },
    )
    expect(ids(c)).toContain('PKG-006')
  })

  it('flags PKG-005 when mimetype is compressed', () => {
    const c = container(
      [['mimetype', { bytes: enc('application/epub+zip'), compression: 'deflate' }], ['META-INF/container.xml', {}]],
      { rootfiles: ['EPUB/package.opf'] },
    )
    expect(ids(c)).toContain('PKG-005')
  })

  it('flags PKG-007 when mimetype content is wrong', () => {
    const c = container(
      [['mimetype', { bytes: enc('text/plain'), compression: 'stored' }], ['META-INF/container.xml', {}]],
      { rootfiles: ['EPUB/package.opf'] },
    )
    expect(ids(c)).toContain('PKG-007')
  })

  it('flags RSC-002 when container.xml is missing', () => {
    const c = container([goodMimetype])
    expect(ids(c)).toContain('RSC-002')
  })

  it('flags RSC-003 when container.xml has no rootfile', () => {
    const c = container([goodMimetype, ['META-INF/container.xml', { bytes: enc('<container/>') }]])
    expect(ids(c)).toContain('RSC-003')
  })
})
