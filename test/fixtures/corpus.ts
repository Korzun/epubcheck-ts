import type { Severity } from '../../src/index.js'
import { buildEpub, CONTAINER, OPF, NAV, CONTENT } from './build.js'

export interface Expected {
  id: string
  severity: Severity
}
export interface Fixture {
  name: string
  area: 'ocf' | 'opf' | 'nav' | 'content' | 'css'
  description: string
  epub: Uint8Array
  expected: Expected[]
}

const E = (id: string, severity: Severity): Expected => ({ id, severity })

export const CORPUS: Fixture[] = [
  // ---- baseline ----
  { name: 'minimal', area: 'ocf', description: 'minimal valid EPUB 3', epub: buildEpub(), expected: [] },

  // ---- OCF (mirrors epub3/04-ocf) ----
  {
    name: 'ocf-mimetype-missing',
    area: 'ocf',
    description: 'no mimetype entry (epubcheck PKG-006)',
    epub: buildEpub({ omit: ['mimetype'] }),
    expected: [E('PKG-006', 'ERROR')],
  },
  {
    name: 'ocf-mimetype-wrong-value',
    area: 'ocf',
    description: 'mimetype contains the wrong string (epubcheck PKG-007)',
    epub: buildEpub({ files: { mimetype: 'application/oops' } }),
    expected: [E('PKG-007', 'ERROR')],
  },
  {
    name: 'ocf-mimetype-compressed',
    area: 'ocf',
    description: 'mimetype entry is compressed, not stored (epubcheck PKG-005)',
    epub: buildEpub({ mimetypeDeflate: true }),
    expected: [E('PKG-005', 'ERROR')],
  },
  {
    name: 'ocf-container-missing',
    area: 'ocf',
    description: 'META-INF/container.xml absent (epubcheck RSC-002, fatal)',
    epub: buildEpub({ omit: ['META-INF/container.xml'] }),
    expected: [E('RSC-002', 'FATAL')],
  },
  {
    name: 'ocf-rootfile-wrong-mediatype',
    area: 'ocf',
    description: 'container.xml rootfile has the wrong media-type (epubcheck RSC-003)',
    epub: buildEpub({
      files: {
        'META-INF/container.xml': CONTAINER.replace('application/oebps-package+xml', 'text/plain'),
      },
    }),
    expected: [E('RSC-003', 'ERROR')],
  },

  // ---- OPF (mirrors epub3/05-package-document) ----
  {
    name: 'opf-title-missing',
    area: 'opf',
    description: 'package metadata has no dc:title (epubcheck RSC-005)',
    epub: buildEpub({ files: { 'EPUB/package.opf': OPF.replace('<dc:title>Title</dc:title>', '') } }),
    expected: [E('RSC-005', 'ERROR')],
  },
  {
    name: 'opf-modified-missing',
    area: 'opf',
    description: 'no dcterms:modified meta (epubcheck RSC-005)',
    epub: buildEpub({ files: { 'EPUB/package.opf': OPF.replace('<meta property="dcterms:modified">2020-01-01T00:00:00Z</meta>', '') } }),
    expected: [E('RSC-005', 'ERROR')],
  },
  {
    name: 'opf-nav-missing',
    area: 'opf',
    description: 'no manifest item declares the nav property (epubcheck RSC-005)',
    epub: buildEpub({ files: { 'EPUB/package.opf': OPF.replace(' properties="nav"', '') } }),
    expected: [E('RSC-005', 'ERROR')],
  },
  {
    name: 'opf-spine-missing',
    area: 'opf',
    description: 'package has no spine element (epubcheck RSC-005)',
    epub: buildEpub({ files: { 'EPUB/package.opf': OPF.replace('<spine><itemref idref="content"/></spine>', '') } }),
    expected: [E('RSC-005', 'ERROR')],
  },
  {
    name: 'opf-spine-no-linear',
    area: 'opf',
    description: 'spine has no linear itemref (epubcheck OPF-033)',
    epub: buildEpub({ files: { 'EPUB/package.opf': OPF.replace('<itemref idref="content"/>', '<itemref idref="content" linear="no"/>') } }),
    expected: [E('OPF-033', 'ERROR')],
  },
  {
    name: 'opf-spine-item-unknown',
    area: 'opf',
    description: 'spine itemref idref is not a manifest item (epubcheck OPF-049)',
    epub: buildEpub({ files: { 'EPUB/package.opf': OPF.replace('idref="content"', 'idref="nope"') } }),
    expected: [E('OPF-049', 'ERROR')],
  },
  {
    name: 'opf-duplicate-resource',
    area: 'opf',
    description: 'two manifest items resolve to the same href (epubcheck OPF-074)',
    epub: buildEpub({ files: { 'EPUB/package.opf': OPF.replace('</manifest>', '<item id="dup" href="content_001.xhtml" media-type="application/xhtml+xml"/></manifest>') } }),
    expected: [E('OPF-074', 'ERROR')],
  },
  {
    name: 'opf-unique-identifier-attr-missing',
    area: 'opf',
    description: 'package has no unique-identifier attribute (epubcheck OPF-048)',
    epub: buildEpub({ files: { 'EPUB/package.opf': OPF.replace(' unique-identifier="uid"', '') } }),
    expected: [E('OPF-048', 'ERROR')],
  },
  {
    name: 'opf-manifest-item-missing-file',
    area: 'opf',
    description: 'manifest declares a file absent from the container (epubcheck RSC-001)',
    epub: buildEpub({ files: { 'EPUB/package.opf': OPF.replace('</manifest>', '<item id="missing" href="missing.xhtml" media-type="application/xhtml+xml"/></manifest>') } }),
    expected: [E('RSC-001', 'ERROR')],
  },
  {
    name: 'opf-version-unsupported',
    area: 'opf',
    description: 'supplementary: package version is not 2.0/3.0 (OPF-001)',
    epub: buildEpub({ files: { 'EPUB/package.opf': OPF.replace('version="3.0"', 'version="4.0"') } }),
    expected: [E('OPF-001', 'ERROR')],
  },
  {
    name: 'opf-unique-identifier-unresolved',
    area: 'opf',
    description: 'supplementary: unique-identifier does not match any dc:identifier id (OPF-030)',
    epub: buildEpub({ files: { 'EPUB/package.opf': OPF.replace('<dc:identifier id="uid">', '<dc:identifier id="other">') } }),
    expected: [E('OPF-030', 'ERROR')],
  },

  // ---- Navigation (mirrors epub3/07-navigation-document) ----
  {
    name: 'nav-toc-missing',
    area: 'nav',
    description: 'nav document has no toc nav (epubcheck RSC-005)',
    epub: buildEpub({
      files: {
        // Remove the <nav> entirely so the only deviation is "no toc nav"
        // (renaming to landmarks would add a second RSC-005 for the anchor's missing epub:type).
        'EPUB/nav.xhtml': NAV.replace(
          '<nav epub:type="toc"><ol><li><a href="content_001.xhtml">Content</a></li></ol></nav>',
          '<p>no nav</p>',
        ),
      },
    }),
    expected: [E('RSC-005', 'ERROR')],
  },
  {
    name: 'nav-link-remote',
    area: 'nav',
    description: 'toc nav link points to a remote URL (epubcheck NAV-010)',
    epub: buildEpub({ files: { 'EPUB/nav.xhtml': NAV.replace('href="content_001.xhtml"', 'href="https://example.com/x"') } }),
    expected: [E('NAV-010', 'ERROR')],
  },

  // ---- Content references (mirrors epub3/06-content-document) ----
  {
    name: 'content-link-missing-doc',
    area: 'content',
    description: 'content a@href points to a missing document (epubcheck RSC-007)',
    epub: buildEpub({ files: { 'EPUB/content_001.xhtml': CONTENT.replace('<p>Hello</p>', '<p><a href="missing.xhtml">x</a></p>') } }),
    expected: [E('RSC-007', 'ERROR')],
  },
  {
    name: 'content-link-missing-fragment',
    area: 'content',
    description: 'content a@href has a same-doc fragment that is not defined (epubcheck RSC-012)',
    epub: buildEpub({ files: { 'EPUB/content_001.xhtml': CONTENT.replace('<p>Hello</p>', '<p><a href="#nope">x</a></p>') } }),
    expected: [E('RSC-012', 'ERROR')],
  },
]
