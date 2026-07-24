import { openEpub } from './io/zip.js'
import { validateOcf } from './checks/ocf.js'
import { parseOpf, type ManifestItem } from './parse/opf.js'
import { validateOpf, checkUndeclaredResources } from './checks/opf.js'
import { validateSchema } from './checks/schema.js'
import { parseNav } from './parse/nav.js'
import { validateNav } from './checks/nav.js'
import { parseNcx } from './parse/ncx.js'
import { validateNcx } from './checks/ncx.js'
import { validateContentDocs } from './checks/content.js'
import { validateCssDocs } from './checks/css.js'
import { buildReport, type Report, type ValidationThreshold } from './report.js'
import { majorVersion, NCX_MEDIA_TYPE, type EpubVersion } from './versions.js'
import { msg, type Message } from './messages/format.js'

export interface ValidateOptions {
  version?: EpubVersion
  threshold?: ValidationThreshold
}

/** Resolve the revision to validate against. Detection from the package
 * document yields only the major version; the specific revision is caller-set,
 * defaulting to the newest revision of the detected major. */
function resolveTarget(
  pkgVersion: string | undefined,
  option: EpubVersion | undefined,
): { target?: EpubVersion; detectedMajor?: '2.0' | '3.0' } {
  const detectedMajor =
    pkgVersion === '2.0' ? '2.0' : pkgVersion === '3.0' ? '3.0' : undefined
  let target: EpubVersion | undefined
  if (option) target = option
  else if (detectedMajor === '2.0') target = '2.0'
  else if (detectedMajor === '3.0') target = '3.3'
  return { target, detectedMajor }
}

export async function validateEpub(
  input: Uint8Array | ArrayBuffer | ReadableStream<Uint8Array>,
  options: ValidateOptions = {},
): Promise<Report> {
  const messages: Message[] = []
  try {
    const container = await openEpub(input)
    messages.push(...validateOcf(container))

    // Everything after openEpub is a non-throwing pure function, so the catch
    // below only ever fires from openEpub — at which point `messages` is still
    // empty. Accumulated messages therefore never bleed into the error report.
    const { pkg, messages: opfMessages } = parseOpf(container)
    messages.push(...opfMessages)

    let target: EpubVersion | undefined
    if (pkg) {
      const resolved = resolveTarget(pkg.version, options.version)
      target = resolved.target

      messages.push(...validateOpf(pkg, container, target))
      // Schema validation requires a resolvable supported major (2.0 or 3.x); an
      // unsupported or absent version already produces OPF-001 and real
      // EPUBCheck does not additionally run the grammar against it.
      if (target !== undefined) {
        messages.push(...validateSchema(pkg, target))
      }
      messages.push(...checkUndeclaredResources(pkg, container))

      if (options.version && resolved.detectedMajor && majorVersion(options.version) !== resolved.detectedMajor) {
        messages.push(msg('PKG-001', pkg.loc, options.version, pkg.version ?? ''))
      }

      if (target !== undefined) {
        // NCX: EPUB 2's navigation document; also validated as a legacy compat
        // doc when an EPUB 3 book ships one. Found via the spine toc idref,
        // falling back to media-type discovery.
        const byId = new Map<string, ManifestItem>()
        for (const item of pkg.manifest) {
          if (item.id !== undefined) byId.set(item.id, item)
        }
        // The spine toc idref locates the NCX regardless of its media type
        // (epubcheck parity): if it points at a non-NCX item, that item is still
        // parsed as the NCX (surfacing a structural RSC-005) and OPF-050 is
        // reported separately by validateOpf. Do not media-type-gate this lookup.
        const ncxItem =
          (pkg.spineToc !== undefined ? byId.get(pkg.spineToc) : undefined) ??
          pkg.manifest.find((i) => i.mediaType === NCX_MEDIA_TYPE)
        if (ncxItem) {
          const { ncx, messages: ncxMessages } = parseNcx(ncxItem, container)
          messages.push(...ncxMessages)
          if (ncx) messages.push(...validateNcx(ncx, pkg, container, target))
        }

        // EPUB 3 navigation document.
        if (majorVersion(target) === '3.0') {
          const navItem = pkg.manifest.find((i) => i.properties.includes('nav'))
          if (navItem) {
            const { nav, messages: navMessages } = parseNav(navItem, container)
            messages.push(...navMessages)
            if (nav) messages.push(...validateNav(nav, pkg, container))
          }
        }

        // Content and CSS layers run for both majors, version-gated internally.
        messages.push(...validateContentDocs(pkg, container, target))
        messages.push(...validateCssDocs(pkg, container, target))
      }
    }

    return buildReport(messages, target, options.threshold)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    const id = /zip/i.test(reason) ? 'PKG-003' : 'CHK-001'
    messages.push(msg(id, undefined, reason))
    return buildReport(messages, options.version, options.threshold)
  }
}
