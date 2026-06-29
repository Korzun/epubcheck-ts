# epubcheck-ts — Plan 5: CSS Validation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse each CSS stylesheet in an EPUB 3 publication and validate its `url()` / `@import` / `@font-face` references (existence, manifest declaration, remote policy, file/fragment rules) plus a small set of property rules and parse errors.

**Architecture:** Same pure-function pipeline. A new `parseCss(item, container)` parses a `text/css` resource with **css-tree** into a plain-data `CssDocument` (references + declarations of interest + font-face info) plus parse-error messages. A new `validateCssDocs(pkg, container)` resolves references (reusing the RSC-006/007/008 logic) and applies CSS property/font-face rules. `validateEpub` calls it after `validateContentDocs`. css-tree is a new (pure-JS, runtime-agnostic) runtime dependency.

**Tech Stack:** TypeScript (ESM), `fflate` (ZIP), `saxes` (XML), **`css-tree` (CSS)**, reuses message catalog + `resolvePath`/`isRemote`.

**Spec:** `docs/superpowers/specs/2026-06-28-epubcheck-ts-design.md` (CSS is the named "Plan 2 — CSS validation" deferred phase, §12).

## Global Constraints

From the spec + Plans 1–4, with the dependency rule relaxed for CSS.

- **ESM-only**, TypeScript source, ship `.d.ts`. Target **ES2022 / Node 18+ / evergreen browsers**.
- **Functional style, no classes.** Plain data + functions only.
- **Runtime-agnostic core:** zero Node-only APIs in `src/` (no `fs`/`Buffer`/`node:*`). `TextDecoder`/`DataView`/web `ReadableStream`/`decodeURIComponent` only. (css-tree is pure JS and runtime-agnostic — it preserves this.)
- **Runtime deps:** `fflate`, `saxes`, **`css-tree`** (decided with the user — relaxes the prior fflate+saxes-only rule). **Dev deps:** `vitest`, `tsdown`, `typescript`, `eslint`, `@eslint/js`, `typescript-eslint` (+ `@types/css-tree` only if css-tree's bundled types are insufficient).
- **Types live with their producer** — no types-only files.
- **Unit tests colocated**; integration tests under `test/`.
- **Lint is type-aware.** Every task keeps `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` green.
- **`validateEpub` always resolves to a `Report`** and never rejects.
- **Message-ID strategy (decided):** specific epubcheck IDs where epubcheck assigns one; otherwise `RSC-005` with a rule-specific detail.

### Carry-forwards / known limitations (honor + document)

- All post-`openEpub` steps remain non-throwing pure functions (preserve the `validate.ts` try/catch invariant). `parseCss` must catch any css-tree throw and degrade to a `CSS-008` message.
- `url()` references are resolved relative to the **stylesheet's own path** (not the content doc that links it).
- **Lockfile:** adding css-tree changes `package-lock.json`. Regenerate it and confirm `npm ci` works (CI uses `npm ci`). css-tree's deps are pure-JS (no native bindings), so there is no cross-platform optional-dep issue.

---

## Reference: epubcheck IDs used in this plan

From `w3c/epubcheck` (`MessageBundle.properties` + `DefaultSeverities.java` + `CSSHandler.java` + `ResourceReferencesChecker.java`).

| ID | Severity | Template | Used for |
|----|----------|----------|----------|
| `CSS-001` | ERROR | `The "%1$s" property must not be included in an EPUB Style Sheet.` | `direction`/`unicode-bidi` property |
| `CSS-002` | ERROR | `Empty or NULL reference found.` | empty/blank `url()` |
| `CSS-006` | USAGE | `CSS selector specifies fixed position.` | `position: fixed` |
| `CSS-008` | ERROR | `An error occurred while parsing the CSS: %1$s.` | CSS parse error |
| `CSS-019` | WARNING | `CSS font-face declaration has no attributes.` | `@font-face {}` with no declarations |
| `RSC-006` | ERROR | `Remote resource reference is not allowed in this context; resource "%1$s" must be located in the EPUB container.` | remote `@import` or non-font `url()` (in catalog) |
| `RSC-007` | ERROR | `Referenced resource "%1$s" could not be found in the EPUB.` | local `url()` target absent (in catalog) |
| `RSC-008` | ERROR | `Referenced resource "%1$s" is not declared in the OPF manifest.` | local `url()` target not in manifest (in catalog) |
| `RSC-013` | ERROR | `Fragment identifier is used in a reference to a stylesheet resource.` | `@import` URL has a `#fragment` |
| `RSC-030` | ERROR | `File URLs are not allowed in EPUB, but found "%1$s".` | `url(file:…)` |
| `RSC-031` | WARNING | `Remote resource references should use HTTPS, but found "%1$s".` | remote `@font-face` src using non-HTTPS |

New catalog entries this plan adds: **`CSS-001`, `CSS-002`, `CSS-006`, `CSS-008`, `CSS-019`, `RSC-013`, `RSC-030`, `RSC-031`** (`RSC-006/007/008` already exist).

### Remote-resource policy (EPUB 3 CSS url())

| Context | `CssRefType` | Remote allowed? | If remote |
|---------|--------------|-----------------|-----------|
| `@font-face src: url(…)` | `font` | yes | non-HTTPS → `RSC-031` (WARNING) |
| `@import url(…)` | `import` | no | `RSC-006` |
| any other declaration (`background-image`, `list-style-image`, `cursor`, `border-image`, …) | `generic` | no | `RSC-006` |

### Deferred (NOT in this plan — roadmap)

`CSS-003`/`CSS-004` (charset/UTF-16 detection), `CSS-005`/`CSS-015` (alternate-stylesheet title), `CSS-007` (non-standard font MIME), `CSS-028` (font-face usage log), `CSS-029`/`CSS-030` (media-overlay class checks), `RSC-020`/`RSC-026`/`RSC-033` (URL syntax/leak/query — galimatias-specific), `RSC-032` (foreign-resource fallback), `OPF-014`/`OPF-018` (remote-resources property), inline `style=""` attributes and `<style>` elements in content docs, `data:` URL nuances, EPUB 2. Note in roadmap; don't implement.

---

## File Structure (this plan)

```
src/
  parse/
    css.ts               # CssDocument/CssRef/CssRefType/CssDeclaration/FontFace + parseCss  (css-tree)  (+ css.test.ts)
    opf.ts               # (modify) add manifestPathMap(pkg) helper                          (+ opf.test.ts)
  checks/
    css.ts               # validateCssDocs (+ reference + property checks)                   (+ css.test.ts)
    content.ts           # (modify) use shared hasScheme + manifestPathMap (DRY)
  util/
    path.ts              # (modify) add hasScheme(url)                                        (+ path.test.ts)
  messages/
    catalog.ts           # (modify) add CSS-001/002/006/008/019, RSC-013/030/031
  validate.ts            # (modify) run validateCssDocs for EPUB 3
  index.ts               # (modify) export parseCss, validateCssDocs + css types
docs/superpowers/specs/2026-06-28-epubcheck-ts-design.md  # (modify) deps line: add css-tree
test/
  integration/
    css.test.ts          # end-to-end validateEpub over in-memory EPUBs with stylesheets
```

---

### Task 1: Add css-tree dependency, catalog ids, and update the spec

**Files:**
- Modify: `package.json`, `package-lock.json`, `src/messages/catalog.ts`, `src/messages/catalog.test.ts`, `docs/superpowers/specs/2026-06-28-epubcheck-ts-design.md`

**Interfaces:**
- Produces: `css-tree` runtime dependency installed + lockfile updated; catalog entries `CSS-001/002/006/008/019` and `RSC-013/030/031`.

- [ ] **Step 1: Install css-tree and verify the lockfile**

```bash
npm install css-tree@3.2.1
```
Then confirm `npm ci` still succeeds (CI uses it):
```bash
npm ci
```
Expected: clean install; `package-lock.json` now contains `css-tree`. If `npx tsc --noEmit` later reports missing css-tree types, also run `npm install -D @types/css-tree@2.3.11` (css-tree 3.x bundles its own types, so this is usually unnecessary).

- [ ] **Step 2: Add the failing catalog test**

Append inside the existing `describe('CATALOG', ...)` block in `src/messages/catalog.test.ts`:
```ts
  it('defines CSS message ids', () => {
    expect(CATALOG['CSS-001']?.severity).toBe('ERROR')
    expect(CATALOG['CSS-002']?.severity).toBe('ERROR')
    expect(CATALOG['CSS-006']?.severity).toBe('USAGE')
    expect(CATALOG['CSS-008']?.severity).toBe('ERROR')
    expect(CATALOG['CSS-019']?.severity).toBe('WARNING')
    expect(CATALOG['RSC-013']?.severity).toBe('ERROR')
    expect(CATALOG['RSC-030']?.severity).toBe('ERROR')
    expect(CATALOG['RSC-031']?.severity).toBe('WARNING')
  })
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/messages/catalog.test.ts`
Expected: FAIL — `CSS-001` etc. undefined.

- [ ] **Step 4: Add the catalog entries**

In `src/messages/catalog.ts`, add to `CATALOG` (after the existing `RSC-*` entries; add a `// CSS` group comment):
```ts
  // CSS
  'CSS-001': { severity: 'ERROR', template: 'The "%1$s" property must not be included in an EPUB Style Sheet.' },
  'CSS-002': { severity: 'ERROR', template: 'Empty or NULL reference found.' },
  'CSS-006': { severity: 'USAGE', template: 'CSS selector specifies fixed position.' },
  'CSS-008': { severity: 'ERROR', template: 'An error occurred while parsing the CSS: %1$s.' },
  'CSS-019': { severity: 'WARNING', template: 'CSS font-face declaration has no attributes.' },
  'RSC-013': { severity: 'ERROR', template: 'Fragment identifier is used in a reference to a stylesheet resource.' },
  'RSC-030': { severity: 'ERROR', template: 'File URLs are not allowed in EPUB, but found "%1$s".' },
  'RSC-031': { severity: 'WARNING', template: 'Remote resource references should use HTTPS, but found "%1$s".' },
```

- [ ] **Step 5: Update the spec dependency line**

In `docs/superpowers/specs/2026-06-28-epubcheck-ts-design.md`, find the `**Runtime deps:**` line (§11) and update it to include css-tree, e.g.:
```
- **Runtime deps:** `fflate` (ZIP), `saxes` (XML/XHTML), `css-tree` (CSS).
```

- [ ] **Step 6: Run the catalog test + lint + typecheck**

Run: `npx vitest run src/messages/catalog.test.ts && npm run lint && npx tsc --noEmit`
Expected: PASS / clean.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/messages/catalog.ts src/messages/catalog.test.ts docs/superpowers/specs/2026-06-28-epubcheck-ts-design.md
git commit -m "build: add css-tree dep; add CSS message ids"
```

---

### Task 2: Shared helpers — `hasScheme` (util) + `manifestPathMap` (opf)

**Files:**
- Modify: `src/util/path.ts`, `src/util/path.test.ts`
- Modify: `src/parse/opf.ts`, `src/parse/opf.test.ts`
- Modify: `src/checks/content.ts` (use the shared helpers)

**Interfaces:**
- Produces:
  - `function hasScheme(url: string): boolean` (from `util/path.ts`) — true for any URL with a scheme (`https:`, `data:`, `mailto:`, …).
  - `function manifestPathMap(pkg: PackageDocument): Map<string, ManifestItem>` (from `parse/opf.ts`) — resolved-container-path → manifest item, for non-remote manifest hrefs.
- `checks/content.ts` switches from its private `hasScheme`/`resolvedManifest` to these shared ones (behavior identical).

- [ ] **Step 1: Write the failing tests**

Append to `src/util/path.test.ts`:
```ts
import { hasScheme } from './path.js'

describe('hasScheme', () => {
  it('detects any url scheme', () => {
    expect(hasScheme('https://x')).toBe(true)
    expect(hasScheme('data:text/css,a')).toBe(true)
    expect(hasScheme('mailto:a@b.com')).toBe(true)
  })
  it('treats relative paths as scheme-less', () => {
    expect(hasScheme('a/b.css')).toBe(false)
    expect(hasScheme('../x.png')).toBe(false)
    expect(hasScheme('#frag')).toBe(false)
  })
})
```

Append to `src/parse/opf.test.ts`:
```ts
import { manifestPathMap } from './opf.js'

describe('manifestPathMap', () => {
  it('maps resolved container paths to manifest items (non-remote)', () => {
    const loc = { path: 'EPUB/package.opf' }
    const pkg = {
      path: 'EPUB/package.opf', version: '3.0' as const, uniqueIdentifier: 'u',
      metadata: { identifiers: [], titles: [], languages: [], modifiedCount: 1 },
      manifest: [
        { id: 'a', href: 'x/a.xhtml', mediaType: 'application/xhtml+xml', properties: [], loc },
        { id: 'r', href: 'https://example.com/r.png', mediaType: 'image/png', properties: [], loc },
      ],
      spinePresent: true, spine: [], loc,
    }
    const map = manifestPathMap(pkg)
    expect(map.get('EPUB/x/a.xhtml')?.id).toBe('a')
    expect([...map.keys()]).not.toContain('https://example.com/r.png') // remote excluded
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/util/path.test.ts src/parse/opf.test.ts`
Expected: FAIL — `hasScheme`/`manifestPathMap` not exported.

- [ ] **Step 3: Implement the helpers**

Append to `src/util/path.ts`:
```ts
/** True when `url` carries any scheme (https:, data:, mailto:, …). */
export function hasScheme(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url)
}
```

In `src/parse/opf.ts`, add imports at the top (if not already present) and the helper at the end of the file:
```ts
import { resolvePath, isRemote } from '../util/path.js'

/** Resolved-container-path → manifest item, for non-remote manifest hrefs. */
export function manifestPathMap(pkg: PackageDocument): Map<string, ManifestItem> {
  const map = new Map<string, ManifestItem>()
  for (const item of pkg.manifest) {
    if (item.href && !isRemote(item.href)) map.set(resolvePath(pkg.path, item.href), item)
  }
  return map
}
```
(If `parse/opf.ts` does not currently import from `../util/path.js`, add the import line shown. If it already imports `resolvePath`, extend that import to include `isRemote`.)

- [ ] **Step 4: Refactor `checks/content.ts` to use the shared helpers**

In `src/checks/content.ts`:
- change the path import to include `hasScheme`: `import { resolvePath, isRemote, hasScheme } from '../util/path.js'`
- import the map helper: `import { manifestPathMap, type ManifestItem, type PackageDocument } from '../parse/opf.js'` (merge with the existing opf type import)
- DELETE the local `function hasScheme(...)` and the local `function resolvedManifest(...)` definitions.
- replace the one call `resolvedManifest(pkg)` with `manifestPathMap(pkg)`.

(Behavior is identical — same resolution logic — so the existing content tests still pass.)

- [ ] **Step 5: Run the affected suites**

Run: `npx vitest run src/util/path.test.ts src/parse/opf.test.ts src/checks/content.test.ts`
Expected: PASS — new helper tests + the unchanged content tests (proving the refactor is behavior-preserving).

- [ ] **Step 6: Lint + typecheck + commit**

Run: `npm run lint && npx tsc --noEmit` (Expected: clean — no unused/duplicate helpers)
```bash
git add src/util/path.ts src/util/path.test.ts src/parse/opf.ts src/parse/opf.test.ts src/checks/content.ts
git commit -m "refactor: share hasScheme and manifestPathMap"
```

---

### Task 3: Parse CSS (`parseCss`)

**Files:**
- Create: `src/parse/css.ts`, `src/parse/css.test.ts`

**Interfaces:**
- Consumes: `css-tree`; `getResource`, `EpubContainer` from `../io/zip.js`; `resolvePath` from `../util/path.js`; `msg`, `Location`, `Message` from `../messages/format.js`; `ManifestItem` from `./opf.js`.
- Produces:
  - `type CssRefType = 'generic' | 'font' | 'import'`
  - `interface CssRef { url: string; type: CssRefType; loc: Location }`
  - `interface CssDeclaration { property: string; value: string; loc: Location }`
  - `interface FontFace { declarationCount: number; loc: Location }`
  - `interface CssDocument { path: string; refs: CssRef[]; declarations: CssDeclaration[]; fontFaces: FontFace[] }`
  - `function parseCss(item: ManifestItem, container: EpubContainer): { css?: CssDocument; messages: Message[] }` — resolves the CSS path relative to the OPF; missing rootfile/href or missing resource → `{ messages: [] }`; parse errors → `CSS-008`; an empty `url()` → `CSS-002`; otherwise a `CssDocument`.

> **Implementer note (css-tree API — THE key reconciliation point of this plan):** css-tree 3.x is error-tolerant and its AST shapes vary by version. Verify against the installed package (`node_modules/css-tree`, types bundled in v3) and reconcile the helper internals until the tests pass — the tests are the fixed contract. Specifically confirm, empirically (a few `node -e` / scratch experiments):
> 1. **`Url` node value:** how the URL string is exposed (`node.value` as a plain string in v3, vs a `String`/`Raw` child node with `.value` in v2). The provided `urlValue` handles both defensively, but verify it returns the bare URL (quotes stripped) for `url(a.png)`, `url("a.png")`, and `url('a.png')`.
> 2. **Empty `url()`:** how css-tree represents `url()` with no argument (it may be a `Url` node with empty value, or a `Function` named `url` with no children). The CSS-002 test requires empty `url()` to be detected — if css-tree does NOT yield a `Url` node for it, extend the walk to also catch a `Function` whose `name === 'url'` with no/empty url argument and route it through `pushRef('', …)`. Document what you found.
> 3. **`onParseError`:** css-tree recovers from most malformed CSS without erroring, so CSS-008 fires only opportunistically. The "handles malformed CSS without throwing" test asserts graceful handling, not a guaranteed CSS-008 — do not chase a specific erroring input. Keep CSS-008 wired to both `onParseError` and the `catch`.
> 4. **`walk` options:** confirm `walk(ast, { enter, leave })` is supported and `enter`/`leave` receive each node; `node.loc.start.{line,column}` exist when `positions: true`. The atrule-stack approach avoids relying on the walker's `this` context.
> Report exactly which of 1–4 needed adjustment.

- [ ] **Step 1: Write the failing test**

`src/parse/css.test.ts`
```ts
import { describe, it, expect } from 'vitest'
import type { EpubContainer, Resource } from '../io/zip.js'
import type { ManifestItem } from './opf.js'
import { parseCss } from './css.js'

const enc = (s: string) => new TextEncoder().encode(s)
const LOC = { path: 'EPUB/package.opf' }
const item: ManifestItem = { id: 's', href: 'styles/s.css', mediaType: 'text/css', properties: [], loc: LOC }

function container(css: string | undefined, path = 'EPUB/styles/s.css'): EpubContainer {
  const resources = new Map<string, Resource>()
  if (css !== undefined) resources.set(path, { path, bytes: enc(css), compression: 'deflate' })
  return { resources, rootfiles: ['EPUB/package.opf'], hasEncryption: false }
}

describe('parseCss', () => {
  it('extracts url() references with their types', () => {
    const { css, messages } = parseCss(item, container(
      '@import "base.css";\n' +
      '@font-face { font-family: F; src: url("../fonts/f.woff2"); }\n' +
      'body { background-image: url(bg.png); }',
    ))
    expect(messages).toHaveLength(0)
    const byType = (t: string) => css!.refs.filter((r) => r.type === t).map((r) => r.url)
    expect(byType('import')).toEqual(['base.css'])
    expect(byType('font')).toEqual(['../fonts/f.woff2'])
    expect(byType('generic')).toEqual(['bg.png'])
  })

  it('collects declarations of interest and font-face info', () => {
    const { css } = parseCss(item, container('p { direction: rtl; position: fixed; }\n@font-face {}'))
    const props = css!.declarations.map((d) => d.property)
    expect(props).toContain('direction')
    expect(props).toContain('position')
    expect(css!.fontFaces[0]?.declarationCount).toBe(0)
  })

  it('handles malformed CSS without throwing', () => {
    // css-tree is error-tolerant; this verifies graceful handling (CSS-008 is emitted
    // opportunistically when css-tree's onParseError fires) and the never-throw contract.
    const result = parseCss(item, container('p { color: }} @@@ broken {'))
    expect(Array.isArray(result.messages)).toBe(true)
  })

  it('reports CSS-002 for an empty url()', () => {
    const { messages } = parseCss(item, container('p { background: url(); }'))
    expect(messages.some((m) => m.id === 'CSS-002')).toBe(true)
  })

  it('returns no doc when the resource is absent', () => {
    expect(parseCss(item, container(undefined))).toEqual({ messages: [] })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/parse/css.test.ts`
Expected: FAIL — cannot find module `./css.js`.

- [ ] **Step 3: Implement `parse/css.ts`**

`src/parse/css.ts`
```ts
import * as csstree from 'css-tree'
import { getResource, type EpubContainer } from '../io/zip.js'
import { resolvePath } from '../util/path.js'
import { msg, type Location, type Message } from '../messages/format.js'
import type { ManifestItem } from './opf.js'

export type CssRefType = 'generic' | 'font' | 'import'
export interface CssRef {
  url: string
  type: CssRefType
  loc: Location
}
export interface CssDeclaration {
  property: string
  value: string
  loc: Location
}
export interface FontFace {
  declarationCount: number
  loc: Location
}
export interface CssDocument {
  path: string
  refs: CssRef[]
  declarations: CssDeclaration[]
  fontFaces: FontFace[]
}

function locOf(node: { loc?: csstree.CssLocation | null } | null | undefined, path: string): Location {
  const start = node?.loc?.start
  return start ? { path, line: start.line, column: start.column } : { path }
}

function stripQuotes(raw: string): string {
  const t = raw.trim()
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    return t.slice(1, -1)
  }
  return t
}

/** Extract the URL string from a css-tree Url node (handles v3 string and v2 String/Raw child). */
function urlValue(node: csstree.Url): string {
  const value: unknown = (node as { value: unknown }).value
  if (typeof value === 'string') return stripQuotes(value)
  if (value && typeof value === 'object' && 'value' in value) {
    const inner = (value as { value: unknown }).value
    if (typeof inner === 'string') return stripQuotes(inner)
  }
  return ''
}

/** The import target from an @import at-rule prelude (Url or String). */
function importTarget(atrule: csstree.Atrule): string | undefined {
  const prelude = atrule.prelude
  if (!prelude || prelude.type !== 'AtrulePrelude') return undefined
  let result: string | undefined
  csstree.walk(prelude, (n) => {
    if (result !== undefined) return
    if (n.type === 'Url') result = urlValue(n)
    else if (n.type === 'String') result = stripQuotes(n.value)
  })
  return result
}

function countDeclarations(atrule: csstree.Atrule): number {
  let count = 0
  if (atrule.block) {
    csstree.walk(atrule.block, (n) => {
      if (n.type === 'Declaration') count++
    })
  }
  return count
}

export function parseCss(
  item: ManifestItem,
  container: EpubContainer,
): { css?: CssDocument; messages: Message[] } {
  const messages: Message[] = []
  const opfPath = container.rootfiles[0]
  if (!opfPath || !item.href) return { messages }

  const path = resolvePath(opfPath, item.href)
  const resource = getResource(container, path)
  if (!resource) return { messages } // missing file is reported as RSC-001 by the OPF manifest check

  const text = new TextDecoder('utf-8').decode(resource.bytes)
  const refs: CssRef[] = []
  const declarations: CssDeclaration[] = []
  const fontFaces: FontFace[] = []

  let ast: csstree.CssNode
  try {
    ast = csstree.parse(text, {
      positions: true,
      onParseError(error) {
        messages.push(msg('CSS-008', { path, line: error.line, column: error.column }, error.message))
      },
    })
  } catch (error) {
    messages.push(msg('CSS-008', { path }, error instanceof Error ? error.message : String(error)))
    return { messages }
  }

  const atruleStack: string[] = []
  const pushRef = (url: string, type: CssRefType, loc: Location): void => {
    if (url.trim() === '') messages.push(msg('CSS-002', loc))
    else refs.push({ url, type, loc })
  }

  csstree.walk(ast, {
    enter: (node) => {
      if (node.type === 'Atrule') {
        if (node.name === 'import') {
          const url = importTarget(node)
          if (url !== undefined) pushRef(url, 'import', locOf(node, path))
        } else if (node.name === 'font-face') {
          fontFaces.push({ declarationCount: countDeclarations(node), loc: locOf(node, path) })
        }
        atruleStack.push(node.name)
      } else if (node.type === 'Url') {
        // @import url() is handled at the Atrule level; skip it here.
        if (atruleStack[atruleStack.length - 1] !== 'import') {
          const type: CssRefType = atruleStack[atruleStack.length - 1] === 'font-face' ? 'font' : 'generic'
          pushRef(urlValue(node), type, locOf(node, path))
        }
      } else if (node.type === 'Declaration') {
        declarations.push({ property: node.property.toLowerCase(), value: csstree.generate(node.value), loc: locOf(node, path) })
      }
    },
    leave: (node) => {
      if (node.type === 'Atrule') atruleStack.pop()
    },
  })

  return { css: { path, refs, declarations, fontFaces }, messages }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/parse/css.test.ts`
Expected: PASS — all five tests. (If a css-tree API mismatch fails a test, reconcile the helper internals per the implementer note; the test assertions are the contract.)

- [ ] **Step 5: Lint + typecheck + commit**

Run: `npm run lint && npx tsc --noEmit` (Expected: clean)
```bash
git add src/parse/css.ts src/parse/css.test.ts
git commit -m "feat: parse CSS and extract references via css-tree"
```

---

### Task 4: CSS checks — references (`validateCssDocs` + `checkReferences`)

**Files:**
- Create: `src/checks/css.ts`, `src/checks/css.test.ts`

**Interfaces:**
- Consumes: `parseCss`, `CssDocument`, `CssRef` from `../parse/css.js`; `manifestPathMap`, `PackageDocument`, `ManifestItem` from `../parse/opf.js`; `getResource`, `EpubContainer` from `../io/zip.js`; `resolvePath`, `isRemote`, `hasScheme` from `../util/path.js`; `msg`, `Message` from `../messages/format.js`.
- Produces: `function validateCssDocs(pkg: PackageDocument, container: EpubContainer): Message[]` — parses every `text/css` manifest item, collecting parse messages, then runs reference checks per doc. Task 5 adds property checks.
- Rules (references): `url(file:…)` → `RSC-030`; `@import` URL with `#` → `RSC-013`; remote → `RSC-006` unless `font` (font remote allowed; non-HTTPS font → `RSC-031`); other-scheme (`data:` etc.) → skip; local missing → `RSC-007`; local present but not in manifest → `RSC-008`.

- [ ] **Step 1: Write the failing test**

`src/checks/css.test.ts`
```ts
import { describe, it, expect } from 'vitest'
import type { EpubContainer, Resource } from '../io/zip.js'
import type { PackageDocument, ManifestItem } from '../parse/opf.js'
import { validateCssDocs } from './css.js'

const enc = (s: string) => new TextEncoder().encode(s)
const LOC = { path: 'EPUB/package.opf' }

// One stylesheet at EPUB/s.css plus declared/present extra resources.
function setup(css: string, opts: { present?: string[]; declared?: string[] } = {}): { pkg: PackageDocument; container: EpubContainer } {
  const resources = new Map<string, Resource>()
  resources.set('EPUB/s.css', { path: 'EPUB/s.css', bytes: enc(css), compression: 'deflate' })
  const manifest: ManifestItem[] = [{ id: 's', href: 's.css', mediaType: 'text/css', properties: [], loc: LOC }]
  for (const p of opts.present ?? []) resources.set(`EPUB/${p}`, { path: `EPUB/${p}`, bytes: enc('x'), compression: 'deflate' })
  for (const href of opts.declared ?? []) manifest.push({ id: href, href, mediaType: 'application/octet-stream', properties: [], loc: LOC })
  const container: EpubContainer = { resources, rootfiles: ['EPUB/package.opf'], hasEncryption: false }
  const pkg: PackageDocument = {
    path: 'EPUB/package.opf', version: '3.0', uniqueIdentifier: 'uid',
    metadata: { identifiers: [{ id: 'uid', value: 'u' }], titles: ['T'], languages: ['en'], modifiedCount: 1 },
    manifest, spinePresent: true, spine: [], loc: LOC,
  }
  return { pkg, container }
}
const ids = (css: string, opts?: { present?: string[]; declared?: string[] }) => {
  const { pkg, container } = setup(css, opts)
  return validateCssDocs(pkg, container).map((m) => m.id)
}

describe('validateCssDocs — references', () => {
  it('passes when a url() resolves and is declared', () => {
    expect(ids('body { background: url(bg.png); }', { present: ['bg.png'], declared: ['bg.png'] })).toEqual([])
  })
  it('RSC-007 when a url() target is missing', () => {
    expect(ids('body { background: url(missing.png); }')).toContain('RSC-007')
  })
  it('RSC-008 when a url() target exists but is not declared', () => {
    expect(ids('body { background: url(extra.png); }', { present: ['extra.png'] })).toContain('RSC-008')
  })
  it('RSC-006 for a remote background image', () => {
    expect(ids('body { background: url(https://example.com/a.png); }')).toContain('RSC-006')
  })
  it('allows a remote @font-face src but warns RSC-031 when not HTTPS', () => {
    const idsOut = ids('@font-face { font-family: F; src: url(http://example.com/f.woff2); }')
    expect(idsOut).not.toContain('RSC-006')
    expect(idsOut).toContain('RSC-031')
  })
  it('RSC-030 for a file: url', () => {
    expect(ids('body { background: url(file:///etc/passwd); }')).toContain('RSC-030')
  })
  it('RSC-013 for an @import with a fragment', () => {
    expect(ids('@import "base.css#x";', { present: ['base.css'], declared: ['base.css'] })).toContain('RSC-013')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/checks/css.test.ts`
Expected: FAIL — cannot find module `./css.js`.

- [ ] **Step 3: Implement `checks/css.ts` (references)**

`src/checks/css.ts`
```ts
import { parseCss, type CssDocument } from '../parse/css.js'
import { manifestPathMap, type ManifestItem, type PackageDocument } from '../parse/opf.js'
import { getResource, type EpubContainer } from '../io/zip.js'
import { resolvePath, isRemote, hasScheme } from '../util/path.js'
import { msg, type Message } from '../messages/format.js'

export function validateCssDocs(pkg: PackageDocument, container: EpubContainer): Message[] {
  const messages: Message[] = []
  const manifest = manifestPathMap(pkg)

  for (const item of pkg.manifest) {
    if (item.mediaType !== 'text/css') continue
    const { css, messages: m } = parseCss(item, container)
    messages.push(...m)
    if (css) messages.push(...checkReferences(css, container, manifest))
  }
  return messages
}

function checkReferences(
  css: CssDocument,
  container: EpubContainer,
  manifest: Map<string, ManifestItem>,
): Message[] {
  const messages: Message[] = []
  for (const ref of css.refs) {
    const url = ref.url

    if (/^file:/i.test(url)) {
      messages.push(msg('RSC-030', ref.loc, url))
      continue
    }
    if (ref.type === 'import' && url.includes('#')) {
      messages.push(msg('RSC-013', ref.loc))
    }
    if (isRemote(url)) {
      if (ref.type === 'font') {
        if (!/^https:\/\//i.test(url)) messages.push(msg('RSC-031', ref.loc, url))
      } else {
        messages.push(msg('RSC-006', ref.loc, url))
      }
      continue
    }
    if (hasScheme(url)) continue // data:, etc. — not container-relative

    const target = resolvePath(css.path, url) // resolvePath strips the fragment
    if (!getResource(container, target)) {
      messages.push(msg('RSC-007', ref.loc, url))
    } else if (!manifest.has(target)) {
      messages.push(msg('RSC-008', ref.loc, url))
    }
  }
  return messages
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/checks/css.test.ts`
Expected: PASS — all seven tests.

- [ ] **Step 5: Lint + typecheck + commit**

Run: `npm run lint && npx tsc --noEmit` (Expected: clean)
```bash
git add src/checks/css.ts src/checks/css.test.ts
git commit -m "feat: add CSS reference validation"
```

---

### Task 5: CSS checks — properties + font-face (`checkProperties`)

**Files:**
- Modify: `src/checks/css.ts`, `src/checks/css.test.ts`

**Interfaces:**
- Produces: `validateCssDocs` now also runs `checkProperties(css)` per doc.
- Rules: declaration `direction` or `unicode-bidi` → `CSS-001` (arg = property); declaration `position` whose value contains `fixed` → `CSS-006`; a `@font-face` with zero declarations → `CSS-019`.

- [ ] **Step 1: Add the failing tests**

Append to `src/checks/css.test.ts`:
```ts
describe('validateCssDocs — properties', () => {
  it('CSS-001 for direction / unicode-bidi', () => {
    expect(ids('p { direction: rtl; }')).toContain('CSS-001')
    expect(ids('p { unicode-bidi: bidi-override; }')).toContain('CSS-001')
  })
  it('CSS-006 for position: fixed', () => {
    expect(ids('div { position: fixed; }')).toContain('CSS-006')
  })
  it('does not flag position: absolute', () => {
    expect(ids('div { position: absolute; }')).not.toContain('CSS-006')
  })
  it('CSS-019 for an empty @font-face', () => {
    expect(ids('@font-face {}')).toContain('CSS-019')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/checks/css.test.ts`
Expected: FAIL — property rules not implemented.

- [ ] **Step 3: Add `checkProperties` and wire it in**

In `src/checks/css.ts`, update the per-doc line in `validateCssDocs`:
```ts
    if (css) {
      messages.push(...checkReferences(css, container, manifest))
      messages.push(...checkProperties(css))
    }
```
Add below `checkReferences`:
```ts
function checkProperties(css: CssDocument): Message[] {
  const messages: Message[] = []
  for (const decl of css.declarations) {
    if (decl.property === 'direction' || decl.property === 'unicode-bidi') {
      messages.push(msg('CSS-001', decl.loc, decl.property))
    } else if (decl.property === 'position' && /\bfixed\b/i.test(decl.value)) {
      messages.push(msg('CSS-006', decl.loc))
    }
  }
  for (const fontFace of css.fontFaces) {
    if (fontFace.declarationCount === 0) messages.push(msg('CSS-019', fontFace.loc))
  }
  return messages
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/checks/css.test.ts`
Expected: PASS — references + properties.

- [ ] **Step 5: Lint + typecheck + commit**

Run: `npm run lint && npx tsc --noEmit` (Expected: clean)
```bash
git add src/checks/css.ts src/checks/css.test.ts
git commit -m "feat: add CSS property and font-face checks"
```

---

### Task 6: Wire CSS into `validateEpub` + public exports + integration

**Files:**
- Modify: `src/validate.ts`, `src/validate.test.ts`, `src/index.ts`
- Create: `test/integration/css.test.ts`

**Interfaces:**
- Consumes: `validateCssDocs` from `./checks/css.js`.
- Produces: for an EPUB 3 package, `validateEpub` runs CSS validation after content validation. `index.ts` exports `parseCss`, `validateCssDocs`, and the css types.

- [ ] **Step 1: Add the failing unit test**

Append to `src/validate.test.ts`:
```ts
  it('runs CSS checks for an EPUB 3 package', async () => {
    const opf =
      '<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid">' +
      '<metadata><dc:identifier id="uid">u</dc:identifier><dc:title>T</dc:title><dc:language>en</dc:language>' +
      '<meta property="dcterms:modified">2020-01-01T00:00:00Z</meta></metadata>' +
      '<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' +
      '<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>' +
      '<item id="css" href="s.css" media-type="text/css"/></manifest>' +
      '<spine><itemref idref="c1"/></spine></package>'
    const nav = '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>t</title></head><body><nav epub:type="toc"><ol><li><a href="c1.xhtml">One</a></li></ol></nav></body></html>'
    const c1 = '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><p>hi</p></body></html>'
    const css = 'body { background-image: url(missing.png); }' // -> RSC-007
    const bytes = zipSync({
      mimetype: [enc('application/epub+zip'), { level: 0 }],
      'META-INF/container.xml': [enc('<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'), { level: 6 }],
      'package.opf': [enc(opf), { level: 6 }],
      'nav.xhtml': [enc(nav), { level: 6 }],
      'c1.xhtml': [enc(c1), { level: 6 }],
      's.css': [enc(css), { level: 6 }],
    })
    const report = await validateEpub(bytes)
    expect(report.messages.map((m) => m.id)).toContain('RSC-007')
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/validate.test.ts`
Expected: FAIL — `RSC-007` from the stylesheet absent (CSS not wired yet).

- [ ] **Step 3: Wire CSS into `validate.ts`**

In `src/validate.ts`, add the import:
```ts
import { validateCssDocs } from './checks/css.js'
```
Inside the `if (detectedVersion === '3.0') { ... }` block, AFTER the `validateContentDocs` line, add:
```ts
        messages.push(...validateCssDocs(pkg, container))
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/validate.test.ts`
Expected: PASS — including the new CSS test.

- [ ] **Step 5: Export the new public API**

In `src/index.ts`:
- add after the `validateContentDocs` export:
```ts
export { parseCss } from './parse/css.js'
export { validateCssDocs } from './checks/css.js'
```
- add to the type re-exports:
```ts
export type { CssDocument, CssRef, CssRefType, CssDeclaration, FontFace } from './parse/css.js'
```

- [ ] **Step 6: Add the integration test**

`test/integration/css.test.ts`
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
  '<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>' +
  '<item id="css" href="s.css" media-type="text/css"/>' +
  '<item id="bg" href="bg.png" media-type="image/png"/></manifest>' +
  '<spine><itemref idref="c1"/></spine></package>'
const NAV = '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>t</title></head><body><nav epub:type="toc"><ol><li><a href="c1.xhtml">One</a></li></ol></nav></body></html>'
const C1 = '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title><link rel="stylesheet" href="s.css"/></head><body><p>hi</p></body></html>'

function epub(css: string) {
  return zipSync({
    mimetype: [enc('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': [CONTAINER, { level: 6 }],
    'EPUB/package.opf': [enc(OPF), { level: 6 }],
    'EPUB/nav.xhtml': [enc(NAV), { level: 6 }],
    'EPUB/c1.xhtml': [enc(C1), { level: 6 }],
    'EPUB/s.css': [enc(css), { level: 6 }],
    'EPUB/bg.png': [enc('PNG'), { level: 6 }],
  })
}

describe('integration: CSS validation', () => {
  it('reports no CSS errors for a clean stylesheet', async () => {
    const report = await validateEpub(epub('body { background-image: url(bg.png); }'))
    const ids = report.messages.map((m) => m.id).filter((id) => id.startsWith('CSS') || id === 'RSC-006' || id === 'RSC-007' || id === 'RSC-008' || id === 'RSC-013' || id === 'RSC-030' || id === 'RSC-031')
    expect(ids).toEqual([])
  })
  it('flags a disallowed property and a missing url() target', async () => {
    const report = await validateEpub(epub('p { direction: rtl; } body { background: url(gone.png); }'))
    const ids = report.messages.map((m) => m.id)
    expect(ids).toContain('CSS-001')
    expect(ids).toContain('RSC-007')
    expect(report.valid).toBe(false)
  })
})
```

- [ ] **Step 7: Run the full gate**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: lint clean; typecheck clean; ALL tests pass (Plans 1–4 suite + new CSS unit/integration); build emits `dist/index.js` + `dist/index.d.ts`.

- [ ] **Step 8: Commit**

```bash
git add src/validate.ts src/validate.test.ts src/index.ts test/integration/css.test.ts
git commit -m "feat: wire CSS validation into validateEpub"
```

---

## Roadmap (subsequent plans)

- **Plan 6 — Inline & embedded CSS:** `style=""` attributes and `<style>` elements in content documents (reuse `parseCss`/`checkReferences` on inline CSS), `CSS-005`/`CSS-015` alternate-stylesheet titles.
- **Plan 7 — Fixture corpus + deferred rules:** ported epubcheck fixtures; deferred CSS rules (`CSS-003/004` charset, `CSS-007` font MIME, `CSS-029/030` MO classes, `RSC-020/026/033` URL syntax/leak/query, `RSC-032` fallback, `OPF-014/018` remote-resources), plus deferred OPF/nav/content rules, attribute-namespace resolution, and `LICENSE`/`ATTRIBUTION`.

---

## Self-Review

**Spec coverage (CSS phase, spec §12):** CSS parse + reference extraction → Task 3 (`parseCss` via css-tree); reference resolution (RSC-006/007/008/013/030/031) → Task 4; property + font-face rules (CSS-001/006/019) + parse errors (CSS-008) + empty url (CSS-002) → Tasks 3 & 5; wiring + EPUB-3-gated CSS validation + exports → Task 6; dependency relaxation (css-tree) + spec update → Task 1; shared-helper DRY (hasScheme, manifestPathMap) → Task 2. Inline/embedded CSS, charset, font-MIME, URL-syntax, fallback, remote-resources-property, EPUB 2 are deferred (roadmap). No CSS-phase gaps.

**Placeholder scan:** No TBD/TODO; every code step has complete code; "later task" references are only the documented incremental wiring of `validateCssDocs` (Tasks 4→5, full code at each step) and the roadmap. The css-tree implementer note flags API reconciliation (against the installed package), not a placeholder — the behavior is fully specified by the tests.

**Type consistency:** `CssRefType`/`CssRef`/`CssDeclaration`/`FontFace`/`CssDocument` defined in Task 3, consumed unchanged in Tasks 4–6. `validateCssDocs(pkg, container)` signature identical across Tasks 4/5/6. `parseCss(item, container) => { css?, messages }` consumed in Task 4. `manifestPathMap` (Task 2, parse/opf.ts) consumed by checks/content.ts (refactor) and checks/css.ts (Task 4); `hasScheme` (Task 2, util/path.ts) consumed by both. Catalog IDs added in Task 1 (`CSS-001/002/006/008/019`, `RSC-013/030/031`) plus reused `RSC-006/007/008` match every `msg(...)` call site. `index.ts` re-exports resolve to real symbols.
```
