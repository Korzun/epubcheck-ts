import type { Severity } from '../../src/index.js'
import { buildEpub, buildEpub2, cssEpub, CONTAINER, OPF, OPF2, NAV, NCX2, CONTENT } from './build.js'

export interface Expected {
  id: string
  severity: Severity
}
export interface Fixture {
  name: string
  area: 'ocf' | 'opf' | 'nav' | 'content' | 'css' | 'ncx' | 'opf2-schema' | 'opf3-schema'
  description: string
  epub: Uint8Array
  expected: Expected[]
}

const E = (id: string, severity: Severity): Expected => ({ id, severity })

const SCHEMA_NS =
  'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf" ' +
  'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"'

/** OPF2 with opf:/xsi: declared, then `find` replaced by `repl`. Mirrors test/differential/cases.ts's `opf2`. */
function schemaEpub2(find: string, repl: string): Uint8Array {
  const base = OPF2.replace('xmlns:dc="http://purl.org/dc/elements/1.1/"', SCHEMA_NS)
  if (!base.includes(find)) throw new Error(`OPF2 does not contain: ${find}`)
  return buildEpub2({ files: { 'EPUB/package.opf': base.replace(find, repl) } })
}

const S_TITLE = '<dc:title>Title</dc:title>'
const S_IDENT = '<dc:identifier id="uid">urn:uuid:00000000-0000-0000-0000-000000000000</dc:identifier>'
const S_LANG = '<dc:language>en</dc:language>'
const S_ITEM = '<item id="content" href="content_001.xhtml" media-type="application/xhtml+xml"/>'
const S_GUIDE = '<guide><reference type="text" title="Text" href="content_001.xhtml"/></guide>'

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
    description: 'package has no unique-identifier attribute (epubcheck OPF-048 + RSC-005)',
    epub: buildEpub({ files: { 'EPUB/package.opf': OPF.replace(' unique-identifier="uid"', '') } }),
    // The jar emits three errors for a missing unique-identifier attribute:
    // OPF-048 (missing attribute), OPF-030 resolving the missing reference to the
    // literal "null", and the schema layer's RNG failure — element "package"
    // missing required attribute "unique-identifier".
    expected: [E('OPF-030', 'ERROR'), E('OPF-048', 'ERROR'), E('RSC-005', 'ERROR')],
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
    name: 'nav-reading-order-fragments',
    area: 'nav',
    description: 'toc links to fragments of the same spine item are out of document order (epubcheck NAV-011 x2)',
    epub: buildEpub({
      files: {
        'EPUB/content_001.xhtml': CONTENT.replace('<p>Hello</p>', '<h2 id="ch1">1</h2><h2 id="ch2">2</h2><h2 id="ch3">3</h2>'),
        'EPUB/nav.xhtml': NAV.replace(
          '<nav epub:type="toc"><ol><li><a href="content_001.xhtml">Content</a></li></ol></nav>',
          '<nav epub:type="toc"><ol>' +
            '<li><a href="content_001.xhtml#ch1">1</a></li>' +
            '<li><a href="content_001.xhtml">M</a></li>' +
            '<li><a href="content_001.xhtml#ch3">3</a></li>' +
            '<li><a href="content_001.xhtml#ch2">2</a></li>' +
            '</ol></nav>',
        ),
      },
    }),
    expected: [E('NAV-011', 'WARNING'), E('NAV-011', 'WARNING')],
  },
  {
    name: 'nav-reading-order-fragments-valid',
    area: 'nav',
    description: 'toc links to fragments of the same spine item in correct document order (valid; no NAV-011)',
    epub: buildEpub({
      files: {
        'EPUB/content_001.xhtml': CONTENT.replace('<p>Hello</p>', '<h2 id="ch1">1</h2><h2 id="ch2">2</h2><h2 id="ch3">3</h2>'),
        'EPUB/nav.xhtml': NAV.replace(
          '<nav epub:type="toc"><ol><li><a href="content_001.xhtml">Content</a></li></ol></nav>',
          '<nav epub:type="toc"><ol>' +
            '<li><a href="content_001.xhtml">M</a></li>' +
            '<li><a href="content_001.xhtml#ch1">1</a></li>' +
            '<li><a href="content_001.xhtml#ch2">2</a></li>' +
            '<li><a href="content_001.xhtml#ch3">3</a></li>' +
            '</ol></nav>',
        ),
      },
    }),
    expected: [],
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
  {
    name: 'nav-link-noncontent-type',
    area: 'nav',
    description: 'nav toc link targets a non-content-document resource type (epubcheck RSC-010, via nav-as-content)',
    epub: buildEpub({
      files: {
        'EPUB/package.opf': OPF.replace('</manifest>', '<item id="photo" href="photo.jpg" media-type="image/jpeg"/></manifest>'),
        'EPUB/photo.jpg': 'JPEG',
        'EPUB/nav.xhtml': NAV.replace('href="content_001.xhtml"', 'href="photo.jpg"'),
      },
    }),
    expected: [E('RSC-010', 'ERROR')],
  },
  {
    name: 'nav-link-nonspine',
    area: 'nav',
    description: 'nav toc link targets a content doc not in the spine (epubcheck RSC-011, via nav-as-content)',
    epub: buildEpub({
      files: {
        'EPUB/package.opf': OPF.replace('</manifest>', '<item id="extra" href="extra.xhtml" media-type="application/xhtml+xml"/></manifest>'),
        'EPUB/extra.xhtml': CONTENT,
        'EPUB/nav.xhtml': NAV.replace('href="content_001.xhtml"', 'href="extra.xhtml"'),
      },
    }),
    expected: [E('RSC-011', 'ERROR')],
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
  // content — RSC-032 variations + valid fallback
  {
    name: 'content-foreign-audio-no-fallback',
    area: 'content',
    description: 'content audio@src targets a non-core media type with no fallback (epubcheck RSC-032)',
    epub: buildEpub({
      files: {
        'EPUB/package.opf': OPF.replace('</manifest>', '<item id="snd" href="sound.bin" media-type="application/octet-stream"/></manifest>'),
        'EPUB/sound.bin': 'AUDIO',
        'EPUB/content_001.xhtml': CONTENT.replace('<p>Hello</p>', '<p><audio src="sound.bin"></audio></p>'),
      },
    }),
    expected: [E('RSC-032', 'ERROR')],
  },
  {
    name: 'content-foreign-embed-no-fallback',
    area: 'content',
    description: 'content embed@src targets a non-core media type with no fallback (epubcheck RSC-032)',
    epub: buildEpub({
      files: {
        'EPUB/package.opf': OPF.replace('</manifest>', '<item id="emb" href="thing.bin" media-type="application/octet-stream"/></manifest>'),
        'EPUB/thing.bin': 'DATA',
        'EPUB/content_001.xhtml': CONTENT.replace('<p>Hello</p>', '<p><embed src="thing.bin"/></p>'),
      },
    }),
    expected: [E('RSC-032', 'ERROR')],
  },
  {
    name: 'content-foreign-img-with-fallback-valid',
    area: 'content',
    description: 'content img@src targets a non-core type but has a manifest fallback to a core type (valid; no RSC-032)',
    epub: buildEpub({
      files: {
        'EPUB/package.opf': OPF.replace('</manifest>',
          '<item id="tiff" href="diagram.tiff" media-type="image/tiff" fallback="png"/>' +
          '<item id="png" href="diagram.png" media-type="image/png"/></manifest>'),
        'EPUB/diagram.tiff': 'TIFF',
        'EPUB/diagram.png': 'PNG',
        'EPUB/content_001.xhtml': CONTENT.replace('<p>Hello</p>', '<p><img src="diagram.tiff"/></p>'),
      },
    }),
    expected: [],
  },
  {
    name: 'content-video-remote-http',
    area: 'content',
    description: 'content video@src is a remote HTTP url that should be HTTPS (epubcheck RSC-031)',
    epub: buildEpub({ files: { 'EPUB/content_001.xhtml': CONTENT.replace('<p>Hello</p>', '<p><video src="http://example.com/v.mp4"></video></p>') } }),
    expected: [E('RSC-031', 'WARNING')],
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
    name: 'css-alternate-stylesheet-empty-title',
    area: 'css',
    description: 'an alternate stylesheet <link> has an empty title attribute (epubcheck CSS-015)',
    epub: cssEpub('p { color: red; }', {
      'EPUB/content_001.xhtml': CONTENT.replace(
        '<head><title>t</title></head>',
        '<head><title>t</title><link rel="stylesheet" href="style.css"/><link rel="alternate stylesheet" href="style.css" title=""/></head>',
      ),
    }),
    expected: [E('CSS-015', 'ERROR')],
  },
  {
    name: 'css-font-face-valid',
    area: 'css',
    description: '@font-face src targets a blessed font type (valid; no CSS-007)',
    epub: buildEpub({
      files: {
        'EPUB/package.opf': OPF.replace('</manifest>',
          '<item id="css" href="style.css" media-type="text/css"/>' +
          '<item id="fnt" href="f.woff2" media-type="font/woff2"/></manifest>'),
        'EPUB/content_001.xhtml': CONTENT.replace('<head><title>t</title></head>', '<head><title>t</title><link rel="stylesheet" href="style.css"/></head>'),
        'EPUB/style.css': '@font-face { font-family: F; src: url(f.woff2); }',
        'EPUB/f.woff2': 'WOFF2',
      },
    }),
    expected: [],
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

  // ---- EPUB 2 baseline ----
  { name: 'minimal-epub2', area: 'ocf', description: 'minimal valid EPUB 2 (OPF 2.0 + NCX)', epub: buildEpub2(), expected: [] },

  // ---- NCX (mirrors epub2/ncx-publication.feature) ----
  {
    name: 'ncx-uid-mismatch',
    area: 'ncx',
    description: 'dtb:uid does not match the OPF unique identifier (epubcheck NCX-001)',
    epub: buildEpub2({ files: { 'EPUB/toc.ncx': NCX2.replace('urn:uuid:00000000-0000-0000-0000-000000000000', 'urn:uuid:mismatch') } }),
    expected: [E('NCX-001', 'ERROR')],
  },
  {
    name: 'ncx-uid-spaces',
    area: 'ncx',
    description: 'dtb:uid has leading/trailing whitespace (epubcheck NCX-004, usage; matches after trim so no NCX-001)',
    epub: buildEpub2({ files: { 'EPUB/toc.ncx': NCX2.replace('content="urn:uuid:00000000-0000-0000-0000-000000000000"', 'content=" urn:uuid:00000000-0000-0000-0000-000000000000 "') } }),
    expected: [E('NCX-004', 'USAGE')],
  },
  {
    name: 'ncx-label-empty',
    area: 'ncx',
    description: 'empty navLabel text (epubcheck NCX-006, usage)',
    epub: buildEpub2({ files: { 'EPUB/toc.ncx': NCX2.replace('<text>Content</text>', '<text></text>') } }),
    expected: [E('NCX-006', 'USAGE')],
  },
  {
    name: 'ncx-navmap-missing',
    area: 'ncx',
    description: 'NCX without a navMap (schema-level, epubcheck RSC-005)',
    epub: buildEpub2({ files: { 'EPUB/toc.ncx': NCX2.replace(/<navMap>[\s\S]*<\/navMap>/, '') } }),
    expected: [E('RSC-005', 'ERROR')],
  },
  {
    name: 'ncx-link-missing-resource',
    area: 'ncx',
    description: 'navPoint src to a file not in the EPUB (epubcheck RSC-007; mirrors ncx-missing-resource-error)',
    epub: buildEpub2({ files: { 'EPUB/toc.ncx': NCX2.replace('src="content_001.xhtml"', 'src="ghost.xhtml"') } }),
    expected: [E('RSC-007', 'ERROR')],
  },
  {
    name: 'ncx-link-non-ops',
    area: 'ncx',
    description: 'navPoint src to a non-content-document (epubcheck RSC-010; mirrors ncx-link-to-non-ops-error)',
    epub: buildEpub2({
      files: {
        'EPUB/package.opf': OPF2.replace('</manifest>', '<item id="img" href="cover.gif" media-type="image/gif"/></manifest>'),
        'EPUB/cover.gif': 'GIF89a',
        'EPUB/toc.ncx': NCX2.replace('src="content_001.xhtml"', 'src="cover.gif"'),
      },
    }),
    expected: [E('RSC-010', 'ERROR')],
  },

  // ---- OPF 2.0 (mirrors epub2/opf-package-document.feature + opf-publication.feature) ----
  {
    name: 'opf2-guide-undeclared',
    area: 'opf',
    description: 'guide reference to a file not in the manifest (epubcheck OPF-031)',
    epub: buildEpub2({ files: { 'EPUB/package.opf': OPF2.replace('href="content_001.xhtml"/></guide>', 'href="ghost.xhtml"/></guide>') } }),
    expected: [E('OPF-031', 'ERROR')],
  },
  {
    name: 'opf2-guide-non-content',
    area: 'opf',
    description: 'guide reference to a non-content-document (epubcheck OPF-032)',
    epub: buildEpub2({
      files: {
        'EPUB/package.opf': OPF2
          .replace('</manifest>', '<item id="img" href="cover.gif" media-type="image/gif"/></manifest>')
          .replace('href="content_001.xhtml"/></guide>', 'href="cover.gif"/></guide>'),
        'EPUB/cover.gif': 'GIF89a',
      },
    }),
    expected: [E('OPF-032', 'ERROR')],
  },
  {
    name: 'opf2-spine-duplicate',
    area: 'opf',
    description: 'spine references the same manifest item twice (epubcheck OPF-034)',
    epub: buildEpub2({ files: { 'EPUB/package.opf': OPF2.replace('<itemref idref="content"/>', '<itemref idref="content"/><itemref idref="content"/>') } }),
    expected: [E('OPF-034', 'ERROR')],
  },
  {
    name: 'opf2-text-html',
    area: 'opf',
    description: 'manifest item with text/html media type (epubcheck OPF-035, warning)',
    epub: buildEpub2({
      files: {
        'EPUB/package.opf': OPF2.replace('</manifest>', '<item id="html" href="old.html" media-type="text/html"/></manifest>'),
        'EPUB/old.html': CONTENT,
      },
    }),
    expected: [E('OPF-035', 'WARNING')],
  },
  {
    name: 'opf2-deprecated-type',
    area: 'opf',
    description: 'manifest item with deprecated text/x-oeb1-css media type (epubcheck OPF-037, warning)',
    epub: buildEpub2({
      files: {
        'EPUB/package.opf': OPF2.replace('</manifest>', '<item id="oeb" href="old.css" media-type="text/x-oeb1-css"/></manifest>'),
        'EPUB/old.css': 'p { color: black }',
      },
    }),
    expected: [E('OPF-037', 'WARNING')],
  },
  {
    name: 'opf2-spine-image',
    area: 'opf',
    description: 'image media type in the spine (epubcheck OPF-042)',
    epub: buildEpub2({
      files: {
        'EPUB/package.opf': OPF2
          .replace('</manifest>', '<item id="img" href="cover.gif" media-type="image/gif"/></manifest>')
          .replace('<itemref idref="content"/>', '<itemref idref="content"/><itemref idref="img"/>'),
        'EPUB/cover.gif': 'GIF89a',
      },
    }),
    expected: [E('OPF-042', 'ERROR')],
  },
  {
    name: 'opf2-spine-foreign-no-fallback',
    area: 'opf',
    description: 'foreign spine item without fallback (epubcheck OPF-043)',
    epub: buildEpub2({
      files: {
        'EPUB/package.opf': OPF2
          .replace('</manifest>', '<item id="pdf" href="doc.pdf" media-type="application/pdf"/></manifest>')
          .replace('<itemref idref="content"/>', '<itemref idref="content"/><itemref idref="pdf"/>'),
        'EPUB/doc.pdf': '%PDF-1.4',
      },
    }),
    expected: [E('OPF-043', 'ERROR')],
  },
  {
    name: 'opf2-spine-foreign-bad-fallback',
    area: 'opf',
    description: 'foreign spine item whose fallback chain never reaches a content document (epubcheck OPF-044)',
    epub: buildEpub2({
      files: {
        'EPUB/package.opf': OPF2
          .replace(
            '</manifest>',
            '<item id="pdf" href="doc.pdf" media-type="application/pdf" fallback="img"/>' +
              '<item id="img" href="cover.gif" media-type="image/gif"/></manifest>',
          )
          .replace('<itemref idref="content"/>', '<itemref idref="content"/><itemref idref="pdf"/>'),
        'EPUB/doc.pdf': '%PDF-1.4',
        'EPUB/cover.gif': 'GIF89a',
      },
    }),
    expected: [E('OPF-044', 'ERROR')],
  },
  {
    name: 'opf2-fallback-unresolved',
    area: 'opf',
    description: 'fallback idref not in the manifest (epubcheck OPF-040; the dangling chain also fails the content-document requirement → OPF-044)',
    epub: buildEpub2({
      files: {
        'EPUB/package.opf': OPF2
          .replace('</manifest>', '<item id="pdf" href="doc.pdf" media-type="application/pdf" fallback="ghost"/></manifest>')
          .replace('<itemref idref="content"/>', '<itemref idref="content"/><itemref idref="pdf"/>'),
        'EPUB/doc.pdf': '%PDF-1.4',
      },
    }),
    expected: [E('OPF-040', 'ERROR'), E('OPF-044', 'ERROR')],
  },
  {
    name: 'opf2-spine-toc-missing',
    area: 'opf',
    description: 'EPUB 2 spine without the required toc attribute (schema-level, epubcheck RSC-005; NCX still found by media type)',
    epub: buildEpub2({ files: { 'EPUB/package.opf': OPF2.replace('<spine toc="ncx">', '<spine>') } }),
    expected: [E('RSC-005', 'ERROR')],
  },
  {
    name: 'opf2-toc-not-ncx',
    area: 'opf',
    description: 'spine toc idref resolves to a non-NCX item (epubcheck OPF-050); the non-NCX target is not parsed as an NCX (jar emits CHK-008 + OPF-050, no navMap RSC-005)',
    epub: buildEpub2({ files: { 'EPUB/package.opf': OPF2.replace('<spine toc="ncx">', '<spine toc="content">') } }),
    expected: [E('OPF-050', 'ERROR')],
  },
  {
    name: 'opf2-meta-property',
    area: 'opf',
    description:
      'EPUB 3 style <meta property> in an OPF 2.0 package: unknown attribute, missing name/content, ' +
      'and text in an empty content model (epubcheck opf20.rng, three RSC-005s)',
    epub: buildEpub2({
      files: {
        'EPUB/package.opf': OPF2.replace(
          '</metadata>',
          '<meta property="dcterms:modified">2020-01-01T00:00:00Z</meta></metadata>',
        ),
      },
    }),
    expected: [E('RSC-005', 'ERROR'), E('RSC-005', 'ERROR'), E('RSC-005', 'ERROR')],
  },
  {
    name: 'opf2-meta-valid',
    area: 'opf',
    description: 'a well-formed OPF 2.0 meta (name + content) stays valid — the pair to opf2-meta-property',
    epub: buildEpub2({
      files: {
        'EPUB/package.opf': OPF2.replace('</metadata>', '<meta name="calibre:series" content="X"/></metadata>'),
      },
    }),
    expected: [],
  },
  {
    name: 'opf3-meta-opf2-style',
    area: 'opf',
    description:
      'an OPF 2.0 style meta in an EPUB 3 package stays valid; the OPF 2.0 content model must not leak into 3.x ' +
      '(the EPUB 3 <meta property> case is covered by the "minimal" baseline)',
    epub: buildEpub({
      files: { 'EPUB/package.opf': OPF.replace('</metadata>', '<meta name="calibre:series" content="X"/></metadata>') },
    }),
    expected: [],
  },
  {
    name: 'opf-manifest-self',
    area: 'opf',
    description: 'manifest lists the package document itself (epubcheck OPF-099; version-agnostic, EPUB 3 fixture)',
    epub: buildEpub({
      files: {
        'EPUB/package.opf': OPF.replace('</manifest>', '<item id="self" href="package.opf" media-type="application/oebps-package+xml"/></manifest>'),
      },
    }),
    expected: [E('OPF-099', 'ERROR')],
  },

  // ---- EPUB 2 content layer ----
  {
    name: 'epub2-remote-image',
    area: 'content',
    description: 'remote image reference in an EPUB 2 content doc (epubcheck RSC-006; remote publication resources are forbidden in EPUB 2)',
    epub: buildEpub2({
      files: {
        'EPUB/content_001.xhtml':
          '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>' +
          '<img src="https://example.com/x.png" alt="x"/></body></html>',
      },
    }),
    expected: [E('RSC-006', 'ERROR')],
  },

  // ---- EPUB 3 legacy NCX ----
  {
    name: 'epub3-legacy-ncx-broken',
    area: 'ncx',
    description: 'EPUB 3 book shipping a legacy NCX with a mismatched dtb:uid (epubcheck NCX-001 fires for EPUB 3 too)',
    epub: buildEpub({
      files: {
        'EPUB/package.opf': OPF.replace('</manifest>', '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest>'),
        'EPUB/toc.ncx': NCX2.replace('urn:uuid:00000000-0000-0000-0000-000000000000', 'urn:uuid:mismatch'),
      },
    }),
    expected: [E('NCX-001', 'ERROR')],
  },

  // ---- OPF 2.0 content model (schema layer) ----
  {
    name: 'realistic calibre metadata is clean',
    area: 'opf2-schema',
    description: 'calibre-style opf:file-as/opf:role and a bare-year dc:date produce no false positives (valid)',
    epub: schemaEpub2(
      `${S_IDENT}${S_TITLE}${S_LANG}`,
      `${S_TITLE}<dc:creator opf:file-as="Doe, Jane" opf:role="aut">Jane Doe</dc:creator>` +
        `<dc:contributor opf:file-as="calibre" opf:role="bkp">calibre (3.48.0)</dc:contributor>` +
        `<dc:date>2019-01-01T00:00:00+00:00</dc:date>${S_LANG}` +
        `<dc:identifier id="uid" opf:scheme="uuid">urn:uuid:00000000-0000-0000-0000-000000000000</dc:identifier>` +
        `<meta name="calibre:timestamp" content="2019-01-01T00:00:00+00:00"/>` +
        `<meta name="cover" content="content"/>`,
    ),
    expected: [],
  },
  {
    name: 'realistic sigil metadata is clean',
    area: 'opf2-schema',
    description: 'Sigil-style dc:creator/dc:date/dc:rights/dc:subject metadata produces no false positives (valid)',
    epub: schemaEpub2(
      `${S_IDENT}${S_TITLE}${S_LANG}`,
      `${S_IDENT}${S_TITLE}${S_LANG}<dc:creator opf:role="aut">Jane Doe</dc:creator>` +
        `<dc:publisher>Pub</dc:publisher><dc:date opf:event="publication">2019</dc:date>` +
        `<dc:rights>All rights reserved</dc:rights><dc:subject>Fiction</dc:subject>`,
    ),
    expected: [],
  },
  {
    name: 'foreign-namespace metadata child is clean',
    area: 'opf2-schema',
    description: 'a foreign-namespace element (e.g. dcterms:modified) inside metadata matches the wildcard (valid)',
    epub: schemaEpub2(S_TITLE, `${S_TITLE}<dcterms:modified xmlns:dcterms="http://purl.org/dc/terms/">2019-01-01T00:00:00Z</dcterms:modified>`),
    expected: [],
  },
  {
    name: 'metadata children in any order are clean',
    area: 'opf2-schema',
    description: 'dc:identifier/dc:title/dc:language may appear in any order in OPF 2.0 metadata (valid)',
    epub: schemaEpub2(`${S_IDENT}${S_TITLE}${S_LANG}`, `${S_LANG}${S_TITLE}${S_IDENT}`),
    expected: [],
  },
  {
    name: 'unknown guide reference type is clean',
    area: 'opf2-schema',
    description: 'guide reference@type accepts any string, so an unrecognised value is schema-valid (valid)',
    epub: schemaEpub2(S_GUIDE, '<guide><reference type="banana" href="content_001.xhtml"/></guide>'),
    expected: [],
  },
  {
    name: 'tours are clean',
    area: 'opf2-schema',
    description: 'a well-formed tours/tour/site block is schema-valid (valid)',
    epub: schemaEpub2(
      S_GUIDE,
      `<tours><tour id="t1" title="Tour"><site title="S" href="content_001.xhtml"/></tour></tours>${S_GUIDE}`,
    ),
    expected: [],
  },
  {
    name: 'opf:file-as on dc:title is rejected',
    area: 'opf2-schema',
    description: 'opf:file-as is not allowed on dc:title, only on dc:creator/dc:contributor (epubcheck RSC-005)',
    epub: schemaEpub2(S_TITLE, '<dc:title opf:file-as="Title, The">Title</dc:title>'),
    expected: [E('RSC-005', 'ERROR')],
  },
  {
    name: 'dc:language xml:lang is rejected',
    area: 'opf2-schema',
    description: 'dc:language does not accept xml:lang, unlike the other rich dc:* elements (epubcheck RSC-005)',
    epub: schemaEpub2(S_LANG, '<dc:language xml:lang="en">en</dc:language>'),
    expected: [E('RSC-005', 'ERROR')],
  },
  {
    name: 'empty dc:identifier is rejected',
    area: 'opf2-schema',
    description:
      'an empty dc:identifier fails its non-empty-string content model (epubcheck RSC-005). A second, ' +
      'unlabelled dc:identifier is left empty rather than the unique-identifier one, so the fixture isolates ' +
      'the content-model failure from the unrelated NCX-001 identifier-match check (see task report).',
    epub: schemaEpub2(S_IDENT, `${S_IDENT}<dc:identifier></dc:identifier>`),
    expected: [E('RSC-005', 'ERROR')],
  },
  {
    name: 'missing dc:title is reported once',
    area: 'opf2-schema',
    description: 'metadata with no dc:title reports exactly one missing-required-element message (epubcheck RSC-005)',
    epub: schemaEpub2(S_TITLE, ''),
    expected: [E('RSC-005', 'ERROR')],
  },
  {
    name: 'item properties attribute is rejected',
    area: 'opf2-schema',
    description: 'the OPF 2.0 item element has no properties attribute — that is an EPUB 3 addition (epubcheck RSC-005)',
    epub: schemaEpub2(S_ITEM, S_ITEM.replace('/>', ' properties="nav"/>')),
    expected: [E('RSC-005', 'ERROR')],
  },
  {
    name: 'itemref linear value is enumerated',
    area: 'opf2-schema',
    description: 'itemref@linear only accepts "yes"/"no" (epubcheck RSC-005)',
    epub: schemaEpub2('<itemref idref="content"/>', '<itemref idref="content" linear="maybe"/>'),
    expected: [E('RSC-005', 'ERROR')],
  },
  {
    name: 'spine missing toc',
    area: 'opf2-schema',
    description: 'the EPUB 2 spine requires a toc attribute (epubcheck RSC-005)',
    epub: schemaEpub2('<spine toc="ncx">', '<spine>'),
    expected: [E('RSC-005', 'ERROR')],
  },
  {
    name: 'guide reference missing type',
    area: 'opf2-schema',
    description: 'guide reference requires a type attribute (epubcheck RSC-005)',
    epub: schemaEpub2(S_GUIDE, '<guide><reference title="T" href="content_001.xhtml"/></guide>'),
    expected: [E('RSC-005', 'ERROR')],
  },
  {
    name: 'tour missing title',
    area: 'opf2-schema',
    description: 'tour requires a title attribute (epubcheck RSC-005)',
    epub: schemaEpub2(
      S_GUIDE,
      `<tours><tour><site title="S" href="content_001.xhtml"/></tour></tours>${S_GUIDE}`,
    ),
    expected: [E('RSC-005', 'ERROR')],
  },
  {
    name: 'duplicate guide reference warns',
    area: 'opf2-schema',
    description:
      'two guide references sharing type+href warn once per participating element (epubcheck RSC-017); ' +
      'the jar aggregates the pair into one message with two locations, which the multiset here expands to two',
    epub: schemaEpub2(
      S_GUIDE,
      '<guide><reference type="text" title="T" href="content_001.xhtml"/>' +
        '<reference type="TEXT" title="T2" href="content_001.xhtml"/></guide>',
    ),
    expected: [E('RSC-017', 'WARNING'), E('RSC-017', 'WARNING')],
  },
  {
    name: 'guide before spine breaks package order',
    area: 'opf2-schema',
    description:
      'guide arriving before the required spine is reported as premature, and the spine that follows finds ' +
      'nothing left to expect but its own end-tag (epubcheck RSC-005 x2)',
    epub: schemaEpub2(
      `<spine toc="ncx"><itemref idref="content"/></spine>${S_GUIDE}`,
      `${S_GUIDE}<spine toc="ncx"><itemref idref="content"/></spine>`,
    ),
    expected: [E('RSC-005', 'ERROR'), E('RSC-005', 'ERROR')],
  },
  {
    name: 'package epub3 i18n attrs on an OPF 2.0 package is rejected',
    area: 'opf2-schema',
    description: 'dir/xml:lang on package are an EPUB 3 addition, not present in the OPF 2.0 package content model (epubcheck RSC-005 x2)',
    epub: schemaEpub2('version="2.0"', 'version="2.0" dir="ltr" xml:lang="en"'),
    expected: [E('RSC-005', 'ERROR'), E('RSC-005', 'ERROR')],
  },
  {
    name: 'dc:creator unprefixed role is rejected',
    area: 'opf2-schema',
    description: 'dc:creator only accepts the opf:role attribute, not a bare unprefixed role (epubcheck RSC-005)',
    epub: schemaEpub2(S_TITLE, `${S_TITLE}<dc:creator role="aut">J D</dc:creator>`),
    expected: [E('RSC-005', 'ERROR')],
  },

  // ---- package-30 content model (schema layer) ----
  {
    name: 'legacy name/content meta is clean in EPUB 3',
    area: 'opf3-schema',
    description: 'the OPF 2.0 style name/content meta form is still accepted alongside EPUB 3 property meta (valid)',
    epub: buildEpub({
      files: {
        'EPUB/package.opf': OPF.replace('</metadata>', '<meta name="cover" content="content"/></metadata>'),
      },
    }),
    expected: [],
  },
  {
    name: 'metadata link is clean',
    area: 'opf3-schema',
    description:
      'a well-formed metadata link element is schema-valid (valid). The jar additionally emits OPF-028 ' +
      '(undeclared "cc" prefix) here, which we do not implement, so our expected output stays empty.',
    epub: buildEpub({
      files: {
        'EPUB/package.opf': OPF.replace(
          '</metadata>',
          '<link rel="cc:license" href="http://example.com/l"/></metadata>',
        ),
      },
    }),
    expected: [],
  },
  {
    name: 'page-progression-direction is clean',
    area: 'opf3-schema',
    description: 'spine@page-progression-direction is a valid EPUB 3 attribute (valid)',
    epub: buildEpub({
      files: { 'EPUB/package.opf': OPF.replace('<spine>', '<spine page-progression-direction="rtl">') },
    }),
    expected: [],
  },
  {
    name: 'unknown attribute on item is rejected',
    area: 'opf3-schema',
    description: 'an unrecognised attribute on manifest item is rejected (epubcheck RSC-005)',
    epub: buildEpub({
      files: { 'EPUB/package.opf': OPF.replace('properties="nav"', 'properties="nav" bogus="x"') },
    }),
    expected: [E('RSC-005', 'ERROR')],
  },
  {
    name: 'dir outside its enumeration is rejected',
    area: 'opf3-schema',
    description: 'dir only accepts "ltr", "rtl" or "auto" (epubcheck RSC-005)',
    epub: buildEpub({
      files: { 'EPUB/package.opf': OPF.replace('<dc:title>Title</dc:title>', '<dc:title dir="sideways">Title</dc:title>') },
    }),
    expected: [E('RSC-005', 'ERROR')],
  },
  {
    name: 'epub3 itemref linear value is enumerated',
    area: 'opf3-schema',
    description: 'itemref@linear only accepts "yes"/"no" in package-30 too (epubcheck RSC-005)',
    epub: buildEpub({
      files: { 'EPUB/package.opf': OPF.replace('<itemref idref="content"/>', '<itemref idref="content" linear="maybe"/>') },
    }),
    expected: [E('RSC-005', 'ERROR')],
  },
  {
    name: 'epub3 meta unknown attribute is rejected',
    area: 'opf3-schema',
    description: 'an unrecognised attribute on an EPUB 3 property meta is rejected (epubcheck RSC-005)',
    epub: buildEpub({
      files: {
        'EPUB/package.opf': OPF.replace(
          '<meta property="dcterms:modified">2020-01-01T00:00:00Z</meta>',
          '<meta property="dcterms:modified" bogus="x">2020-01-01T00:00:00Z</meta>',
        ),
      },
    }),
    expected: [E('RSC-005', 'ERROR')],
  },
  {
    name: 'epub3 link missing rel is rejected',
    area: 'opf3-schema',
    description: 'metadata link requires a rel attribute (epubcheck RSC-005)',
    epub: buildEpub({
      files: {
        'EPUB/package.opf': OPF.replace('</metadata>', '<link href="http://example.com/l"/></metadata>'),
      },
    }),
    expected: [E('RSC-005', 'ERROR')],
  },
]
