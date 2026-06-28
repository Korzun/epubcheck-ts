# epubcheck-ts — Plan 1: Foundation + OCF Container Validation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the epubcheck-ts package and ship an end-to-end validator that fully checks EPUB **container (OCF)** structure — returning a `Report` of epubcheck-compatible messages.

**Architecture:** A pipeline of pure functions over plain data. `validateEpub(bytes)` unzips the EPUB (`openEpub` via fflate), parses XML to a positioned tree (`parseXml` via saxes), runs `validateOcf`, and aggregates messages into a `Report` (`buildReport`). Validation problems become messages; nothing throws for invalid EPUBs.

**Tech Stack:** TypeScript (ESM), `fflate` (ZIP), `saxes` (XML w/ line/column), `vitest` (tests), `tsdown` (build).

**Spec:** `docs/superpowers/specs/2026-06-28-epubcheck-ts-design.md`

## Global Constraints

These apply to every task; copied verbatim from the spec.

- **ESM-only**, TypeScript source, ship `.d.ts`. Target **ES2022 / Node 18+ / evergreen browsers**.
- **Functional style, no classes.** All structures are plain data; all behavior is functions.
- **Runtime-agnostic core:** operate on bytes (`Uint8Array | ArrayBuffer | ReadableStream<Uint8Array>`); **zero Node-only APIs** in `src/` (no `fs`, no `Buffer`, no `node:*`). Use `TextDecoder`, `DataView`, web `ReadableStream`.
- **Runtime deps:** only `fflate` and `saxes`. **Dev deps:** only `vitest`, `tsdown`, `typescript`.
- **Types live with their producer** — no types-only files.
- **Unit tests are colocated** (`foo.ts` + `foo.test.ts`). Integration tests live under `test/`.
- **Reuse epubcheck message IDs** (e.g. `PKG-006`, `RSC-002`); severities/templates come from the ported catalog.
- **`validateEpub` always resolves to a `Report`** and never rejects on a malformed EPUB.
- **License: BSD-3-Clause.**

---

## File Structure (this plan)

```
package.json                 # ESM package manifest, scripts, deps
tsconfig.json                # ES2022, strict, declaration
tsdown.config.ts             # build to dist/ (ESM + d.ts)
vitest.config.ts             # test config
.gitignore
src/
  index.ts                   # public exports + type re-exports
  validate.ts                # validateEpub() orchestration   (+ validate.test.ts)
  report.ts                  # Report type + buildReport()     (+ report.test.ts)
  messages/
    catalog.ts               # Severity type + CATALOG         (+ catalog.test.ts)
    format.ts                # Location, Message types + msg()  (+ format.test.ts)
  io/
    xml.ts                   # XmlNode type + parseXml() + element helpers  (+ xml.test.ts)
    zip.ts                   # EpubContainer, Resource types + openEpub() + getResource()  (+ zip.test.ts)
  checks/
    ocf.ts                   # validateOcf()                   (+ ocf.test.ts)
test/
  integration/
    container.test.ts        # end-to-end validateEpub over in-memory EPUBs
```

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsdown.config.ts`, `vitest.config.ts`, `.gitignore`, `src/index.ts`, `src/index.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a buildable, testable ESM package named `epubcheck-ts`; `src/index.ts` exports `VERSION`.

- [ ] **Step 1: Write the failing test**

`src/index.test.ts`
```ts
import { describe, it, expect } from 'vitest'
import { VERSION } from './index.js'

describe('package', () => {
  it('exports a VERSION string', () => {
    expect(typeof VERSION).toBe('string')
  })
})
```

- [ ] **Step 2: Create the package manifest and config**

`package.json`
```json
{
  "name": "epubcheck-ts",
  "version": "0.0.0",
  "description": "A TypeScript-native EPUB validator (library).",
  "type": "module",
  "license": "BSD-3-Clause",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsdown",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "fflate": "0.8.3",
    "saxes": "6.0.0"
  },
  "devDependencies": {
    "tsdown": "0.22.3",
    "typescript": "5.7.2",
    "vitest": "4.1.9"
  }
}
```

`tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "declaration": true,
    "verbatimModuleSyntax": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
```

`tsdown.config.ts`
```ts
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'es2022',
  // Emit .js/.d.ts (not .mjs/.d.mts) so the package "exports" contract is
  // stable; valid ESM because the package is "type": "module".
  fixedExtension: false,
})
```

`vitest.config.ts`
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
})
```

`.gitignore`
```
node_modules
dist
*.log
```

- [ ] **Step 3: Create the entry module**

`src/index.ts`
```ts
export const VERSION = '0.0.0'
```

- [ ] **Step 4: Install and run the test**

Run: `npm install && npm test`
Expected: PASS — 1 test passing.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsdown.config.ts vitest.config.ts .gitignore src/index.ts src/index.test.ts
git commit -m "chore: scaffold epubcheck-ts ESM package"
```

---

### Task 2: Message framework (catalog + format)

**Files:**
- Create: `src/messages/catalog.ts`, `src/messages/catalog.test.ts`, `src/messages/format.ts`, `src/messages/format.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Severity = 'FATAL' | 'ERROR' | 'WARNING' | 'INFO' | 'USAGE'` (from `catalog.ts`)
  - `const CATALOG: Record<string, { severity: Severity; template: string }>` (from `catalog.ts`)
  - `interface Location { path: string; line?: number; column?: number }` (from `format.ts`)
  - `interface Message { id: string; severity: Severity; message: string; location?: Location; suggestion?: string }` (from `format.ts`)
  - `function msg(id: string, location: Location | undefined, ...args: unknown[]): Message` (from `format.ts`)

- [ ] **Step 1: Write the failing test for the catalog**

`src/messages/catalog.test.ts`
```ts
import { describe, it, expect } from 'vitest'
import { CATALOG } from './catalog.js'

describe('CATALOG', () => {
  it('defines OCF/container message ids with severities', () => {
    expect(CATALOG['PKG-006']?.severity).toBe('ERROR')
    expect(CATALOG['RSC-002']?.severity).toBe('FATAL')
    expect(CATALOG['CHK-001']?.severity).toBe('FATAL')
  })

  it('templates carry positional placeholders where needed', () => {
    expect(CATALOG['RSC-005']?.template).toContain('%1$s')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/messages/catalog.test.ts`
Expected: FAIL — cannot find module `./catalog.js`.

- [ ] **Step 3: Implement the catalog**

`src/messages/catalog.ts`
```ts
export type Severity = 'FATAL' | 'ERROR' | 'WARNING' | 'INFO' | 'USAGE'

/**
 * Message catalog (id -> severity + template), porting epubcheck's message
 * vocabulary. Templates use positional placeholders: %1$s, %2$s, ...
 * This plan seeds only the OCF/container + internal ids; later plans extend it.
 */
export const CATALOG: Record<string, { severity: Severity; template: string }> = {
  // Package / container structure
  'PKG-003': { severity: 'FATAL', template: 'The EPUB could not be read: %1$s' },
  'PKG-005': { severity: 'ERROR', template: 'The mimetype file must not be compressed.' },
  'PKG-006': { severity: 'ERROR', template: 'The mimetype file entry is missing or is not the first file in the archive.' },
  'PKG-007': { severity: 'ERROR', template: "The mimetype file contains an incorrect value; expected 'application/epub+zip'." },
  // Resources
  'RSC-002': { severity: 'FATAL', template: 'The required META-INF/container.xml resource could not be found.' },
  'RSC-003': { severity: 'ERROR', template: "No rootfile with media type 'application/oebps-package+xml' was found in META-INF/container.xml." },
  'RSC-005': { severity: 'ERROR', template: "Error while parsing file '%1$s': %2$s" },
  // Internal
  'CHK-001': { severity: 'FATAL', template: 'An internal error occurred while validating: %1$s' },
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/messages/catalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for `msg`**

`src/messages/format.test.ts`
```ts
import { describe, it, expect } from 'vitest'
import { msg } from './format.js'

describe('msg', () => {
  it('builds a message from the catalog id and severity', () => {
    const m = msg('PKG-006', { path: 'OEBPS/book.epub' })
    expect(m.id).toBe('PKG-006')
    expect(m.severity).toBe('ERROR')
    expect(m.message).toContain('mimetype')
    expect(m.location?.path).toBe('OEBPS/book.epub')
  })

  it('substitutes positional placeholders', () => {
    const m = msg('RSC-005', { path: 'a.xhtml' }, 'a.xhtml', 'unexpected token')
    expect(m.message).toBe("Error while parsing file 'a.xhtml': unexpected token")
  })

  it('falls back to a readable string for unknown ids', () => {
    const m = msg('ZZZ-999', undefined)
    expect(m.id).toBe('ZZZ-999')
    expect(m.severity).toBe('ERROR')
    expect(m.message).toContain('ZZZ-999')
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run src/messages/format.test.ts`
Expected: FAIL — cannot find module `./format.js`.

- [ ] **Step 7: Implement `format.ts`**

`src/messages/format.ts`
```ts
import { CATALOG, type Severity } from './catalog.js'

export interface Location {
  path: string
  line?: number
  column?: number
}

export interface Message {
  id: string
  severity: Severity
  message: string
  location?: Location
  suggestion?: string
}

/** Replace %N$s placeholders (1-based) with the corresponding argument. */
function applyTemplate(template: string, args: unknown[]): string {
  return template.replace(/%(\d+)\$s/g, (_match, n: string) => {
    const value = args[Number(n) - 1]
    return value === undefined ? '' : String(value)
  })
}

export function msg(id: string, location: Location | undefined, ...args: unknown[]): Message {
  const entry = CATALOG[id]
  if (!entry) {
    return {
      id,
      severity: 'ERROR',
      message: `Unknown message id ${id}${args.length ? ` (${args.join(', ')})` : ''}`,
      location,
    }
  }
  return {
    id,
    severity: entry.severity,
    message: applyTemplate(entry.template, args),
    location,
  }
}
```

- [ ] **Step 8: Run both test files to verify they pass**

Run: `npx vitest run src/messages/`
Expected: PASS — all tests in both files.

- [ ] **Step 9: Commit**

```bash
git add src/messages/
git commit -m "feat: add message catalog and formatter"
```

---

### Task 3: Report aggregation

**Files:**
- Create: `src/report.ts`, `src/report.test.ts`

**Interfaces:**
- Consumes: `Message`, `Severity` from `messages/`.
- Produces:
  - `interface Report { messages: Message[]; epubVersion?: '2.0' | '3.0'; counts: Record<Severity, number>; fatal: boolean; valid: boolean }`
  - `function buildReport(messages: Message[], epubVersion?: '2.0' | '3.0'): Report`

- [ ] **Step 1: Write the failing test**

`src/report.test.ts`
```ts
import { describe, it, expect } from 'vitest'
import { buildReport } from './report.js'
import type { Message } from './messages/format.js'

const m = (severity: Message['severity']): Message => ({ id: 'X', severity, message: '' })

describe('buildReport', () => {
  it('counts messages by severity', () => {
    const r = buildReport([m('ERROR'), m('ERROR'), m('WARNING')])
    expect(r.counts.ERROR).toBe(2)
    expect(r.counts.WARNING).toBe(1)
    expect(r.counts.FATAL).toBe(0)
  })

  it('is invalid when there is any ERROR or FATAL', () => {
    expect(buildReport([m('ERROR')]).valid).toBe(false)
    expect(buildReport([m('FATAL')]).fatal).toBe(true)
    expect(buildReport([m('WARNING')]).valid).toBe(true)
    expect(buildReport([]).valid).toBe(true)
  })

  it('records the epub version when provided', () => {
    expect(buildReport([], '3.0').epubVersion).toBe('3.0')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/report.test.ts`
Expected: FAIL — cannot find module `./report.js`.

- [ ] **Step 3: Implement `report.ts`**

`src/report.ts`
```ts
import type { Message, Severity } from './messages/format.js'

export interface Report {
  messages: Message[]
  epubVersion?: '2.0' | '3.0'
  counts: Record<Severity, number>
  fatal: boolean
  valid: boolean
}

export function buildReport(messages: Message[], epubVersion?: '2.0' | '3.0'): Report {
  const counts: Record<Severity, number> = { FATAL: 0, ERROR: 0, WARNING: 0, INFO: 0, USAGE: 0 }
  for (const message of messages) counts[message.severity]++
  return {
    messages,
    epubVersion,
    counts,
    fatal: counts.FATAL > 0,
    valid: counts.FATAL === 0 && counts.ERROR === 0,
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/report.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/report.ts src/report.test.ts
git commit -m "feat: add report aggregation"
```

---

### Task 4: XML parsing (positioned tree)

**Files:**
- Create: `src/io/xml.ts`, `src/io/xml.test.ts`

**Interfaces:**
- Consumes: `Location`, `Message` from `messages/format.js`; `saxes`.
- Produces:
  - `interface XmlNode { type: 'element' | 'text'; name?: string; ns?: string; attrs?: Record<string, string>; children?: XmlNode[]; text?: string; loc: Location }`
  - `function parseXml(bytes: Uint8Array, path: string): { root?: XmlNode; messages: Message[] }`
  - `function childElements(node: XmlNode): XmlNode[]`
  - `function findDescendants(node: XmlNode, localName: string): XmlNode[]` — matches by local name (namespace-prefix-insensitive)

- [ ] **Step 1: Write the failing test**

`src/io/xml.test.ts`
```ts
import { describe, it, expect } from 'vitest'
import { parseXml, findDescendants, childElements } from './xml.js'

const enc = (s: string) => new TextEncoder().encode(s)

describe('parseXml', () => {
  it('builds a positioned element tree', () => {
    const { root, messages } = parseXml(enc('<root><a>hi</a></root>'), 'm.xml')
    expect(messages).toHaveLength(0)
    expect(root?.name).toBe('root')
    const a = childElements(root!)[0]!
    expect(a.name).toBe('a')
    expect(a.loc.path).toBe('m.xml')
    expect(typeof a.loc.line).toBe('number')
  })

  it('exposes attributes and resolved namespaces', () => {
    const xml = '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfile full-path="a.opf"/></container>'
    const { root } = parseXml(enc(xml), 'container.xml')
    expect(root?.ns).toBe('urn:oasis:names:tc:opendocument:xmlns:container')
    const rootfile = findDescendants(root!, 'rootfile')[0]!
    expect(rootfile.attrs?.['full-path']).toBe('a.opf')
  })

  it('reports a message on malformed XML instead of throwing', () => {
    const { root, messages } = parseXml(enc('<root><a></root>'), 'bad.xml')
    expect(root).toBeUndefined()
    expect(messages[0]?.id).toBe('RSC-005')
    expect(messages[0]?.location?.path).toBe('bad.xml')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/io/xml.test.ts`
Expected: FAIL — cannot find module `./xml.js`.

- [ ] **Step 3: Implement `xml.ts`**

`src/io/xml.ts`
```ts
import { SaxesParser, type SaxesTagNS } from 'saxes'
import { msg, type Location, type Message } from '../messages/format.js'

export interface XmlNode {
  type: 'element' | 'text'
  name?: string
  ns?: string
  attrs?: Record<string, string>
  children?: XmlNode[]
  text?: string
  loc: Location
}

function decode(bytes: Uint8Array): string {
  const text = new TextDecoder('utf-8').decode(bytes)
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

export function parseXml(bytes: Uint8Array, path: string): { root?: XmlNode; messages: Message[] } {
  const parser = new SaxesParser<object>({ xmlns: true, position: true })
  const messages: Message[] = []

  // Synthetic root holds the document element as its single child.
  const document: XmlNode = { type: 'element', children: [], loc: { path } }
  const stack: XmlNode[] = [document]

  parser.on('opentag', (tag: SaxesTagNS) => {
    const attrs: Record<string, string> = {}
    for (const [key, value] of Object.entries(tag.attributes)) attrs[key] = value.value
    const node: XmlNode = {
      type: 'element',
      name: tag.local,
      ns: tag.uri || undefined,
      attrs,
      children: [],
      loc: { path, line: parser.line, column: parser.column },
    }
    stack[stack.length - 1]!.children!.push(node)
    stack.push(node)
  })

  parser.on('text', (value: string) => {
    if (value.trim() === '') return
    stack[stack.length - 1]!.children!.push({ type: 'text', text: value, loc: { path } })
  })

  parser.on('closetag', () => {
    stack.pop()
  })

  let failed = false
  parser.on('error', (err: Error) => {
    if (failed) return
    failed = true
    messages.push(msg('RSC-005', { path, line: parser.line, column: parser.column }, path, err.message))
  })

  try {
    parser.write(decode(bytes)).close()
  } catch {
    // saxes throws after the error handler runs; the message is already recorded.
  }

  if (failed) return { messages }
  return { root: document.children![0] as XmlNode | undefined, messages }
}

/** Element children of a node (text nodes filtered out). */
export function childElements(node: XmlNode): XmlNode[] {
  return (node.children ?? []).filter((c) => c.type === 'element')
}

/** All descendant elements (any depth) whose local name matches. */
export function findDescendants(node: XmlNode, localName: string): XmlNode[] {
  const out: XmlNode[] = []
  const walk = (n: XmlNode) => {
    for (const child of n.children ?? []) {
      if (child.type === 'element') {
        if (child.name === localName) out.push(child)
        walk(child)
      }
    }
  }
  walk(node)
  return out
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/io/xml.test.ts`
Expected: PASS — all three tests.

- [ ] **Step 5: Commit**

```bash
git add src/io/xml.ts src/io/xml.test.ts
git commit -m "feat: add positioned XML parser"
```

---

### Task 5: ZIP reader + container (`openEpub`)

**Files:**
- Create: `src/io/zip.ts`, `src/io/zip.test.ts`

**Interfaces:**
- Consumes: `parseXml`, `findDescendants` from `./xml.js`; `unzipSync` from `fflate`.
- Produces:
  - `interface Resource { path: string; bytes: Uint8Array; compression: 'stored' | 'deflate'; mediaType?: string }`
  - `interface EpubContainer { resources: Map<string, Resource>; rootfiles: string[]; hasEncryption: boolean }`
  - `function openEpub(input: Uint8Array | ArrayBuffer | ReadableStream<Uint8Array>): Promise<EpubContainer>` — resources are inserted in ZIP central-directory order. Throws only if the bytes are not a readable ZIP (caller turns that into a `PKG-003`).
  - `function getResource(container: EpubContainer, path: string): Resource | undefined`

- [ ] **Step 1: Write the failing test**

`src/io/zip.test.ts`
```ts
import { describe, it, expect } from 'vitest'
import { zipSync } from 'fflate'
import { openEpub, getResource } from './zip.js'

const enc = (s: string) => new TextEncoder().encode(s)

function makeEpub(extra: Record<string, [Uint8Array, { level: 0 | 6 }]> = {}) {
  return zipSync({
    mimetype: [enc('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': [
      enc(
        '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">' +
          '<rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles>' +
          '</container>',
      ),
      { level: 6 },
    ],
    ...extra,
  })
}

describe('openEpub', () => {
  it('reads resources in order and marks compression', async () => {
    const c = await openEpub(makeEpub())
    const names = [...c.resources.keys()]
    expect(names[0]).toBe('mimetype')
    expect(getResource(c, 'mimetype')?.compression).toBe('stored')
    expect(getResource(c, 'META-INF/container.xml')?.compression).toBe('deflate')
  })

  it('extracts rootfiles from container.xml', async () => {
    const c = await openEpub(makeEpub())
    expect(c.rootfiles).toEqual(['EPUB/package.opf'])
  })

  it('flags encryption when META-INF/encryption.xml is present', async () => {
    const c = await openEpub(makeEpub({ 'META-INF/encryption.xml': [enc('<encryption/>'), { level: 6 }] }))
    expect(c.hasEncryption).toBe(true)
  })

  it('accepts an ArrayBuffer', async () => {
    const bytes = makeEpub()
    const c = await openEpub(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    expect(c.resources.has('mimetype')).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/io/zip.test.ts`
Expected: FAIL — cannot find module `./zip.js`.

- [ ] **Step 3: Implement `zip.ts`**

`src/io/zip.ts`
```ts
import { unzipSync } from 'fflate'
import { parseXml, findDescendants } from './xml.js'

export interface Resource {
  path: string
  bytes: Uint8Array
  compression: 'stored' | 'deflate'
  mediaType?: string
}

export interface EpubContainer {
  resources: Map<string, Resource>
  rootfiles: string[]
  hasEncryption: boolean
}

async function toBytes(
  input: Uint8Array | ArrayBuffer | ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  // web ReadableStream<Uint8Array>
  const reader = input.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.byteLength
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/**
 * Walk the ZIP central directory to recover entry order and compression method.
 * Returns names in directory order with method (0 = stored, 8 = deflate).
 */
function readCentralDirectory(bytes: Uint8Array): Array<{ name: string; method: number }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // Locate End Of Central Directory record (signature 0x06054b50), scanning backward.
  let eocd = -1
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Not a ZIP archive: missing end-of-central-directory record')

  const count = view.getUint16(eocd + 10, true)
  let p = view.getUint32(eocd + 16, true) // central directory offset
  const decoder = new TextDecoder('utf-8')
  const entries: Array<{ name: string; method: number }> = []

  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) break // central file header signature
    const method = view.getUint16(p + 10, true)
    const nameLen = view.getUint16(p + 28, true)
    const extraLen = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen))
    entries.push({ name, method })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

export async function openEpub(
  input: Uint8Array | ArrayBuffer | ReadableStream<Uint8Array>,
): Promise<EpubContainer> {
  const bytes = await toBytes(input)
  const order = readCentralDirectory(bytes) // throws if not a ZIP
  const content = unzipSync(bytes)

  const resources = new Map<string, Resource>()
  for (const { name, method } of order) {
    const data = content[name]
    if (!data) continue // directory entry or unsupported; skip
    resources.set(name, {
      path: name,
      bytes: data,
      compression: method === 0 ? 'stored' : 'deflate',
    })
  }

  const rootfiles = extractRootfiles(resources)
  return {
    resources,
    rootfiles,
    hasEncryption: resources.has('META-INF/encryption.xml'),
  }
}

function extractRootfiles(resources: Map<string, Resource>): string[] {
  const container = resources.get('META-INF/container.xml')
  if (!container) return []
  const { root } = parseXml(container.bytes, 'META-INF/container.xml')
  if (!root) return []
  return findDescendants(root, 'rootfile')
    .filter((rf) => rf.attrs?.['media-type'] === 'application/oebps-package+xml')
    .map((rf) => rf.attrs?.['full-path'])
    .filter((path): path is string => typeof path === 'string')
}

export function getResource(container: EpubContainer, path: string): Resource | undefined {
  return container.resources.get(path)
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/io/zip.test.ts`
Expected: PASS — all four tests.

- [ ] **Step 5: Commit**

```bash
git add src/io/zip.ts src/io/zip.test.ts
git commit -m "feat: add ZIP reader and container loader"
```

---

### Task 6: OCF container checks (`validateOcf`)

**Files:**
- Create: `src/checks/ocf.ts`, `src/checks/ocf.test.ts`

**Interfaces:**
- Consumes: `EpubContainer`, `getResource` from `../io/zip.js`; `msg`, `Message` from `../messages/format.js`.
- Produces: `function validateOcf(container: EpubContainer): Message[]`
- Rules implemented:
  - **PKG-006** (ERROR): first resource is not named `mimetype`.
  - **PKG-007** (ERROR): `mimetype` content is not exactly `application/epub+zip`.
  - **PKG-005** (ERROR): `mimetype` entry is compressed (not stored).
  - **RSC-002** (FATAL): `META-INF/container.xml` is missing.
  - **RSC-003** (ERROR): `container.xml` present but yields no rootfile (only when container.xml exists).

- [ ] **Step 1: Write the failing test**

`src/checks/ocf.test.ts`
```ts
import { describe, it, expect } from 'vitest'
import type { EpubContainer, Resource } from '../io/zip.js'
import { validateOcf } from './ocf.js'

const enc = (s: string) => new TextEncoder().encode(s)

function container(
  entries: Array<[string, Partial<Resource> & { bytes?: Uint8Array }]>,
  opts: { rootfiles?: string[]; hasEncryption?: boolean } = {},
): EpubContainer {
  const resources = new Map<string, Resource>()
  for (const [path, r] of entries) {
    resources.set(path, {
      path,
      bytes: r.bytes ?? new Uint8Array(),
      compression: r.compression ?? 'deflate',
    })
  }
  return { resources, rootfiles: opts.rootfiles ?? [], hasEncryption: opts.hasEncryption ?? false }
}

const ids = (c: EpubContainer) => validateOcf(c).map((m) => m.id)

describe('validateOcf', () => {
  const goodMimetype: [string, Partial<Resource>] = [
    'mimetype',
    { bytes: enc('application/epub+zip'), compression: 'stored' },
  ]

  it('passes a well-formed container', () => {
    const c = container(
      [goodMimetype, ['META-INF/container.xml', { bytes: enc('<container/>') }]],
      { rootfiles: ['EPUB/package.opf'] },
    )
    expect(ids(c)).toEqual([])
  })

  it('flags PKG-006 when mimetype is not first', () => {
    const c = container(
      [['META-INF/container.xml', {}], goodMimetype],
      { rootfiles: ['EPUB/package.opf'] },
    )
    expect(ids(c)).toContain('PKG-006')
  })

  it('flags PKG-005 when mimetype is compressed', () => {
    const c = container(
      [['mimetype', { bytes: enc('application/epub+zip'), compression: 'deflate' }], ['META-INF/container.xml', {}]],
      { rootfiles: ['EPUB/package.opf'] },
    )
    expect(ids(c)).toContain('PKG-005')
  })

  it('flags PKG-007 when mimetype content is wrong', () => {
    const c = container(
      [['mimetype', { bytes: enc('text/plain'), compression: 'stored' }], ['META-INF/container.xml', {}]],
      { rootfiles: ['EPUB/package.opf'] },
    )
    expect(ids(c)).toContain('PKG-007')
  })

  it('flags RSC-002 when container.xml is missing', () => {
    const c = container([goodMimetype])
    expect(ids(c)).toContain('RSC-002')
  })

  it('flags RSC-003 when container.xml has no rootfile', () => {
    const c = container([goodMimetype, ['META-INF/container.xml', { bytes: enc('<container/>') }]])
    expect(ids(c)).toContain('RSC-003')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/checks/ocf.test.ts`
Expected: FAIL — cannot find module `./ocf.js`.

- [ ] **Step 3: Implement `ocf.ts`**

`src/checks/ocf.ts`
```ts
import { getResource, type EpubContainer } from '../io/zip.js'
import { msg, type Message } from '../messages/format.js'

const MIMETYPE = 'mimetype'
const EPUB_MEDIA_TYPE = 'application/epub+zip'
const CONTAINER_PATH = 'META-INF/container.xml'

export function validateOcf(container: EpubContainer): Message[] {
  const messages: Message[] = []

  // --- mimetype rules ---
  const firstKey = container.resources.keys().next().value
  const mimetype = getResource(container, MIMETYPE)
  if (firstKey !== MIMETYPE || !mimetype) {
    messages.push(msg('PKG-006', { path: MIMETYPE }))
  }
  if (mimetype) {
    if (mimetype.compression !== 'stored') {
      messages.push(msg('PKG-005', { path: MIMETYPE }))
    }
    const value = new TextDecoder('utf-8').decode(mimetype.bytes)
    if (value !== EPUB_MEDIA_TYPE) {
      messages.push(msg('PKG-007', { path: MIMETYPE }))
    }
  }

  // --- container.xml + rootfile rules ---
  const containerXml = getResource(container, CONTAINER_PATH)
  if (!containerXml) {
    messages.push(msg('RSC-002', { path: CONTAINER_PATH }))
  } else if (container.rootfiles.length === 0) {
    messages.push(msg('RSC-003', { path: CONTAINER_PATH }))
  }

  return messages
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/checks/ocf.test.ts`
Expected: PASS — all six tests.

- [ ] **Step 5: Commit**

```bash
git add src/checks/ocf.ts src/checks/ocf.test.ts
git commit -m "feat: add OCF container validation"
```

---

### Task 7: Orchestration (`validateEpub`) + public exports + integration

**Files:**
- Create: `src/validate.ts`, `src/validate.test.ts`, `test/integration/container.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `openEpub`, `getResource`, `EpubContainer`, `Resource` from `./io/zip.js`; `parseXml`, `childElements`, `findDescendants`, `XmlNode` from `./io/xml.js`; `validateOcf` from `./checks/ocf.js`; `buildReport`, `Report` from `./report.js`; `msg`, `Message`, `Location`, `Severity` from `./messages/`.
- Produces:
  - `interface ValidateOptions { version?: '2.0' | '3.0' }`
  - `function validateEpub(input: Uint8Array | ArrayBuffer | ReadableStream<Uint8Array>, options?: ValidateOptions): Promise<Report>` — **never rejects**; ZIP-open failure becomes a `PKG-003` FATAL; unexpected internal errors become `CHK-001` FATAL.
  - `src/index.ts` re-exports the public API + types.

- [ ] **Step 1: Write the failing unit test**

`src/validate.test.ts`
```ts
import { describe, it, expect } from 'vitest'
import { zipSync } from 'fflate'
import { validateEpub } from './validate.js'

const enc = (s: string) => new TextEncoder().encode(s)

describe('validateEpub', () => {
  it('returns a FATAL PKG-003 (never throws) for non-zip input', async () => {
    const report = await validateEpub(enc('not a zip'))
    expect(report.fatal).toBe(true)
    expect(report.messages[0]?.id).toBe('PKG-003')
  })

  it('runs OCF checks for a real archive', async () => {
    const bytes = zipSync({
      'META-INF/container.xml': [enc('<container/>'), { level: 6 }], // mimetype missing & not first
    })
    const report = await validateEpub(bytes)
    const ids = report.messages.map((m) => m.id)
    expect(ids).toContain('PKG-006')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/validate.test.ts`
Expected: FAIL — cannot find module `./validate.js`.

- [ ] **Step 3: Implement `validate.ts`**

`src/validate.ts`
```ts
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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/validate.test.ts`
Expected: PASS — both tests.

- [ ] **Step 5: Wire up public exports**

Replace `src/index.ts` with:
```ts
export const VERSION = '0.0.0'

// Primary + layered API
export { validateEpub, type ValidateOptions } from './validate.js'
export { openEpub, getResource } from './io/zip.js'
export { parseXml, childElements, findDescendants } from './io/xml.js'
export { validateOcf } from './checks/ocf.js'
export { buildReport } from './report.js'
export { msg } from './messages/format.js'

// Types
export type { Report } from './report.js'
export type { Message, Location } from './messages/format.js'
export type { Severity } from './messages/catalog.js'
export type { EpubContainer, Resource } from './io/zip.js'
export type { XmlNode } from './io/xml.js'
```

- [ ] **Step 6: Update the package smoke test**

Replace `src/index.test.ts` with:
```ts
import { describe, it, expect } from 'vitest'
import { VERSION, validateEpub, openEpub, validateOcf } from './index.js'

describe('public API', () => {
  it('exports the entry points', () => {
    expect(typeof VERSION).toBe('string')
    expect(typeof validateEpub).toBe('function')
    expect(typeof openEpub).toBe('function')
    expect(typeof validateOcf).toBe('function')
  })
})
```

- [ ] **Step 7: Write the end-to-end integration test**

`test/integration/container.test.ts`
```ts
import { describe, it, expect } from 'vitest'
import { zipSync } from 'fflate'
import { validateEpub } from '../../src/index.js'

const enc = (s: string) => new TextEncoder().encode(s)

const CONTAINER = enc(
  '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">' +
    '<rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles>' +
    '</container>',
)

describe('integration: container validation', () => {
  it('reports no OCF errors for a structurally valid container', async () => {
    const bytes = zipSync({
      mimetype: [enc('application/epub+zip'), { level: 0 }],
      'META-INF/container.xml': [CONTAINER, { level: 6 }],
      'EPUB/package.opf': [enc('<package/>'), { level: 6 }],
    })
    const report = await validateEpub(bytes)
    // No OCF-layer messages (OPF/content checks arrive in later plans).
    const ocfIds = report.messages.map((m) => m.id).filter((id) => id.startsWith('PKG') || id === 'RSC-002' || id === 'RSC-003')
    expect(ocfIds).toEqual([])
  })

  it('reports container errors for an EPUB missing its mimetype', async () => {
    const bytes = zipSync({ 'META-INF/container.xml': [CONTAINER, { level: 6 }] })
    const report = await validateEpub(bytes)
    expect(report.messages.map((m) => m.id)).toContain('PKG-006')
    expect(report.valid).toBe(false)
  })
})
```

- [ ] **Step 8: Run the whole suite + typecheck + build**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck clean; all tests PASS; `dist/index.js` + `dist/index.d.ts` produced.

- [ ] **Step 9: Commit**

```bash
git add src/validate.ts src/validate.test.ts src/index.ts src/index.test.ts test/integration/container.test.ts
git commit -m "feat: wire validateEpub orchestration and public API"
```

---

## Roadmap (subsequent plans)

Each is written when reached, follows this same TDD/commit structure, and extends the catalog + orchestration already in place. `validateEpub` already has the seam (after `validateOcf`) where these slot in.

- **Plan 2 — OPF package:** `parse/opf.ts` (`PackageDocument`, `ManifestItem`, `SpineItem`, `Metadata`, `parseOpf`) + `checks/opf.ts` (`validateOpf`): manifest/spine integrity, required EPUB 3 metadata, media types, manifest↔resource cross-refs, `nav` item identification, version detection feeding `Report.epubVersion`.
- **Plan 3 — Navigation:** `parse/nav.ts` (`NavDocument`, `parseNav`) + `checks/nav.ts` (`validateNav`): toc nav presence + structure.
- **Plan 4 — XHTML content:** `parse/content.ts` + `checks/content.ts` (`validateContentDocs`): well-formedness, allowed element/attribute subset, reference resolution, fragment ids.
- **Plan 5 — Fixture corpus:** port a curated subset of epubcheck's `src/test/resources` EPUBs into `test/fixtures/` (+ `ATTRIBUTION`), with an integration harness asserting the emitted `{ id, severity }` set per fixture.

---

## Self-Review

**Spec coverage (Plan 1 portion):** §3 pipeline → Task 7; §4 layout → Tasks 1–7 (OCF slice); §5 types `Severity`/`Location`/`Message`/`Report`/`XmlNode`/`EpubContainer`/`Resource` → Tasks 2–5; §6 catalog+`msg` → Task 2; §7 API (`validateEpub`, `openEpub`, `getResource`, `validateOcf`, `parseXml`, type re-exports) → Tasks 5–7; §8 short-circuit/never-throw → Task 7; §10 Vitest + colocated unit + integration → all tasks + Task 7; §11 ESM/tsdown/deps → Task 1. OPF/nav/content (§2 layers 2–4) and §9/§12 deferred to Plans 2–5 (roadmap). No Plan-1 gaps.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; the only comments describing future work are in the roadmap section and the documented orchestration seam, not in place of implementation.

**Type consistency:** `Severity`/`Location`/`Message` defined in Task 2 and imported unchanged in Tasks 3–7. `Report`/`buildReport` (Task 3) used in Task 7 with matching signature. `EpubContainer`/`Resource`/`openEpub`/`getResource` (Task 5) consumed by Tasks 6–7 with matching shapes. `XmlNode`/`parseXml`/`findDescendants`/`childElements` (Task 4) consumed by Task 5 and re-exported in Task 7. `validateOcf` signature identical in Tasks 6 and 7. All `index.ts` re-exports point to symbols that exist.
```
