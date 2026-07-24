import {
  TEXT, all, attribute, choice, data, element, name, oneOrMore, optional,
  ref, seq, zeroOrMore, type Pattern,
} from './pattern.js'
import { DT_ANY_URI, DT_ID, DT_IDREF, DT_NON_EMPTY, dtEnum } from './datatypes.js'
import { makeGrammar, type Grammar } from './validate.js'

/**
 * EPUB 3 package documents, transcribed from
 * `com/adobe/epubcheck/schema/30/package-30.rnc` as bundled in EPUBCheck 5.3.0.
 * Definition names mirror the RNC's so the two can be diffed by eye.
 *
 * `datatype.property`, `datatype.properties`, `datatype.mimetype` and
 * `datatype.languagecode` are all treated as free text; see the containment rule.
 */

const OPF = 'http://www.idpf.org/2007/opf'
const DC = 'http://purl.org/dc/elements/1.1/'
const XML = 'http://www.w3.org/XML/1998/namespace'

const opfEl = (local: string, p: Pattern) => element(name(OPF, local, local), p)
const dcEl = (local: string, p: Pattern) => element(name(DC, local, `dc:${local}`), p)
const attr = (local: string, p: Pattern) => attribute(name(undefined, local, local), p)

const optId = optional(attr('id', data(DT_ID)))
/** `opf.i18n.attrs` */
const i18n = all(
  optional(attribute(name(XML, 'lang', 'xml:lang'), TEXT)),
  optional(attr('dir', data(dtEnum(['ltr', 'rtl', 'auto'])))),
)
const optProperties = optional(attr('properties', TEXT))
const optRefines = optional(attr('refines', data(DT_ANY_URI)))

/** `opf.dc.attlist` */
const dcAttlist = all(optId, i18n)
const NONEMPTY = data(DT_NON_EMPTY)

const dcIdentifier = dcEl('identifier', all(optId, NONEMPTY))
const dcTitle = dcEl('title', all(dcAttlist, NONEMPTY))
const dcLanguage = dcEl('language', all(optId, NONEMPTY))
const dcDate = dcEl('date', all(optId, NONEMPTY))
const dcSimple = (local: string) => dcEl(local, all(optId, NONEMPTY))
const dcRich = (local: string) => dcEl(local, all(dcAttlist, NONEMPTY))

/** `opf.dc.elems` — an interleave, so order is free. */
const dcElems = all(
  oneOrMore(dcIdentifier),
  oneOrMore(dcTitle),
  oneOrMore(dcLanguage),
  optional(dcDate),
  zeroOrMore(dcRich('source')),
  zeroOrMore(dcSimple('type')),
  zeroOrMore(dcSimple('format')),
  zeroOrMore(dcRich('creator')),
  zeroOrMore(dcRich('subject')),
  zeroOrMore(dcRich('description')),
  zeroOrMore(dcRich('publisher')),
  zeroOrMore(dcRich('contributor')),
  zeroOrMore(dcRich('relation')),
  zeroOrMore(dcRich('coverage')),
  zeroOrMore(dcRich('rights')),
)

/** `opf.epub3.meta.content` */
const epub3Meta = all(
  attr('property', TEXT),
  optRefines,
  optId,
  optional(attr('scheme', TEXT)),
  i18n,
  NONEMPTY,
)
/** `opf.epub2.meta.content` — the legacy form. */
const epub2Meta = all(attr('name', TEXT), attr('content', TEXT))
const meta = opfEl('meta', choice(epub3Meta, epub2Meta))

const link = opfEl(
  'link',
  all(
    attr('href', data(DT_ANY_URI)),
    optional(attr('hreflang', TEXT)),
    attr('rel', TEXT),
    optId,
    optRefines,
    optional(attr('media-type', TEXT)),
    optProperties,
  ),
)

const metadata = opfEl('metadata', all(optId, i18n, dcElems, zeroOrMore(meta), zeroOrMore(link)))

const item = opfEl(
  'item',
  all(
    attr('id', data(DT_ID)),
    attr('href', data(DT_ANY_URI)),
    attr('media-type', TEXT),
    optional(attr('fallback', data(DT_IDREF))),
    optional(attr('media-overlay', data(DT_IDREF))),
    optProperties,
  ),
)
const manifest = opfEl('manifest', all(optId, oneOrMore(item)))

const itemref = opfEl(
  'itemref',
  all(
    attr('idref', data(DT_IDREF)),
    optional(attr('linear', data(dtEnum(['yes', 'no'])))),
    optId,
    optProperties,
  ),
)
const spine = opfEl(
  'spine',
  all(
    optId,
    optional(attr('toc', data(DT_IDREF))),
    optional(attr('page-progression-direction', data(dtEnum(['ltr', 'rtl', 'default'])))),
    oneOrMore(itemref),
  ),
)

const reference = opfEl(
  'reference',
  all(attr('href', data(DT_ANY_URI)), attr('type', TEXT), optional(attr('title', TEXT))),
)
const guide = opfEl('guide', oneOrMore(reference))

const mediaType = opfEl('mediaType', all(attr('media-type', TEXT), attr('handler', data(DT_IDREF))))
const bindings = opfEl('bindings', oneOrMore(mediaType))

/** `opf.collection` is the one recursive production, hence the `ref` indirection. */
const collectionLink = opfEl(
  'link',
  all(attr('href', data(DT_ANY_URI)), optional(attr('rel', TEXT)), optId, optional(attr('media-type', TEXT))),
)
const collectionMetadata = opfEl(
  'metadata',
  all(
    optId,
    i18n,
    all(
      zeroOrMore(dcIdentifier), zeroOrMore(dcTitle), zeroOrMore(dcLanguage), zeroOrMore(dcDate),
      zeroOrMore(dcRich('source')), zeroOrMore(dcSimple('type')), zeroOrMore(dcSimple('format')),
      zeroOrMore(dcRich('creator')), zeroOrMore(dcRich('subject')), zeroOrMore(dcRich('description')),
      zeroOrMore(dcRich('publisher')), zeroOrMore(dcRich('contributor')), zeroOrMore(dcRich('relation')),
      zeroOrMore(dcRich('coverage')), zeroOrMore(dcRich('rights')),
    ),
    zeroOrMore(opfEl('meta', epub3Meta)),
    zeroOrMore(link),
  ),
)
const collectionRef: Pattern = ref(() => collection)
const collection: Pattern = opfEl(
  'collection',
  all(
    all(optId, i18n, attr('role', TEXT)),
    seq(
      optional(collectionMetadata),
      choice(oneOrMore(collectionRef), seq(zeroOrMore(collectionRef), oneOrMore(collectionLink))),
    ),
  ),
)

const pkg = opfEl(
  'package',
  all(
    attr('version', data(dtEnum(['3.0']))),
    attr('unique-identifier', data(DT_IDREF)),
    optId,
    optional(attr('prefix', TEXT)),
    i18n,
    seq(metadata, manifest, spine, optional(guide), optional(bindings), zeroOrMore(collection)),
  ),
)

export const PACKAGE30: Grammar = makeGrammar(pkg)
