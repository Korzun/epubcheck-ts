// Single source of truth: the bundler inlines this at build time, so there is
// no runtime file access and the value can never drift from package.json.
import { version } from '../package.json'

export const VERSION: string = version

// Primary + layered API
export { validateEpub, type ValidateOptions } from './validate.js'
export { openEpub, getResource } from './io/zip.js'
export { parseXml, childElements, findDescendants, textContent } from './io/xml.js'
export { validateOcf } from './checks/ocf.js'
export { parseOpf } from './parse/opf.js'
export { validateOpf } from './checks/opf.js'
export { parseNav } from './parse/nav.js'
export { validateNav } from './checks/nav.js'
export { parseContent } from './parse/content.js'
export { validateContentDocs } from './checks/content.js'
export { parseCss, analyzeCss } from './parse/css.js'
export { validateCss, validateCssDocs } from './checks/css.js'
export { buildReport, ValidationThreshold } from './report.js'
export { msg } from './messages/format.js'

// Types
export type { Report } from './report.js'
export type { Message, Location } from './messages/format.js'
export type { Severity } from './messages/catalog.js'
export type { EpubContainer, Resource } from './io/zip.js'
export type { XmlNode } from './io/xml.js'
export type { PackageDocument, ManifestItem, SpineItem, Metadata, DcIdentifier } from './parse/opf.js'
export type { NavDocument, NavSection } from './parse/nav.js'
export type { ContentDocument, ContentRef, RefType, InlineStyle } from './parse/content.js'
export type { CssDocument, CssRef, CssRefType, CssDeclaration, FontFace, CssAnalysis } from './parse/css.js'
