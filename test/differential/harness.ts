import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateEpub } from '../../src/index.js'

export interface Emitted {
  id: string
  severity: string
  message: string
}

export interface DiffCase {
  name: string
  epub: Uint8Array
}

export interface CaseResult {
  name: string
  jar: Emitted[]
  ts: Emitted[]
  match: boolean
}

/**
 * Canonicalise a message for comparison. Whitespace is collapsed, and the RSC-005
 * `Error while parsing file '<path>': ` prefix is reduced to `Error while parsing
 * file: ` — the jar's JSON `message` keeps the filename in `locations`, not the
 * message text, whereas epubcheck-ts bakes it into the RSC-005 template. Stripping
 * the path from both sides (a no-op on the jar) compares the semantic message rather
 * than the filename-embedding convention.
 */
function normalizeMessage(message: string): string {
  return message
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/Error while parsing file '[^']*': /, 'Error while parsing file: ')
}

/** One raw message as it appears in EPUBCheck's JSON report (before location expansion). */
export interface JarMessage {
  ID: string
  severity: string
  message: string
  locations?: unknown[]
}

/** Is the real EPUBCheck jar on PATH? CI without it skips the whole suite. */
export function jarAvailable(): boolean {
  try {
    execFileSync('epubcheck', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Run the real EPUBCheck over `epub` and return its raw JSON `messages`, unexpanded.
 * Each entry may carry MULTIPLE `locations` — EPUBCheck aggregates identical messages
 * (e.g. a duplicate id reported at two elements) into a single message. Callers that
 * want per-occurrence records should use {@link runJar}, which expands them.
 */
export function runJarMessages(epub: Uint8Array): JarMessage[] {
  const dir = mkdtempSync(join(tmpdir(), 'epubcheck-diff-'))
  const file = join(dir, 'book.epub')
  writeFileSync(file, epub)
  let out: string
  try {
    out = execFileSync('epubcheck', [file, '--json', '-'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 32 * 1024 * 1024,
    })
  } catch (e) {
    out = (e as { stdout?: string }).stdout ?? ''
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  const start = out.indexOf('{')
  if (start < 0) return []
  const report = JSON.parse(out.slice(start)) as { messages?: JarMessage[] }
  return report.messages ?? []
}

/**
 * Expand EPUBCheck's aggregated messages into one record per occurrence.
 *
 * EPUBCheck collapses identical messages into a single JSON entry whose `locations`
 * array lists every place the message applies: a duplicate-id pair is ONE `RSC-005`
 * with two locations, three duplicate `<reference>` elements are ONE `RSC-017` with
 * three. `epubcheck-ts` emits one `Message` per occurrence, so to compare as an
 * equal multiset we expand each jar message into one record per `location`. A message
 * with no locations stays a single record.
 */
export function expandJarMessages(messages: JarMessage[]): Emitted[] {
  const out: Emitted[] = []
  for (const m of messages) {
    const record: Emitted = {
      id: m.ID,
      severity: m.severity,
      message: normalizeMessage(m.message),
    }
    const count = Array.isArray(m.locations) ? m.locations.length : 0
    if (count <= 1) out.push(record)
    else for (let i = 0; i < count; i++) out.push({ ...record })
  }
  return out
}

/** Run the real EPUBCheck and return its messages, one record per location. */
export function runJar(epub: Uint8Array): Emitted[] {
  return expandJarMessages(runJarMessages(epub))
}

/** Run epubcheck-ts over the same bytes. */
export async function runTs(epub: Uint8Array): Promise<Emitted[]> {
  const report = await validateEpub(epub)
  return report.messages.map((m) => ({
    id: m.id,
    severity: m.severity,
    message: normalizeMessage(m.message),
  }))
}

/**
 * Message ids EPUBCheck emits that epubcheck-ts does not implement at all. These are
 * filtered from the jar side before comparing, so the harness measures parity on the
 * rules we claim to cover rather than failing on known gaps. The jar side is filtered
 * against this set; our side is never filtered. Add an id here ONLY when the rule is
 * genuinely out of scope, with a comment saying why. Populated from a real jar run;
 * every id below is absent from IMPLEMENTED_IDS.
 */
export const KNOWN_UNIMPLEMENTED = new Set<string>([
  // Internal EPUBCheck notice: "Error encountered while processing an item ...; skip other
  // checks for the item." A processing-abort signal we have no equivalent for.
  'CHK-008',
  // "Undeclared prefix" — validates that a `property`/`rel` prefix (e.g. `cc:`) is bound via
  // the reserved vocabulary or a package `prefix` attribute. Prefix-declaration semantics we
  // do not model.
  'OPF-028',
])

/** Compare id, severity and wording as an order-insensitive multiset. */
export async function diffCase(c: DiffCase): Promise<CaseResult> {
  const jar = runJar(c.epub).filter((m) => !KNOWN_UNIMPLEMENTED.has(m.id))
  const ts = await runTs(c.epub)
  const key = (e: Emitted): string => `${e.severity} ${e.id} ${e.message}`
  const a = jar.map(key).sort()
  const b = ts.map(key).sort()
  return { name: c.name, jar, ts, match: JSON.stringify(a) === JSON.stringify(b) }
}
