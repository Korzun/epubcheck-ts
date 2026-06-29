import { openEpub } from './io/zip.js'
import { validateOcf } from './checks/ocf.js'
import { parseOpf } from './parse/opf.js'
import { validateOpf, checkUndeclaredResources } from './checks/opf.js'
import { parseNav } from './parse/nav.js'
import { validateNav } from './checks/nav.js'
import { validateContentDocs } from './checks/content.js'
import { validateCssDocs } from './checks/css.js'
import { buildReport, type Report } from './report.js'
import { msg, type Message } from './messages/format.js'

export interface ValidateOptions {
  version?: '2.0' | '3.0'
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

    let detectedVersion: '2.0' | '3.0' | undefined
    if (pkg) {
      messages.push(...validateOpf(pkg, container))
      messages.push(...checkUndeclaredResources(pkg, container))

      if (pkg.version === '2.0') detectedVersion = '2.0'
      else if (pkg.version === '3.0') detectedVersion = '3.0'

      if (options.version && detectedVersion && options.version !== detectedVersion) {
        messages.push(msg('PKG-001', pkg.loc, options.version, detectedVersion))
      }

      // Navigation Document (EPUB 3 only).
      if (detectedVersion === '3.0') {
        const navItem = pkg.manifest.find((i) => i.properties.includes('nav'))
        if (navItem) {
          const { nav, messages: navMessages } = parseNav(navItem, container)
          messages.push(...navMessages)
          if (nav) messages.push(...validateNav(nav, pkg))
        }
        messages.push(...validateContentDocs(pkg, container))
        messages.push(...validateCssDocs(pkg, container))
      }
    }

    return buildReport(messages, options.version ?? detectedVersion)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    const id = /zip/i.test(reason) ? 'PKG-003' : 'CHK-001'
    messages.push(msg(id, undefined, reason))
    return buildReport(messages, options.version)
  }
}
