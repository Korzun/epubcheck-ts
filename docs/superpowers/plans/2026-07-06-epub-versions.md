# EPUB Per-Revision Version Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the validator from two major versions (`2.0`/`3.0`) to the full set of published revisions (`2.0`, `2.0.1`, `3.0`, `3.0.1`, `3.2`, `3.3`) and apply revision-specific rules where the specs actually differ.

**Architecture:** A new `src/versions.ts` module is the single source of truth for everything that varies by revision (the `EpubVersion` type, an ordering, `majorVersion`/`atLeast` helpers, and a `coreMediaTypes(v)` table). The caller-specified (or defaulted) target revision threads into the checks that branch on it. Deprecation warnings for `bindings`/`epub:switch`/`epub:trigger` are emitted through epubcheck's generic `RSC-017` WARNING, gated to `3.2+`.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest, saxes (XML), fflate (zip). Functional style — plain functions and modules, no classes.

## Global Constraints

- Functional style only — no classes. Plain exported functions and `const` data.
- ESM imports use `.js` specifiers even for `.ts` files (e.g. `from './versions.js'`).
- Types are colocated with the module that produces them; no types-only files.
- Unit tests are colocated beside source (`foo.ts` → `foo.test.ts`); integration tests live under `test/`.
- Deprecation fidelity: only `bindings`, `epub:switch`, `epub:trigger` are flagged (as `RSC-017` WARNING). `<guide>` and NCX/spine-`toc` are NOT flagged — epubcheck emits nothing for them.
- Revision ordering rank: `2.0`/`2.0.1` → 20, `3.0`/`3.0.1` → 30, `3.2` → 32, `3.3` → 33.
- Default target when the caller passes no `version`: newest revision of the detected major — `'3.3'` for EPUB 3, `'2.0'` for EPUB 2.
- Run the full suite with `npx vitest run`; a single file with `npx vitest run <path>`.

---

## File Structure

- **Create** `src/versions.ts` — `EpubVersion` type, `majorVersion`, `atLeast`, `coreMediaTypes`. Single source of revision-varying knowledge.
- **Create** `src/versions.test.ts` — unit tests for the above.
- **Modify** `src/parse/opf.ts` — capture the `<bindings>` element location on `PackageDocument`.
- **Modify** `src/parse/opf.test.ts` — test bindings capture.
- **Modify** `src/parse/content.ts` — capture `epub:switch`/`epub:trigger` occurrences on `ContentDocument`.
- **Modify** `src/parse/content.test.ts` — test switch/trigger capture.
- **Modify** `src/messages/catalog.ts` — add `RSC-017`.
- **Modify** `src/messages/catalog.test.ts` — assert `RSC-017` severity/template.
- **Modify** `src/checks/opf.ts` — thread `version`; emit `RSC-017` for `bindings` at 3.2+; gate nav requirement on `majorVersion(version)`.
- **Modify** `src/checks/opf.test.ts` — update call sites; bindings deprecation tests.
- **Modify** `src/checks/content.ts` — thread `version`; use `coreMediaTypes(version)`; emit `RSC-017` for switch/trigger at 3.2+.
- **Modify** `src/checks/content.test.ts` — update call sites; revision media-type + switch/trigger tests.
- **Modify** `src/report.ts` — widen `epubVersion` to `EpubVersion`.
- **Modify** `src/validate.ts` — `EpubVersion` option; `resolveVersion`; thread target; PKG-001 major comparison; gate EPUB-3 checks on `majorVersion(target)`.
- **Modify** `src/validate.test.ts` — revision threading, PKG-001 major, default→3.3.
- **Modify** `src/index.ts` — export the `EpubVersion` type.
- **Modify** `README.md` — version support + caller-target/default semantics.
- **Create** `test/integration/versions.test.ts` + fixtures — per-revision end-to-end.

---

### Task 1: `src/versions.ts` — version model & media-type table

**Files:**
- Create: `src/versions.ts`
- Test: `src/versions.test.ts`

**Interfaces:**
- Consumes: `BLESSED_FONT_TYPES` from `src/util/media-types.ts`.
- Produces:
  - `type EpubVersion = '2.0' | '2.0.1' | '3.0' | '3.0.1' | '3.2' | '3.3'`
  - `majorVersion(v: EpubVersion): '2.0' | '3.0'`
  - `atLeast(v: EpubVersion, floor: EpubVersion): boolean`
  - `coreMediaTypes(v: EpubVersion): ReadonlySet<string>`

- [ ] **Step 1: Write the failing test**

Create `src/versions.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { majorVersion, atLeast, coreMediaTypes, type EpubVersion } from './versions.js'

describe('majorVersion', () => {
  it('maps revisions to their major version', () => {
    expect(majorVersion('2.0')).toBe('2.0')
    expect(majorVersion('2.0.1')).toBe('2.0')
    expect(majorVersion('3.0')).toBe('3.0')
    expect(majorVersion('3.0.1')).toBe('3.0')
    expect(majorVersion('3.2')).toBe('3.0')
    expect(majorVersion('3.3')).toBe('3.0')
  })
})

describe('atLeast', () => {
  it('orders revisions by rank, treating same-profile revisions as equal', () => {
    expect(atLeast('3.2', '3.2')).toBe(true)
    expect(atLeast('3.3', '3.2')).toBe(true)
    expect(atLeast('3.0', '3.2')).toBe(false)
    expect(atLeast('3.0.1', '3.0')).toBe(true) // same rank
    expect(atLeast('2.0.1', '2.0')).toBe(true) // same rank
    expect(atLeast('2.0', '3.0')).toBe(false)
  })
})

describe('coreMediaTypes', () => {
  it('adds application/javascript at 3.2', () => {
    expect(coreMediaTypes('3.0').has('application/javascript')).toBe(false)
    expect(coreMediaTypes('3.2').has('application/javascript')).toBe(true)
  })
  it('adds WebP and application/ecmascript at 3.3', () => {
    expect(coreMediaTypes('3.2').has('image/webp')).toBe(false)
    expect(coreMediaTypes('3.3').has('image/webp')).toBe(true)
    expect(coreMediaTypes('3.2').has('application/ecmascript')).toBe(false)
    expect(coreMediaTypes('3.3').has('application/ecmascript')).toBe(true)
  })
  it('removes application/pls+xml at 3.3', () => {
    expect(coreMediaTypes('3.2').has('application/pls+xml')).toBe(true)
    expect(coreMediaTypes('3.3').has('application/pls+xml')).toBe(false)
  })
  it('keeps common images and text/css across revisions', () => {
    for (const v of ['3.0', '3.2', '3.3'] as EpubVersion[]) {
      expect(coreMediaTypes(v).has('image/png')).toBe(true)
      expect(coreMediaTypes(v).has('text/css')).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/versions.test.ts`
Expected: FAIL — cannot find module `./versions.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/versions.ts`:

```ts
import { BLESSED_FONT_TYPES } from './util/media-types.js'

/** Every EPUB revision this validator accepts as a target. */
export type EpubVersion = '2.0' | '2.0.1' | '3.0' | '3.0.1' | '3.2' | '3.3'

// Gating rank. Revisions that share a validation profile share a rank:
// 2.0/2.0.1 → 20, 3.0/3.0.1 → 30, 3.2 → 32, 3.3 → 33.
const RANK: Record<EpubVersion, number> = {
  '2.0': 20,
  '2.0.1': 20,
  '3.0': 30,
  '3.0.1': 30,
  '3.2': 32,
  '3.3': 33,
}

export function majorVersion(v: EpubVersion): '2.0' | '3.0' {
  return RANK[v] < 30 ? '2.0' : '3.0'
}

export function atLeast(v: EpubVersion, floor: EpubVersion): boolean {
  return RANK[v] >= RANK[floor]
}

// Core Media Types common to every EPUB 3 revision. Fonts are treated uniformly
// across 3.x (the shared blessed-font set); over-accepting a font is low-risk and
// preserves prior behavior. Revision gating below applies to the high-confidence
// image/script deltas.
const CORE_BASE: readonly string[] = [
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/svg+xml',
  'audio/mpeg',
  'audio/mp4',
  'application/xhtml+xml',
  'text/javascript',
  'text/css',
  'application/pls+xml',
  'application/smil+xml',
]

/** Exact-match Core Media Types for a revision. (video/* and Opus are handled
 * by prefix/pattern at the call site — see checks/content.ts.) */
export function coreMediaTypes(v: EpubVersion): ReadonlySet<string> {
  const set = new Set<string>([...CORE_BASE, ...BLESSED_FONT_TYPES])
  if (atLeast(v, '3.2')) set.add('application/javascript')
  if (atLeast(v, '3.3')) {
    set.add('image/webp')
    set.add('application/ecmascript')
    set.delete('application/pls+xml') // PLS dropped as a Core Media Type in 3.3
  }
  return set
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/versions.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/versions.ts src/versions.test.ts
git commit -m "feat: add EpubVersion model and revision-aware coreMediaTypes"
```

---

### Task 2: `RSC-017` message catalog entry

**Files:**
- Modify: `src/messages/catalog.ts`
- Test: `src/messages/catalog.test.ts`

**Interfaces:**
- Produces: catalog id `RSC-017`, severity `WARNING`, template `Warning while parsing file: %1$s`.

- [ ] **Step 1: Write the failing test**

Add to `src/messages/catalog.test.ts` inside the `describe('CATALOG', …)` block:

```ts
  it('RSC-017 is a WARNING with a single parameter (used for deprecations)', () => {
    expect(CATALOG['RSC-017']?.severity).toBe('WARNING')
    expect(CATALOG['RSC-017']?.template).toContain('%1$s')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/messages/catalog.test.ts`
Expected: FAIL — `CATALOG['RSC-017']` is undefined.

- [ ] **Step 3: Write minimal implementation**

In `src/messages/catalog.ts`, add this line to the `CATALOG` object, next to the other `RSC-*` entries (e.g. after `RSC-016`/`RSC-013` group; any position within the object literal is fine):

```ts
  'RSC-017': { severity: 'WARNING', template: 'Warning while parsing file: %1$s' },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/messages/catalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/messages/catalog.ts src/messages/catalog.test.ts
git commit -m "feat: add RSC-017 deprecation-warning catalog entry"
```

---

### Task 3: Capture `<bindings>` in the OPF parser

**Files:**
- Modify: `src/parse/opf.ts` (add `bindings?: Location` to `PackageDocument`; parse it in `parseOpf`)
- Test: `src/parse/opf.test.ts`

**Interfaces:**
- Consumes: `firstChild`, `Location` (already imported in the module).
- Produces: `PackageDocument.bindings?: Location`.

- [ ] **Step 1: Write the failing test**

Add to `src/parse/opf.test.ts` (it already builds containers/OPF XML — follow the existing `parseOpf` test patterns in that file for constructing `container`):

```ts
  it('captures the <bindings> element location when present', () => {
    const opf =
      '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">' +
      '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">u</dc:identifier><dc:title>T</dc:title><dc:language>en</dc:language></metadata>' +
      '<manifest><item id="x" href="x.xhtml" media-type="application/xhtml+xml"/></manifest>' +
      '<spine><itemref idref="x"/></spine>' +
      '<bindings><mediaType handler="h" media-type="application/x-foo"/></bindings>' +
      '</package>'
    const container = makeOpfContainer(opf) // helper already used in this file
    const { pkg } = parseOpf(container)
    expect(pkg?.bindings).toBeDefined()
  })

  it('leaves bindings undefined when the element is absent', () => {
    const opf =
      '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">' +
      '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">u</dc:identifier><dc:title>T</dc:title><dc:language>en</dc:language></metadata>' +
      '<manifest><item id="x" href="x.xhtml" media-type="application/xhtml+xml"/></manifest>' +
      '<spine><itemref idref="x"/></spine></package>'
    const { pkg } = parseOpf(makeOpfContainer(opf))
    expect(pkg?.bindings).toBeUndefined()
  })
```

> If `src/parse/opf.test.ts` does not already have a `makeOpfContainer(opf)` helper, add this near the top of the file (it mirrors the container shape used elsewhere in the suite):
>
> ```ts
> function makeOpfContainer(opf: string): EpubContainer {
>   const resources = new Map<string, Resource>()
>   resources.set('package.opf', { path: 'package.opf', bytes: new TextEncoder().encode(opf), compression: 'deflate' })
>   return { resources, rootfiles: ['package.opf'], hasEncryption: false }
> }
> ```
> Ensure `EpubContainer` and `Resource` are imported: `import type { EpubContainer, Resource } from '../io/zip.js'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/parse/opf.test.ts`
Expected: FAIL — `pkg.bindings` is `undefined` in the present-case test (property does not exist yet).

- [ ] **Step 3: Write minimal implementation**

In `src/parse/opf.ts`:

1. Add the field to the `PackageDocument` interface (after `spine: SpineItem[]`):

```ts
  bindings?: Location
```

2. In `parseOpf`, after `const spineEl = firstChild(root, 'spine')`, add:

```ts
  const bindingsEl = firstChild(root, 'bindings')
```

3. In the `const pkg: PackageDocument = { … }` literal, add:

```ts
    bindings: bindingsEl?.loc,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/parse/opf.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/parse/opf.ts src/parse/opf.test.ts
git commit -m "feat: capture <bindings> element location in OPF parser"
```

---

### Task 4: Capture `epub:switch` / `epub:trigger` in the content parser

**Files:**
- Modify: `src/parse/content.ts` (add `deprecatedElements` to `ContentDocument`; collect them)
- Test: `src/parse/content.test.ts`

**Interfaces:**
- Produces:
  - `interface DeprecatedElement { name: 'switch' | 'trigger'; loc: Location }`
  - `ContentDocument.deprecatedElements: DeprecatedElement[]`

- [ ] **Step 1: Write the failing test**

Add to `src/parse/content.test.ts` (follow the file's existing `parseContent` setup for building a `ManifestItem` + `container`):

```ts
  it('captures epub:switch and epub:trigger occurrences', () => {
    const xhtml =
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">' +
      '<head><title>t</title></head><body>' +
      '<epub:switch><epub:case>a</epub:case></epub:switch>' +
      '<epub:trigger ev:observer="x"/>' +
      '</body></html>'
    const { doc } = parseContentFromString(xhtml) // helper described below
    const names = (doc?.deprecatedElements ?? []).map((d) => d.name).sort()
    expect(names).toEqual(['switch', 'trigger'])
  })

  it('has empty deprecatedElements for a plain document', () => {
    const xhtml = '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><p>x</p></body></html>'
    const { doc } = parseContentFromString(xhtml)
    expect(doc?.deprecatedElements).toEqual([])
  })
```

> If the test file lacks a string-based helper, add one mirroring its existing container construction:
>
> ```ts
> function parseContentFromString(xhtml: string) {
>   const resources = new Map<string, Resource>()
>   resources.set('package.opf', { path: 'package.opf', bytes: new TextEncoder().encode(''), compression: 'deflate' })
>   resources.set('c.xhtml', { path: 'c.xhtml', bytes: new TextEncoder().encode(xhtml), compression: 'deflate' })
>   const container: EpubContainer = { resources, rootfiles: ['package.opf'], hasEncryption: false }
>   const item: ManifestItem = { id: 'c', href: 'c.xhtml', mediaType: 'application/xhtml+xml', properties: [], loc: { path: 'package.opf' } }
>   return parseContent(item, container)
> }
> ```
> Import `EpubContainer`, `Resource` from `../io/zip.js` and `ManifestItem` from `./opf.js` if not already imported.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/parse/content.test.ts`
Expected: FAIL — `doc.deprecatedElements` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `src/parse/content.ts`:

1. Add the OPS namespace constant near the top (after imports):

```ts
const OPS_NS = 'http://www.idpf.org/2007/ops'
```

2. Add the type (near `ContentRef`/`InlineStyle`):

```ts
export interface DeprecatedElement {
  name: 'switch' | 'trigger'
  loc: Location
}
```

3. Add the field to `ContentDocument`:

```ts
  deprecatedElements: DeprecatedElement[]
```

4. Extend `collect` to also gather them. Change the `collect` signature to accept the array and push matches. Update the signature and body:

```ts
function collect(
  node: XmlNode,
  parent: string | undefined,
  refs: ContentRef[],
  ids: Set<string>,
  idPositions: Map<string, number>,
  inlineStyles: InlineStyle[],
  deprecated: DeprecatedElement[],
): void {
  for (const child of node.children ?? []) {
    if (child.type !== 'element') continue
    const attrs = child.attrs ?? {}
    const id = attrs['id']
    if (id) {
      ids.add(id)
      if (!idPositions.has(id)) idPositions.set(id, idPositions.size + 1)
    }
    if (child.ns === OPS_NS && (child.name === 'switch' || child.name === 'trigger')) {
      deprecated.push({ name: child.name, loc: child.loc })
    }
    addRefs(child, parent, attrs, refs)
    if (child.name === 'style') {
      inlineStyles.push({ context: 'stylesheet', text: textContent(child), loc: child.loc })
    }
    const styleAttr = attrs['style']
    if (styleAttr) {
      inlineStyles.push({ context: 'declarationList', text: styleAttr, loc: child.loc })
    }
    collect(child, child.name, refs, ids, idPositions, inlineStyles, deprecated)
  }
}
```

5. In `parseContent`, allocate and thread the array, and include it in the returned doc:

```ts
  const refs: ContentRef[] = []
  const ids = new Set<string>()
  const idPositions = new Map<string, number>()
  const inlineStyles: InlineStyle[] = []
  const deprecatedElements: DeprecatedElement[] = []
  collect(root, undefined, refs, ids, idPositions, inlineStyles, deprecatedElements)
  return { doc: { path, root, refs, ids, idPositions, inlineStyles, deprecatedElements }, messages }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/parse/content.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/parse/content.ts src/parse/content.test.ts
git commit -m "feat: capture epub:switch/epub:trigger in content parser"
```

---

### Task 5: Thread version into `validateOpf`; flag deprecated `bindings`

**Files:**
- Modify: `src/checks/opf.ts`
- Test: `src/checks/opf.test.ts`

**Interfaces:**
- Consumes: `EpubVersion`, `majorVersion`, `atLeast` from `../versions.js`; `PackageDocument.bindings` (Task 3); `RSC-017` (Task 2).
- Produces: `validateOpf(pkg: PackageDocument, container: EpubContainer, version: EpubVersion | undefined): Message[]`.

- [ ] **Step 1: Write the failing test**

In `src/checks/opf.test.ts`, update the `ids` helper to take a version (default `'3.3'`, which keeps `majorVersion` = `'3.0'` so existing nav-requirement assertions are unchanged):

```ts
const ids = (pkg: PackageDocument, version: EpubVersion = '3.3', c: EpubContainer = emptyContainer(['EPUB/nav.xhtml'])) =>
  validateOpf(pkg, c, version).map((m) => m.id)
```

Add the import: `import type { EpubVersion } from '../versions.js'`.

Then add a new describe block:

```ts
describe('validateOpf — bindings deprecation (RSC-017)', () => {
  it('warns at 3.2+ when a bindings element is present', () => {
    const pkg = validPkg({ bindings: LOC })
    expect(ids(pkg, '3.2')).toContain('RSC-017')
    expect(ids(pkg, '3.3')).toContain('RSC-017')
  })
  it('does not warn at 3.0 (bindings not yet deprecated)', () => {
    const pkg = validPkg({ bindings: LOC })
    expect(ids(pkg, '3.0')).not.toContain('RSC-017')
  })
  it('does not warn when there is no bindings element', () => {
    expect(ids(validPkg(), '3.3')).not.toContain('RSC-017')
  })
  it('the RSC-017 message names the bindings element', () => {
    const out = validateOpf(validPkg({ bindings: LOC }), emptyContainer(['EPUB/nav.xhtml']), '3.3')
    expect(out.some((m) => m.id === 'RSC-017' && m.message.includes('bindings element is deprecated'))).toBe(true)
  })
})
```

Also, because the `ids` helper signature changed, any existing call that passed a container as the 2nd arg (e.g. `ids(pkg, someContainer)`) must move it to the 3rd arg: `ids(pkg, '3.3', someContainer)`. Search the file for `ids(` and fix such call sites.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/checks/opf.test.ts`
Expected: FAIL — `validateOpf` currently takes 2 args / no `RSC-017` emitted.

- [ ] **Step 3: Write minimal implementation**

In `src/checks/opf.ts`:

1. Add imports:

```ts
import { majorVersion, atLeast, type EpubVersion } from '../versions.js'
```

2. Change `validateOpf` to accept and thread the version:

```ts
export function validateOpf(
  pkg: PackageDocument,
  container: EpubContainer,
  version: EpubVersion | undefined,
): Message[] {
  return [
    ...checkPackage(pkg),
    ...checkManifest(pkg, container),
    ...checkSpineAndNav(pkg, version),
    ...checkDeprecatedFeatures(pkg, version),
  ]
}
```

3. Change `checkSpineAndNav` to gate the nav requirement on the target major instead of `pkg.version`:

```ts
function checkSpineAndNav(pkg: PackageDocument, version: EpubVersion | undefined): Message[] {
```

and replace the line `if (pkg.version === '3.0') {` with:

```ts
  if (version !== undefined && majorVersion(version) === '3.0') {
```

4. Add the new deprecation check function (place it after `checkSpineAndNav`):

```ts
function checkDeprecatedFeatures(pkg: PackageDocument, version: EpubVersion | undefined): Message[] {
  const messages: Message[] = []
  if (version !== undefined && atLeast(version, '3.2') && pkg.bindings) {
    messages.push(msg('RSC-017', pkg.bindings, 'Use of the bindings element is deprecated'))
  }
  return messages
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/checks/opf.test.ts`
Expected: PASS (existing + new). If any existing test still calls `validateOpf(pkg, c)` with two args, add the third: `validateOpf(pkg, c, '3.3')`.

- [ ] **Step 5: Commit**

```bash
git add src/checks/opf.ts src/checks/opf.test.ts
git commit -m "feat: flag deprecated <bindings> (RSC-017) at EPUB 3.2+"
```

---

### Task 6: Thread version into `validateContentDocs`; revision media types + switch/trigger

**Files:**
- Modify: `src/checks/content.ts`
- Test: `src/checks/content.test.ts`

**Interfaces:**
- Consumes: `coreMediaTypes`, `atLeast`, `EpubVersion` from `../versions.js`; `ContentDocument.deprecatedElements` (Task 4); `RSC-017` (Task 2).
- Produces: `validateContentDocs(pkg: PackageDocument, container: EpubContainer, version: EpubVersion): Message[]`.

- [ ] **Step 1: Write the failing test**

First, update every existing call in `src/checks/content.test.ts` to pass a version, preserving current behavior. Mechanically replace:
- `validateContentDocs(pkg, container)` → `validateContentDocs(pkg, container, '3.3')`
- `validateContentDocs(pkg.pkg, pkg.container)` → `validateContentDocs(pkg.pkg, pkg.container, '3.3')`

(Do the same for the shared helper on line ~35: `return validateContentDocs(pkg, container, '3.3').map(...)`.)

Then add new revision-sensitive tests. These need a small helper that builds an EPUB where an `<img>` points at a WebP resource with no fallback — reuse the file's existing `setup(...)` pattern (which maps filename → content and wires the manifest). Add:

```ts
describe('validateContentDocs — revision-sensitive core media types', () => {
  it('RSC-032 for a WebP image target under 3.2 (WebP not yet core)', () => {
    const { pkg, container } = setupWebp() // helper below
    expect(validateContentDocs(pkg, container, '3.2').map((m) => m.id)).toContain('RSC-032')
  })
  it('no RSC-032 for a WebP image target under 3.3 (WebP is core)', () => {
    const { pkg, container } = setupWebp()
    expect(validateContentDocs(pkg, container, '3.3').map((m) => m.id)).not.toContain('RSC-032')
  })
})

describe('validateContentDocs — deprecated content elements (RSC-017)', () => {
  it('warns for epub:switch/epub:trigger at 3.2+ but not at 3.0', () => {
    const body =
      '<epub:switch><epub:case>a</epub:case></epub:switch><epub:trigger ev:observer="o"/>'
    const { pkg, container } = setupBody(body) // helper below
    expect(validateContentDocs(pkg, container, '3.2').filter((m) => m.id === 'RSC-017').length).toBe(2)
    expect(validateContentDocs(pkg, container, '3.0').some((m) => m.id === 'RSC-017')).toBe(false)
  })
})
```

> Implement `setupWebp()` and `setupBody(body)` using the same container/manifest wiring the existing `setup(...)` helper in this file uses. `setupWebp` must declare a manifest item `pic.webp` with `media-type="image/webp"` and an XHTML doc containing `<img src="pic.webp"/>` (no `<picture>`, so no intrinsic fallback) and no manifest `fallback`. `setupBody(body)` wraps `body` in a minimal XHTML doc that declares `xmlns:epub="http://www.idpf.org/2007/ops"` and `xmlns:ev="http://www.w3.org/2001/xml-events"`. If the existing `setup` already accepts a files map, prefer building on it directly rather than duplicating wiring.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/checks/content.test.ts`
Expected: FAIL — `validateContentDocs` takes 2 args; new behavior absent.

- [ ] **Step 3: Write minimal implementation**

In `src/checks/content.ts`:

1. Add import and remove the now-superseded local media-type set:

```ts
import { coreMediaTypes, atLeast, type EpubVersion } from '../versions.js'
```

Delete the module-level `CORE_MEDIA_TYPES` set (lines ~28-48) and the `isCoreMediaType` function (lines ~50-56) — they move into a version-aware local below.

2. Change the exported signature and thread `version`:

```ts
export function validateContentDocs(
  pkg: PackageDocument,
  container: EpubContainer,
  version: EpubVersion,
): Message[] {
```

Inside, after computing `docs`, in the per-doc loop add the deprecation check and pass `version` to `checkReferences`:

```ts
  for (const doc of docs.values()) {
    messages.push(...checkReferences(doc, container, manifest, byId, spinePaths, version))
    messages.push(...checkFragments(doc, docs, manifest))
    messages.push(...checkElements(doc))
    messages.push(...checkLinkElements(doc))
    messages.push(...checkDeprecatedElements(doc, version))
    for (const style of doc.inlineStyles) {
      const a = analyzeCss(style.text, doc.path, style.context)
      messages.push(...a.messages)
      messages.push(
        ...validateCss(
          { path: doc.path, refs: a.refs, declarations: a.declarations, fontFaces: a.fontFaces },
          container,
          manifest,
        ),
      )
    }
  }
  return messages
}
```

3. Change `checkReferences` to accept `version` and use a version-aware core-type predicate. Update its signature:

```ts
function checkReferences(
  doc: ContentDocument,
  container: EpubContainer,
  manifest: Map<string, ManifestItem>,
  byId: Map<string, ManifestItem>,
  spinePaths: ReadonlySet<string>,
  version: EpubVersion,
): Message[] {
  const messages: Message[] = []
  const core = coreMediaTypes(version)
  const isCore = (mediaType: string | undefined): boolean => {
    if (mediaType === undefined) return false
    if (core.has(mediaType)) return true
    if (mediaType.startsWith('video/')) return true // all video/* are core in every 3.x
    if (atLeast(version, '3.3') && /^audio\/ogg\s*;\s*codecs=opus$/i.test(mediaType)) return true // Opus added in 3.3
    return false
  }
```

Then, inside the RSC-032 branch, replace the two `isCoreMediaType(...)` calls with `isCore(...)`:

```ts
      if (
        item &&
        !ref.hasIntrinsicFallback &&
        !isCore(item.mediaType) &&
        !hasFallbackTo(item, byId, (i) => isCore(i.mediaType))
      ) {
        messages.push(msg('RSC-032', ref.loc, target, item.mediaType ?? ''))
      }
```

4. Add the new deprecation-element check (place it near `checkElements`):

```ts
function checkDeprecatedElements(doc: ContentDocument, version: EpubVersion): Message[] {
  if (!atLeast(version, '3.2')) return []
  return doc.deprecatedElements.map((d) =>
    msg('RSC-017', d.loc, `The "epub:${d.name}" element is deprecated.`),
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/checks/content.test.ts`
Expected: PASS. Note: the existing test "RSC-032 for an `<img>` whose target is a non-core media type" must use a type that is non-core at `3.3` (e.g. `image/tiff`); if it previously relied on a type that is core at 3.3, adjust that fixture's media-type to `image/tiff`.

- [ ] **Step 5: Commit**

```bash
git add src/checks/content.ts src/checks/content.test.ts
git commit -m "feat: revision-aware core media types + epub:switch/trigger deprecation"
```

---

### Task 7: Widen `report.epubVersion` to `EpubVersion`

**Files:**
- Modify: `src/report.ts`
- Test: `src/report.test.ts` (no behavior change; a type-level widening — add one assertion)

**Interfaces:**
- Consumes: `EpubVersion` from `./versions.js`.
- Produces: `Report.epubVersion?: EpubVersion`; `buildReport(messages, epubVersion?: EpubVersion, threshold?)`.

- [ ] **Step 1: Write the failing test**

Add to `src/report.test.ts`:

```ts
  it('carries the resolved epubVersion through', () => {
    const r = buildReport([], '3.3')
    expect(r.epubVersion).toBe('3.3')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/report.test.ts`
Expected: With the current `'2.0' | '3.0'` type, `buildReport([], '3.3')` is a **TypeScript compile error** (`'3.3'` not assignable). Vitest will report a transform/type failure for this file.

- [ ] **Step 3: Write minimal implementation**

In `src/report.ts`:

1. Add import:

```ts
import type { EpubVersion } from './versions.js'
```

2. In the `Report` interface, change:

```ts
  epubVersion?: EpubVersion
```

3. In `buildReport`, change the parameter type:

```ts
export function buildReport(
  messages: Message[],
  epubVersion?: EpubVersion,
  threshold: ValidationThreshold = 'ERROR',
): Report {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/report.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/report.ts src/report.test.ts
git commit -m "feat: widen Report.epubVersion to EpubVersion"
```

---

### Task 8: `validate.ts` — resolve target, thread it, fix PKG-001

**Files:**
- Modify: `src/validate.ts`
- Test: `src/validate.test.ts`

**Interfaces:**
- Consumes: `EpubVersion`, `majorVersion` from `./versions.js`; `validateOpf(pkg, container, version)` (Task 5); `validateContentDocs(pkg, container, version)` (Task 6).
- Produces: `ValidateOptions.version?: EpubVersion`; unchanged `validateEpub` signature/return type otherwise.

- [ ] **Step 1: Write the failing test**

In `src/validate.test.ts`:

1. Change the existing assertion `expect(report.epubVersion).toBe('3.0')` (the "reports the detected version" test, ~line 37) to:

```ts
    expect(report.epubVersion).toBe('3.3') // default target for an unspecified EPUB 3 file
```

2. Add new tests (reuse the `zipSync` fixture style already in the file):

```ts
  it('validates against an explicit revision without a PKG-001 mismatch', async () => {
    const opf =
      '<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid">' +
      '<metadata><dc:identifier id="uid">u</dc:identifier><dc:title>T</dc:title><dc:language>en</dc:language>' +
      '<meta property="dcterms:modified">2020-01-01T00:00:00Z</meta></metadata>' +
      '<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest>' +
      '<spine><itemref idref="nav"/></spine></package>'
    const nav = '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>t</title></head><body><nav epub:type="toc"><ol><li><a href="nav.xhtml">N</a></li></ol></nav></body></html>'
    const bytes = zipSync({
      mimetype: [enc('application/epub+zip'), { level: 0 }],
      'META-INF/container.xml': [enc('<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'), { level: 6 }],
      'package.opf': [enc(opf), { level: 6 }],
      'nav.xhtml': [enc(nav), { level: 6 }],
    })
    const report = await validateEpub(bytes, { version: '3.3' })
    expect(report.epubVersion).toBe('3.3')
    expect(report.messages.some((m) => m.id === 'PKG-001')).toBe(false)
  })

  it('fires PKG-001 when the target major differs from the detected major', async () => {
    // same fixture bytes as above (version="3.0"), but force a 2.0 target
    const opf =
      '<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid">' +
      '<metadata><dc:identifier id="uid">u</dc:identifier><dc:title>T</dc:title><dc:language>en</dc:language>' +
      '<meta property="dcterms:modified">2020-01-01T00:00:00Z</meta></metadata>' +
      '<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest>' +
      '<spine><itemref idref="nav"/></spine></package>'
    const nav = '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>t</title></head><body><nav epub:type="toc"><ol><li><a href="nav.xhtml">N</a></li></ol></nav></body></html>'
    const bytes = zipSync({
      mimetype: [enc('application/epub+zip'), { level: 0 }],
      'META-INF/container.xml': [enc('<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'), { level: 6 }],
      'package.opf': [enc(opf), { level: 6 }],
      'nav.xhtml': [enc(nav), { level: 6 }],
    })
    const report = await validateEpub(bytes, { version: '2.0' })
    expect(report.messages.some((m) => m.id === 'PKG-001')).toBe(true)
  })
```

> The existing "reports PKG-001 when options.version differs" test (which forces `version: '2.0'` on a `version="3.0"` file) still passes under major comparison — `majorVersion('2.0') = '2.0'` ≠ detected `'3.0'`. Leave it as-is.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/validate.test.ts`
Expected: FAIL — `epubVersion` is `'3.0'` (old) instead of `'3.3'`; `ValidateOptions.version` rejects the option shape only if the type is still narrow (it is `'2.0'|'3.0'` — `'3.3'` is a compile error, so the file fails to transform until Step 3).

- [ ] **Step 3: Write minimal implementation**

Rewrite `src/validate.ts` as follows:

```ts
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
```

> Note: `validateCssDocs` is unchanged (no version dependency). Confirm its current signature `validateCssDocs(pkg, container)` still matches; if it takes a version later, that is out of scope here.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/validate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/validate.ts src/validate.test.ts
git commit -m "feat: resolve caller/target revision, thread it, compare majors for PKG-001"
```

---

### Task 9: Export `EpubVersion`; update README

**Files:**
- Modify: `src/index.ts`
- Modify: `src/index.test.ts`
- Modify: `README.md`

**Interfaces:**
- Produces: public type export `EpubVersion`.

- [ ] **Step 1: Write the failing test**

Add to `src/index.test.ts`:

```ts
  it('exports the EpubVersion type via a validate option', async () => {
    const mod = await import('./index.js')
    // Type-only export: assert the value entry points still resolve and the
    // module shape is intact (compile-time coverage is the real check).
    expect(typeof mod.validateEpub).toBe('function')
  })
```

(The meaningful check is compile-time: Step 3 adds `export type { EpubVersion }`. A consumer importing it must compile.)

- [ ] **Step 2: Run test to verify it fails / baseline**

Run: `npx vitest run src/index.test.ts`
Expected: PASS for the runtime assertion; the type export is verified by the typecheck in Step 4.

- [ ] **Step 3: Write minimal implementation**

1. In `src/index.ts`, add to the Types section:

```ts
export type { EpubVersion } from './versions.js'
```

2. In `README.md`:
   - Update the maturity/support line and the "EPUB 2 and EPUB 3" note to state that all published revisions (`2.0`, `2.0.1`, `3.0`, `3.0.1`, `3.2`, `3.3`) are accepted as `version` targets, that the package document only distinguishes the major version, and that the specific revision is caller-selected.
   - Update the `ValidateOptions` / `Report` type snippets: `version?: EpubVersion` and `epubVersion?: EpubVersion`.
   - Add a sentence: "When no `version` is given, EPUB 3 files are validated against the newest revision (`3.3`) and EPUB 2 against `2.0`. `report.epubVersion` is the revision whose rules were applied (the target), not necessarily the file's declared major."
   - Update the `await validateEpub(bytes, { version: '3.0' })` comment/example to mention revision targets, e.g. `{ version: '3.2' }`.

- [ ] **Step 4: Run typecheck + tests**

Run: `npx tsc --noEmit && npx vitest run src/index.test.ts`
Expected: typecheck clean; test PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/index.test.ts README.md
git commit -m "feat: export EpubVersion; document per-revision targets"
```

---

### Task 10: Integration fixtures — per-revision end-to-end

**Files:**
- Create: `test/integration/versions.test.ts`
- Create: fixture EPUB(s) under `test/fixtures/` as needed (follow the existing fixture-building approach in `test/`).

**Interfaces:**
- Consumes: `validateEpub` from `../../src/index.js` (match existing integration import style).

- [ ] **Step 1: Inspect existing integration style**

Run: `ls test/integration && sed -n '1,40p' test/integration/*.ts | head -80`
Expected: see how fixtures are constructed/loaded (inline `zipSync` vs. on-disk `.epub`). Follow whichever pattern the suite already uses.

- [ ] **Step 2: Write the failing test**

Create `test/integration/versions.test.ts` with two end-to-end cases (use the same fixture-construction approach the existing integration tests use — inline `zipSync` shown here):

```ts
import { describe, it, expect } from 'vitest'
import { zipSync } from 'fflate'
import { validateEpub } from '../../src/index.js'

const enc = (s: string) => new TextEncoder().encode(s)
const CONTAINER = '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'

function build(files: Record<string, string>): Uint8Array {
  const entries: Record<string, [Uint8Array, { level: number }]> = {
    mimetype: [enc('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': [enc(CONTAINER), { level: 6 }],
  }
  for (const [name, body] of Object.entries(files)) entries[name] = [enc(body), { level: 6 }]
  return zipSync(entries)
}

const NAV = '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>t</title></head><body><nav epub:type="toc"><ol><li><a href="nav.xhtml">N</a></li></ol></nav></body></html>'

describe('integration — per-revision targets', () => {
  it('flags a deprecated <bindings> at 3.3 but not at 3.0', async () => {
    const opf =
      '<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid">' +
      '<metadata><dc:identifier id="uid">u</dc:identifier><dc:title>T</dc:title><dc:language>en</dc:language>' +
      '<meta property="dcterms:modified">2020-01-01T00:00:00Z</meta></metadata>' +
      '<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest>' +
      '<spine><itemref idref="nav"/></spine>' +
      '<bindings><mediaType handler="nav" media-type="application/x-foo"/></bindings></package>'
    const bytes = build({ 'package.opf': opf, 'nav.xhtml': NAV })
    const at33 = await validateEpub(bytes, { version: '3.3' })
    const at30 = await validateEpub(bytes, { version: '3.0' })
    expect(at33.messages.some((m) => m.id === 'RSC-017')).toBe(true)
    expect(at30.messages.some((m) => m.id === 'RSC-017')).toBe(false)
  })

  it('accepts a WebP image without fallback at 3.3 but flags it (RSC-032) at 3.2', async () => {
    const opf =
      '<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid">' +
      '<metadata><dc:identifier id="uid">u</dc:identifier><dc:title>T</dc:title><dc:language>en</dc:language>' +
      '<meta property="dcterms:modified">2020-01-01T00:00:00Z</meta></metadata>' +
      '<manifest>' +
      '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' +
      '<item id="c" href="c.xhtml" media-type="application/xhtml+xml"/>' +
      '<item id="pic" href="pic.webp" media-type="image/webp"/>' +
      '</manifest>' +
      '<spine><itemref idref="nav"/><itemref idref="c"/></spine></package>'
    const content = '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>c</title></head><body><img src="pic.webp" alt="p"/></body></html>'
    const bytes = build({ 'package.opf': opf, 'nav.xhtml': NAV, 'c.xhtml': content, 'pic.webp': 'RIFF....WEBP' })
    const at33 = await validateEpub(bytes, { version: '3.3' })
    const at32 = await validateEpub(bytes, { version: '3.2' })
    expect(at33.messages.some((m) => m.id === 'RSC-032')).toBe(false)
    expect(at32.messages.some((m) => m.id === 'RSC-032')).toBe(true)
  })
})
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npx vitest run test/integration/versions.test.ts`
Expected: PASS.

- [ ] **Step 4: Full suite + typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: entire suite green.

- [ ] **Step 5: Commit**

```bash
git add test/integration/versions.test.ts test/fixtures
git commit -m "test: per-revision integration coverage (bindings, WebP fallback)"
```

---

## Self-Review

**Spec coverage:**
- Version model / `EpubVersion` / `majorVersion` / `atLeast` → Task 1. ✅
- `coreMediaTypes` revision table → Task 1; consumed in Task 6. ✅
- Version resolution + default `3.3` + PKG-001 major comparison → Task 8. ✅
- Parser captures `bindings` → Task 3; `switch`/`trigger` → Task 4. ✅
- `bindings` deprecation (RSC-017, 3.2+) → Task 5. ✅
- `switch`/`trigger` deprecation (RSC-017, 3.2+) → Task 6. ✅
- Revision-correct RSC-032 via `coreMediaTypes(version)` → Task 6. ✅
- EPUB-3 gate flips to `majorVersion(target)` → Tasks 5 (nav requirement) & 8 (layered docs). ✅
- `RSC-017` catalog entry → Task 2. ✅
- `report.epubVersion` widened → Task 7. ✅
- API surface (`EpubVersion` export) + README → Task 9. ✅
- Per-revision integration fixtures → Task 10. ✅
- Out of scope (guide, NCX-legacy, 3.4, 3.0-vs-3.0.1, a11y, FXL) → not implemented, by design. ✅

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". Test bodies contain concrete assertions; the two helper-dependent spots (Task 6 `setupWebp`/`setupBody`, Task 10 fixture style) give explicit construction requirements rather than deferring.

**Type consistency:** `validateOpf(pkg, container, version)` (Task 5) and `validateContentDocs(pkg, container, version)` (Task 6) signatures are consumed with matching arity in Task 8. `EpubVersion` is produced in Task 1 and imported the same way (`from '../versions.js'` / `'./versions.js'`) everywhere. `coreMediaTypes` returns `ReadonlySet<string>` consumed as such. `RSC-017` template parameter count (1) matches every `msg('RSC-017', loc, <one arg>)` call.

**One consumer note for the implementer:** `validateOpf` takes `EpubVersion | undefined` (it runs even when detection fails), whereas `validateContentDocs` takes a non-optional `EpubVersion` (it only runs inside the `majorVersion(target) === '3.0'` guard, where `target` is always defined). This asymmetry is intentional.
