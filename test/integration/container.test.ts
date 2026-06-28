import { describe, it, expect } from 'vitest'
import { zipSync } from 'fflate'
import { validateEpub } from '../../src/index.js'

const enc = (s: string) => new TextEncoder().encode(s)

const CONTAINER = enc(
  '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">' +
    '<rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles>' +
    '</container>',
)

describe('integration: container validation', () => {
  it('reports no OCF errors for a structurally valid container', async () => {
    const bytes = zipSync({
      mimetype: [enc('application/epub+zip'), { level: 0 }],
      'META-INF/container.xml': [CONTAINER, { level: 6 }],
      'EPUB/package.opf': [enc('<package/>'), { level: 6 }],
    })
    const report = await validateEpub(bytes)
    // No OCF-layer messages (OPF/content checks arrive in later plans).
    const ocfIds = report.messages.map((m) => m.id).filter((id) => id.startsWith('PKG') || id === 'RSC-002' || id === 'RSC-003')
    expect(ocfIds).toEqual([])
  })

  it('reports container errors for an EPUB missing its mimetype', async () => {
    const bytes = zipSync({ 'META-INF/container.xml': [CONTAINER, { level: 6 }] })
    const report = await validateEpub(bytes)
    expect(report.messages.map((m) => m.id)).toContain('PKG-006')
    expect(report.valid).toBe(false)
  })
})
