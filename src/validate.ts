import { openEpub } from './io/zip.js'
import { validateOcf } from './checks/ocf.js'
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
    // Later plans append: parse OPF -> detect version -> OPF/nav/content checks.
    return buildReport(messages, options.version)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    // ZIP-open failures surface as PKG-003; this boundary also catches any
    // unexpected internal error so the API never rejects.
    const id = /zip/i.test(reason) ? 'PKG-003' : 'CHK-001'
    messages.push(msg(id, undefined, reason))
    return buildReport(messages, options.version)
  }
}
