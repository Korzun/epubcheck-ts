import { openEpub } from './io/zip.js'
import { validateOcf } from './checks/ocf.js'
import { parseOpf } from './parse/opf.js'
import { validateOpf, checkUndeclaredResources } from './checks/opf.js'
import { parseNav } from './parse/nav.js'
import { validateNav } from './checks/nav.js'
import { validateContentDocs } from './checks/content.js'
import { validateCssDocs } from './checks/css.js'
import { buildReport, type Report, type ValidationThreshold } from './report.js'
import { majorVersion, type EpubVersion } from './versions.js'
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

    const { pkg, messages: opfMessages } = parseOpf(container)
    messages.push(...opfMessages)

    let target: EpubVersion | undefined
    if (pkg) {
      const resolved = resolveTarget(pkg.version, options.version)
      target = resolved.target

      messages.push(...validateOpf(pkg, container, target))
      messages.push(...checkUndeclaredResources(pkg, container))

      if (options.version && resolved.detectedMajor && majorVersion(options.version) !== resolved.detectedMajor) {
        messages.push(msg('PKG-001', pkg.loc, options.version, pkg.version ?? ''))
      }

      // EPUB 3 layered documents (nav, content, css).
      if (target !== undefined && majorVersion(target) === '3.0') {
        const navItem = pkg.manifest.find((i) => i.properties.includes('nav'))
        if (navItem) {
          const { nav, messages: navMessages } = parseNav(navItem, container)
          messages.push(...navMessages)
          if (nav) messages.push(...validateNav(nav, pkg, container))
        }
        messages.push(...validateContentDocs(pkg, container, target))
        messages.push(...validateCssDocs(pkg, container))
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
