import { parseCss, type CssDocument } from '../parse/css.js'
import { manifestPathMap, type ManifestItem, type PackageDocument } from '../parse/opf.js'
import { getResource, type EpubContainer } from '../io/zip.js'
import { resolvePath, isRemote, hasScheme } from '../util/path.js'
import { msg, type Message } from '../messages/format.js'
import { isBlessedFontType, isBlessedFontMimetype20 } from '../util/media-types.js'
import { majorVersion, type EpubVersion } from '../versions.js'

export function validateCss(
  css: CssDocument,
  container: EpubContainer,
  manifest: Map<string, ManifestItem>,
  version?: EpubVersion,
): Message[] {
  return [...checkReferences(css, container, manifest, version), ...checkProperties(css)]
}

export function validateCssDocs(
  pkg: PackageDocument,
  container: EpubContainer,
  version?: EpubVersion,
): Message[] {
  const messages: Message[] = []
  const manifest = manifestPathMap(pkg)
  for (const item of pkg.manifest) {
    if (item.mediaType !== 'text/css') continue
    const { css, messages: m } = parseCss(item, container)
    messages.push(...m)
    if (css) messages.push(...validateCss(css, container, manifest, version))
  }
  return messages
}

function checkProperties(css: CssDocument): Message[] {
  const messages: Message[] = []
  for (const decl of css.declarations) {
    if (decl.property === 'direction' || decl.property === 'unicode-bidi') {
      messages.push(msg('CSS-001', decl.loc, decl.property))
    } else if (decl.property === 'position' && /\bfixed\b/i.test(decl.value)) {
      messages.push(msg('CSS-006', decl.loc))
    }
  }
  for (const fontFace of css.fontFaces) {
    if (fontFace.declarationCount === 0) messages.push(msg('CSS-019', fontFace.loc))
  }
  return messages
}

function checkReferences(
  css: CssDocument,
  container: EpubContainer,
  manifest: Map<string, ManifestItem>,
  version?: EpubVersion,
): Message[] {
  const messages: Message[] = []
  const isBlessedFont =
    version !== undefined && majorVersion(version) === '2.0' ? isBlessedFontMimetype20 : isBlessedFontType
  for (const ref of css.refs) {
    const url = ref.url

    if (/^file:/i.test(url)) {
      messages.push(msg('RSC-030', ref.loc, url))
      continue
    }
    if (ref.type === 'import' && url.includes('#')) {
      messages.push(msg('RSC-013', ref.loc))
    }
    if (isRemote(url)) {
      if (ref.type === 'font') {
        if (!/^https:\/\//i.test(url)) messages.push(msg('RSC-031', ref.loc, url))
      } else {
        messages.push(msg('RSC-006', ref.loc, url))
      }
      continue
    }
    if (hasScheme(url)) continue // data:, etc. — not container-relative

    const target = resolvePath(css.path, url) // resolvePath strips the fragment
    if (!getResource(container, target)) {
      messages.push(msg('RSC-007', ref.loc, url))
    } else if (!manifest.has(target)) {
      messages.push(msg('RSC-008', ref.loc, url))
    } else if (ref.type === 'font') {
      const item = manifest.get(target)
      if (item && item.mediaType !== undefined && !isBlessedFont(item.mediaType)) {
        messages.push(msg('CSS-007', ref.loc, url, item.mediaType))
      }
    }
  }
  return messages
}
