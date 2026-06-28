# epubcheck-ts — Plan 2: OPF Package Document Parsing + Validation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse the EPUB 3 package document (OPF) into a plain-data `PackageDocument` and validate its metadata, manifest, spine, and navigation declarations — feeding the detected version into the `Report` and surfacing epubcheck-compatible messages.

**Architecture:** Same pure-function pipeline as Plan 1. A new `parseOpf(container)` reads the rootfile OPF into a `PackageDocument`; a new `validateOpf(pkg, container)` runs package/manifest/spine/nav checks. `validateEpub` calls them after `validateOcf`, threading the OPF version into the report. No schema engine — every rule is an explicit TS check.

**Tech Stack:** TypeScript (ESM), reuses Plan 1's `parseXml` (saxes), `openEpub` (fflate), message catalog, and report aggregation.

**Spec:** `docs/superpowers/specs/2026-06-28-epubcheck-ts-design.md` (§2 OPF surface, §5 `PackageDocument` types, §6 check framework, §7 API).

## Global Constraints

Apply to every task; copied from the spec + Plan 1.

- **ESM-only**, TypeScript source, ship `.d.ts`. Target **ES2022 / Node 18+ / evergreen browsers**.
- **Functional style, no classes.** Plain data + functions only.
- **Runtime-agnostic core:** zero Node-only APIs in `src/` (no `fs`, `Buffer`, `node:*`). `TextDecoder`/`DataView`/web `ReadableStream` only.
- **Runtime deps:** only `fflate` + `saxes`. **Dev deps:** only `vitest`, `tsdown`, `typescript`, `eslint`, `@eslint/js`, `typescript-eslint`.
- **Types live with their producer** — no types-only files.
- **Unit tests colocated** (`foo.ts` + `foo.test.ts`); integration tests under `test/`.
- **Lint is type-aware** (ESLint flat config). Every task must keep `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` green.
- **`validateEpub` always resolves to a `Report`** and never rejects.
- **Message-ID strategy (decided):** use the specific epubcheck IDs where epubcheck assigns one at the Java level; for rules epubcheck only enforces via its RelaxNG/Schematron schemas, emit **`RSC-005`** with a clear, rule-specific detail string (this matches what epubcheck actually reports to users).

### Carry-forwards from Plan 1 (honor these)

- `XmlNode.attrs` keys are **qualified** names. OPF attributes (`id`, `href`, `media-type`, `properties`, `idref`, `linear`, `version`, `unique-identifier`, `property`, `refines`) are all **unprefixed**, so plain string keys are correct here.
- `XmlNode.name` is the **local** name; `XmlNode.ns` is the resolved **namespace URI**. Match `dc:*` elements by `ns === DC_NS && name === 'identifier'` etc.
- In `validate.ts`, all steps after `openEpub` are non-throwing pure functions, so the `try/catch` only ever catches `openEpub` failures (when the message list is still empty). Keep that invariant and document it (Task 7).

---

## Reference: epubcheck message IDs used in this plan

Sourced from `w3c/epubcheck` (`MessageBundle.properties` + `DefaultSeverities.java`). Templates verbatim.

| ID | Severity | Template | Used for |
|----|----------|----------|----------|
| `OPF-001` | ERROR | `There was an error when parsing the EPUB version: %1$s` | version attr missing / unsupported |
| `OPF-030` | ERROR | `The unique-identifier "%1$s" was not found.` | unique-identifier doesn't match a dc:identifier id |
| `OPF-033` | ERROR | `The spine contains no linear resources.` | spine has itemrefs but none linear |
| `OPF-048` | ERROR | `Package tag is missing its required unique-identifier attribute and value.` | unique-identifier attr absent |
| `OPF-049` | ERROR | `Item id "%1$s" was not found in the manifest.` | spine itemref idref has no matching item |
| `OPF-074` | ERROR | `Package resource "%1$s" is declared in several manifest item.` | two manifest items resolve to same URL |
| `RSC-001` | ERROR | `File "%1$s" could not be found.` | manifest item href not present in container |
| `RSC-005` | ERROR | `Error while parsing file '%1$s': %2$s` | (Plan 1 form) schema-enforced rules — `%2$s` = rule-specific detail |

`RSC-005` already exists in the catalog (Plan 1) with the two-arg `(path, detail)` form — reuse it. The rule-specific detail strings are defined inline in the checks (Tasks 4–6) and mirror epubcheck's Schematron assert text where one exists.

### Deferred (NOT in this plan)

`OPF-003` undeclared-file (USAGE; needs an exclusion list), `PKG-001` version-mismatch warning, `RSC-016` fatal-parse distinction (our `parseXml` reports all parse errors as `RSC-005`), fallback-chain validation, collections, `guide`, remote-resource policy, properties-vocabulary validation, EPUB 2 specifics. Note these in the roadmap, don't implement.

---

## File Structure (this plan)

```
src/
  util/
    path.ts              # resolvePath(fromFile, href)  — container path resolution  (+ path.test.ts)
  parse/
    opf.ts               # PackageDocument + parseOpf()  (+ opf.test.ts)
  checks/
    opf.ts               # validateOpf()                 (+ opf.test.ts)
  messages/
    catalog.ts           # (modify) add OPF-001/030/033/048/049/074, RSC-001
  validate.ts            # (modify) call parseOpf + validateOpf; thread version
  index.ts               # (modify) export parseOpf, validateOpf + OPF types
test/
  integration/
    opf.test.ts          # end-to-end validateEpub over in-memory EPUBs
```

---

### Task 1: Extend the message catalog with OPF IDs

**Files:**
- Modify: `src/messages/catalog.ts`
- Modify: `src/messages/catalog.test.ts`

**Interfaces:**
- Consumes: existing `Severity`, `CATALOG`.
- Produces: catalog entries for `OPF-001`, `OPF-030`, `OPF-033`, `OPF-048`, `OPF-049`, `OPF-074`, `RSC-001` (each `{ severity, template }`). `RSC-005` is unchanged.

- [ ] **Step 1: Add the failing test**

Append to `src/messages/catalog.test.ts` inside the existing `describe('CATALOG', ...)` block:
```ts
  it('defines OPF package message ids with severities', () => {
    expect(CATALOG['OPF-001']?.severity).toBe('ERROR')
    expect(CATALOG['OPF-030']?.severity).toBe('ERROR')
    expect(CATALOG['OPF-033']?.severity).toBe('ERROR')
    expect(CATALOG['OPF-048']?.severity).toBe('ERROR')
    expect(CATALOG['OPF-049']?.severity).toBe('ERROR')
    expect(CATALOG['OPF-074']?.severity).toBe('ERROR')
    expect(CATALOG['RSC-001']?.severity).toBe('ERROR')
  })

  it('OPF templates carry the expected placeholders', () => {
    expect(CATALOG['OPF-030']?.template).toContain('%1$s')
    expect(CATALOG['OPF-049']?.template).toContain('%1$s')
    expect(CATALOG['RSC-001']?.template).toContain('%1$s')
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/messages/catalog.test.ts`
Expected: FAIL — `OPF-001` etc. are `undefined`.

- [ ] **Step 3: Add the catalog entries**

In `src/messages/catalog.ts`, add these entries to the `CATALOG` object (after the existing `RSC-*` block, before `CHK-001`):
```ts
  // Package / OPF semantics
  'OPF-001': { severity: 'ERROR', template: 'There was an error when parsing the EPUB version: %1$s' },
  'OPF-030': { severity: 'ERROR', template: 'The unique-identifier "%1$s" was not found.' },
  'OPF-033': { severity: 'ERROR', template: 'The spine contains no linear resources.' },
  'OPF-048': { severity: 'ERROR', template: 'Package tag is missing its required unique-identifier attribute and value.' },
  'OPF-049': { severity: 'ERROR', template: 'Item id "%1$s" was not found in the manifest.' },
  'OPF-074': { severity: 'ERROR', template: 'Package resource "%1$s" is declared in several manifest item.' },
  'RSC-001': { severity: 'ERROR', template: 'File "%1$s" could not be found.' },
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/messages/catalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/messages/catalog.ts src/messages/catalog.test.ts
git commit -m "feat: add OPF message ids to catalog"
```

---

### Task 2: Container path resolution util

**Files:**
- Create: `src/util/path.ts`, `src/util/path.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `function resolvePath(fromFile: string, href: string): string` — resolves a manifest/content `href` (relative to the file it appears in) to a normalized container path. Strips fragment (`#…`) and query (`?…`), decodes percent-encoding, and normalizes `.`/`..`. A leading `/` is treated as container-root-relative.

- [ ] **Step 1: Write the failing test**

`src/util/path.test.ts`
```ts
import { describe, it, expect } from 'vitest'
import { resolvePath } from './path.js'

describe('resolvePath', () => {
  it('resolves a sibling-dir href relative to the OPF', () => {
    expect(resolvePath('EPUB/package.opf', 'xhtml/c1.xhtml')).toBe('EPUB/xhtml/c1.xhtml')
  })
  it('resolves parent traversal', () => {
    expect(resolvePath('EPUB/package.opf', '../images/a.png')).toBe('images/a.png')
  })
  it('resolves a leading ./', () => {
    expect(resolvePath('EPUB/package.opf', './style.css')).toBe('EPUB/style.css')
  })
  it('handles an OPF at the container root', () => {
    expect(resolvePath('package.opf', 'c1.xhtml')).toBe('c1.xhtml')
  })
  it('strips a fragment', () => {
    expect(resolvePath('EPUB/package.opf', 'c1.xhtml#frag')).toBe('EPUB/c1.xhtml')
  })
  it('decodes percent-encoding', () => {
    expect(resolvePath('EPUB/package.opf', 'a%20b.xhtml')).toBe('EPUB/a b.xhtml')
  })
  it('treats a leading slash as container-root-relative', () => {
    expect(resolvePath('EPUB/package.opf', '/EPUB/c1.xhtml')).toBe('EPUB/c1.xhtml')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/util/path.test.ts`
Expected: FAIL — cannot find module `./path.js`.

- [ ] **Step 3: Implement `path.ts`**

`src/util/path.ts`
```ts
/**
 * Resolve an href that appears inside `fromFile` to a normalized container path.
 * Strips fragment/query, decodes percent-encoding, normalizes "." and "..".
 * A leading "/" is container-root-relative.
 */
export function resolvePath(fromFile: string, href: string): string {
  const noFragment = href.split('#')[0] ?? ''
  const clean = noFragment.split('?')[0] ?? ''
  let decoded: string
  try {
    decoded = decodeURIComponent(clean)
  } catch {
    decoded = clean
  }

  const absolute = decoded.startsWith('/')
  const target = absolute ? decoded.slice(1) : decoded
  const baseDir =
    fromFile.includes('/') ? fromFile.slice(0, fromFile.lastIndexOf('/')) : ''
  const stack: string[] = absolute || baseDir === '' ? [] : baseDir.split('/')

  for (const part of target.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') stack.pop()
    else stack.push(part)
  }
  return stack.join('/')
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/util/path.test.ts`
Expected: PASS — all seven tests.

- [ ] **Step 5: Commit**

```bash
git add src/util/path.ts src/util/path.test.ts
git commit -m "feat: add container path resolution util"
```

---

### Task 3: Parse the package document (`parseOpf`)

**Files:**
- Create: `src/parse/opf.ts`, `src/parse/opf.test.ts`

**Interfaces:**
- Consumes: `parseXml`, `childElements`, `XmlNode` from `../io/xml.js`; `getResource`, `EpubContainer` from `../io/zip.js`; `msg`, `Location`, `Message` from `../messages/format.js`.
- Produces:
  - `interface DcIdentifier { id?: string; value: string }`
  - `interface Metadata { identifiers: DcIdentifier[]; titles: string[]; languages: string[]; modifiedCount: number }`
  - `interface ManifestItem { id?: string; href?: string; mediaType?: string; properties: string[]; fallback?: string; loc: Location }`
  - `interface SpineItem { idref?: string; linear: boolean; properties: string[]; loc: Location }`
  - `interface PackageDocument { path: string; version?: string; uniqueIdentifier?: string; metadata: Metadata; manifest: ManifestItem[]; spinePresent: boolean; spine: SpineItem[]; loc: Location }`
  - `function parseOpf(container: EpubContainer): { pkg?: PackageDocument; messages: Message[] }` — reads `container.rootfiles[0]`. No rootfile → `{ messages: [] }` (OCF already reported it). OPF resource missing → `RSC-001`. Unparseable XML → the `RSC-005` from `parseXml`. Returns `pkg` only when a `<package>` root parsed.

- [ ] **Step 1: Write the failing test**

`src/parse/opf.test.ts`
```ts
import { describe, it, expect } from 'vitest'
import type { EpubContainer, Resource } from '../io/zip.js'
import { parseOpf } from './opf.js'

const enc = (s: string) => new TextEncoder().encode(s)

function container(opfXml: string | undefined, opfPath = 'EPUB/package.opf'): EpubContainer {
  const resources = new Map<string, Resource>()
  if (opfXml !== undefined) {
    resources.set(opfPath, { path: opfPath, bytes: enc(opfXml), compression: 'deflate' })
  }
  return { resources, rootfiles: opfXml === undefined ? [] : [opfPath], hasEncryption: false }
}

const PKG = (inner: string, attrs = 'version="3.0" unique-identifier="uid"') =>
  `<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" ${attrs}>${inner}</package>`

const META =
  '<metadata>' +
  '<dc:identifier id="uid">urn:isbn:123</dc:identifier>' +
  '<dc:title>T</dc:title><dc:language>en</dc:language>' +
  '<meta property="dcterms:modified">2020-01-01T00:00:00Z</meta>' +
  '</metadata>'

describe('parseOpf', () => {
  it('parses version, unique-identifier and metadata', () => {
    const { pkg, messages } = parseOpf(
      container(PKG(META + '<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="nav"/></spine>')),
    )
    expect(messages).toHaveLength(0)
    expect(pkg?.version).toBe('3.0')
    expect(pkg?.uniqueIdentifier).toBe('uid')
    expect(pkg?.metadata.identifiers).toEqual([{ id: 'uid', value: 'urn:isbn:123' }])
    expect(pkg?.metadata.titles).toEqual(['T'])
    expect(pkg?.metadata.languages).toEqual(['en'])
    expect(pkg?.metadata.modifiedCount).toBe(1)
  })

  it('parses manifest items with properties and spine itemrefs', () => {
    const { pkg } = parseOpf(
      container(PKG(META + '<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="nav" linear="no"/></spine>')),
    )
    expect(pkg?.manifest).toHaveLength(2)
    expect(pkg?.manifest[0]?.properties).toEqual(['nav'])
    expect(pkg?.spine).toHaveLength(2)
    expect(pkg?.spine[0]?.idref).toBe('c1')
    expect(pkg?.spine[0]?.linear).toBe(true)
    expect(pkg?.spine[1]?.linear).toBe(false)
    expect(pkg?.spinePresent).toBe(true)
  })

  it('reports RSC-001 when the rootfile OPF resource is missing', () => {
    const c: EpubContainer = { resources: new Map(), rootfiles: ['EPUB/package.opf'], hasEncryption: false }
    const { pkg, messages } = parseOpf(c)
    expect(pkg).toBeUndefined()
    expect(messages[0]?.id).toBe('RSC-001')
  })

  it('returns no pkg and no messages when there is no rootfile', () => {
    expect(parseOpf(container(undefined))).toEqual({ messages: [] })
  })

  it('surfaces a parse error as RSC-005', () => {
    const { pkg, messages } = parseOpf(container('<package><metadata></package>'))
    expect(pkg).toBeUndefined()
    expect(messages[0]?.id).toBe('RSC-005')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/parse/opf.test.ts`
Expected: FAIL — cannot find module `./opf.js`.

- [ ] **Step 3: Implement `parse/opf.ts`**

`src/parse/opf.ts`
```ts
import { parseXml, childElements, type XmlNode } from '../io/xml.js'
import { getResource, type EpubContainer } from '../io/zip.js'
import { msg, type Location, type Message } from '../messages/format.js'

const DC_NS = 'http://purl.org/dc/elements/1.1/'

export interface DcIdentifier {
  id?: string
  value: string
}
export interface Metadata {
  identifiers: DcIdentifier[]
  titles: string[]
  languages: string[]
  modifiedCount: number
}
export interface ManifestItem {
  id?: string
  href?: string
  mediaType?: string
  properties: string[]
  fallback?: string
  loc: Location
}
export interface SpineItem {
  idref?: string
  linear: boolean
  properties: string[]
  loc: Location
}
export interface PackageDocument {
  path: string
  version?: string
  uniqueIdentifier?: string
  metadata: Metadata
  manifest: ManifestItem[]
  spinePresent: boolean
  spine: SpineItem[]
  loc: Location
}

function firstChild(node: XmlNode, localName: string): XmlNode | undefined {
  return childElements(node).find((c) => c.name === localName)
}
function splitProps(value: string | undefined): string[] {
  return value ? value.trim().split(/\s+/).filter(Boolean) : []
}
function textOf(node: XmlNode): string {
  return (node.children ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('')
    .trim()
}

export function parseOpf(container: EpubContainer): { pkg?: PackageDocument; messages: Message[] } {
  const messages: Message[] = []
  const opfPath = container.rootfiles[0]
  if (!opfPath) return { messages } // OCF already reported the missing rootfile

  const resource = getResource(container, opfPath)
  if (!resource) {
    messages.push(msg('RSC-001', { path: opfPath }, opfPath))
    return { messages }
  }

  const parsed = parseXml(resource.bytes, opfPath)
  messages.push(...parsed.messages)
  const root = parsed.root
  if (!root || root.name !== 'package') return { messages }

  const metadataEl = firstChild(root, 'metadata')
  const manifestEl = firstChild(root, 'manifest')
  const spineEl = firstChild(root, 'spine')

  const metadata: Metadata = { identifiers: [], titles: [], languages: [], modifiedCount: 0 }
  if (metadataEl) {
    for (const el of childElements(metadataEl)) {
      if (el.ns === DC_NS && el.name === 'identifier') {
        metadata.identifiers.push({ id: el.attrs?.['id'], value: textOf(el) })
      } else if (el.ns === DC_NS && el.name === 'title') {
        metadata.titles.push(textOf(el))
      } else if (el.ns === DC_NS && el.name === 'language') {
        metadata.languages.push(textOf(el))
      } else if (
        el.name === 'meta' &&
        el.attrs?.['property'] === 'dcterms:modified' &&
        !el.attrs['refines']
      ) {
        metadata.modifiedCount++
      }
    }
  }

  const manifest: ManifestItem[] = manifestEl
    ? childElements(manifestEl)
        .filter((el) => el.name === 'item')
        .map((el) => ({
          id: el.attrs?.['id'],
          href: el.attrs?.['href'],
          mediaType: el.attrs?.['media-type'],
          properties: splitProps(el.attrs?.['properties']),
          fallback: el.attrs?.['fallback'],
          loc: el.loc,
        }))
    : []

  const spine: SpineItem[] = spineEl
    ? childElements(spineEl)
        .filter((el) => el.name === 'itemref')
        .map((el) => ({
          idref: el.attrs?.['idref'],
          linear: el.attrs?.['linear'] !== 'no',
          properties: splitProps(el.attrs?.['properties']),
          loc: el.loc,
        }))
    : []

  const pkg: PackageDocument = {
    path: opfPath,
    version: root.attrs?.['version'],
    uniqueIdentifier: root.attrs?.['unique-identifier'],
    metadata,
    manifest,
    spinePresent: spineEl !== undefined,
    spine,
    loc: root.loc,
  }
  return { pkg, messages }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/parse/opf.test.ts`
Expected: PASS — all five tests.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` (Expected: clean)
```bash
git add src/parse/opf.ts src/parse/opf.test.ts
git commit -m "feat: parse OPF package document into PackageDocument"
```

---

### Task 4: OPF checks — package level (`validateOpf` + `checkPackage`)

**Files:**
- Create: `src/checks/opf.ts`, `src/checks/opf.test.ts`

**Interfaces:**
- Consumes: `PackageDocument`, `ManifestItem` from `../parse/opf.js`; `EpubContainer`, `getResource` from `../io/zip.js`; `resolvePath` from `../util/path.js`; `msg`, `Message` from `../messages/format.js`.
- Produces: `function validateOpf(pkg: PackageDocument, container: EpubContainer): Message[]`. In this task `validateOpf` returns only the package-level checks; Tasks 5 and 6 extend it with manifest and spine/nav checks.
- Rules (package level):
  - **OPF-001**: `version` missing, or not `"2.0"`/`"3.0"`.
  - **OPF-048**: `unique-identifier` attribute absent.
  - **OPF-030**: `unique-identifier` present but no `dc:identifier` has that id.
  - **RSC-005** (schema-enforced): zero `dc:identifier`; zero `dc:title`; zero `dc:language`; `dcterms:modified` count ≠ 1.

- [ ] **Step 1: Write the failing test**

`src/checks/opf.test.ts`
```ts
import { describe, it, expect } from 'vitest'
import type { EpubContainer, Resource } from '../io/zip.js'
import type { PackageDocument, ManifestItem, SpineItem } from '../parse/opf.js'
import { validateOpf } from './opf.js'

const enc = (s: string) => new TextEncoder().encode(s)
const LOC = { path: 'EPUB/package.opf', line: 1, column: 1 }

function emptyContainer(paths: string[] = []): EpubContainer {
  const resources = new Map<string, Resource>()
  for (const p of paths) resources.set(p, { path: p, bytes: enc(''), compression: 'deflate' })
  return { resources, rootfiles: ['EPUB/package.opf'], hasEncryption: false }
}

// A package that is fully valid; individual tests mutate one field to trigger one rule.
function validPkg(overrides: Partial<PackageDocument> = {}): PackageDocument {
  const navItem: ManifestItem = { id: 'nav', href: 'nav.xhtml', mediaType: 'application/xhtml+xml', properties: ['nav'], loc: LOC }
  const spineItem: SpineItem = { idref: 'nav', linear: true, properties: [], loc: LOC }
  return {
    path: 'EPUB/package.opf',
    version: '3.0',
    uniqueIdentifier: 'uid',
    metadata: { identifiers: [{ id: 'uid', value: 'urn:isbn:1' }], titles: ['T'], languages: ['en'], modifiedCount: 1 },
    manifest: [navItem],
    spinePresent: true,
    spine: [spineItem],
    loc: LOC,
    ...overrides,
  }
}

const ids = (pkg: PackageDocument, c: EpubContainer = emptyContainer(['EPUB/nav.xhtml'])) =>
  validateOpf(pkg, c).map((m) => m.id)

describe('validateOpf — package level', () => {
  it('passes a valid package (no package-level messages)', () => {
    expect(ids(validPkg())).toEqual([])
  })
  it('OPF-001 when version is missing', () => {
    expect(ids(validPkg({ version: undefined }))).toContain('OPF-001')
  })
  it('OPF-001 when version is unsupported', () => {
    expect(ids(validPkg({ version: '4.0' }))).toContain('OPF-001')
  })
  it('OPF-048 when unique-identifier attribute is absent', () => {
    expect(ids(validPkg({ uniqueIdentifier: undefined }))).toContain('OPF-048')
  })
  it('OPF-030 when unique-identifier does not match a dc:identifier id', () => {
    expect(ids(validPkg({ uniqueIdentifier: 'other' }))).toContain('OPF-030')
  })
  it('RSC-005 when dc:identifier / dc:title / dc:language are missing', () => {
    const pkg = validPkg({ metadata: { identifiers: [], titles: [], languages: [], modifiedCount: 1 } })
    const msgs = validateOpf(pkg, emptyContainer(['EPUB/nav.xhtml']))
    expect(msgs.filter((m) => m.id === 'RSC-005').length).toBeGreaterThanOrEqual(3)
  })
  it('RSC-005 when dcterms:modified is not present exactly once', () => {
    const pkg = validPkg({ metadata: { identifiers: [{ id: 'uid', value: 'u' }], titles: ['T'], languages: ['en'], modifiedCount: 0 } })
    expect(validateOpf(pkg, emptyContainer(['EPUB/nav.xhtml'])).some((m) => m.id === 'RSC-005' && m.message.includes('dcterms:modified'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/checks/opf.test.ts`
Expected: FAIL — cannot find module `./opf.js`.

- [ ] **Step 3: Implement `checks/opf.ts` (package level)**

`src/checks/opf.ts`
```ts
import type { EpubContainer } from '../io/zip.js'
import { msg, type Message } from '../messages/format.js'
import type { PackageDocument } from '../parse/opf.js'

// `_container` is unused at the package level; Tasks 5/6 add manifest/spine
// checks that use it (the lint config ignores `^_` args). Renamed to
// `container` in Task 5.
export function validateOpf(pkg: PackageDocument, _container: EpubContainer): Message[] {
  return [...checkPackage(pkg)]
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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/checks/opf.test.ts`
Expected: PASS — all seven tests.

- [ ] **Step 5: Lint + typecheck + commit**

Run: `npm run lint && npx tsc --noEmit` (Expected: clean)
```bash
git add src/checks/opf.ts src/checks/opf.test.ts
git commit -m "feat: add OPF package-level validation"
```

---

### Task 5: OPF checks — manifest (`checkManifest`)

**Files:**
- Modify: `src/checks/opf.ts`
- Modify: `src/checks/opf.test.ts`

**Interfaces:**
- Consumes: `getResource`, `EpubContainer` from `../io/zip.js`; `resolvePath` from `../util/path.js`; existing `validateOpf`/`checkPackage`.
- Produces: `validateOpf` now also returns `checkManifest(pkg, container)` results.
- Rules (manifest):
  - **RSC-005** (schema-enforced): an item missing `id`, `href`, or `media-type`.
  - **RSC-005** (schema-enforced): duplicate item `id`.
  - **OPF-074**: two items whose `href` resolves to the same container path.
  - **RSC-001**: an item `href` (non-remote) that does not resolve to a resource present in the container.

- [ ] **Step 1: Add the failing tests**

Append to `src/checks/opf.test.ts` a new describe block:
```ts
describe('validateOpf — manifest', () => {
  const navItem: ManifestItem = { id: 'nav', href: 'nav.xhtml', mediaType: 'application/xhtml+xml', properties: ['nav'], loc: LOC }

  it('RSC-005 when an item is missing a required attribute', () => {
    const bad: ManifestItem = { id: 'c1', href: undefined, mediaType: 'application/xhtml+xml', properties: [], loc: LOC }
    const pkg = validPkg({ manifest: [navItem, bad], spine: [{ idref: 'nav', linear: true, properties: [], loc: LOC }] })
    expect(validateOpf(pkg, emptyContainer(['EPUB/nav.xhtml'])).some((m) => m.id === 'RSC-005' && m.message.includes('required attribute'))).toBe(true)
  })

  it('RSC-005 on a duplicate manifest item id', () => {
    const dup: ManifestItem = { id: 'nav', href: 'c1.xhtml', mediaType: 'application/xhtml+xml', properties: [], loc: LOC }
    const pkg = validPkg({ manifest: [navItem, dup] })
    expect(validateOpf(pkg, emptyContainer(['EPUB/nav.xhtml', 'EPUB/c1.xhtml'])).some((m) => m.id === 'RSC-005' && m.message.includes('Duplicate manifest item id'))).toBe(true)
  })

  it('OPF-074 when two items resolve to the same href', () => {
    const a: ManifestItem = { id: 'a', href: 'c1.xhtml', mediaType: 'application/xhtml+xml', properties: [], loc: LOC }
    const b: ManifestItem = { id: 'b', href: './c1.xhtml', mediaType: 'application/xhtml+xml', properties: [], loc: LOC }
    const pkg = validPkg({ manifest: [navItem, a, b] })
    expect(validateOpf(pkg, emptyContainer(['EPUB/nav.xhtml', 'EPUB/c1.xhtml'])).map((m) => m.id)).toContain('OPF-074')
  })

  it('RSC-001 when an item href is not present in the container', () => {
    const missing: ManifestItem = { id: 'm', href: 'gone.xhtml', mediaType: 'application/xhtml+xml', properties: [], loc: LOC }
    const pkg = validPkg({ manifest: [navItem, missing] })
    expect(validateOpf(pkg, emptyContainer(['EPUB/nav.xhtml'])).map((m) => m.id)).toContain('RSC-001')
  })

  it('does not report RSC-001 for a remote href', () => {
    const remote: ManifestItem = { id: 'r', href: 'https://example.com/x.mp4', mediaType: 'video/mp4', properties: [], loc: LOC }
    const pkg = validPkg({ manifest: [navItem, remote] })
    expect(validateOpf(pkg, emptyContainer(['EPUB/nav.xhtml'])).map((m) => m.id)).not.toContain('RSC-001')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/checks/opf.test.ts`
Expected: FAIL — `OPF-074`/`RSC-001` not emitted yet.

- [ ] **Step 3: Add `checkManifest` and wire it in**

In `src/checks/opf.ts`, replace the imports block with:
```ts
import { getResource, type EpubContainer } from '../io/zip.js'
import { resolvePath } from '../util/path.js'
import { msg, type Message } from '../messages/format.js'
import type { PackageDocument } from '../parse/opf.js'
```
Replace `validateOpf` with:
```ts
export function validateOpf(pkg: PackageDocument, container: EpubContainer): Message[] {
  return [...checkPackage(pkg), ...checkManifest(pkg, container)]
}
```
Add these functions below `checkPackage`:
```ts
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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/checks/opf.test.ts`
Expected: PASS — package-level + manifest tests.

- [ ] **Step 5: Lint + typecheck + commit**

Run: `npm run lint && npx tsc --noEmit` (Expected: clean)
```bash
git add src/checks/opf.ts src/checks/opf.test.ts
git commit -m "feat: add OPF manifest validation"
```

---

### Task 6: OPF checks — spine + nav (`checkSpineAndNav`)

**Files:**
- Modify: `src/checks/opf.ts`
- Modify: `src/checks/opf.test.ts`

**Interfaces:**
- Consumes: existing `validateOpf`, `PackageDocument`.
- Produces: `validateOpf` now also returns `checkSpineAndNav(pkg)` results.
- Rules:
  - **RSC-005** (schema-enforced): no `<spine>` element; or a `<spine>` with zero `<itemref>`.
  - **OPF-049**: an itemref `idref` with no matching manifest item id.
  - **OPF-033**: spine has itemrefs but none are linear.
  - **RSC-005** (schema-enforced, EPUB 3 only): manifest does not declare exactly one `nav` item; or the nav item's media-type is not `application/xhtml+xml`.

- [ ] **Step 1: Add the failing tests**

Append to `src/checks/opf.test.ts`:
```ts
describe('validateOpf — spine and nav', () => {
  const navItem: ManifestItem = { id: 'nav', href: 'nav.xhtml', mediaType: 'application/xhtml+xml', properties: ['nav'], loc: LOC }
  const c = emptyContainer(['EPUB/nav.xhtml'])

  it('RSC-005 when there is no spine', () => {
    const pkg = validPkg({ spinePresent: false, spine: [] })
    expect(validateOpf(pkg, c).some((m) => m.id === 'RSC-005' && m.message.includes('spine element'))).toBe(true)
  })
  it('RSC-005 when the spine has no itemref', () => {
    const pkg = validPkg({ spinePresent: true, spine: [] })
    expect(validateOpf(pkg, c).some((m) => m.id === 'RSC-005' && m.message.includes('at least one itemref'))).toBe(true)
  })
  it('OPF-049 when an itemref idref has no manifest item', () => {
    const pkg = validPkg({ spine: [{ idref: 'missing', linear: true, properties: [], loc: LOC }] })
    expect(validateOpf(pkg, c).map((m) => m.id)).toContain('OPF-049')
  })
  it('OPF-033 when no spine item is linear', () => {
    const pkg = validPkg({ spine: [{ idref: 'nav', linear: false, properties: [], loc: LOC }] })
    expect(validateOpf(pkg, c).map((m) => m.id)).toContain('OPF-033')
  })
  it('RSC-005 when there is not exactly one nav item', () => {
    const pkg = validPkg({ manifest: [{ ...navItem, properties: [] }] })
    expect(validateOpf(pkg, c).some((m) => m.id === 'RSC-005' && m.message.includes('"nav" property'))).toBe(true)
  })
  it('RSC-005 when the nav item is not XHTML', () => {
    const pkg = validPkg({ manifest: [{ ...navItem, mediaType: 'text/html' }] })
    expect(validateOpf(pkg, c).some((m) => m.id === 'RSC-005' && m.message.includes('Navigation Document'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/checks/opf.test.ts`
Expected: FAIL — spine/nav rules not implemented.

- [ ] **Step 3: Add `checkSpineAndNav` and wire it in**

In `src/checks/opf.ts`, add a constant near the top (after imports):
```ts
const XHTML_MEDIA_TYPE = 'application/xhtml+xml'
```
Replace `validateOpf` with:
```ts
export function validateOpf(pkg: PackageDocument, container: EpubContainer): Message[] {
  return [...checkPackage(pkg), ...checkManifest(pkg, container), ...checkSpineAndNav(pkg)]
}
```
Add below `checkManifest`:
```ts
function checkSpineAndNav(pkg: PackageDocument): Message[] {
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
  if (pkg.version === '3.0') {
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
```

- [ ] **Step 4: Run the whole check suite to verify it passes**

Run: `npx vitest run src/checks/opf.test.ts`
Expected: PASS — package + manifest + spine/nav.

- [ ] **Step 5: Lint + typecheck + commit**

Run: `npm run lint && npx tsc --noEmit` (Expected: clean)
```bash
git add src/checks/opf.ts src/checks/opf.test.ts
git commit -m "feat: add OPF spine and nav validation"
```

---

### Task 7: Wire OPF into `validateEpub` + public exports + integration

**Files:**
- Modify: `src/validate.ts`, `src/validate.test.ts`
- Modify: `src/index.ts`
- Create: `test/integration/opf.test.ts`

**Interfaces:**
- Consumes: `parseOpf` from `./parse/opf.js`; `validateOpf` from `./checks/opf.js`; existing orchestration.
- Produces: `validateEpub` runs OPF parse + validation after OCF, and sets `Report.epubVersion` from the parsed OPF version (unless `options.version` overrides). `index.ts` exports `parseOpf`, `validateOpf`, and the OPF types.

- [ ] **Step 1: Add the failing unit test**

Append to `src/validate.test.ts`:
```ts
  it('runs OPF checks and reports the detected version', async () => {
    const opf =
      '<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid">' +
      '<metadata><dc:identifier id="uid">u</dc:identifier><dc:title>T</dc:title><dc:language>en</dc:language>' +
      '<meta property="dcterms:modified">2020-01-01T00:00:00Z</meta></metadata>' +
      '<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest>' +
      '<spine><itemref idref="missing"/></spine></package>'
    const bytes = zipSync({
      mimetype: [enc('application/epub+zip'), { level: 0 }],
      'META-INF/container.xml': [enc('<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'), { level: 6 }],
      'package.opf': [enc(opf), { level: 6 }],
      'nav.xhtml': [enc('<html/>'), { level: 6 }],
    })
    const report = await validateEpub(bytes)
    expect(report.epubVersion).toBe('3.0')
    expect(report.messages.map((m) => m.id)).toContain('OPF-049') // idref "missing"
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/validate.test.ts`
Expected: FAIL — `epubVersion` undefined / `OPF-049` absent.

- [ ] **Step 3: Wire OPF into `validate.ts`**

Replace `src/validate.ts` with:
```ts
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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/validate.test.ts`
Expected: PASS — including the new OPF test.

- [ ] **Step 5: Export the new public API**

In `src/index.ts`, add after the existing `validateOcf` export line:
```ts
export { parseOpf } from './parse/opf.js'
export { validateOpf } from './checks/opf.js'
```
And add to the type re-exports:
```ts
export type { PackageDocument, ManifestItem, SpineItem, Metadata, DcIdentifier } from './parse/opf.js'
```

- [ ] **Step 6: Add the integration test**

`test/integration/opf.test.ts`
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

function epub(opf: string, files: Record<string, Uint8Array> = {}) {
  return zipSync({
    mimetype: [enc('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': [CONTAINER, { level: 6 }],
    'EPUB/package.opf': [enc(opf), { level: 6 }],
    ...Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [v, { level: 6 }] as [Uint8Array, { level: 6 }]])),
  })
}

const VALID_OPF =
  '<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid">' +
  '<metadata><dc:identifier id="uid">urn:isbn:1</dc:identifier><dc:title>T</dc:title><dc:language>en</dc:language>' +
  '<meta property="dcterms:modified">2020-01-01T00:00:00Z</meta></metadata>' +
  '<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest>' +
  '<spine><itemref idref="nav"/></spine></package>'

describe('integration: OPF validation', () => {
  it('reports no OPF errors for a valid EPUB 3 package', async () => {
    const report = await validateEpub(epub(VALID_OPF, { 'EPUB/nav.xhtml': enc('<html/>') }))
    const opfIds = report.messages.map((m) => m.id).filter((id) => id.startsWith('OPF') || id === 'RSC-001' || id === 'RSC-005')
    expect(opfIds).toEqual([])
    expect(report.epubVersion).toBe('3.0')
  })

  it('flags a manifest item whose file is missing', async () => {
    // Add a manifest item pointing at a file that is not in the container.
    const opf = VALID_OPF.replace(
      '</manifest>',
      '<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>',
    )
    const report = await validateEpub(epub(opf, { 'EPUB/nav.xhtml': enc('<html/>') }))
    expect(report.messages.map((m) => m.id)).toContain('RSC-001')
    expect(report.valid).toBe(false)
  })
})
```

- [ ] **Step 7: Run the full gate**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: lint clean; typecheck clean; ALL tests pass (Plan 1 suite + new OPF unit/integration); build emits `dist/index.js` + `dist/index.d.ts`.

- [ ] **Step 8: Commit**

```bash
git add src/validate.ts src/validate.test.ts src/index.ts test/integration/opf.test.ts
git commit -m "feat: wire OPF parsing and validation into validateEpub"
```

---

## Roadmap (subsequent plans)

- **Plan 3 — Navigation document:** `parse/nav.ts` + `checks/nav.ts` — toc nav presence/structure (the OPF nav *declaration* is validated here; the nav *document content* is Plan 3).
- **Plan 4 — XHTML content:** `parse/content.ts` + `checks/content.ts`.
- **Plan 5 — Fixture corpus + deferred OPF rules:** ported epubcheck fixtures; plus the deferred OPF rules (`OPF-003` undeclared files, `PKG-001` version mismatch, fallback chains, collections, `guide`, remote-resource policy, properties vocabulary).

---

## Self-Review

**Spec coverage (Plan 2 portion of spec §2/§5/§6/§7):** OPF manifest/spine/metadata + nav declaration → Tasks 4–6; `PackageDocument`/`ManifestItem`/`SpineItem`/`Metadata` types (§5) → Task 3; version detection feeding `Report.epubVersion` (§7) → Task 7; layered exports `parseOpf`/`validateOpf` (§7) → Task 7; message-ID reuse (§6, decided strategy) → Task 1 + checks. EPUB 2 specifics, CSS, content docs, and the deferred OPF rules are out of scope (roadmap). No Plan-2 gaps.

**Placeholder scan:** No TBD/TODO; every code step has complete code; the only "later task" references are the documented incremental wiring of `validateOpf` (Tasks 4→5→6) with full code at each step, and the roadmap.

**Type consistency:** `PackageDocument`/`ManifestItem`/`SpineItem`/`Metadata`/`DcIdentifier` defined in Task 3 and consumed unchanged in Tasks 4–7. `validateOpf(pkg, container)` signature identical across Tasks 4/5/6/7. `parseOpf(container) => { pkg?, messages }` consumed correctly in Task 7. Catalog IDs added in Task 1 (`OPF-001/030/033/048/049/074`, `RSC-001`) match every `msg(...)` call site in Tasks 4–6; `RSC-005` reuses the Plan 1 `(path, detail)` two-arg form. `index.ts` re-exports point to symbols produced in Tasks 3–6.
```
