import type { Severity } from '../../src/index.js'
import { buildEpub, cssEpub, CONTAINER, OPF, NAV, CONTENT } from './build.js'

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
    expected: [E('RSC-005', 'ERROR'), E('RSC-011', 'ERROR')],
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
    expected: [E('OPF-049', 'ERROR'), E('RSC-011', 'ERROR')],
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
  {
    name: 'opf-undeclared-resource',
    area: 'opf',
    description: 'a container file is not declared in the manifest (epubcheck OPF-003, usage)',
    epub: buildEpub({ files: { 'EPUB/orphan.txt': 'orphan' } }),
    expected: [E('OPF-003', 'USAGE')],
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
  {
    name: 'nav-reading-order',
    area: 'nav',
    description: 'toc links are not in spine reading order (epubcheck NAV-011)',
    epub: buildEpub({
      files: {
        'EPUB/package.opf': OPF
          .replace('</manifest>', '<item id="content2" href="content_002.xhtml" media-type="application/xhtml+xml"/></manifest>')
          .replace('<itemref idref="content"/>', '<itemref idref="content"/><itemref idref="content2"/>'),
        'EPUB/content_002.xhtml': CONTENT,
        'EPUB/nav.xhtml': NAV.replace(
          '<nav epub:type="toc"><ol><li><a href="content_001.xhtml">Content</a></li></ol></nav>',
          '<nav epub:type="toc"><ol><li><a href="content_002.xhtml">Two</a></li><li><a href="content_001.xhtml">One</a></li></ol></nav>',
        ),
      },
    }),
    expected: [E('NAV-011', 'WARNING')],
  },
  {
    name: 'nav-link-missing-target',
    area: 'nav',
    description: 'nav toc link points to a missing file (epubcheck RSC-007, via content validation of the nav doc)',
    epub: buildEpub({ files: { 'EPUB/nav.xhtml': NAV.replace('href="content_001.xhtml"', 'href="missing.xhtml"') } }),
    expected: [E('RSC-007', 'ERROR')],
  },
  {
    name: 'nav-link-bad-fragment',
    area: 'nav',
    description: 'nav toc link has an undefined fragment in its target (epubcheck RSC-012, via content validation of the nav doc)',
    epub: buildEpub({ files: { 'EPUB/nav.xhtml': NAV.replace('href="content_001.xhtml"', 'href="content_001.xhtml#nope"') } }),
    expected: [E('RSC-012', 'ERROR')],
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
  {
    name: 'content-link-nonstandard-type',
    area: 'content',
    description: 'content a@href targets a non-content-document resource type (epubcheck RSC-010)',
    epub: buildEpub({
      files: {
        'EPUB/package.opf': OPF.replace(
          '</manifest>',
          '<item id="photo" href="photo.jpg" media-type="image/jpeg"/></manifest>',
        ),
        'EPUB/photo.jpg': 'JPEGDATA',
        'EPUB/content_001.xhtml': CONTENT.replace('<p>Hello</p>', '<p><a href="photo.jpg">x</a></p>'),
      },
    }),
    expected: [E('RSC-010', 'ERROR')],
  },
  {
    name: 'content-link-nonspine',
    area: 'content',
    description: 'content a@href targets a content doc that is not a spine item (epubcheck RSC-011)',
    // The nav doc is a declared XHTML resource that is not in the spine.
    epub: buildEpub({ files: { 'EPUB/content_001.xhtml': CONTENT.replace('<p>Hello</p>', '<p><a href="nav.xhtml">x</a></p>') } }),
    expected: [E('RSC-011', 'ERROR')],
  },
  {
    name: 'content-audio-remote-http',
    area: 'content',
    description: 'content audio@src is a remote HTTP url that should be HTTPS (epubcheck RSC-031)',
    epub: buildEpub({ files: { 'EPUB/content_001.xhtml': CONTENT.replace('<p>Hello</p>', '<p><audio src="http://example.com/a.mp3"></audio></p>') } }),
    expected: [E('RSC-031', 'WARNING')],
  },
  {
    name: 'content-foreign-resource-no-fallback',
    area: 'content',
    description: 'content img@src targets a non-core media type with no fallback (epubcheck RSC-032)',
    epub: buildEpub({
      files: {
        'EPUB/package.opf': OPF.replace(
          '</manifest>',
          '<item id="tiff" href="diagram.tiff" media-type="image/tiff"/></manifest>',
        ),
        'EPUB/diagram.tiff': 'TIFFDATA',
        'EPUB/content_001.xhtml': CONTENT.replace('<p>Hello</p>', '<p><img src="diagram.tiff"/></p>'),
      },
    }),
    expected: [E('RSC-032', 'ERROR')],
  },

  // ---- CSS (mirrors epub3/06-content-document css scenarios) ----
  { name: 'css-valid', area: 'css', description: 'valid EPUB with a stylesheet', epub: cssEpub('p { color: red; }'), expected: [] },
  {
    name: 'css-property-direction',
    area: 'css',
    description: 'stylesheet uses the direction property (epubcheck CSS-001)',
    epub: cssEpub('body { direction: rtl; }'),
    expected: [E('CSS-001', 'ERROR')],
  },
  {
    name: 'css-font-face-empty',
    area: 'css',
    description: 'empty @font-face block (epubcheck CSS-019)',
    epub: cssEpub('@font-face {}'),
    expected: [E('CSS-019', 'WARNING')],
  },
  {
    name: 'css-url-empty',
    area: 'css',
    description: 'empty url() reference (epubcheck CSS-002)',
    epub: cssEpub('body { background: url(); }'),
    expected: [E('CSS-002', 'ERROR')],
  },
  {
    name: 'css-url-missing',
    area: 'css',
    description: 'url() target is absent from the container (epubcheck RSC-007)',
    epub: cssEpub('body { background: url(missing.png); }'),
    expected: [E('RSC-007', 'ERROR')],
  },
  {
    name: 'css-import-not-declared',
    area: 'css',
    description: '@import target is present but not in the manifest (epubcheck RSC-008)',
    epub: cssEpub('@import "extra.css";', { 'EPUB/extra.css': 'p{}' }),
    expected: [E('RSC-008', 'ERROR'), E('OPF-003', 'USAGE')],
  },
  {
    name: 'css-remote-image',
    area: 'css',
    description: 'supplementary: remote background image not allowed (RSC-006)',
    epub: cssEpub('body { background: url(https://example.com/a.png); }'),
    expected: [E('RSC-006', 'ERROR')],
  },
  {
    name: 'css-import-fragment',
    area: 'css',
    description: 'supplementary: @import url has a fragment (RSC-013) + target undeclared (RSC-008)',
    epub: cssEpub('@import "other.css#x";', { 'EPUB/other.css': 'p{}' }),
    expected: [E('RSC-013', 'ERROR'), E('RSC-008', 'ERROR'), E('OPF-003', 'USAGE')],
  },
  {
    name: 'css-file-url',
    area: 'css',
    description: 'supplementary: file: URL is not allowed (RSC-030)',
    epub: cssEpub('body { background: url(file:///etc/passwd); }'),
    expected: [E('RSC-030', 'ERROR')],
  },
  {
    name: 'css-font-remote-http',
    area: 'css',
    description: 'supplementary: remote @font-face over HTTP should be HTTPS (RSC-031)',
    epub: cssEpub('@font-face { font-family: F; src: url(http://example.com/f.woff2); }'),
    expected: [E('RSC-031', 'WARNING')],
  },
  {
    name: 'css-font-face-nonstandard-type',
    area: 'css',
    description: '@font-face src targets a resource whose manifest media-type is not a font type (epubcheck CSS-007)',
    epub: buildEpub({
      files: {
        'EPUB/package.opf': OPF.replace(
          '</manifest>',
          '<item id="css" href="style.css" media-type="text/css"/>' +
            '<item id="fnt" href="f.bin" media-type="application/octet-stream"/></manifest>',
        ),
        'EPUB/content_001.xhtml': CONTENT.replace(
          '<head><title>t</title></head>',
          '<head><title>t</title><link rel="stylesheet" href="style.css"/></head>',
        ),
        'EPUB/style.css': '@font-face { font-family: F; src: url(f.bin); }',
        'EPUB/f.bin': 'FONTBYTES',
      },
    }),
    expected: [E('CSS-007', 'INFO')],
  },
  {
    name: 'css-position-fixed',
    area: 'css',
    description: 'supplementary: position:fixed (CSS-006, usage)',
    epub: cssEpub('div { position: fixed; }'),
    expected: [E('CSS-006', 'USAGE')],
  },
  {
    name: 'css-alternate-stylesheet-no-title',
    area: 'css',
    description: 'an alternate stylesheet <link> has no title (epubcheck CSS-015)',
    epub: cssEpub('p { color: red; }', {
      'EPUB/content_001.xhtml': CONTENT.replace(
        '<head><title>t</title></head>',
        '<head><title>t</title><link rel="stylesheet" href="style.css"/><link rel="alternate stylesheet" href="style.css"/></head>',
      ),
    }),
    expected: [E('CSS-015', 'ERROR')],
  },
  {
    name: 'css-link-conflicting-class',
    area: 'css',
    description: 'a stylesheet <link> has conflicting alternate-style class tokens (epubcheck CSS-005)',
    epub: cssEpub('p { color: red; }', {
      'EPUB/content_001.xhtml': CONTENT.replace(
        '<head><title>t</title></head>',
        '<head><title>t</title><link rel="stylesheet" href="style.css" class="day night"/></head>',
      ),
    }),
    expected: [E('CSS-005', 'USAGE')],
  },
  {
    name: 'css-charset-non-utf8',
    area: 'css',
    description: 'CSS @charset declares a non-UTF-8 encoding (epubcheck CSS-004)',
    epub: cssEpub('@charset "iso-8859-1";\np { color: red; }'),
    expected: [E('CSS-004', 'ERROR')],
  },
  {
    name: 'css-encoding-utf16',
    area: 'css',
    description: 'CSS file is UTF-16 (BOM) and should be UTF-8 (epubcheck CSS-003)',
    epub: buildEpub({
      files: {
        'EPUB/package.opf': OPF.replace(
          '</manifest>',
          '<item id="css" href="style.css" media-type="text/css"/></manifest>',
        ),
        'EPUB/content_001.xhtml': CONTENT.replace(
          '<head><title>t</title></head>',
          '<head><title>t</title><link rel="stylesheet" href="style.css"/></head>',
        ),
        'EPUB/style.css': new Uint8Array([0xff, 0xfe, 0x70, 0x00, 0x7b, 0x00, 0x7d, 0x00]), // UTF-16LE BOM + "p{}"
      },
    }),
    expected: [E('CSS-003', 'WARNING')],
  },
  {
    name: 'inline-style-element-url-missing',
    area: 'css',
    description: 'supplementary: <style> element url() target missing (RSC-007)',
    epub: buildEpub({ files: { 'EPUB/content_001.xhtml': CONTENT.replace('<head><title>t</title></head>', '<head><title>t</title><style>body { background: url(missing.png); }</style></head>') } }),
    expected: [E('RSC-007', 'ERROR')],
  },
  {
    name: 'inline-style-attr-position-fixed',
    area: 'css',
    description: 'supplementary: style="" attribute position:fixed (CSS-006, usage)',
    epub: buildEpub({ files: { 'EPUB/content_001.xhtml': CONTENT.replace('<p>Hello</p>', '<p style="position: fixed">x</p>') } }),
    expected: [E('CSS-006', 'USAGE')],
  },
]
