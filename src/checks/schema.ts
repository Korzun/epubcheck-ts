import type { Message } from '../messages/format.js'
import type { PackageDocument } from '../parse/opf.js'
import { majorVersion, type EpubVersion } from '../versions.js'
import { validateAgainst } from '../schema/validate.js'
import { OPF20 } from '../schema/opf20.js'
import { PACKAGE30 } from '../schema/package30.js'
import { checkDuplicateReferences, checkUniqueIds } from '../schema/schematron.js'

/**
 * Validate the package document against its RelaxNG grammar, the way EPUBCheck does.
 * An unknown version is treated as EPUB 3, matching the gating the dcterms:modified
 * rule and checkEpub2 already use.
 */
export function validateSchema(pkg: PackageDocument, version: EpubVersion | undefined): Message[] {
  const isEpub2 = version !== undefined && majorVersion(version) === '2.0'
  const grammar = isEpub2 ? OPF20 : PACKAGE30

  const messages: Message[] = [
    ...validateAgainst(grammar, pkg.root, pkg.path),
    ...checkUniqueIds(pkg.root, pkg.path),
  ]
  // opf_guideReferenceUnique is in schema/20/sch/opf.sch only.
  if (isEpub2) messages.push(...checkDuplicateReferences(pkg.root, pkg.path))
  return messages
}
