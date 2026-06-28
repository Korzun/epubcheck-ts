export const VERSION = '0.0.0'

// Primary + layered API
export { validateEpub, type ValidateOptions } from './validate.js'
export { openEpub, getResource } from './io/zip.js'
export { parseXml, childElements, findDescendants } from './io/xml.js'
export { validateOcf } from './checks/ocf.js'
export { parseOpf } from './parse/opf.js'
export { validateOpf } from './checks/opf.js'
export { buildReport } from './report.js'
export { msg } from './messages/format.js'

// Types
export type { Report } from './report.js'
export type { Message, Location } from './messages/format.js'
export type { Severity } from './messages/catalog.js'
export type { EpubContainer, Resource } from './io/zip.js'
export type { XmlNode } from './io/xml.js'
export type { PackageDocument, ManifestItem, SpineItem, Metadata, DcIdentifier } from './parse/opf.js'
