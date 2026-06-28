import { openEpub } from './io/zip.js'
import { validateOcf } from './checks/ocf.js'
import { parseOpf } from './parse/opf.js'
import { validateOpf } from './checks/opf.js'
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
      if (pkg.version === '2.0') detectedVersion = '2.0'
      else if (pkg.version === '3.0') detectedVersion = '3.0'
    }

    return buildReport(messages, options.version ?? detectedVersion)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    // ZIP-open failure → PKG-003; any other (unexpected) internal error → CHK-001.
    const id = /zip/i.test(reason) ? 'PKG-003' : 'CHK-001'
    messages.push(msg(id, undefined, reason))
    return buildReport(messages, options.version)
  }
}
