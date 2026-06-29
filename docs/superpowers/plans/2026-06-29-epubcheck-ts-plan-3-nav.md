# epubcheck-ts — Plan 3: Navigation Document Parsing + Validation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse the EPUB 3 Navigation Document (the manifest's `properties="nav"` XHTML file) into plain data and validate its `toc`/`page-list`/`landmarks` sections — occurrence, structure, link text, landmark semantics, and link resolution.

**Architecture:** Same pure-function pipeline. A new `parseNav(navItem, container)` locates and parses the nav doc into a `NavDocument` (its `<nav>` sections by `epub:type`); a new `validateNav(nav, pkg, container)` runs occurrence + content + link checks. `validateEpub` calls them after `validateOpf` for EPUB 3 packages that declare a nav item. No schema engine — explicit TS checks.

**Tech Stack:** TypeScript (ESM), reuses Plan 1/2's `parseXml`/`findDescendants` (saxes), `openEpub` (fflate), `resolvePath`, message catalog, report aggregation.

**Spec:** `docs/superpowers/specs/2026-06-28-epubcheck-ts-design.md` (§2 navigation surface, §6 check framework, §7 API).

## Global Constraints

Apply to every task; from the spec + Plans 1–2.

- **ESM-only**, TypeScript source, ship `.d.ts`. Target **ES2022 / Node 18+ / evergreen browsers**.
- **Functional style, no classes.** Plain data + functions only.
- **Runtime-agnostic core:** zero Node-only APIs in `src/` (no `fs`/`Buffer`/`node:*`). `TextDecoder`/`DataView`/web `ReadableStream`/`decodeURIComponent` only.
- **Runtime deps:** only `fflate` + `saxes`. **Dev deps:** `vitest`, `tsdown`, `typescript`, `eslint`, `@eslint/js`, `typescript-eslint`.
- **Types live with their producer** — no types-only files.
- **Unit tests colocated**; integration tests under `test/`.
- **Lint is type-aware.** Every task keeps `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` green.
- **`validateEpub` always resolves to a `Report`** and never rejects.
- **Message-ID strategy (decided in Plan 2):** specific epubcheck IDs where epubcheck assigns one at the Java level; otherwise `RSC-005` with a clear, rule-specific detail string (faithful to what epubcheck reports for its schema-enforced nav rules).

### Carry-forwards / known limitations (honor + document)

- `XmlNode.attrs` keys are **qualified** names, and attribute namespaces are not resolved. We match `epub:type` by the conventional `epub:` prefix (`attrs['epub:type']`). Real-world EPUB nav docs use this prefix; a non-`epub:` prefix bound to the OPS namespace would be missed. Document this; do not re-architect attribute namespacing in this plan.
- `parseXml` (saxes, XML mode) does not know HTML named entities like `&nbsp;`. Conforming XHTML must use numeric refs (`&#160;`) or declare entities; an undeclared named entity surfaces as `RSC-005`. Tests use clean XML. Known limitation, shared with Plan 4.
- All post-`openEpub` steps remain non-throwing pure functions (preserve the `validate.ts` try/catch invariant).

---

## Reference: epubcheck message IDs used in this plan

From `w3c/epubcheck` (`MessageBundle.properties` + `DefaultSeverities.java` + `epub-nav-30.sch`). Most nav rules are schema-enforced in epubcheck → `RSC-005`; we reuse `RSC-005` with a rule-specific detail (mirroring the Schematron assert text where one exists). New Java-level IDs added to the catalog:

| ID | Severity | Template | Used for |
|----|----------|----------|----------|
| `RSC-007` | ERROR | `Referenced resource "%1$s" could not be found in the EPUB.` | nav link target absent from container |
| `RSC-008` | ERROR | `Referenced resource "%1$s" is not declared in the OPF manifest.` | nav link target present in container but not in manifest |
| `NAV-010` | ERROR | `"%1$s" nav must not link to remote resources; found link to "%2$s".` | nav link resolves to a remote URL |
| `RSC-005` | ERROR | `Error while parsing file '%1$s': %2$s` (Plan 1 form) | schema-enforced nav rules — `%2$s` = rule detail |

`RSC-005` already exists (Plan 1). Rule-specific detail strings are defined inline in the checks (Tasks 4–6), mirroring the epubcheck Schematron assert text where one exists.

### Schema-enforced nav rules → RSC-005 (detail text)

- Occurrence: `Exactly one "toc" nav element must be present.` / `Multiple occurrences of the "page-list" nav element.` / `Multiple occurrences of the "landmarks" nav element.`
- Structure: `The "toc" nav element must contain an ol element.`
- Links/labels: `An "a" element in the navigation document must have an href attribute.` / `Anchors within nav elements must contain text.` / `Spans within nav elements must contain text.`
- Landmarks: `Missing epub:type attribute on anchor inside "landmarks" nav element.` / `Another landmark was found with the same epub:type and reference to "<href>".`

### Deferred (NOT in this plan — roadmap)

`RSC-012` broken-fragment (needs parsing the target doc — Plan 4), `NAV-011` reading-order, `NAV-009` region-nav-FXL, `NAV-003..008` EDUPUB lists, `NAV-001` EPUB 2 nav, `flat-nav` nested-`ol` warning, `req-heading` for custom navs, deep RNG li/ol nesting grammar. Note in roadmap; don't implement.

---

## File Structure (this plan)

```
src/
  util/
    path.ts              # (modify) add isRemote(href); shared by checks/opf + checks/nav  (+ path.test.ts)
  io/
    xml.ts               # (modify) add textContent(node) recursive text extractor        (+ xml.test.ts)
  parse/
    nav.ts               # NavDocument + parseNav()                                        (+ nav.test.ts)
  checks/
    nav.ts               # validateNav()                                                   (+ nav.test.ts)
    opf.ts               # (modify) import isRemote from util/path instead of local copy
  messages/
    catalog.ts           # (modify) add RSC-007, RSC-008, NAV-010
  validate.ts            # (modify) parse + validate nav for EPUB 3 packages
  index.ts               # (modify) export parseNav, validateNav, textContent + Nav types
test/
  integration/
    nav.test.ts          # end-to-end validateEpub over in-memory EPUBs with nav docs
```

---

### Task 1: Extend the message catalog (RSC-007, RSC-008, NAV-010)

**Files:**
- Modify: `src/messages/catalog.ts`, `src/messages/catalog.test.ts`

**Interfaces:**
- Produces: catalog entries `RSC-007`, `RSC-008` (ERROR), `NAV-010` (ERROR).

- [ ] **Step 1: Add the failing test**

Append inside the existing `describe('CATALOG', ...)` block in `src/messages/catalog.test.ts`:
```ts
  it('defines navigation message ids with severities', () => {
    expect(CATALOG['RSC-007']?.severity).toBe('ERROR')
    expect(CATALOG['RSC-008']?.severity).toBe('ERROR')
    expect(CATALOG['NAV-010']?.severity).toBe('ERROR')
  })

  it('NAV-010 template carries two placeholders', () => {
    expect(CATALOG['NAV-010']?.template).toContain('%1$s')
    expect(CATALOG['NAV-010']?.template).toContain('%2$s')
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/messages/catalog.test.ts`
Expected: FAIL — `RSC-007` etc. undefined.

- [ ] **Step 3: Add the catalog entries**

In `src/messages/catalog.ts`, add to `CATALOG` (after the existing `RSC-*` entries):
```ts
  'RSC-007': { severity: 'ERROR', template: 'Referenced resource "%1$s" could not be found in the EPUB.' },
  'RSC-008': { severity: 'ERROR', template: 'Referenced resource "%1$s" is not declared in the OPF manifest.' },
  'NAV-010': { severity: 'ERROR', template: '"%1$s" nav must not link to remote resources; found link to "%2$s".' },
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/messages/catalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/messages/catalog.ts src/messages/catalog.test.ts
git commit -m "feat: add navigation message ids to catalog"
```

---

### Task 2: Shared helpers — `isRemote` (util) + `textContent` (xml)

**Files:**
- Modify: `src/util/path.ts`, `src/util/path.test.ts`
- Modify: `src/io/xml.ts`, `src/io/xml.test.ts`
- Modify: `src/checks/opf.ts` (use the shared `isRemote`)

**Interfaces:**
- Produces:
  - `function isRemote(href: string): boolean` (from `util/path.ts`) — true for an absolute URL with a scheme (`scheme://…`).
  - `function textContent(node: XmlNode): string` (from `io/xml.ts`) — concatenation of all descendant text nodes (no trimming).
- `checks/opf.ts` switches from its local `isRemote` to the shared one (DRY; behavior identical).

- [ ] **Step 1: Write the failing tests**

Append to `src/util/path.test.ts`:
```ts
import { isRemote } from './path.js'

describe('isRemote', () => {
  it('detects scheme-based remote urls', () => {
    expect(isRemote('https://example.com/x')).toBe(true)
    expect(isRemote('http://example.com/x')).toBe(true)
    expect(isRemote('data:image/png;base64,AAA')).toBe(false) // no //
  })
  it('treats relative paths as local', () => {
    expect(isRemote('chapter.xhtml')).toBe(false)
    expect(isRemote('../img/a.png')).toBe(false)
  })
})
```

Append to `src/io/xml.test.ts`:
```ts
import { textContent } from './xml.js'

describe('textContent', () => {
  it('concatenates nested text', () => {
    const { root } = parseXml(new TextEncoder().encode('<a>Hello <b>World</b>!</a>'), 'm.xml')
    expect(textContent(root!)).toBe('Hello World!')
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/util/path.test.ts src/io/xml.test.ts`
Expected: FAIL — `isRemote`/`textContent` not exported.

- [ ] **Step 3: Implement the helpers**

Append to `src/util/path.ts`:
```ts
/** True when `href` is an absolute URL with a scheme (e.g. https://…). */
export function isRemote(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(href)
}
```

Append to `src/io/xml.ts`:
```ts
/** All descendant text content of a node, concatenated (not trimmed). */
export function textContent(node: XmlNode): string {
  let out = ''
  const walk = (n: XmlNode) => {
    for (const child of n.children ?? []) {
      if (child.type === 'text') out += child.text ?? ''
      else walk(child)
    }
  }
  walk(node)
  return out
}
```

- [ ] **Step 4: Refactor `checks/opf.ts` to use the shared `isRemote`**

In `src/checks/opf.ts`: change the import from `'../util/path.js'` to include `isRemote`:
```ts
import { resolvePath, isRemote } from '../util/path.js'
```
and DELETE the local `function isRemote(href: string): boolean { … }` definition in that file. (The behavior is identical — same regex — so the existing OPF tests still pass.)

- [ ] **Step 5: Run the affected suites to verify they pass**

Run: `npx vitest run src/util/path.test.ts src/io/xml.test.ts src/checks/opf.test.ts`
Expected: PASS — new helper tests + the unchanged OPF tests (proving the refactor is behavior-preserving).

- [ ] **Step 6: Lint + typecheck + commit**

Run: `npm run lint && npx tsc --noEmit` (Expected: clean — no unused/duplicate `isRemote`)
```bash
git add src/util/path.ts src/util/path.test.ts src/io/xml.ts src/io/xml.test.ts src/checks/opf.ts
git commit -m "refactor: share isRemote in util/path; add textContent to xml"
```

---

### Task 3: Parse the navigation document (`parseNav`)

**Files:**
- Create: `src/parse/nav.ts`, `src/parse/nav.test.ts`

**Interfaces:**
- Consumes: `parseXml`, `findDescendants`, `XmlNode` from `../io/xml.js`; `getResource`, `EpubContainer` from `../io/zip.js`; `resolvePath` from `../util/path.js`; `Location`, `Message` from `../messages/format.js`; `ManifestItem` from `./opf.js`.
- Produces:
  - `interface NavSection { types: string[]; node: XmlNode; loc: Location }`
  - `interface NavDocument { path: string; root: XmlNode; sections: NavSection[]; loc: Location }`
  - `function parseNav(navItem: ManifestItem, container: EpubContainer): { nav?: NavDocument; messages: Message[] }` — resolves the nav doc path (`resolvePath(container.rootfiles[0], navItem.href)`); missing rootfile/href or missing resource → `{ messages: [] }` (a missing nav file is already reported as `RSC-001` by the OPF manifest check); parse errors → parseXml's `RSC-005` messages; otherwise a `NavDocument` whose `sections` are every `<nav>` element with its `epub:type` tokens.

- [ ] **Step 1: Write the failing test**

`src/parse/nav.test.ts`
```ts
import { describe, it, expect } from 'vitest'
import type { EpubContainer, Resource } from '../io/zip.js'
import type { ManifestItem } from './opf.js'
import { parseNav } from './nav.js'

const enc = (s: string) => new TextEncoder().encode(s)
const LOC = { path: 'EPUB/package.opf', line: 1, column: 1 }

function container(navXml: string | undefined, navPath = 'EPUB/nav.xhtml'): EpubContainer {
  const resources = new Map<string, Resource>()
  if (navXml !== undefined) resources.set(navPath, { path: navPath, bytes: enc(navXml), compression: 'deflate' })
  return { resources, rootfiles: ['EPUB/package.opf'], hasEncryption: false }
}
const navItem: ManifestItem = { id: 'nav', href: 'nav.xhtml', mediaType: 'application/xhtml+xml', properties: ['nav'], loc: LOC }

const NAV = (body: string) =>
  '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>t</title></head><body>' +
  body + '</body></html>'

describe('parseNav', () => {
  it('extracts nav sections with their epub:type tokens', () => {
    const { nav, messages } = parseNav(navItem, container(NAV(
      '<nav epub:type="toc"><ol><li><a href="c1.xhtml">One</a></li></ol></nav>' +
      '<nav epub:type="landmarks"><ol><li><a epub:type="bodymatter" href="c1.xhtml">Start</a></li></ol></nav>',
    )))
    expect(messages).toHaveLength(0)
    expect(nav?.path).toBe('EPUB/nav.xhtml')
    expect(nav?.sections).toHaveLength(2)
    expect(nav?.sections[0]?.types).toEqual(['toc'])
    expect(nav?.sections[1]?.types).toEqual(['landmarks'])
  })

  it('returns no nav and no messages when the nav resource is absent', () => {
    expect(parseNav(navItem, container(undefined))).toEqual({ messages: [] })
  })

  it('surfaces a parse error as RSC-005', () => {
    const { nav, messages } = parseNav(navItem, container(NAV('<nav epub:type="toc"><ol></nav>')))
    expect(nav).toBeUndefined()
    expect(messages[0]?.id).toBe('RSC-005')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/parse/nav.test.ts`
Expected: FAIL — cannot find module `./nav.js`.

- [ ] **Step 3: Implement `parse/nav.ts`**

`src/parse/nav.ts`
```ts
import { parseXml, findDescendants, type XmlNode } from '../io/xml.js'
import { getResource, type EpubContainer } from '../io/zip.js'
import { resolvePath } from '../util/path.js'
import type { Location, Message } from '../messages/format.js'
import type { ManifestItem } from './opf.js'

const EPUB_TYPE_ATTR = 'epub:type'

export interface NavSection {
  types: string[]
  node: XmlNode
  loc: Location
}
export interface NavDocument {
  path: string
  root: XmlNode
  sections: NavSection[]
  loc: Location
}

function tokens(value: string | undefined): string[] {
  return value ? value.trim().split(/\s+/).filter(Boolean) : []
}

export function parseNav(
  navItem: ManifestItem,
  container: EpubContainer,
): { nav?: NavDocument; messages: Message[] } {
  const messages: Message[] = []
  const opfPath = container.rootfiles[0]
  if (!opfPath || !navItem.href) return { messages }

  const navPath = resolvePath(opfPath, navItem.href)
  const resource = getResource(container, navPath)
  // A missing nav file is reported as RSC-001 by the OPF manifest check; don't double-report.
  if (!resource) return { messages }

  const parsed = parseXml(resource.bytes, navPath)
  messages.push(...parsed.messages)
  const root = parsed.root
  if (!root) return { messages }

  const sections: NavSection[] = findDescendants(root, 'nav').map((node) => ({
    types: tokens(node.attrs?.[EPUB_TYPE_ATTR]),
    node,
    loc: node.loc,
  }))

  return { nav: { path: navPath, root, sections, loc: root.loc }, messages }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/parse/nav.test.ts`
Expected: PASS — all three tests.

- [ ] **Step 5: Lint + typecheck + commit**

Run: `npm run lint && npx tsc --noEmit` (Expected: clean)
```bash
git add src/parse/nav.ts src/parse/nav.test.ts
git commit -m "feat: parse navigation document into NavDocument"
```

---

### Task 4: Nav checks — occurrence + toc structure (`validateNav` + `checkOccurrence`)

**Files:**
- Create: `src/checks/nav.ts`, `src/checks/nav.test.ts`

**Interfaces:**
- Consumes: `findDescendants` from `../io/xml.js`; `EpubContainer` from `../io/zip.js`; `msg`, `Message` from `../messages/format.js`; `NavDocument`, `NavSection` from `../parse/nav.js`; `PackageDocument` from `../parse/opf.js`.
- Produces: `function validateNav(nav: NavDocument, pkg: PackageDocument, container: EpubContainer): Message[]`. In this task it returns only `checkOccurrence`; Tasks 5/6 extend it. `pkg`/`container` are unused here (prefix `_`).
- Rules (RSC-005): exactly one `toc`; at most one `page-list`; at most one `landmarks`; the `toc` nav must contain an `ol`.

- [ ] **Step 1: Write the failing test**

`src/checks/nav.test.ts`
```ts
import { describe, it, expect } from 'vitest'
import type { EpubContainer, Resource } from '../io/zip.js'
import type { PackageDocument } from '../parse/opf.js'
import { parseNav, type NavDocument } from '../parse/nav.js'
import type { ManifestItem } from '../parse/opf.js'
import { validateNav } from './nav.js'

const enc = (s: string) => new TextEncoder().encode(s)
const LOC = { path: 'EPUB/package.opf', line: 1, column: 1 }
const navItem: ManifestItem = { id: 'nav', href: 'nav.xhtml', mediaType: 'application/xhtml+xml', properties: ['nav'], loc: LOC }

// Build a NavDocument from body XML, plus a container holding the link targets.
function navDoc(body: string, targets: string[] = ['EPUB/c1.xhtml']): { nav: NavDocument; pkg: PackageDocument; container: EpubContainer } {
  const navXml =
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>t</title></head><body>' +
    body + '</body></html>'
  const resources = new Map<string, Resource>()
  resources.set('EPUB/nav.xhtml', { path: 'EPUB/nav.xhtml', bytes: enc(navXml), compression: 'deflate' })
  for (const t of targets) resources.set(t, { path: t, bytes: enc('<html/>'), compression: 'deflate' })
  const container: EpubContainer = { resources, rootfiles: ['EPUB/package.opf'], hasEncryption: false }
  const { nav } = parseNav(navItem, container)
  const pkg: PackageDocument = {
    path: 'EPUB/package.opf', version: '3.0', uniqueIdentifier: 'uid',
    metadata: { identifiers: [{ id: 'uid', value: 'u' }], titles: ['T'], languages: ['en'], modifiedCount: 1 },
    manifest: [navItem, { id: 'c1', href: 'c1.xhtml', mediaType: 'application/xhtml+xml', properties: [], loc: LOC }],
    spinePresent: true, spine: [{ idref: 'c1', linear: true, properties: [], loc: LOC }], loc: LOC,
  }
  return { nav: nav!, pkg, container }
}
const ids = (body: string, targets?: string[]) => {
  const { nav, pkg, container } = navDoc(body, targets)
  return validateNav(nav, pkg, container).map((m) => m.id)
}
const msgs = (body: string, targets?: string[]) => {
  const { nav, pkg, container } = navDoc(body, targets)
  return validateNav(nav, pkg, container)
}

const TOC = '<nav epub:type="toc"><ol><li><a href="c1.xhtml">One</a></li></ol></nav>'

describe('validateNav — occurrence', () => {
  it('passes a valid toc-only nav', () => {
    expect(ids(TOC)).toEqual([])
  })
  it('RSC-005 when the toc nav is missing', () => {
    expect(msgs('<nav epub:type="landmarks"><ol><li><a epub:type="x" href="c1.xhtml">L</a></li></ol></nav>')
      .some((m) => m.id === 'RSC-005' && m.message.includes('"toc"'))).toBe(true)
  })
  it('RSC-005 on duplicate page-list navs', () => {
    const body = TOC +
      '<nav epub:type="page-list"><ol><li><a href="c1.xhtml">1</a></li></ol></nav>' +
      '<nav epub:type="page-list"><ol><li><a href="c1.xhtml">2</a></li></ol></nav>'
    expect(msgs(body).some((m) => m.id === 'RSC-005' && m.message.includes('page-list'))).toBe(true)
  })
  it('RSC-005 when the toc nav has no ol', () => {
    expect(msgs('<nav epub:type="toc"><p>no list</p></nav>')
      .some((m) => m.id === 'RSC-005' && m.message.includes('ol element'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/checks/nav.test.ts`
Expected: FAIL — cannot find module `./nav.js`.

- [ ] **Step 3: Implement `checks/nav.ts` (occurrence)**

`src/checks/nav.ts`
```ts
import { findDescendants } from '../io/xml.js'
import type { EpubContainer } from '../io/zip.js'
import { msg, type Message } from '../messages/format.js'
import type { NavDocument, NavSection } from '../parse/nav.js'
import type { PackageDocument } from '../parse/opf.js'

function hasType(section: NavSection, type: string): boolean {
  return section.types.includes(type)
}

export function validateNav(
  nav: NavDocument,
  _pkg: PackageDocument,
  _container: EpubContainer,
): Message[] {
  return [...checkOccurrence(nav)]
}

function checkOccurrence(nav: NavDocument): Message[] {
  const messages: Message[] = []
  const tocs = nav.sections.filter((s) => hasType(s, 'toc'))

  if (tocs.length !== 1) {
    messages.push(msg('RSC-005', nav.loc, nav.path, 'Exactly one "toc" nav element must be present.'))
  }
  if (nav.sections.filter((s) => hasType(s, 'page-list')).length > 1) {
    messages.push(msg('RSC-005', nav.loc, nav.path, 'Multiple occurrences of the "page-list" nav element.'))
  }
  if (nav.sections.filter((s) => hasType(s, 'landmarks')).length > 1) {
    messages.push(msg('RSC-005', nav.loc, nav.path, 'Multiple occurrences of the "landmarks" nav element.'))
  }

  const toc = tocs[0]
  if (toc && findDescendants(toc.node, 'ol').length === 0) {
    messages.push(msg('RSC-005', toc.loc, nav.path, 'The "toc" nav element must contain an ol element.'))
  }

  return messages
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/checks/nav.test.ts`
Expected: PASS — all four tests.

- [ ] **Step 5: Lint + typecheck + commit**

Run: `npm run lint && npx tsc --noEmit` (Expected: clean)
```bash
git add src/checks/nav.ts src/checks/nav.test.ts
git commit -m "feat: add nav occurrence and toc-structure validation"
```

---

### Task 5: Nav checks — content rules (`checkContent`)

**Files:**
- Modify: `src/checks/nav.ts`, `src/checks/nav.test.ts`

**Interfaces:**
- Consumes: adds `textContent` from `../io/xml.js`.
- Produces: `validateNav` now also returns `checkContent(nav)`.
- Rules (RSC-005): every nav `<a>` must have an `href`; every nav `<a>` must contain non-empty text; every nav `<span>` must contain non-empty text. In a `landmarks` nav: every `<a>` must have an `epub:type`; no two anchors may share the same `epub:type` + `href`.

- [ ] **Step 1: Add the failing tests**

Append to `src/checks/nav.test.ts`:
```ts
describe('validateNav — content', () => {
  it('RSC-005 when an anchor has no href', () => {
    expect(msgs('<nav epub:type="toc"><ol><li><a>No link</a></li></ol></nav>')
      .some((m) => m.id === 'RSC-005' && m.message.includes('href attribute'))).toBe(true)
  })
  it('RSC-005 when an anchor has empty text', () => {
    expect(msgs('<nav epub:type="toc"><ol><li><a href="c1.xhtml"></a></li></ol></nav>')
      .some((m) => m.id === 'RSC-005' && m.message.includes('Anchors within nav'))).toBe(true)
  })
  it('RSC-005 when a span has empty text', () => {
    expect(msgs('<nav epub:type="toc"><ol><li><span></span><ol><li><a href="c1.xhtml">x</a></li></ol></li></ol></nav>')
      .some((m) => m.id === 'RSC-005' && m.message.includes('Spans within nav'))).toBe(true)
  })
  it('RSC-005 when a landmarks anchor has no epub:type', () => {
    const body = '<nav epub:type="toc"><ol><li><a href="c1.xhtml">x</a></li></ol></nav>' +
      '<nav epub:type="landmarks"><ol><li><a href="c1.xhtml">Start</a></li></ol></nav>'
    expect(msgs(body).some((m) => m.id === 'RSC-005' && m.message.includes('Missing epub:type'))).toBe(true)
  })
  it('RSC-005 on duplicate landmark epub:type + href', () => {
    const body = '<nav epub:type="toc"><ol><li><a href="c1.xhtml">x</a></li></ol></nav>' +
      '<nav epub:type="landmarks"><ol>' +
      '<li><a epub:type="bodymatter" href="c1.xhtml">A</a></li>' +
      '<li><a epub:type="bodymatter" href="c1.xhtml">B</a></li></ol></nav>'
    expect(msgs(body).some((m) => m.id === 'RSC-005' && m.message.includes('Another landmark'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/checks/nav.test.ts`
Expected: FAIL — content rules not implemented.

- [ ] **Step 3: Add `checkContent` and wire it in**

In `src/checks/nav.ts`, update the xml import to add `textContent`:
```ts
import { findDescendants, textContent } from '../io/xml.js'
```
Replace `validateNav` with:
```ts
export function validateNav(
  nav: NavDocument,
  _pkg: PackageDocument,
  _container: EpubContainer,
): Message[] {
  return [...checkOccurrence(nav), ...checkContent(nav)]
}
```
Add below `checkOccurrence`:
```ts
function checkContent(nav: NavDocument): Message[] {
  const messages: Message[] = []

  for (const section of nav.sections) {
    const anchors = findDescendants(section.node, 'a')

    for (const a of anchors) {
      if (!a.attrs?.['href']) {
        messages.push(msg('RSC-005', a.loc, nav.path, 'An "a" element in the navigation document must have an href attribute.'))
      }
      if (textContent(a).trim() === '') {
        messages.push(msg('RSC-005', a.loc, nav.path, 'Anchors within nav elements must contain text.'))
      }
    }

    for (const span of findDescendants(section.node, 'span')) {
      if (textContent(span).trim() === '') {
        messages.push(msg('RSC-005', span.loc, nav.path, 'Spans within nav elements must contain text.'))
      }
    }

    if (hasType(section, 'landmarks')) {
      const seen = new Set<string>()
      for (const a of anchors) {
        const type = a.attrs?.['epub:type']
        if (!type) {
          messages.push(msg('RSC-005', a.loc, nav.path, 'Missing epub:type attribute on anchor inside "landmarks" nav element.'))
          continue
        }
        const href = a.attrs?.['href'] ?? ''
        const key = `${type} ${href}`
        if (seen.has(key)) {
          messages.push(msg('RSC-005', a.loc, nav.path, `Another landmark was found with the same epub:type and reference to "${href}".`))
        } else {
          seen.add(key)
        }
      }
    }
  }

  return messages
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/checks/nav.test.ts`
Expected: PASS — occurrence + content.

- [ ] **Step 5: Lint + typecheck + commit**

Run: `npm run lint && npx tsc --noEmit` (Expected: clean)
```bash
git add src/checks/nav.ts src/checks/nav.test.ts
git commit -m "feat: add nav content (link/label/landmark) validation"
```

---

### Task 6: Nav checks — link resolution (`checkLinks`)

**Files:**
- Modify: `src/checks/nav.ts`, `src/checks/nav.test.ts`

**Interfaces:**
- Consumes: adds `getResource` from `../io/zip.js`; `resolvePath`, `isRemote` from `../util/path.js`.
- Produces: `validateNav` now also returns `checkLinks(nav, pkg, container)`; `_pkg`/`_container` become `pkg`/`container`.
- Rules: for each nav `<a href>` — if remote → `NAV-010` (`%1$s` = the section's first `epub:type` token or `"toc"`, `%2$s` = href); else resolve against the nav doc path: not in container → `RSC-007` (href); in container but not declared in the manifest → `RSC-008` (href).

- [ ] **Step 1: Add the failing tests**

Append to `src/checks/nav.test.ts`:
```ts
describe('validateNav — links', () => {
  it('RSC-007 when a nav link target is not in the container', () => {
    expect(ids('<nav epub:type="toc"><ol><li><a href="missing.xhtml">x</a></li></ol></nav>'))
      .toContain('RSC-007')
  })
  it('NAV-010 when a nav link is remote', () => {
    expect(ids('<nav epub:type="toc"><ol><li><a href="https://example.com/x">x</a></li></ol></nav>'))
      .toContain('NAV-010')
  })
  it('RSC-008 when the target exists in the container but is not in the manifest', () => {
    // 'extra.xhtml' is added to the container targets but not to the manifest in navDoc().
    expect(ids('<nav epub:type="toc"><ol><li><a href="extra.xhtml">x</a></li></ol></nav>', ['EPUB/c1.xhtml', 'EPUB/extra.xhtml']))
      .toContain('RSC-008')
  })
  it('does not flag a resolvable, manifest-declared link', () => {
    expect(ids('<nav epub:type="toc"><ol><li><a href="c1.xhtml#frag">x</a></li></ol></nav>'))
      .toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/checks/nav.test.ts`
Expected: FAIL — link rules not implemented.

- [ ] **Step 3: Add `checkLinks` and wire it in**

In `src/checks/nav.ts`, update imports:
```ts
import { findDescendants, textContent } from '../io/xml.js'
import { getResource, type EpubContainer } from '../io/zip.js'
import { resolvePath, isRemote } from '../util/path.js'
```
Replace `validateNav` with:
```ts
export function validateNav(
  nav: NavDocument,
  pkg: PackageDocument,
  container: EpubContainer,
): Message[] {
  return [...checkOccurrence(nav), ...checkContent(nav), ...checkLinks(nav, pkg, container)]
}
```
Add below `checkContent`:
```ts
function checkLinks(nav: NavDocument, pkg: PackageDocument, container: EpubContainer): Message[] {
  const messages: Message[] = []

  // Container paths declared in the manifest (manifest hrefs resolve against the OPF path).
  const manifestPaths = new Set<string>()
  for (const item of pkg.manifest) {
    if (item.href && !isRemote(item.href)) manifestPaths.add(resolvePath(pkg.path, item.href))
  }

  for (const section of nav.sections) {
    const label = section.types[0] ?? 'toc'
    for (const a of findDescendants(section.node, 'a')) {
      const href = a.attrs?.['href']
      if (!href) continue
      if (isRemote(href)) {
        messages.push(msg('NAV-010', a.loc, label, href))
        continue
      }
      const target = resolvePath(nav.path, href) // resolvePath strips the fragment
      if (!getResource(container, target)) {
        messages.push(msg('RSC-007', a.loc, href))
      } else if (!manifestPaths.has(target)) {
        messages.push(msg('RSC-008', a.loc, href))
      }
    }
  }

  return messages
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/checks/nav.test.ts`
Expected: PASS — occurrence + content + links.

- [ ] **Step 5: Lint + typecheck + commit**

Run: `npm run lint && npx tsc --noEmit` (Expected: clean)
```bash
git add src/checks/nav.ts src/checks/nav.test.ts
git commit -m "feat: add nav link resolution validation"
```

---

### Task 7: Wire nav into `validateEpub` + public exports + integration

**Files:**
- Modify: `src/validate.ts`, `src/validate.test.ts`, `src/index.ts`
- Create: `test/integration/nav.test.ts`

**Interfaces:**
- Consumes: `parseNav` from `./parse/nav.js`; `validateNav` from `./checks/nav.js`.
- Produces: for an EPUB 3 package that declares a nav item, `validateEpub` parses + validates the nav document after `validateOpf`. `index.ts` exports `parseNav`, `validateNav`, `textContent`, and the `NavDocument`/`NavSection` types.

- [ ] **Step 1: Add the failing unit test**

Append to `src/validate.test.ts`:
```ts
  it('runs nav checks for an EPUB 3 package', async () => {
    const opf =
      '<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid">' +
      '<metadata><dc:identifier id="uid">u</dc:identifier><dc:title>T</dc:title><dc:language>en</dc:language>' +
      '<meta property="dcterms:modified">2020-01-01T00:00:00Z</meta></metadata>' +
      '<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest>' +
      '<spine><itemref idref="nav"/></spine></package>'
    // nav doc whose toc links to a file not in the container -> RSC-007
    const nav =
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>t</title></head><body>' +
      '<nav epub:type="toc"><ol><li><a href="missing.xhtml">One</a></li></ol></nav></body></html>'
    const bytes = zipSync({
      mimetype: [enc('application/epub+zip'), { level: 0 }],
      'META-INF/container.xml': [enc('<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'), { level: 6 }],
      'package.opf': [enc(opf), { level: 6 }],
      'nav.xhtml': [enc(nav), { level: 6 }],
    })
    const report = await validateEpub(bytes)
    expect(report.messages.map((m) => m.id)).toContain('RSC-007')
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/validate.test.ts`
Expected: FAIL — `RSC-007` absent (nav not wired yet).

- [ ] **Step 3: Wire nav into `validate.ts`**

Replace `src/validate.ts` with:
```ts
import { openEpub } from './io/zip.js'
import { validateOcf } from './checks/ocf.js'
import { parseOpf } from './parse/opf.js'
import { validateOpf } from './checks/opf.js'
import { parseNav } from './parse/nav.js'
import { validateNav } from './checks/nav.js'
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

      // Navigation Document (EPUB 3 only).
      if (detectedVersion === '3.0') {
        const navItem = pkg.manifest.find((i) => i.properties.includes('nav'))
        if (navItem) {
          const { nav, messages: navMessages } = parseNav(navItem, container)
          messages.push(...navMessages)
          if (nav) messages.push(...validateNav(nav, pkg, container))
        }
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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/validate.test.ts`
Expected: PASS — including the new nav test.

- [ ] **Step 5: Export the new public API**

In `src/index.ts`:
- add `textContent` to the existing `io/xml.js` export line so it reads:
```ts
export { parseXml, childElements, findDescendants, textContent } from './io/xml.js'
```
- add after the `validateOpf` export:
```ts
export { parseNav } from './parse/nav.js'
export { validateNav } from './checks/nav.js'
```
- add to the type re-exports:
```ts
export type { NavDocument, NavSection } from './parse/nav.js'
```

- [ ] **Step 6: Add the integration test**

`test/integration/nav.test.ts`
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
const OPF =
  '<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid">' +
  '<metadata><dc:identifier id="uid">urn:isbn:1</dc:identifier><dc:title>T</dc:title><dc:language>en</dc:language>' +
  '<meta property="dcterms:modified">2020-01-01T00:00:00Z</meta></metadata>' +
  '<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' +
  '<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>' +
  '<spine><itemref idref="c1"/></spine></package>'

function epub(navBody: string) {
  const nav =
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>t</title></head><body>' +
    navBody + '</body></html>'
  return zipSync({
    mimetype: [enc('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': [CONTAINER, { level: 6 }],
    'EPUB/package.opf': [enc(OPF), { level: 6 }],
    'EPUB/nav.xhtml': [enc(nav), { level: 6 }],
    'EPUB/c1.xhtml': [enc('<html/>'), { level: 6 }],
  })
}

describe('integration: nav validation', () => {
  it('reports no nav errors for a valid toc', async () => {
    const report = await validateEpub(epub('<nav epub:type="toc"><ol><li><a href="c1.xhtml">One</a></li></ol></nav>'))
    const navIds = report.messages.map((m) => m.id).filter((id) => id.startsWith('NAV') || id === 'RSC-005' || id === 'RSC-007' || id === 'RSC-008')
    expect(navIds).toEqual([])
  })

  it('flags a missing toc nav', async () => {
    const report = await validateEpub(epub('<nav epub:type="landmarks"><ol><li><a epub:type="bodymatter" href="c1.xhtml">Start</a></li></ol></nav>'))
    expect(report.messages.some((m) => m.id === 'RSC-005' && m.message.includes('"toc"'))).toBe(true)
    expect(report.valid).toBe(false)
  })
})
```

- [ ] **Step 7: Run the full gate**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: lint clean; typecheck clean; ALL tests pass (Plans 1–2 suite + new nav unit/integration); build emits `dist/index.js` + `dist/index.d.ts`.

- [ ] **Step 8: Commit**

```bash
git add src/validate.ts src/validate.test.ts src/index.ts test/integration/nav.test.ts
git commit -m "feat: wire navigation document validation into validateEpub"
```

---

## Roadmap (subsequent plans)

- **Plan 4 — XHTML content:** `parse/content.ts` + `checks/content.ts` — content-document well-formedness, allowed element/attribute subset, reference resolution, fragment-id checks (`RSC-012`). Nav reading-order (`NAV-011`) and broken-fragment checks for nav links fit naturally once content docs are parsed.
- **Plan 5 — Fixture corpus + deferred rules:** ported epubcheck fixtures; deferred nav rules (`NAV-011` reading order, `NAV-009` region-FXL, `NAV-003..008` EDUPUB, `flat-nav` nested-ol warning, `req-heading`), plus deferred OPF rules and `LICENSE`/`ATTRIBUTION`.
- **Attribute-namespace resolution:** a `parseXml` enhancement to resolve attribute namespaces (so `epub:type` is matched by URI, not the `epub:` prefix) — improves nav + content fidelity.

---

## Self-Review

**Spec coverage (navigation portion of §2/§6/§7):** nav doc parse → Task 3 (`parseNav`/`NavDocument`); occurrence + structure → Task 4; content/labels/landmarks → Task 5; link resolution → Task 6; wiring + `epubVersion`-gated nav + exports → Task 7; message-ID reuse (decided strategy) → Task 1 + checks. EDUPUB/region/reading-order/fragment rules are deferred (roadmap). No nav-scope gaps.

**Placeholder scan:** No TBD/TODO; every code step has complete code; "later task" references are only the documented incremental wiring of `validateNav` (Tasks 4→5→6, full code at each step) and the roadmap.

**Type consistency:** `NavSection`/`NavDocument` defined in Task 3, consumed unchanged in Tasks 4–7. `validateNav(nav, pkg, container)` signature identical across Tasks 4/5/6/7 (params gain use across tasks; `_`-prefixed until used). `parseNav(navItem, container) => { nav?, messages }` consumed in Task 7. Catalog IDs added in Task 1 (`RSC-007`/`RSC-008`/`NAV-010`) match every `msg(...)` call site; `RSC-005` reuses the Plan 1 `(path, detail)` form. `isRemote` (Task 2, `util/path.ts`) consumed by `checks/opf.ts` (refactor) and `checks/nav.ts` (Task 6). `textContent` (Task 2, `io/xml.ts`) consumed by `checks/nav.ts` (Task 5) and re-exported in Task 7. `index.ts` re-exports resolve to real symbols.
```
