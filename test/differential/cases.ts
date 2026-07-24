import { buildEpub, buildEpub2, OPF, OPF2 } from '../fixtures/build.js'
import type { DiffCase } from './harness.js'

const NS_ALL =
  'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf" ' +
  'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"'

/** OPF2 with opf:/xsi: declared, then `find` replaced by `repl`. */
function opf2(find: string, repl: string): Uint8Array {
  const base = OPF2.replace('xmlns:dc="http://purl.org/dc/elements/1.1/"', NS_ALL)
  if (!base.includes(find)) throw new Error(`OPF2 does not contain: ${find}`)
  return buildEpub2({ files: { 'EPUB/package.opf': base.replace(find, repl) } })
}

function opf3(find: string, repl: string): Uint8Array {
  if (!OPF.includes(find)) throw new Error(`OPF does not contain: ${find}`)
  return buildEpub({ files: { 'EPUB/package.opf': OPF.replace(find, repl) } })
}

const TITLE = '<dc:title>Title</dc:title>'
const IDENT = '<dc:identifier id="uid">urn:uuid:00000000-0000-0000-0000-000000000000</dc:identifier>'
const LANG = '<dc:language>en</dc:language>'
const ITEM = '<item id="content" href="content_001.xhtml" media-type="application/xhtml+xml"/>'
const GUIDE = '<guide><reference type="text" title="Text" href="content_001.xhtml"/></guide>'

export const CASES: DiffCase[] = [
  { name: 'epub2 baseline', epub: buildEpub2() },
  { name: 'epub3 baseline', epub: buildEpub() },

  // package
  { name: 'package unknown attr', epub: opf2('version="2.0"', 'version="2.0" prefix="foo: http://x"') },
  { name: 'package epub3 i18n attrs', epub: opf2('version="2.0"', 'version="2.0" dir="ltr" xml:lang="en"') },
  { name: 'package no unique-identifier', epub: opf2(' unique-identifier="uid"', '') },

  // dc:* attribute models
  { name: 'dc:creator opf:role + opf:file-as', epub: opf2(TITLE, `${TITLE}<dc:creator opf:role="aut" opf:file-as="D, J">J D</dc:creator>`) },
  { name: 'dc:date opf:event', epub: opf2(TITLE, `${TITLE}<dc:date opf:event="publication">2001-01-01</dc:date>`) },
  { name: 'dc:identifier opf:scheme', epub: opf2(IDENT, '<dc:identifier id="uid" opf:scheme="uuid">urn:uuid:00000000-0000-0000-0000-000000000000</dc:identifier>') },
  { name: 'dc:subject opf:authority', epub: opf2(TITLE, `${TITLE}<dc:subject opf:authority="BISAC">FIC000000</dc:subject>`) },
  { name: 'dc:title opf:file-as', epub: opf2(TITLE, '<dc:title opf:file-as="Title, The">Title</dc:title>') },
  { name: 'dc:creator unprefixed role', epub: opf2(TITLE, `${TITLE}<dc:creator role="aut">J D</dc:creator>`) },
  { name: 'dc:language xml:lang', epub: opf2(LANG, '<dc:language xml:lang="en">en</dc:language>') },
  { name: 'dc:identifier empty', epub: opf2(IDENT, '<dc:identifier id="uid"></dc:identifier>') },
  { name: 'dc:isbn unknown element', epub: opf2(TITLE, `${TITLE}<dc:isbn>123</dc:isbn>`) },
  { name: 'dc:title child element', epub: opf2(TITLE, '<dc:title>Title<b>x</b></dc:title>') },
  { name: 'dc:creator attr order probe A', epub: opf2(TITLE, `${TITLE}<dc:creator opf:file-as="D" bogus="x" opf:role="aut">J</dc:creator>`) },
  { name: 'dc:creator attr order probe B', epub: opf2(TITLE, `${TITLE}<dc:creator bogus="x" opf:file-as="D" opf:role="aut">J</dc:creator>`) },

  // meta — the PR #28 regression pair
  { name: 'meta property first', epub: opf2(TITLE, `${TITLE}<meta property="dcterms:modified" name="n" content="c"/>`) },
  { name: 'meta property last', epub: opf2(TITLE, `${TITLE}<meta name="n" content="c" property="dcterms:modified"/>`) },
  { name: 'meta bare property', epub: opf2(TITLE, `${TITLE}<meta property="dcterms:modified">2020-01-01T00:00:00Z</meta>`) },
  { name: 'meta valid', epub: opf2(TITLE, `${TITLE}<meta name="cover" content="content"/>`) },

  // manifest / item
  { name: 'item properties', epub: opf2(ITEM, ITEM.replace('/>', ' properties="nav"/>')) },
  { name: 'item missing media-type', epub: opf2(ITEM, '<item id="content" href="content_001.xhtml"/>') },
  { name: 'item missing id and href', epub: opf2(ITEM, '<item media-type="application/xhtml+xml"/>') },
  { name: 'item required-modules alone', epub: opf2(ITEM, ITEM.replace('/>', ' required-modules="mod"/>')) },
  { name: 'item text content', epub: opf2(ITEM, ITEM.replace('/>', '>x</item>')) },
  { name: 'item id not an NCName', epub: opf2(ITEM, ITEM.replace('id="content"', 'id="1"')) },
  { name: 'manifest unknown attr', epub: opf2('<manifest>', '<manifest foo="1">') },
  { name: 'manifest non-item child', epub: opf2('<manifest>', '<manifest><bogus/>') },
  { name: 'duplicate id', epub: opf2(ITEM, ITEM.replace('id="content"', 'id="ncx"')) },

  // spine / itemref
  { name: 'spine missing toc', epub: opf2('<spine toc="ncx">', '<spine>') },
  { name: 'itemref properties', epub: opf2('<itemref idref="content"/>', '<itemref idref="content" properties="page-spread-left"/>') },
  { name: 'itemref linear invalid', epub: opf2('<itemref idref="content"/>', '<itemref idref="content" linear="maybe"/>') },
  { name: 'itemref missing idref', epub: opf2('<itemref idref="content"/>', '<itemref/>') },
  { name: 'spine empty', epub: opf2('<itemref idref="content"/>', '') },
  { name: 'spine non-itemref child', epub: opf2('<itemref idref="content"/>', '<itemref idref="content"/><bogus/>') },

  // guide / reference / tours
  { name: 'reference unknown type', epub: opf2(GUIDE, '<guide><reference type="banana" title="B" href="content_001.xhtml"/></guide>') },
  { name: 'reference no title', epub: opf2(GUIDE, '<guide><reference type="text" href="content_001.xhtml"/></guide>') },
  { name: 'reference missing type', epub: opf2(GUIDE, '<guide><reference title="T" href="content_001.xhtml"/></guide>') },
  { name: 'guide empty', epub: opf2(GUIDE, '<guide></guide>') },
  { name: 'duplicate reference', epub: opf2(GUIDE, '<guide><reference type="text" title="T" href="content_001.xhtml"/><reference type="TEXT" title="T2" href="content_001.xhtml"/></guide>') },
  { name: 'tours valid', epub: opf2(GUIDE, `<tours><tour id="t1" title="Tour"><site title="S" href="content_001.xhtml"/></tour></tours>${GUIDE}`) },
  { name: 'tours empty', epub: opf2(GUIDE, `<tours></tours>${GUIDE}`) },
  { name: 'tour missing title', epub: opf2(GUIDE, `<tours><tour><site title="S" href="content_001.xhtml"/></tour></tours>${GUIDE}`) },

  // ordering
  { name: 'guide before spine', epub: opf2(`<spine toc="ncx"><itemref idref="content"/></spine>${GUIDE}`, `${GUIDE}<spine toc="ncx"><itemref idref="content"/></spine>`) },
  { name: 'tours after guide', epub: opf2(GUIDE, `${GUIDE}<tours><tour title="T"><site title="S" href="content_001.xhtml"/></tour></tours>`) },
  { name: 'unknown top-level element', epub: opf2('</package>', '<bogus/></package>') },
  { name: 'foreign-ns top-level element', epub: opf2('</package>', '<x:foo xmlns:x="http://example.com/x"/></package>') },

  // metadata model
  { name: 'metadata shuffled order', epub: opf2(`${IDENT}${TITLE}${LANG}`, `${LANG}${TITLE}${IDENT}`) },
  { name: 'metadata foreign-ns child', epub: opf2(TITLE, `${TITLE}<x:foo xmlns:x="http://example.com/x">v</x:foo>`) },
  { name: 'metadata no dc:title', epub: opf2(TITLE, '') },
  { name: 'metadata empty', epub: opf2(`${IDENT}${TITLE}${LANG}`, '') },

  // EPUB 3
  { name: 'epub3 item unknown attr', epub: opf3('media-type="application/xhtml+xml" properties="nav"', 'media-type="application/xhtml+xml" properties="nav" bogus="x"') },
  { name: 'epub3 dir invalid', epub: opf3('<dc:title>Title</dc:title>', '<dc:title dir="sideways">Title</dc:title>') },
  { name: 'epub3 legacy name/content meta', epub: opf3('</metadata>', '<meta name="cover" content="content"/></metadata>') },
  { name: 'epub3 spine ppd', epub: opf3('<spine>', '<spine page-progression-direction="rtl">') },
  { name: 'epub3 link element', epub: opf3('</metadata>', '<link rel="cc:license" href="http://example.com/l"/></metadata>') },
  { name: 'epub3 no dc:title', epub: opf3('<dc:title>Title</dc:title>', '') },

  // vendor-realistic (must stay clean)
  ...realistic(),
]

/** Realistic producer output. These must report zero messages from both validators. */
function realistic(): DiffCase[] {
  const uid = '<dc:identifier id="uid" opf:scheme="uuid">urn:uuid:00000000-0000-0000-0000-000000000000</dc:identifier>'
  return [
    {
      name: 'realistic calibre',
      epub: opf2(
        `${IDENT}${TITLE}${LANG}`,
        `${TITLE}<dc:creator opf:file-as="Doe, Jane" opf:role="aut">Jane Doe</dc:creator>` +
          `<dc:contributor opf:file-as="calibre" opf:role="bkp">calibre (3.48.0)</dc:contributor>` +
          `<dc:date>2019-01-01T00:00:00+00:00</dc:date>${LANG}${uid}` +
          `<meta name="calibre:timestamp" content="2019-01-01T00:00:00+00:00"/>` +
          `<meta name="cover" content="content"/>`,
      ),
    },
    {
      name: 'realistic sigil',
      epub: opf2(
        `${IDENT}${TITLE}${LANG}`,
        `${uid}${TITLE}${LANG}<dc:creator opf:role="aut">Jane Doe</dc:creator>` +
          `<dc:publisher>Pub</dc:publisher><dc:date opf:event="publication">2019</dc:date>` +
          `<dc:rights>All rights reserved</dc:rights><dc:subject>Fiction</dc:subject>`,
      ),
    },
    {
      name: 'realistic indesign',
      epub: opf2(
        `${IDENT}${TITLE}${LANG}`,
        `${uid}${TITLE}${LANG}<dc:creator>Jane Doe</dc:creator>` +
          `<dc:date xsi:type="dcterms:W3CDTF">2019-01-01</dc:date>` +
          `<meta name="cover" content="content"/>`,
      ),
    },
  ]
}
