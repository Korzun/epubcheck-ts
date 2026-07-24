import { getResource, type EpubContainer } from '../io/zip.js'
import { resolvePath, isRemote } from '../util/path.js'
import { msg, type Message } from '../messages/format.js'
import { manifestPathMap, hasFallbackTo, type ManifestItem, type PackageDocument } from '../parse/opf.js'
import {
  majorVersion,
  atLeast,
  blessedContentTypes,
  EPUB2_IMAGE_TYPES,
  EPUB2_STYLE_TYPES,
  NCX_MEDIA_TYPE,
  type EpubVersion,
} from '../versions.js'

const XHTML_MEDIA_TYPE = 'application/xhtml+xml'

export function validateOpf(
  pkg: PackageDocument,
  container: EpubContainer,
  version: EpubVersion | undefined,
): Message[] {
  return [
    ...checkPackage(pkg, version),
    ...checkManifest(pkg, container),
    ...checkSpineAndNav(pkg, version),
    ...checkDeprecatedFeatures(pkg, version),
    ...checkEpub2(pkg, version),
  ]
}

/**
 * OPF-003: a container resource that is not declared in the manifest.
 * Excludes `mimetype`, everything under `META-INF/`, and the rootfile package
 * document(s). (epubcheck also exempts EPUB 3 OPF `<link>` resources and the
 * Multiple-Renditions mapping document, which we do not model.)
 */
export function checkUndeclaredResources(pkg: PackageDocument, container: EpubContainer): Message[] {
  const messages: Message[] = []
  const declared = manifestPathMap(pkg)
  const rootfiles = new Set(container.rootfiles)
  for (const path of container.resources.keys()) {
    if (path === 'mimetype') continue
    if (path.startsWith('META-INF/')) continue
    if (rootfiles.has(path)) continue
    if (declared.has(path)) continue
    messages.push(msg('OPF-003', { path }, path))
  }
  return messages
}

function checkPackage(pkg: PackageDocument, version: EpubVersion | undefined): Message[] {
  const messages: Message[] = []
  const loc = pkg.loc

  // OPF-001: version present and supported
  if (!pkg.version) {
    messages.push(msg('OPF-001', loc, 'the version attribute is missing'))
  } else if (pkg.version !== '2.0' && pkg.version !== '3.0') {
    messages.push(msg('OPF-001', loc, `unsupported version "${pkg.version}"`))
  }

  // unique-identifier attribute + resolution. An absent attribute yields both
  // OPF-048 (missing attribute) and OPF-030 with the literal "null" — matching
  // epubcheck, which resolves the missing reference to a null id.
  if (!pkg.uniqueIdentifier) {
    messages.push(msg('OPF-048', loc))
    messages.push(msg('OPF-030', loc, 'null'))
  } else if (!pkg.metadata.identifiers.some((i) => i.id === pkg.uniqueIdentifier)) {
    messages.push(msg('OPF-030', loc, pkg.uniqueIdentifier))
  }

  // Required dc:identifier/dc:title/dc:language are enforced by the schema layer
  // (validateSchema), which reports them as the jar's RNG-derived RSC-005.
  // dcterms:modified is an EPUB 3 requirement; do not demand it of EPUB 2 books.
  if ((version === undefined || majorVersion(version) === '3.0') && pkg.metadata.modifiedCount !== 1) {
    messages.push(msg('RSC-005', loc, pkg.path, 'The package dcterms:modified meta element must occur exactly once.'))
  }

  return messages
}

function checkManifest(pkg: PackageDocument, container: EpubContainer): Message[] {
  const messages: Message[] = []
  const seenPaths = new Set<string>()
  const byId = new Map<string, ManifestItem>()
  for (const item of pkg.manifest) {
    if (item.id !== undefined) byId.set(item.id, item)
  }

  // Missing required item attributes and duplicate item ids are RNG/schematron
  // failures now emitted by the schema layer (validateSchema).
  for (const item of pkg.manifest) {
    if (item.fallback !== undefined && !byId.has(item.fallback)) {
      messages.push(msg('OPF-040', item.loc, item.fallback))
    }
    if (item.href && !isRemote(item.href)) {
      const resolved = resolvePath(pkg.path, item.href)
      if (seenPaths.has(resolved)) {
        messages.push(msg('OPF-074', item.loc, resolved))
      } else {
        seenPaths.add(resolved)
      }
      if (resolved === pkg.path) {
        messages.push(msg('OPF-099', item.loc))
      }
      if (!getResource(container, resolved)) {
        messages.push(msg('RSC-001', item.loc, resolved))
      }
    }
  }
  return messages
}

function checkSpineAndNav(pkg: PackageDocument, version: EpubVersion | undefined): Message[] {
  const messages: Message[] = []

  // A missing spine and an empty spine are RNG failures now emitted by the
  // schema layer (validateSchema).
  const ids = new Set(pkg.manifest.map((i) => i.id).filter((id): id is string => Boolean(id)))
  for (const ref of pkg.spine) {
    if (ref.idref && !ids.has(ref.idref)) {
      messages.push(msg('OPF-049', ref.loc, ref.idref))
    }
  }
  if (pkg.spine.length > 0 && !pkg.spine.some((s) => s.linear)) {
    messages.push(msg('OPF-033', pkg.loc))
  }

  // Navigation document is an EPUB 3 requirement only.
  if (version !== undefined && majorVersion(version) === '3.0') {
    const navItems = pkg.manifest.filter((i) => i.properties.includes('nav'))
    if (navItems.length !== 1) {
      messages.push(msg('RSC-005', pkg.loc, pkg.path, `Exactly one manifest item must declare the "nav" property (number of "nav" items: ${navItems.length}).`))
    } else {
      const nav = navItems[0]
      if (nav && nav.mediaType !== XHTML_MEDIA_TYPE) {
        messages.push(msg('RSC-005', nav.loc, pkg.path, `The manifest item representing the Navigation Document must be of the "${XHTML_MEDIA_TYPE}" type (given type was "${nav.mediaType ?? ''}").`))
      }
    }
  }

  return messages
}

function checkDeprecatedFeatures(pkg: PackageDocument, version: EpubVersion | undefined): Message[] {
  const messages: Message[] = []
  if (version !== undefined && atLeast(version, '3.2') && pkg.bindings) {
    messages.push(msg('RSC-017', pkg.bindings, 'Use of the bindings element is deprecated'))
  }
  return messages
}

/** EPUB 2 (OPF 2.0) rules: guide, spine toc/NCX, blessed types, fallback chains. */
function checkEpub2(pkg: PackageDocument, version: EpubVersion | undefined): Message[] {
  if (version === undefined || majorVersion(version) !== '2.0') return []
  const messages: Message[] = []
  const blessed = blessedContentTypes(version)
  const isBlessedContent = (mediaType: string | undefined): boolean =>
    mediaType !== undefined && blessed.has(mediaType)
  // A "foreign" resource is one whose media type is not an EPUB 2 Core Media Type
  // (content docs, images, style sheets, or the NCX). An absent media type is
  // foreign. epubcheck requires a fallback for these (RSC-032); core types such as
  // images and CSS are accepted without one.
  const isForeign = (mediaType: string | undefined): boolean =>
    mediaType === undefined ||
    !(isBlessedContent(mediaType) ||
      EPUB2_IMAGE_TYPES.has(mediaType) ||
      EPUB2_STYLE_TYPES.has(mediaType) ||
      mediaType === NCX_MEDIA_TYPE)

  const byId = new Map<string, ManifestItem>()
  for (const item of pkg.manifest) {
    if (item.id !== undefined) byId.set(item.id, item)
  }
  const declared = manifestPathMap(pkg)

  // Manifest media-type hygiene (epubcheck OPFChecker.checkItem, OPF 2.0 branch).
  for (const item of pkg.manifest) {
    if (item.mediaType === 'text/html') {
      messages.push(msg('OPF-035', item.loc))
    } else if (item.mediaType === 'text/x-oeb1-document' || item.mediaType === 'text/x-oeb1-css') {
      messages.push(msg('OPF-037', item.loc, item.mediaType))
    }
  }

  // Spine: duplicates + permissible media types (epubcheck checkSpineItem).
  const seenIdrefs = new Set<string>()
  for (const ref of pkg.spine) {
    if (ref.idref === undefined) continue
    if (seenIdrefs.has(ref.idref)) messages.push(msg('OPF-034', ref.loc, ref.idref))
    seenIdrefs.add(ref.idref)

    const item = byId.get(ref.idref)
    if (item === undefined) continue // unknown idref → OPF-049 elsewhere
    // An absent media-type is non-standard and rendered by epubcheck as the
    // literal "undefined" (OPF-043/OPF-044).
    const mediaType = item.mediaType
    if (mediaType !== undefined && (EPUB2_STYLE_TYPES.has(mediaType) || EPUB2_IMAGE_TYPES.has(mediaType))) {
      messages.push(msg('OPF-042', item.loc, mediaType))
    } else if (!isBlessedContent(mediaType)) {
      if (item.fallback === undefined) {
        messages.push(msg('OPF-043', item.loc, mediaType ?? 'undefined'))
      } else if (!hasFallbackTo(item, byId, (i) => isBlessedContent(i.mediaType))) {
        messages.push(msg('OPF-044', item.loc, mediaType ?? 'undefined'))
      }
    }
  }

  // Spine toc attribute → NCX (epubcheck OPFHandler). The missing-toc RNG failure
  // is emitted by the schema layer (validateSchema); here we only resolve a
  // present toc idref to its NCX item.
  if (pkg.spinePresent && pkg.spineToc !== undefined) {
    const tocItem = byId.get(pkg.spineToc)
    if (tocItem === undefined) {
      messages.push(msg('OPF-049', pkg.spineLoc ?? pkg.loc, pkg.spineToc))
    } else if (tocItem.mediaType !== NCX_MEDIA_TYPE) {
      messages.push(msg('OPF-050', tocItem.loc))
    }
  }

  // Guide references (epubcheck OPFChecker.checkGuide). The messages embed the
  // container-resolved path, not the raw href (epubcheck parity). A guide
  // reference to a foreign resource with no content-document fallback is also a
  // generic hyperlink to a foreign resource, so it additionally yields RSC-032.
  for (const ref of pkg.guide) {
    if (ref.href === undefined || isRemote(ref.href)) continue
    const target = resolvePath(pkg.path, ref.href)
    const item = declared.get(target)
    if (item === undefined) {
      messages.push(msg('OPF-031', ref.loc, target))
    } else if (!isBlessedContent(item.mediaType)) {
      messages.push(msg('OPF-032', ref.loc, target))
      if (isForeign(item.mediaType) && !hasFallbackTo(item, byId, (i) => !isForeign(i.mediaType))) {
        messages.push(msg('RSC-032', ref.loc, target, item.mediaType ?? 'undefined'))
      }
    }
  }

  return messages
}
