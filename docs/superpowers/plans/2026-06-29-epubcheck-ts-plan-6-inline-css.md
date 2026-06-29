# epubcheck-ts — Plan 6: Inline & `<style>` CSS Validation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate CSS embedded inside XHTML content documents — `<style>` element contents and `style=""` attribute values — applying the same reference and property rules already used for standalone stylesheets.

**Architecture:** Refactor the Plan 5 CSS code into two reusable functions: `analyzeCss(text, path, context)` (parse a CSS string of either a full stylesheet or a declaration-list into refs/declarations/font-faces + messages) and `validateCss(cssDoc, container, manifest)` (run reference + property checks on an analysis). Then collect inline styles during content-document parsing and validate them inside `validateContentDocs`. No new message IDs, no parser change, no new wiring in `validateEpub` (inline CSS rides the already-wired content pass).

**Tech Stack:** TypeScript (ESM), `css-tree` (reused), reuses message catalog + `resolvePath`/`manifestPathMap`.

**Spec:** `docs/superpowers/specs/2026-06-28-epubcheck-ts-design.md` (content/CSS validation; inline CSS is named in the Plan 5 roadmap).

## Global Constraints

From the spec + Plans 1–5.

- **ESM-only**, TypeScript source, ship `.d.ts`. Target **ES2022 / Node 18+ / evergreen browsers**.
- **Functional style, no classes.** Plain data + functions only.
- **Runtime-agnostic core:** zero Node-only APIs in `src/` (`TextDecoder`/`DataView`/web `ReadableStream`/`decodeURIComponent` only). css-tree is pure-JS.
- **Runtime deps:** `fflate`, `saxes`, `css-tree`. **Dev deps:** `vitest`, `tsdown`, `typescript`, `eslint`, `@eslint/js`, `typescript-eslint`.
- **Types live with their producer** — no types-only files.
- **Unit tests colocated**; integration tests under `test/`.
- **Lint is type-aware.** Every task keeps `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` green.
- **`validateEpub` always resolves to a `Report`** and never rejects.
- **Message-ID strategy (decided):** specific epubcheck IDs where one exists; otherwise `RSC-005` with a rule-specific detail. Inline CSS reuses the existing CSS/RSC ids (`CSS-001/002/006/008/019`, `RSC-006/007/008/013/030/031`) — **no new catalog entries**.

### Carry-forwards / known limitations (honor + document)

- Inline-CSS `url()` references resolve relative to the **content document's own path** (the doc the inline style lives in).
- The nav document is excluded from `validateContentDocs` (Plan 4), so inline CSS *inside the nav doc* is not validated. Acceptable (rare); note it.
- `style=""` attributes are parsed in css-tree's `declarationList` context (a declaration body, not a full stylesheet) — so `@import`/`@font-face` can't appear there; `<style>` elements are parsed as full stylesheets.
- All post-`openEpub` steps remain non-throwing pure functions; `analyzeCss` catches any css-tree throw → `CSS-008`.

---

## File Structure (this plan)

```
src/
  parse/
    css.ts               # (modify) extract+export analyzeCss(text, path, context) + CssAnalysis; parseCss uses it
    content.ts           # (modify) collect inlineStyles (InlineStyle) from <style> + style="" during parse
  checks/
    css.ts               # (modify) extract+export validateCss(cssDoc, container, manifest); validateCssDocs uses it
    content.ts           # (modify) validate each content doc's inlineStyles via analyzeCss + validateCss
  css-tree.d.ts          # (modify, if needed) ensure parse options type allows `context`
  index.ts               # (modify) export analyzeCss, validateCss + types CssAnalysis, InlineStyle
test/
  integration/
    inline-css.test.ts   # end-to-end validateEpub over in-memory EPUBs with <style> + style="" CSS
```

---

### Task 1: Extract reusable `analyzeCss` (full stylesheet + declaration-list)

**Files:**
- Modify: `src/parse/css.ts`, `src/parse/css.test.ts`
- Modify: `src/css-tree.d.ts` (only if the parse-options type needs a `context` field)

**Interfaces:**
- Produces:
  - `interface CssAnalysis { refs: CssRef[]; declarations: CssDeclaration[]; fontFaces: FontFace[]; messages: Message[] }`
  - `function analyzeCss(text: string, path: string, context: 'stylesheet' | 'declarationList'): CssAnalysis`
  - `parseCss` is refactored to call `analyzeCss(text, path, 'stylesheet')` (behavior unchanged).

- [ ] **Step 1: Add the failing test**

Append to `src/parse/css.test.ts`:
```ts
import { analyzeCss } from './css.js'

describe('analyzeCss', () => {
  it('analyzes a full stylesheet (context: stylesheet)', () => {
    const a = analyzeCss('@import "x.css"; body { background: url(bg.png); direction: rtl; }', 'EPUB/c1.xhtml', 'stylesheet')
    expect(a.refs.map((r) => r.type).sort()).toEqual(['generic', 'import'])
    expect(a.declarations.some((d) => d.property === 'direction')).toBe(true)
    expect(a.messages).toHaveLength(0)
  })
  it('analyzes a style-attribute value (context: declarationList)', () => {
    const a = analyzeCss('position: fixed; background: url(bg.png)', 'EPUB/c1.xhtml', 'declarationList')
    expect(a.declarations.map((d) => d.property)).toContain('position')
    expect(a.refs.map((r) => r.url)).toEqual(['bg.png'])
    expect(a.refs[0]?.type).toBe('generic')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/parse/css.test.ts`
Expected: FAIL — `analyzeCss` not exported.

- [ ] **Step 3: Refactor `parse/css.ts` to extract `analyzeCss`**

In `src/parse/css.ts`:
- Add the `CssAnalysis` interface (near the other interfaces):
```ts
export interface CssAnalysis {
  refs: CssRef[]
  declarations: CssDeclaration[]
  fontFaces: FontFace[]
  messages: Message[]
}
```
- Replace the body of `parseCss` (the part that decodes bytes, parses, walks, and builds refs/declarations/fontFaces/messages) so that the parse-and-walk logic lives in a new exported `analyzeCss`, and `parseCss` only resolves the resource and delegates:
```ts
export function analyzeCss(
  text: string,
  path: string,
  context: 'stylesheet' | 'declarationList',
): CssAnalysis {
  const messages: Message[] = []
  const refs: CssRef[] = []
  const declarations: CssDeclaration[] = []
  const fontFaces: FontFace[] = []

  let ast: csstree.CssNode
  try {
    ast = csstree.parse(text, {
      positions: true,
      context,
      onParseError(error) {
        messages.push(msg('CSS-008', { path, line: error.line, column: error.column }, error.message))
      },
    })
  } catch (error) {
    messages.push(msg('CSS-008', { path }, error instanceof Error ? error.message : String(error)))
    return { refs, declarations, fontFaces, messages }
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

  return { refs, declarations, fontFaces, messages }
}

export function parseCss(
  item: ManifestItem,
  container: EpubContainer,
): { css?: CssDocument; messages: Message[] } {
  const opfPath = container.rootfiles[0]
  if (!opfPath || !item.href) return { messages: [] }

  const path = resolvePath(opfPath, item.href)
  const resource = getResource(container, path)
  if (!resource) return { messages: [] } // missing file is reported as RSC-001 by the OPF manifest check

  const text = new TextDecoder('utf-8').decode(resource.bytes)
  const a = analyzeCss(text, path, 'stylesheet')
  return { css: { path, refs: a.refs, declarations: a.declarations, fontFaces: a.fontFaces }, messages: a.messages }
}
```
(Keep the existing helpers `locOf`, `stripQuotes`, `urlValue`, `importTarget`, `countDeclarations` exactly as they are — `analyzeCss` uses them.)

- [ ] **Step 4: Ensure the css-tree shim allows the `context` option**

If `npx tsc --noEmit` complains that the `parse` options object has no `context` property, edit `src/css-tree.d.ts` so the `parse` function's options type includes `context?: string` (alongside `positions` and `onParseError`). If tsc is already happy, leave the shim unchanged.

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run src/parse/css.test.ts`
Expected: PASS — new `analyzeCss` tests + the unchanged `parseCss` tests (proving the refactor is behavior-preserving).

- [ ] **Step 6: Lint + typecheck + commit**

Run: `npm run lint && npx tsc --noEmit` (Expected: clean)
```bash
git add src/parse/css.ts src/parse/css.test.ts src/css-tree.d.ts
git commit -m "refactor: extract reusable analyzeCss (stylesheet + declarationList)"
```

---

### Task 2: Extract reusable `validateCss`

**Files:**
- Modify: `src/checks/css.ts`, `src/checks/css.test.ts`

**Interfaces:**
- Consumes: existing private `checkReferences`/`checkProperties`; `CssDocument` from `../parse/css.js`; `manifestPathMap`, `ManifestItem`, `PackageDocument` from `../parse/opf.js`; `EpubContainer` from `../io/zip.js`.
- Produces: `function validateCss(css: CssDocument, container: EpubContainer, manifest: Map<string, ManifestItem>): Message[]` — runs `checkReferences` + `checkProperties`. `validateCssDocs` is refactored to call it (behavior unchanged).

- [ ] **Step 1: Add the failing test**

Append to `src/checks/css.test.ts`:
```ts
import { validateCss } from './css.js'
import { manifestPathMap } from '../parse/opf.js'

describe('validateCss (reusable)', () => {
  it('runs reference + property checks on a synthesized CssDocument', () => {
    const { pkg, container } = setup('') // reuse the existing test helper; the .css resource content is irrelevant here
    const manifest = manifestPathMap(pkg)
    const css = {
      path: 'EPUB/c1.xhtml',
      refs: [{ url: 'missing.png', type: 'generic' as const, loc: { path: 'EPUB/c1.xhtml' } }],
      declarations: [{ property: 'position', value: 'fixed', loc: { path: 'EPUB/c1.xhtml' } }],
      fontFaces: [],
    }
    const ids = validateCss(css, container, manifest).map((m) => m.id)
    expect(ids).toContain('RSC-007') // missing.png unresolved relative to EPUB/c1.xhtml
    expect(ids).toContain('CSS-006') // position: fixed
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/checks/css.test.ts`
Expected: FAIL — `validateCss` not exported.

- [ ] **Step 3: Extract `validateCss` and use it in `validateCssDocs`**

In `src/checks/css.ts`, add the exported function (place it above `checkReferences`) and refactor `validateCssDocs` to call it:
```ts
export function validateCss(
  css: CssDocument,
  container: EpubContainer,
  manifest: Map<string, ManifestItem>,
): Message[] {
  return [...checkReferences(css, container, manifest), ...checkProperties(css)]
}
```
Replace the per-item body of `validateCssDocs` so it delegates to `validateCss`:
```ts
export function validateCssDocs(pkg: PackageDocument, container: EpubContainer): Message[] {
  const messages: Message[] = []
  const manifest = manifestPathMap(pkg)
  for (const item of pkg.manifest) {
    if (item.mediaType !== 'text/css') continue
    const { css, messages: m } = parseCss(item, container)
    messages.push(...m)
    if (css) messages.push(...validateCss(css, container, manifest))
  }
  return messages
}
```
Ensure `CssDocument` and `ManifestItem`/`PackageDocument` are imported (they already are via the existing imports; `CssDocument` is imported from `../parse/css.js`).

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/checks/css.test.ts`
Expected: PASS — the new `validateCss` test + the unchanged `validateCssDocs` reference/property tests.

- [ ] **Step 5: Lint + typecheck + commit**

Run: `npm run lint && npx tsc --noEmit` (Expected: clean)
```bash
git add src/checks/css.ts src/checks/css.test.ts
git commit -m "refactor: extract reusable validateCss"
```

---

### Task 3: Collect inline styles during content parsing

**Files:**
- Modify: `src/parse/content.ts`, `src/parse/content.test.ts`

**Interfaces:**
- Consumes: `textContent` from `../io/xml.js`.
- Produces:
  - `interface InlineStyle { context: 'stylesheet' | 'declarationList'; text: string; loc: Location }`
  - `ContentDocument` gains `inlineStyles: InlineStyle[]`.
  - During the element walk: a `<style>` element contributes `{ context: 'stylesheet', text: <its text content>, loc }`; any element with a non-empty `style` attribute contributes `{ context: 'declarationList', text: <attr value>, loc }`.

- [ ] **Step 1: Add the failing test**

Append to `src/parse/content.test.ts`:
```ts
describe('parseContent — inline styles', () => {
  it('collects <style> element contents and style="" attribute values', () => {
    const { doc } = parseContent(item, container(DOC(
      '<style>body { color: red; }</style><p style="position: fixed">x</p>',
    )))
    const sheets = doc!.inlineStyles.filter((s) => s.context === 'stylesheet').map((s) => s.text)
    const attrs = doc!.inlineStyles.filter((s) => s.context === 'declarationList').map((s) => s.text)
    expect(sheets).toEqual(['body { color: red; }'])
    expect(attrs).toEqual(['position: fixed'])
  })
})
```
(The existing `parseContent` test file already defines `item`, `container`, and `DOC` helpers — reuse them.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/parse/content.test.ts`
Expected: FAIL — `inlineStyles` undefined.

- [ ] **Step 3: Collect inline styles in `parse/content.ts`**

In `src/parse/content.ts`:
- Add the `InlineStyle` interface and extend `ContentDocument`:
```ts
export interface InlineStyle {
  context: 'stylesheet' | 'declarationList'
  text: string
  loc: Location
}
```
In `interface ContentDocument`, add the field:
```ts
  inlineStyles: InlineStyle[]
```
- Import `textContent`:
```ts
import { parseXml, textContent, type XmlNode } from '../io/xml.js'
```
- Thread an `inlineStyles` array through `collect` (mirror how `refs`/`ids` are threaded). Update `collect`'s signature and the recursive call, and the call site in `parseContent`. In the per-child body of `collect`, after collecting ids/refs, add:
```ts
    if (child.name === 'style') {
      inlineStyles.push({ context: 'stylesheet', text: textContent(child), loc: child.loc })
    }
    const styleAttr = attrs['style']
    if (styleAttr) {
      inlineStyles.push({ context: 'declarationList', text: styleAttr, loc: child.loc })
    }
```
- In `parseContent`, declare `const inlineStyles: InlineStyle[] = []`, pass it to `collect`, and include it in the returned document: `{ path, root, refs, ids, inlineStyles }`.

Concretely, `collect` becomes:
```ts
function collect(
  node: XmlNode,
  parent: string | undefined,
  refs: ContentRef[],
  ids: Set<string>,
  inlineStyles: InlineStyle[],
): void {
  for (const child of node.children ?? []) {
    if (child.type !== 'element') continue
    const attrs = child.attrs ?? {}
    const id = attrs['id']
    if (id) ids.add(id)
    addRefs(child, parent, attrs, refs)
    if (child.name === 'style') {
      inlineStyles.push({ context: 'stylesheet', text: textContent(child), loc: child.loc })
    }
    const styleAttr = attrs['style']
    if (styleAttr) {
      inlineStyles.push({ context: 'declarationList', text: styleAttr, loc: child.loc })
    }
    collect(child, child.name, refs, ids, inlineStyles)
  }
}
```
and in `parseContent`:
```ts
  const refs: ContentRef[] = []
  const ids = new Set<string>()
  const inlineStyles: InlineStyle[] = []
  collect(root, undefined, refs, ids, inlineStyles)
  return { doc: { path, root, refs, ids, inlineStyles }, messages }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/parse/content.test.ts`
Expected: PASS — the new inline-styles test + all existing content-parse tests.

- [ ] **Step 5: Lint + typecheck + commit**

Run: `npm run lint && npx tsc --noEmit` (Expected: clean)
```bash
git add src/parse/content.ts src/parse/content.test.ts
git commit -m "feat: collect inline <style>/style attribute CSS during content parsing"
```

---

### Task 4: Validate inline CSS inside `validateContentDocs`

**Files:**
- Modify: `src/checks/content.ts`, `src/checks/content.test.ts`

**Interfaces:**
- Consumes: `analyzeCss` from `../parse/css.js`; `validateCss` from `./css.js`; the `doc.inlineStyles` produced in Task 3; the `manifest` map already built in `validateContentDocs`.
- Produces: `validateContentDocs` now also validates each content doc's inline styles (resolving url() relative to the doc's path).

- [ ] **Step 1: Add the failing tests**

Append to `src/checks/content.test.ts`:
```ts
describe('validateContentDocs — inline CSS', () => {
  it('RSC-007 for a missing url() in a <style> element', () => {
    expect(ids({ 'c1.xhtml': '<style>body { background: url(missing.png); }</style>' })).toContain('RSC-007')
  })
  it('CSS-006 for position:fixed in a style attribute', () => {
    expect(ids({ 'c1.xhtml': '<p style="position: fixed">x</p>' })).toContain('CSS-006')
  })
  it('CSS-001 for direction in a <style> element', () => {
    expect(ids({ 'c1.xhtml': '<style>p { direction: rtl; }</style>' })).toContain('CSS-001')
  })
})
```
(The existing `checks/content.test.ts` already defines the `ids({...})` / `setup` harness — reuse it.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/checks/content.test.ts`
Expected: FAIL — inline CSS not validated yet.

- [ ] **Step 3: Validate inline styles in `validateContentDocs`**

In `src/checks/content.ts`:
- Add imports:
```ts
import { analyzeCss } from '../parse/css.js'
import { validateCss } from './css.js'
```
- In `validateContentDocs`, inside the per-doc loop (after the existing `checkReferences`/`checkFragments`/`checkElements` calls), add inline-CSS validation:
```ts
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
```
(`manifest` is the `manifestPathMap(pkg)` already computed at the top of `validateContentDocs`.)

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/checks/content.test.ts`
Expected: PASS — the new inline-CSS tests + all existing content tests.

- [ ] **Step 5: Lint + typecheck + commit**

Run: `npm run lint && npx tsc --noEmit` (Expected: clean)
```bash
git add src/checks/content.ts src/checks/content.test.ts
git commit -m "feat: validate inline <style>/style attribute CSS in content documents"
```

---

### Task 5: Public exports + integration

**Files:**
- Modify: `src/index.ts`
- Create: `test/integration/inline-css.test.ts`

**Interfaces:**
- Produces: `index.ts` exports `analyzeCss`, `validateCss`, and types `CssAnalysis`, `InlineStyle`. (No change to `validateEpub` — inline CSS is validated inside the already-wired `validateContentDocs`.)

- [ ] **Step 1: Add the public exports**

In `src/index.ts`:
- extend the css value exports:
```ts
export { parseCss, analyzeCss } from './parse/css.js'
export { validateCss, validateCssDocs } from './checks/css.js'
```
(If `parseCss`/`validateCssDocs` are already exported on their own lines, add `analyzeCss`/`validateCss` to those lines instead of duplicating.)
- add to the type re-exports:
```ts
export type { CssAnalysis } from './parse/css.js'
export type { InlineStyle } from './parse/content.js'
```

- [ ] **Step 2: Typecheck the exports**

Run: `npx tsc --noEmit`
Expected: clean (all re-exported symbols resolve).

- [ ] **Step 3: Write the integration test**

`test/integration/inline-css.test.ts`
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
  '<item id="bg" href="bg.png" media-type="image/png"/></manifest>' +
  '<spine><itemref idref="c1"/></spine></package>'
const NAV = '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>t</title></head><body><nav epub:type="toc"><ol><li><a href="c1.xhtml">One</a></li></ol></nav></body></html>'

function epub(bodyAndHead: { head?: string; body: string }) {
  const c1 =
    '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title>' + (bodyAndHead.head ?? '') + '</head><body>' + bodyAndHead.body + '</body></html>'
  return zipSync({
    mimetype: [enc('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': [CONTAINER, { level: 6 }],
    'EPUB/package.opf': [enc(OPF), { level: 6 }],
    'EPUB/nav.xhtml': [enc(NAV), { level: 6 }],
    'EPUB/c1.xhtml': [enc(c1), { level: 6 }],
    'EPUB/bg.png': [enc('PNG'), { level: 6 }],
  })
}

describe('integration: inline CSS validation', () => {
  it('reports no inline-CSS errors for clean <style> and style attributes', async () => {
    const report = await validateEpub(epub({ head: '<style>body { background: url(bg.png); }</style>', body: '<p style="color: red">x</p>' }))
    const ids = report.messages.map((m) => m.id).filter((id) => id.startsWith('CSS') || id === 'RSC-006' || id === 'RSC-007' || id === 'RSC-008')
    expect(ids).toEqual([])
  })
  it('flags a bad url() in <style> and a disallowed property in a style attribute', async () => {
    const report = await validateEpub(epub({ head: '<style>body { background: url(gone.png); }</style>', body: '<p style="position: fixed">x</p>' }))
    const ids = report.messages.map((m) => m.id)
    expect(ids).toContain('RSC-007') // gone.png
    expect(ids).toContain('CSS-006') // position: fixed
    expect(report.valid).toBe(false)
  })
})
```

- [ ] **Step 4: Run the full gate**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: lint clean; typecheck clean; ALL tests pass (Plans 1–5 suite + new inline-CSS unit/integration); build emits `dist/index.js` + `dist/index.d.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts test/integration/inline-css.test.ts
git commit -m "feat: export analyzeCss/validateCss; add inline CSS integration tests"
```

---

## Roadmap (subsequent plans)

- **Plan 7 — Fixture corpus + deferred rules:** port a curated subset of epubcheck's `src/test/resources` EPUBs (+ `ATTRIBUTION`) with a harness asserting the emitted `{ id, severity }` set; plus the long tail of deferred rules (content `RSC-010/011/031/032`, nav `NAV-011` reading-order + `RSC-012` for nav links, OPF `OPF-003`/`PKG-001`, CSS `CSS-003/004` charset, `CSS-005/015` alternate-stylesheet titles, `CSS-007` font-MIME), attribute-namespace resolution, and the root `LICENSE`/`ATTRIBUTION` needed before an npm publish.

---

## Self-Review

**Spec coverage (inline CSS):** reusable CSS analysis for both contexts → Task 1 (`analyzeCss`); reusable CSS validation → Task 2 (`validateCss`); inline-style collection from `<style>` + `style=""` → Task 3; inline-CSS validation inside content checks → Task 4; exports + integration → Task 5. No new message IDs (reuses Plan 5's CSS/RSC ids). `<link rel=stylesheet>` standalone sheets are already validated (Plan 5); alternate-stylesheet titles (`CSS-005/015`) and other deferred CSS rules are out of scope (roadmap). No inline-CSS gaps.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; the only conditional is the css-tree shim edit in Task 1 Step 4 (gated on a concrete tsc error — fully specified, not a placeholder).

**Type consistency:** `CssAnalysis`/`analyzeCss` defined in Task 1, consumed in Task 4 and re-exported in Task 5. `validateCss(css, container, manifest)` defined in Task 2, consumed in Task 4 (with a synthesized `CssDocument` = `{ path, refs, declarations, fontFaces }`, matching the Plan 5 `CssDocument` shape) and re-exported in Task 5. `InlineStyle` + `ContentDocument.inlineStyles` defined in Task 3, consumed in Task 4 and re-exported in Task 5. `analyzeCss`'s `context` parameter (`'stylesheet' | 'declarationList'`) matches `InlineStyle.context`. `parseCss`/`validateCssDocs` signatures unchanged (internal refactor only). `index.ts` re-exports resolve to real symbols.
```
