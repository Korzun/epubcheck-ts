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

  // unique-identifier attribute + resolution
  if (!pkg.uniqueIdentifier) {
    messages.push(msg('OPF-048', loc))
  } else if (!pkg.metadata.identifiers.some((i) => i.id === pkg.uniqueIdentifier)) {
    messages.push(msg('OPF-030', loc, pkg.uniqueIdentifier))
  }

  // Required metadata (epubcheck enforces these via schema -> RSC-005)
  if (pkg.metadata.identifiers.length === 0) {
    messages.push(msg('RSC-005', loc, pkg.path, 'The package metadata must include at least one dc:identifier element.'))
  }
  if (pkg.metadata.titles.length === 0) {
    messages.push(msg('RSC-005', loc, pkg.path, 'The package metadata must include at least one dc:title element.'))
  }
  if (pkg.metadata.languages.length === 0) {
    messages.push(msg('RSC-005', loc, pkg.path, 'The package metadata must include at least one dc:language element.'))
  }
  // dcterms:modified is an EPUB 3 requirement; do not demand it of EPUB 2 books.
  if ((version === undefined || majorVersion(version) === '3.0') && pkg.metadata.modifiedCount !== 1) {
    messages.push(msg('RSC-005', loc, pkg.path, 'The package dcterms:modified meta element must occur exactly once.'))
  }

  return messages
}

function checkManifest(pkg: PackageDocument, container: EpubContainer): Message[] {
  const messages: Message[] = []
  const seenIds = new Set<string>()
  const seenPaths = new Set<string>()
  const byId = new Map<string, ManifestItem>()
  for (const item of pkg.manifest) {
    if (item.id !== undefined) byId.set(item.id, item)
  }

  for (const item of pkg.manifest) {
    if (!item.id || !item.href || !item.mediaType) {
      messages.push(msg('RSC-005', item.loc, pkg.path, 'A manifest item is missing a required attribute (id, href, and media-type are required).'))
    }
    if (item.id) {
      if (seenIds.has(item.id)) {
        messages.push(msg('RSC-005', item.loc, pkg.path, `Duplicate manifest item id "${item.id}".`))
      } else {
        seenIds.add(item.id)
      }
    }
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

  if (!pkg.spinePresent) {
    messages.push(msg('RSC-005', pkg.loc, pkg.path, 'The package document must contain a spine element.'))
  } else if (pkg.spine.length === 0) {
    messages.push(msg('RSC-005', pkg.loc, pkg.path, 'The spine element must contain at least one itemref.'))
  } else {
    const ids = new Set(pkg.manifest.map((i) => i.id).filter((id): id is string => Boolean(id)))
    for (const ref of pkg.spine) {
      if (ref.idref && !ids.has(ref.idref)) {
        messages.push(msg('OPF-049', ref.loc, ref.idref))
      }
    }
    if (!pkg.spine.some((s) => s.linear)) {
      messages.push(msg('OPF-033', pkg.loc))
    }
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
    const mediaType = item?.mediaType
    if (item === undefined || mediaType === undefined) continue // unknown idref → OPF-049 elsewhere
    if (EPUB2_STYLE_TYPES.has(mediaType) || EPUB2_IMAGE_TYPES.has(mediaType)) {
      messages.push(msg('OPF-042', item.loc, mediaType))
    } else if (!isBlessedContent(mediaType)) {
      if (item.fallback === undefined) {
        messages.push(msg('OPF-043', item.loc, mediaType))
      } else if (!hasFallbackTo(item, byId, (i) => isBlessedContent(i.mediaType))) {
        messages.push(msg('OPF-044', item.loc, mediaType))
      }
    }
  }

  // Spine toc attribute → NCX (required in EPUB 2; epubcheck OPFHandler).
  if (pkg.spinePresent) {
    if (pkg.spineToc === undefined) {
      messages.push(msg('RSC-005', pkg.spineLoc ?? pkg.loc, pkg.path, 'The spine element must include the toc attribute in EPUB 2.'))
    } else {
      const tocItem = byId.get(pkg.spineToc)
      if (tocItem === undefined) {
        messages.push(msg('OPF-049', pkg.spineLoc ?? pkg.loc, pkg.spineToc))
      } else if (tocItem.mediaType !== NCX_MEDIA_TYPE) {
        messages.push(msg('OPF-050', tocItem.loc))
      }
    }
  }

  // Guide references (epubcheck OPFChecker.checkGuide).
  for (const ref of pkg.guide) {
    if (ref.href === undefined || isRemote(ref.href)) continue
    const target = resolvePath(pkg.path, ref.href)
    const item = declared.get(target)
    if (item === undefined) {
      messages.push(msg('OPF-031', ref.loc, ref.href))
    } else if (!isBlessedContent(item.mediaType)) {
      messages.push(msg('OPF-032', ref.loc, ref.href))
    }
  }

  return messages
}
