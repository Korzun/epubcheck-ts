import {
  TEXT, all, attribute, anyNameExcept, choice, data, element, name, oneOrMore,
  optional, ref, seq, zeroOrMore, type Pattern,
} from './pattern.js'
import { DT_ANY_URI, DT_ID, DT_IDREF, DT_NON_EMPTY, dtEnum } from './datatypes.js'
import { makeGrammar, type Grammar } from './validate.js'

/**
 * OPF 2.0, transcribed from `com/adobe/epubcheck/schema/20/rng/opf20.rng`
 * (revision 20070222) as bundled in EPUBCheck 5.3.0. Definition names below mirror
 * the RNG's `define` names so the two can be diffed by eye.
 */

const OPF = 'http://www.idpf.org/2007/opf'
const DC = 'http://purl.org/dc/elements/1.1/'
const XML = 'http://www.w3.org/XML/1998/namespace'
const XSI = 'http://www.w3.org/2001/XMLSchema-instance'
const OEB = 'http://openebook.org/namespaces/oeb-package/1.0/'

const opfEl = (local: string, p: Pattern) => element(name(OPF, local, local), p)
const dcEl = (local: string, p: Pattern) => element(name(DC, local, `dc:${local}`), p)

/** Attributes are unprefixed unless the RNG gives them an `ns`. */
const attr = (local: string, p: Pattern) => attribute(name(undefined, local, local), p)
const optId = optional(attr('id', data(DT_ID)))
const optXmlLang = optional(attribute(name(XML, 'lang', 'xml:lang'), TEXT))
const optXsiType = optional(attribute(name(XSI, 'type', 'xsi:type'), TEXT))
const optFileAs = optional(attribute(name(OPF, 'file-as', 'opf:file-as'), TEXT))
const optRole = optional(attribute(name(OPF, 'role', 'opf:role'), TEXT))
const optScheme = optional(attribute(name(OPF, 'scheme', 'opf:scheme'), TEXT))
const optEvent = optional(attribute(name(OPF, 'event', 'opf:event'), TEXT))

/** `DC.metadata-common-content` — free text. */
const DC_COMMON = TEXT
/** `DC.metadata-required-content` — token, minLength 1. */
const DC_REQUIRED = data(DT_NON_EMPTY)

const dcIdentifier = dcEl('identifier', all(optId, optXsiType, optScheme, DC_REQUIRED))
const dcTitle = dcEl('title', all(optId, optXmlLang, DC_COMMON))
const dcLanguage = dcEl('language', all(optId, optXsiType, DC_COMMON))

/** `DC.optional-metadata-element`. */
const dcOptional = [
  dcEl('contributor', all(optId, optXmlLang, optFileAs, optRole, DC_COMMON)),
  dcEl('coverage', all(optId, optXmlLang, DC_COMMON)),
  dcEl('creator', all(optId, optXmlLang, optFileAs, optRole, DC_COMMON)),
  dcEl('date', all(optId, optXsiType, optEvent, DC_COMMON)),
  dcEl('description', all(optId, optXmlLang, DC_COMMON)),
  dcEl('format', all(optId, optXsiType, DC_COMMON)),
  dcEl('publisher', all(optId, optXmlLang, DC_COMMON)),
  dcEl('relation', all(optId, optXmlLang, DC_COMMON)),
  dcEl('rights', all(optId, optXmlLang, DC_COMMON)),
  dcEl('source', all(optId, optXmlLang, DC_COMMON)),
  dcEl('subject', all(optId, optXmlLang, DC_COMMON)),
  dcEl('type', all(optId, optXsiType, DC_COMMON)),
].reduce(choice)

/** `OPF20.meta-element` — empty content model. */
const meta = opfEl(
  'meta',
  all(optId, optXmlLang, attr('name', TEXT), attr('content', TEXT), optional(attr('scheme', TEXT))),
)

/**
 * `OPF20.any-other-element` — anything outside the OPF, OEB 1.2 and DC namespaces,
 * with any attributes, any text, and recursively any more of the same. This wildcard
 * is why a foreign-namespace `dcterms:modified` element inside `<metadata>` is clean.
 */
const anyOther: Pattern = element(
  anyNameExcept([OPF, OEB, DC]),
  zeroOrMore(
    choice(
      choice(attribute(anyNameExcept([]), TEXT), TEXT),
      ref(() => anyOther),
    ),
  ),
)

const dcMetadata = opfEl(
  'dc-metadata',
  all(optId, oneOrMore(dcTitle), oneOrMore(dcLanguage), oneOrMore(dcIdentifier), zeroOrMore(dcOptional)),
)
const xMetadata = opfEl('x-metadata', all(optId, zeroOrMore(meta), zeroOrMore(anyOther)))

/** `OPF20.metadata-content` — a choice of the OEB 1.2 branch and the EPUB 2 branch. */
const metadataContent = choice(
  all(dcMetadata, optional(xMetadata)),
  all(
    oneOrMore(dcTitle),
    oneOrMore(dcLanguage),
    oneOrMore(dcIdentifier),
    zeroOrMore(dcOptional),
    zeroOrMore(meta),
    zeroOrMore(anyOther),
  ),
)

const metadata = opfEl('metadata', all(optId, metadataContent))

const item = opfEl(
  'item',
  all(
    attr('id', data(DT_ID)),
    attr('href', data(DT_ANY_URI)),
    attr('media-type', TEXT),
    optional(attr('fallback', data(DT_IDREF))),
    optional(attr('fallback-style', data(DT_IDREF))),
    // `required-modules` is legal only alongside `required-namespace`.
    optional(all(attr('required-namespace', TEXT), optional(attr('required-modules', TEXT)))),
  ),
)
const manifest = opfEl('manifest', all(optId, oneOrMore(item)))

const itemref = opfEl(
  'itemref',
  all(optId, attr('idref', data(DT_IDREF)), optional(attr('linear', data(dtEnum(['yes', 'no']))))),
)
const spine = opfEl('spine', all(optId, attr('toc', data(DT_IDREF)), oneOrMore(itemref)))

const site = opfEl('site', all(optId, attr('title', TEXT), attr('href', data(DT_ANY_URI))))
const tour = opfEl('tour', all(optId, attr('title', TEXT), oneOrMore(site)))
const tours = opfEl('tours', all(optId, oneOrMore(tour)))

const reference = opfEl(
  'reference',
  all(optId, attr('type', TEXT), optional(attr('title', TEXT)), attr('href', data(DT_ANY_URI))),
)
const guide = opfEl('guide', all(optId, oneOrMore(reference)))

/** `OPF20.package-element` — note the package children are an ordered sequence. */
const pkg = opfEl(
  'package',
  all(
    attr('version', data(dtEnum(['2.0']))),
    attr('unique-identifier', data(DT_IDREF)),
    optId,
    seq(metadata, manifest, spine, optional(tours), optional(guide)),
  ),
)

export const OPF20: Grammar = makeGrammar(pkg)
