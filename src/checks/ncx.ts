import { getResource, type EpubContainer } from '../io/zip.js'
import { resolvePath, isRemote, hasScheme } from '../util/path.js'
import { msg, type Message } from '../messages/format.js'
import { manifestPathMap, hasFallbackTo, type ManifestItem, type PackageDocument } from '../parse/opf.js'
import { parseContent } from '../parse/content.js'
import type { NcxDocument } from '../parse/ncx.js'
import { blessedContentTypes, type EpubVersion } from '../versions.js'

export function validateNcx(
  ncx: NcxDocument,
  pkg: PackageDocument,
  container: EpubContainer,
  version: EpubVersion,
): Message[] {
  return [
    ...checkIdentifier(ncx, pkg),
    ...checkStructure(ncx),
    ...checkLabels(ncx),
    ...checkReferences(ncx, pkg, container, version),
  ]
}

/** NCX-001/NCX-004: dtb:uid vs the OPF unique identifier (epubcheck NCXChecker). */
function checkIdentifier(ncx: NcxDocument, pkg: PackageDocument): Message[] {
  const messages: Message[] = []
  if (ncx.uid === undefined) return messages
  if (ncx.uid !== ncx.uid.trim()) {
    messages.push(msg('NCX-004', ncx.uidLoc ?? ncx.loc))
  }
  // Skip the comparison when the OPF has no usable unique identifier: an empty or
  // whitespace-only dc:identifier is already reported (RSC-005) and epubcheck does
  // not additionally flag an NCX mismatch against a blank OPF identifier.
  const opfUid = pkg.metadata.identifiers.find((i) => i.id === pkg.uniqueIdentifier)?.value
  if (opfUid !== undefined && opfUid.trim() !== '' && ncx.uid.trim() !== opfUid) {
    messages.push(msg('NCX-001', ncx.uidLoc ?? ncx.loc, ncx.uid, opfUid))
  }
  return messages
}

/** Structural requirements the NCX RNG schema enforces (hand-written, as RSC-005). */
function checkStructure(ncx: NcxDocument): Message[] {
  const messages: Message[] = []
  if (!ncx.navMapPresent) {
    messages.push(msg('RSC-005', ncx.loc, ncx.path, 'The NCX document must contain a navMap element.'))
  }
  for (const np of ncx.navPoints) {
    if (!np.hasLabel) {
      messages.push(msg('RSC-005', np.loc, ncx.path, 'A navPoint must contain a navLabel element.'))
    }
    if (!np.hasContent) {
      messages.push(msg('RSC-005', np.loc, ncx.path, 'A navPoint must contain a content element.'))
    }
  }
  return messages
}

/** NCX-006: empty text labels (epubcheck NCXHandler). */
function checkLabels(ncx: NcxDocument): Message[] {
  return ncx.textLabels.filter((t) => t.text === '').map((t) => msg('NCX-006', t.loc))
}

/**
 * navPoint content@src integrity. epubcheck registers these as HYPERLINK
 * references, so they get the full hyperlink chain: RSC-007 (missing),
 * RSC-008 (undeclared), RSC-010 (non-content-document), RSC-011 (not in
 * spine), RSC-012 (missing fragment). The first failure aborts that src's
 * chain (epubcheck CheckAbortException semantics).
 */
function checkReferences(
  ncx: NcxDocument,
  pkg: PackageDocument,
  container: EpubContainer,
  version: EpubVersion,
): Message[] {
  const messages: Message[] = []
  const manifest = manifestPathMap(pkg)
  const blessed = blessedContentTypes(version)
  const isBlessedContent = (mediaType: string | undefined): boolean =>
    mediaType !== undefined && blessed.has(mediaType)

  const byId = new Map<string, ManifestItem>()
  for (const item of pkg.manifest) {
    if (item.id !== undefined) byId.set(item.id, item)
  }
  const spinePaths = new Set<string>()
  for (const s of pkg.spine) {
    if (s.idref === undefined) continue
    const item = byId.get(s.idref)
    if (item?.href && !isRemote(item.href)) spinePaths.add(resolvePath(pkg.path, item.href))
  }

  // Parse a target XHTML doc on demand (cached) to check fragment ids.
  const idsCache = new Map<string, Set<string>>()
  const idsFor = (path: string): Set<string> => {
    const cached = idsCache.get(path)
    if (cached) return cached
    const item = manifest.get(path)
    const ids = item ? (parseContent(item, container).doc?.ids ?? new Set<string>()) : new Set<string>()
    idsCache.set(path, ids)
    return ids
  }

  for (const np of ncx.navPoints) {
    const src = np.src
    if (src === undefined || isRemote(src) || hasScheme(src)) continue // remote hyperlinks are allowed
    const target = resolvePath(ncx.path, src)
    if (!getResource(container, target)) {
      messages.push(msg('RSC-007', np.loc, src))
      continue
    }
    const item = manifest.get(target)
    if (item === undefined) {
      messages.push(msg('RSC-008', np.loc, src))
      continue
    }
    if (!isBlessedContent(item.mediaType) && !hasFallbackTo(item, byId, (i) => isBlessedContent(i.mediaType))) {
      messages.push(msg('RSC-010', np.loc))
      continue
    }
    if (!spinePaths.has(target)) {
      messages.push(msg('RSC-011', np.loc))
      continue
    }
    const hash = src.indexOf('#')
    const frag = hash < 0 ? '' : src.slice(hash + 1)
    if (frag !== '' && item.mediaType === 'application/xhtml+xml' && !idsFor(target).has(frag)) {
      messages.push(msg('RSC-012', np.loc))
    }
  }
  return messages
}
