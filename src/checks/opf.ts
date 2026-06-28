import { getResource, type EpubContainer } from '../io/zip.js'
import { resolvePath } from '../util/path.js'
import { msg, type Message } from '../messages/format.js'
import type { PackageDocument } from '../parse/opf.js'

export function validateOpf(pkg: PackageDocument, container: EpubContainer): Message[] {
  return [...checkPackage(pkg), ...checkManifest(pkg, container)]
}

function checkPackage(pkg: PackageDocument): Message[] {
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
  if (pkg.metadata.modifiedCount !== 1) {
    messages.push(msg('RSC-005', loc, pkg.path, 'The package dcterms:modified meta element must occur exactly once.'))
  }

  return messages
}

function isRemote(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(href)
}

function checkManifest(pkg: PackageDocument, container: EpubContainer): Message[] {
  const messages: Message[] = []
  const seenIds = new Set<string>()
  const seenPaths = new Set<string>()

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
    if (item.href && !isRemote(item.href)) {
      const resolved = resolvePath(pkg.path, item.href)
      if (seenPaths.has(resolved)) {
        messages.push(msg('OPF-074', item.loc, resolved))
      } else {
        seenPaths.add(resolved)
      }
      if (!getResource(container, resolved)) {
        messages.push(msg('RSC-001', item.loc, resolved))
      }
    }
  }
  return messages
}
