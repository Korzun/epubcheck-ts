# epubcheck-ts — Plan 4: XHTML Content Document Validation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse each EPUB 3 XHTML content document, validate its resource references (existence, manifest declaration, remote policy), fragment identifiers, and flag unknown XHTML-namespace elements.

**Architecture:** Same pure-function pipeline. A new `parseContent(item, container)` parses a content doc into a `ContentDocument` (its references + element ids). A new `validateContentDocs(pkg, container)` parses all XHTML content docs into a map, then runs reference, fragment, and element checks against the container/manifest and the parsed-doc map. `validateEpub` calls it after `validateNav`. No schema engine — explicit TS checks. Named-entity handling matches epubcheck: undeclared named entities (`&nbsp;`) fail parsing → `RSC-005`.

**Tech Stack:** TypeScript (ESM), reuses `parseXml` (saxes), `openEpub` (fflate), `resolvePath`/`isRemote`, message catalog.

**Spec:** `docs/superpowers/specs/2026-06-28-epubcheck-ts-design.md` (§2 content surface, §6 check framework, §7 API).

## Global Constraints

From the spec + Plans 1–3.

- **ESM-only**, TypeScript source, ship `.d.ts`. Target **ES2022 / Node 18+ / evergreen browsers**.
- **Functional style, no classes.** Plain data + functions only.
- **Runtime-agnostic core:** zero Node-only APIs in `src/` (no `fs`/`Buffer`/`node:*`). `TextDecoder`/`DataView`/web `ReadableStream`/`decodeURIComponent` only.
- **Runtime deps:** only `fflate` + `saxes`. **Dev deps:** `vitest`, `tsdown`, `typescript`, `eslint`, `@eslint/js`, `typescript-eslint`.
- **Types live with their producer** — no types-only files.
- **Unit tests colocated**; integration tests under `test/`.
- **Lint is type-aware.** Every task keeps `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` green.
- **`validateEpub` always resolves to a `Report`** and never rejects.
- **Message-ID strategy (decided):** specific epubcheck IDs where epubcheck assigns one; otherwise `RSC-005` with a rule-specific detail string.
- **Named entities (decided):** match epubcheck — do NOT resolve HTML5 named entities; an undeclared named entity is a parse error → `RSC-005` (this is already the behavior of our saxes-based `parseXml`; no parser change).

### Carry-forwards / known limitations (honor + document)

- `XmlNode.attrs` keys are **qualified** names (attribute namespaces unresolved). We match `xlink:href` by the conventional `xlink:` prefix and namespace-aware element checks by `XmlNode.ns` (the element namespace IS resolved). Document the `xlink:` assumption.
- All post-`openEpub` steps remain non-throwing pure functions (preserve the `validate.ts` try/catch invariant).

---

## Reference: epubcheck IDs used in this plan

From `w3c/epubcheck` (`MessageBundle.properties` + `DefaultSeverities.java` + `ResourceReferencesChecker.java`).

| ID | Severity | Template | Used for |
|----|----------|----------|----------|
| `RSC-006` | ERROR | `Remote resource reference is not allowed in this context; resource "%1$s" must be located in the EPUB container.` | remote ref for a type that may not be remote |
| `RSC-007` | ERROR | `Referenced resource "%1$s" could not be found in the EPUB.` | local ref target absent from container (already in catalog, Plan 3) |
| `RSC-008` | ERROR | `Referenced resource "%1$s" is not declared in the OPF manifest.` | local ref target present but not in manifest (already in catalog) |
| `RSC-012` | ERROR | `Fragment identifier is not defined.` | `#frag` in a ref where the XHTML target has no element with that id |
| `RSC-005` | ERROR | `Error while parsing file '%1$s': %2$s` (Plan 1 form) | parse error (incl. undeclared named entity); unknown-element detail |

New catalog entries this plan adds: **`RSC-006`, `RSC-012`** (`RSC-007`/`RSC-008` already exist).

### Reference type → remote policy (EPUB 3)

`RefType` values and whether a **remote** URL is allowed (else `RSC-006`):

| RefType | Source attributes (this plan) | Remote allowed? |
|---------|-------------------------------|-----------------|
| `hyperlink` | `a/@href`, `area/@href`, SVG `a/@xlink:href` | **yes** |
| `cite` | `blockquote/q/ins/del @cite` | **yes** |
| `audio` | `audio/@src`, `source/@src` in `<audio>` | **yes** |
| `video` | `video/@src`, `source/@src` in `<video>` | **yes** |
| `image` | `img/@src`, `img/@srcset`, `video/@poster`, `source/@srcset`, SVG `image/@xlink:href`, `math/@altimg` | **no** → RSC-006 |
| `stylesheet` | `link/@href` (rel contains `stylesheet`) | **no** → RSC-006 |
| `generic` | `script/@src`, `object/@data`, `iframe/@src`, `embed/@src`, `input/@src` | **no** → RSC-006 |
| `track` | `track/@src` | **no** → RSC-006 |

### Deferred (NOT in this plan — roadmap)

`RSC-010`/`RSC-011` (hyperlink type/spine-membership), `RSC-031` (remote-should-be-HTTPS), `RSC-032` (foreign-resource fallback), `RSC-006b` (scripted remote, USAGE), `RSC-013`/`014`/`015` (stylesheet/SVG-use fragments), SVG `use`/paint/clip refs, standalone SVG content documents, full XHTML/SVG/MathML content-model grammar (we only flag genuinely-unknown XHTML-namespace elements), CSS `url()` references (Plan: CSS), EPUB 2. Note in roadmap; don't implement.

---

## File Structure (this plan)

```
src/
  util/
    html-elements.ts     # KNOWN_HTML_ELEMENTS + isKnownHtmlElement   (+ html-elements.test.ts)
  parse/
    content.ts           # ContentDocument/ContentRef/RefType + parseContent   (+ content.test.ts)
  checks/
    content.ts           # validateContentDocs (+ reference/fragment/element checks)   (+ content.test.ts)
  messages/
    catalog.ts           # (modify) add RSC-006, RSC-012
  validate.ts            # (modify) run validateContentDocs for EPUB 3
  index.ts               # (modify) export parseContent, validateContentDocs + content types
test/
  integration/
    content.test.ts      # end-to-end validateEpub over in-memory EPUBs with content docs
```

---

### Task 1: Extend the message catalog (RSC-006, RSC-012)

**Files:**
- Modify: `src/messages/catalog.ts`, `src/messages/catalog.test.ts`

**Interfaces:**
- Produces: catalog entries `RSC-006` (ERROR), `RSC-012` (ERROR).

- [ ] **Step 1: Add the failing test**

Append inside the existing `describe('CATALOG', ...)` block in `src/messages/catalog.test.ts`:
```ts
  it('defines content-reference message ids', () => {
    expect(CATALOG['RSC-006']?.severity).toBe('ERROR')
    expect(CATALOG['RSC-012']?.severity).toBe('ERROR')
    expect(CATALOG['RSC-006']?.template).toContain('%1$s')
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/messages/catalog.test.ts`
Expected: FAIL — `RSC-006`/`RSC-012` undefined.

- [ ] **Step 3: Add the catalog entries**

In `src/messages/catalog.ts`, add to `CATALOG` (after the existing `RSC-*` entries):
```ts
  'RSC-006': { severity: 'ERROR', template: 'Remote resource reference is not allowed in this context; resource "%1$s" must be located in the EPUB container.' },
  'RSC-012': { severity: 'ERROR', template: 'Fragment identifier is not defined.' },
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/messages/catalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/messages/catalog.ts src/messages/catalog.test.ts
git commit -m "feat: add content-reference message ids to catalog"
```

---

### Task 2: Known HTML element set

**Files:**
- Create: `src/util/html-elements.ts`, `src/util/html-elements.test.ts`

**Interfaces:**
- Produces:
  - `const KNOWN_HTML_ELEMENTS: ReadonlySet<string>` — local names of HTML5 elements.
  - `function isKnownHtmlElement(name: string): boolean`.

- [ ] **Step 1: Write the failing test**

`src/util/html-elements.test.ts`
```ts
import { describe, it, expect } from 'vitest'
import { isKnownHtmlElement } from './html-elements.js'

describe('isKnownHtmlElement', () => {
  it('recognizes common HTML5 elements', () => {
    for (const name of ['html', 'head', 'body', 'div', 'p', 'a', 'img', 'section', 'figure', 'video', 'template']) {
      expect(isKnownHtmlElement(name)).toBe(true)
    }
  })
  it('rejects unknown element names', () => {
    expect(isKnownHtmlElement('frobnicate')).toBe(false)
    expect(isKnownHtmlElement('blink')).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/util/html-elements.test.ts`
Expected: FAIL — cannot find module `./html-elements.js`.

- [ ] **Step 3: Implement `html-elements.ts`**

`src/util/html-elements.ts`
```ts
/** Local names of HTML5 elements (the conforming element vocabulary). */
export const KNOWN_HTML_ELEMENTS: ReadonlySet<string> = new Set([
  'a', 'abbr', 'address', 'area', 'article', 'aside', 'audio', 'b', 'base', 'bdi', 'bdo',
  'blockquote', 'body', 'br', 'button', 'canvas', 'caption', 'cite', 'code', 'col', 'colgroup',
  'data', 'datalist', 'dd', 'del', 'details', 'dfn', 'dialog', 'div', 'dl', 'dt', 'em', 'embed',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'head', 'header', 'hgroup', 'hr', 'html', 'i', 'iframe', 'img', 'input', 'ins', 'kbd', 'label',
  'legend', 'li', 'link', 'main', 'map', 'mark', 'menu', 'meta', 'meter', 'nav', 'noscript',
  'object', 'ol', 'optgroup', 'option', 'output', 'p', 'param', 'picture', 'pre', 'progress',
  'q', 'rb', 'rp', 'rt', 'rtc', 'ruby', 's', 'samp', 'script', 'section', 'select', 'slot',
  'small', 'source', 'span', 'strong', 'style', 'sub', 'summary', 'sup', 'table', 'tbody', 'td',
  'template', 'textarea', 'tfoot', 'th', 'thead', 'time', 'title', 'tr', 'track', 'u', 'ul',
  'var', 'video', 'wbr',
])

export function isKnownHtmlElement(name: string): boolean {
  return KNOWN_HTML_ELEMENTS.has(name)
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/util/html-elements.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint + typecheck + commit**

Run: `npm run lint && npx tsc --noEmit` (Expected: clean)
```bash
git add src/util/html-elements.ts src/util/html-elements.test.ts
git commit -m "feat: add known HTML5 element set"
```

---

### Task 3: Parse content documents (`parseContent`)

**Files:**
- Create: `src/parse/content.ts`, `src/parse/content.test.ts`

**Interfaces:**
- Consumes: `parseXml`, `XmlNode` from `../io/xml.js`; `getResource`, `EpubContainer` from `../io/zip.js`; `resolvePath` from `../util/path.js`; `Location`, `Message` from `../messages/format.js`; `ManifestItem` from `./opf.js`.
- Produces:
  - `type RefType = 'hyperlink' | 'image' | 'audio' | 'video' | 'stylesheet' | 'generic' | 'cite' | 'track'`
  - `interface ContentRef { url: string; type: RefType; loc: Location }`
  - `interface ContentDocument { path: string; root: XmlNode; refs: ContentRef[]; ids: Set<string> }`
  - `function parseContent(item: ManifestItem, container: EpubContainer): { doc?: ContentDocument; messages: Message[] }` — resolves the doc path relative to the OPF; missing rootfile/href → `{ messages: [] }`; missing resource → `{ messages: [] }` (OPF manifest reports `RSC-001`); parse error → parseXml's `RSC-005`; otherwise a `ContentDocument` with extracted references and element ids.

- [ ] **Step 1: Write the failing test**

`src/parse/content.test.ts`
```ts
import { describe, it, expect } from 'vitest'
import type { EpubContainer, Resource } from '../io/zip.js'
import type { ManifestItem } from './opf.js'
import { parseContent } from './content.js'

const enc = (s: string) => new TextEncoder().encode(s)
const LOC = { path: 'EPUB/package.opf', line: 1, column: 1 }
const item: ManifestItem = { id: 'c1', href: 'c1.xhtml', mediaType: 'application/xhtml+xml', properties: [], loc: LOC }

function container(xml: string | undefined, path = 'EPUB/c1.xhtml'): EpubContainer {
  const resources = new Map<string, Resource>()
  if (xml !== undefined) resources.set(path, { path, bytes: enc(xml), compression: 'deflate' })
  return { resources, rootfiles: ['EPUB/package.opf'], hasEncryption: false }
}
const DOC = (body: string) =>
  '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:xlink="http://www.w3.org/1999/xlink"><head><title>t</title></head><body>' +
  body + '</body></html>'

describe('parseContent', () => {
  it('extracts references with their types', () => {
    const { doc, messages } = parseContent(item, container(DOC(
      '<p id="top"><a href="c2.xhtml#x">link</a> <img src="a.png" srcset="b.png 2x, c.png 3x"/></p>' +
      '<link rel="stylesheet" href="s.css"/><script src="app.js"></script>',
    )))
    expect(messages).toHaveLength(0)
    const byType = (t: string) => doc!.refs.filter((r) => r.type === t).map((r) => r.url)
    expect(byType('hyperlink')).toEqual(['c2.xhtml#x'])
    expect(byType('image')).toEqual(['a.png', 'b.png', 'c.png'])
    expect(byType('stylesheet')).toEqual(['s.css'])
    expect(byType('generic')).toEqual(['app.js'])
    expect(doc!.ids.has('top')).toBe(true)
  })

  it('types source/@src by its audio/video parent', () => {
    const { doc } = parseContent(item, container(DOC(
      '<audio><source src="a.mp3"/></audio><video src="v.mp4" poster="p.png"><source src="v2.webm"/></video>',
    )))
    expect(doc!.refs.filter((r) => r.type === 'audio').map((r) => r.url)).toEqual(['a.mp3'])
    expect(doc!.refs.filter((r) => r.type === 'video').map((r) => r.url).sort()).toEqual(['v.mp4', 'v2.webm'])
    expect(doc!.refs.filter((r) => r.type === 'image').map((r) => r.url)).toEqual(['p.png'])
  })

  it('reports RSC-005 for an undeclared named entity (matches epubcheck)', () => {
    const { doc, messages } = parseContent(item, container(DOC('<p>x&nbsp;y</p>')))
    expect(doc).toBeUndefined()
    expect(messages[0]?.id).toBe('RSC-005')
  })

  it('returns no doc when the resource is absent', () => {
    expect(parseContent(item, container(undefined))).toEqual({ messages: [] })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/parse/content.test.ts`
Expected: FAIL — cannot find module `./content.js`.

- [ ] **Step 3: Implement `parse/content.ts`**

`src/parse/content.ts`
```ts
import { parseXml, type XmlNode } from '../io/xml.js'
import { getResource, type EpubContainer } from '../io/zip.js'
import { resolvePath } from '../util/path.js'
import type { Location, Message } from '../messages/format.js'
import type { ManifestItem } from './opf.js'

export type RefType =
  | 'hyperlink'
  | 'image'
  | 'audio'
  | 'video'
  | 'stylesheet'
  | 'generic'
  | 'cite'
  | 'track'

export interface ContentRef {
  url: string
  type: RefType
  loc: Location
}
export interface ContentDocument {
  path: string
  root: XmlNode
  refs: ContentRef[]
  ids: Set<string>
}

/** Extract the URL of each srcset candidate ("url descriptor, url descriptor"). */
function parseSrcset(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim().split(/\s+/)[0] ?? '')
    .filter((u) => u !== '')
}

function addRefs(
  el: XmlNode,
  parent: string | undefined,
  attrs: Record<string, string>,
  refs: ContentRef[],
): void {
  const push = (url: string | undefined, type: RefType): void => {
    if (url) refs.push({ url, type, loc: el.loc })
  }
  const pushAll = (urls: string[], type: RefType): void => {
    for (const url of urls) refs.push({ url, type, loc: el.loc })
  }

  switch (el.name) {
    case 'a':
    case 'area':
      push(attrs['href'] ?? attrs['xlink:href'], 'hyperlink')
      break
    case 'img':
      push(attrs['src'], 'image')
      if (attrs['srcset']) pushAll(parseSrcset(attrs['srcset']), 'image')
      break
    case 'image': // SVG <image>
      push(attrs['xlink:href'] ?? attrs['href'], 'image')
      break
    case 'source':
      if (attrs['srcset']) pushAll(parseSrcset(attrs['srcset']), 'image')
      else if (parent === 'audio') push(attrs['src'], 'audio')
      else if (parent === 'video') push(attrs['src'], 'video')
      else push(attrs['src'], 'image')
      break
    case 'audio':
      push(attrs['src'], 'audio')
      break
    case 'video':
      push(attrs['src'], 'video')
      push(attrs['poster'], 'image')
      break
    case 'track':
      push(attrs['src'], 'track')
      break
    case 'link':
      if ((attrs['rel'] ?? '').split(/\s+/).includes('stylesheet')) push(attrs['href'], 'stylesheet')
      break
    case 'script':
      push(attrs['src'], 'generic')
      break
    case 'object':
      push(attrs['data'], 'generic')
      break
    case 'iframe':
    case 'embed':
    case 'input':
      push(attrs['src'], 'generic')
      break
    case 'blockquote':
    case 'q':
    case 'ins':
    case 'del':
      push(attrs['cite'], 'cite')
      break
    case 'math':
      push(attrs['altimg'], 'image')
      break
    default:
      break
  }
}

function collect(node: XmlNode, parent: string | undefined, refs: ContentRef[], ids: Set<string>): void {
  for (const child of node.children ?? []) {
    if (child.type !== 'element') continue
    const attrs = child.attrs ?? {}
    const id = attrs['id']
    if (id) ids.add(id)
    addRefs(child, parent, attrs, refs)
    collect(child, child.name, refs, ids)
  }
}

export function parseContent(
  item: ManifestItem,
  container: EpubContainer,
): { doc?: ContentDocument; messages: Message[] } {
  const messages: Message[] = []
  const opfPath = container.rootfiles[0]
  if (!opfPath || !item.href) return { messages }

  const path = resolvePath(opfPath, item.href)
  const resource = getResource(container, path)
  if (!resource) return { messages } // missing file is reported as RSC-001 by the OPF manifest check

  const parsed = parseXml(resource.bytes, path)
  messages.push(...parsed.messages)
  const root = parsed.root
  if (!root) return { messages }

  const refs: ContentRef[] = []
  const ids = new Set<string>()
  collect(root, undefined, refs, ids)
  return { doc: { path, root, refs, ids }, messages }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/parse/content.test.ts`
Expected: PASS — all four tests.

- [ ] **Step 5: Lint + typecheck + commit**

Run: `npm run lint && npx tsc --noEmit` (Expected: clean)
```bash
git add src/parse/content.ts src/parse/content.test.ts
git commit -m "feat: parse content documents and extract references"
```

---

### Task 4: Content checks — references (`validateContentDocs` + `checkReferences`)

**Files:**
- Create: `src/checks/content.ts`, `src/checks/content.test.ts`

**Interfaces:**
- Consumes: `parseContent`, `ContentDocument`, `ContentRef`, `RefType` from `../parse/content.js`; `PackageDocument`, `ManifestItem` from `../parse/opf.js`; `getResource`, `EpubContainer` from `../io/zip.js`; `resolvePath`, `isRemote` from `../util/path.js`; `msg`, `Message` from `../messages/format.js`.
- Produces:
  - `function validateContentDocs(pkg: PackageDocument, container: EpubContainer): Message[]` — parses every XHTML manifest item EXCEPT the nav item (the nav doc is validated by `validateNav`), collecting parse messages, then runs reference checks on each parsed doc. Tasks 5/6 add fragment + element checks.
- Rules (references): for each ref whose url is not a same-document fragment and not a non-resolvable scheme (`data:`/`mailto:`/`tel:`…): remote url for a non-remote-allowed type → `RSC-006`; local target absent from container → `RSC-007`; local target present but not in manifest → `RSC-008`.

- [ ] **Step 1: Write the failing test**

`src/checks/content.test.ts`
```ts
import { describe, it, expect } from 'vitest'
import type { EpubContainer, Resource } from '../io/zip.js'
import type { PackageDocument, ManifestItem } from '../parse/opf.js'
import { validateContentDocs } from './content.js'

const enc = (s: string) => new TextEncoder().encode(s)
const LOC = { path: 'EPUB/package.opf', line: 1, column: 1 }
const DOC = (body: string) =>
  '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:xlink="http://www.w3.org/1999/xlink"><head><title>t</title></head><body>' +
  body + '</body></html>'

// Build a package + container from a map of content-doc bodies and extra resource paths.
function setup(docs: Record<string, string>, extras: string[] = []): { pkg: PackageDocument; container: EpubContainer } {
  const resources = new Map<string, Resource>()
  const manifest: ManifestItem[] = []
  for (const [href, body] of Object.entries(docs)) {
    const path = `EPUB/${href}`
    resources.set(path, { path, bytes: enc(DOC(body)), compression: 'deflate' })
    manifest.push({ id: href, href, mediaType: 'application/xhtml+xml', properties: [], loc: LOC })
  }
  for (const p of extras) resources.set(`EPUB/${p}`, { path: `EPUB/${p}`, bytes: enc('x'), compression: 'deflate' })
  const container: EpubContainer = { resources, rootfiles: ['EPUB/package.opf'], hasEncryption: false }
  const pkg: PackageDocument = {
    path: 'EPUB/package.opf', version: '3.0', uniqueIdentifier: 'uid',
    metadata: { identifiers: [{ id: 'uid', value: 'u' }], titles: ['T'], languages: ['en'], modifiedCount: 1 },
    manifest, spinePresent: true, spine: [], loc: LOC,
  }
  return { pkg, container }
}
const ids = (docs: Record<string, string>, extras?: string[]) => {
  const { pkg, container } = setup(docs, extras)
  return validateContentDocs(pkg, container).map((m) => m.id)
}

describe('validateContentDocs — references', () => {
  it('passes when every reference resolves and is declared', () => {
    // c1 links to c2 (a declared content doc) and an image that is declared+present
    const pkg = setup({ 'c1.xhtml': '<a href="c2.xhtml">x</a><img src="a.png"/>', 'c2.xhtml': '<p>two</p>' })
    pkg.pkg.manifest.push({ id: 'img', href: 'a.png', mediaType: 'image/png', properties: [], loc: LOC })
    pkg.container.resources.set('EPUB/a.png', { path: 'EPUB/a.png', bytes: enc('x'), compression: 'deflate' })
    expect(validateContentDocs(pkg.pkg, pkg.container).map((m) => m.id)).toEqual([])
  })
  it('RSC-007 when a referenced file is missing', () => {
    expect(ids({ 'c1.xhtml': '<img src="missing.png"/>' })).toContain('RSC-007')
  })
  it('RSC-008 when a referenced file exists but is not in the manifest', () => {
    expect(ids({ 'c1.xhtml': '<img src="extra.png"/>' }, ['extra.png'])).toContain('RSC-008')
  })
  it('RSC-006 for a remote image reference (not allowed)', () => {
    expect(ids({ 'c1.xhtml': '<img src="https://example.com/a.png"/>' })).toContain('RSC-006')
  })
  it('allows a remote hyperlink (no RSC-006)', () => {
    expect(ids({ 'c1.xhtml': '<a href="https://example.com/">x</a>' })).not.toContain('RSC-006')
  })
  it('ignores mailto: and same-document fragment links', () => {
    expect(ids({ 'c1.xhtml': '<a href="mailto:a@b.com">m</a><a href="#top">t</a><span id="top"/>' })).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/checks/content.test.ts`
Expected: FAIL — cannot find module `./content.js`.

- [ ] **Step 3: Implement `checks/content.ts` (references)**

`src/checks/content.ts`
```ts
import { parseContent, type ContentDocument, type RefType } from '../parse/content.js'
import { getResource, type EpubContainer } from '../io/zip.js'
import { resolvePath, isRemote } from '../util/path.js'
import { msg, type Message } from '../messages/format.js'
import type { ManifestItem, PackageDocument } from '../parse/opf.js'

const REMOTE_ALLOWED: ReadonlySet<RefType> = new Set<RefType>(['hyperlink', 'cite', 'audio', 'video'])

/** A URL carrying any scheme (https:, data:, mailto:, tel:, …). */
function hasScheme(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url)
}

/** Map of resolved-container-path → manifest item, for declared local resources. */
function resolvedManifest(pkg: PackageDocument): Map<string, ManifestItem> {
  const map = new Map<string, ManifestItem>()
  for (const item of pkg.manifest) {
    if (item.href && !isRemote(item.href)) map.set(resolvePath(pkg.path, item.href), item)
  }
  return map
}

export function validateContentDocs(pkg: PackageDocument, container: EpubContainer): Message[] {
  const messages: Message[] = []
  const manifest = resolvedManifest(pkg)

  // Parse every XHTML content doc except the nav doc (validated by validateNav).
  const docs = new Map<string, ContentDocument>()
  for (const item of pkg.manifest) {
    if (item.mediaType !== 'application/xhtml+xml') continue
    if (item.properties.includes('nav')) continue
    const { doc, messages: m } = parseContent(item, container)
    messages.push(...m)
    if (doc) docs.set(doc.path, doc)
  }

  for (const doc of docs.values()) {
    messages.push(...checkReferences(doc, container, manifest))
  }
  return messages
}

function checkReferences(
  doc: ContentDocument,
  container: EpubContainer,
  manifest: Map<string, ManifestItem>,
): Message[] {
  const messages: Message[] = []
  for (const ref of doc.refs) {
    const url = ref.url
    if (url.startsWith('#')) continue // same-document fragment; handled by the fragment check
    if (isRemote(url)) {
      if (!REMOTE_ALLOWED.has(ref.type)) messages.push(msg('RSC-006', ref.loc, url))
      continue
    }
    if (hasScheme(url)) continue // data:, mailto:, tel:, … — not container-relative
    const target = resolvePath(doc.path, url)
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

Run: `npx vitest run src/checks/content.test.ts`
Expected: PASS — all six tests.

- [ ] **Step 5: Lint + typecheck + commit**

Run: `npm run lint && npx tsc --noEmit` (Expected: clean)
```bash
git add src/checks/content.ts src/checks/content.test.ts
git commit -m "feat: add content reference validation"
```

---

### Task 5: Content checks — fragments (`checkFragments`)

**Files:**
- Modify: `src/checks/content.ts`, `src/checks/content.test.ts`

**Interfaces:**
- Produces: `validateContentDocs` now also runs `checkFragments(doc, docs, manifest)` per doc.
- Rule: for a ref `url` containing `#frag` — if same-document (`base === ''`), the current doc must have an element with id `frag`; if cross-document and the target is a parsed XHTML content doc, that doc must have id `frag`; else (remote, scheme, non-XHTML/un-parsed target) skip. Missing id → `RSC-012`.

- [ ] **Step 1: Add the failing tests**

Append to `src/checks/content.test.ts`:
```ts
describe('validateContentDocs — fragments', () => {
  it('RSC-012 when a same-document fragment id is missing', () => {
    expect(ids({ 'c1.xhtml': '<a href="#nope">x</a>' })).toContain('RSC-012')
  })
  it('passes when a same-document fragment id exists', () => {
    expect(ids({ 'c1.xhtml': '<a href="#here">x</a><span id="here"/>' })).toEqual([])
  })
  it('RSC-012 when a cross-document fragment id is missing', () => {
    expect(ids({ 'c1.xhtml': '<a href="c2.xhtml#nope">x</a>', 'c2.xhtml': '<p id="other">2</p>' })).toContain('RSC-012')
  })
  it('passes when a cross-document fragment id exists', () => {
    expect(ids({ 'c1.xhtml': '<a href="c2.xhtml#ok">x</a>', 'c2.xhtml': '<p id="ok">2</p>' })).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/checks/content.test.ts`
Expected: FAIL — RSC-012 not emitted.

- [ ] **Step 3: Add `checkFragments` and wire it in**

In `src/checks/content.ts`, update the per-doc loop in `validateContentDocs`:
```ts
  for (const doc of docs.values()) {
    messages.push(...checkReferences(doc, container, manifest))
    messages.push(...checkFragments(doc, docs, manifest))
  }
```
Add below `checkReferences`:
```ts
function isFragmentCheckable(mediaType: string | undefined): boolean {
  return mediaType === 'application/xhtml+xml'
}

function checkFragments(
  doc: ContentDocument,
  docs: Map<string, ContentDocument>,
  manifest: Map<string, ManifestItem>,
): Message[] {
  const messages: Message[] = []
  for (const ref of doc.refs) {
    const hash = ref.url.indexOf('#')
    if (hash < 0) continue
    const frag = ref.url.slice(hash + 1)
    if (frag === '') continue
    const base = ref.url.slice(0, hash)

    let ids: Set<string> | undefined
    if (base === '') {
      ids = doc.ids // same-document
    } else {
      if (isRemote(ref.url) || hasScheme(base)) continue
      const target = resolvePath(doc.path, base)
      const item = manifest.get(target)
      if (!item || !isFragmentCheckable(item.mediaType)) continue // only id-check XHTML targets
      ids = docs.get(target)?.ids
      if (!ids) continue // target XHTML wasn't parsed (e.g. the nav doc, which we skip)
    }

    if (!ids.has(frag)) messages.push(msg('RSC-012', ref.loc))
  }
  return messages
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/checks/content.test.ts`
Expected: PASS — references + fragments.

- [ ] **Step 5: Lint + typecheck + commit**

Run: `npm run lint && npx tsc --noEmit` (Expected: clean)
```bash
git add src/checks/content.ts src/checks/content.test.ts
git commit -m "feat: add content fragment-identifier validation"
```

---

### Task 6: Content checks — unknown elements (`checkElements`)

**Files:**
- Modify: `src/checks/content.ts`, `src/checks/content.test.ts`

**Interfaces:**
- Consumes: `isKnownHtmlElement` from `../util/html-elements.js`; `XmlNode` from `../io/xml.js`.
- Produces: `validateContentDocs` now also runs `checkElements(doc)` per doc.
- Rule (conservative, RSC-005): an element in the XHTML namespace whose local name is not a known HTML5 element and is not a custom element (no `-`) → `RSC-005` with detail `Unknown element "<name>" in the XHTML namespace.`. Elements in other namespaces (SVG, MathML) and custom elements are not flagged.

- [ ] **Step 1: Add the failing tests**

Append to `src/checks/content.test.ts`:
```ts
describe('validateContentDocs — elements', () => {
  it('RSC-005 for an unknown XHTML-namespace element', () => {
    const msgs = (() => { const { pkg, container } = setup({ 'c1.xhtml': '<frobnicate>x</frobnicate>' }); return validateContentDocs(pkg, container) })()
    expect(msgs.some((m) => m.id === 'RSC-005' && m.message.includes('frobnicate'))).toBe(true)
  })
  it('does not flag known elements or custom (hyphenated) elements', () => {
    expect(ids({ 'c1.xhtml': '<section><my-widget>x</my-widget></section>' })).toEqual([])
  })
  it('does not flag SVG-namespace elements', () => {
    expect(ids({ 'c1.xhtml': '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>' })).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/checks/content.test.ts`
Expected: FAIL — unknown-element rule not implemented.

- [ ] **Step 3: Add `checkElements` and wire it in**

In `src/checks/content.ts`, add imports at the top:
```ts
import type { XmlNode } from '../io/xml.js'
import { isKnownHtmlElement } from '../util/html-elements.js'
```
Add the constant near the top (after imports):
```ts
const HTML_NS = 'http://www.w3.org/1999/xhtml'
```
Update the per-doc loop in `validateContentDocs`:
```ts
  for (const doc of docs.values()) {
    messages.push(...checkReferences(doc, container, manifest))
    messages.push(...checkFragments(doc, docs, manifest))
    messages.push(...checkElements(doc))
  }
```
Add below `checkFragments`:
```ts
function checkElements(doc: ContentDocument): Message[] {
  const messages: Message[] = []
  const walk = (node: XmlNode): void => {
    for (const child of node.children ?? []) {
      if (child.type !== 'element') continue
      const name = child.name ?? ''
      // Only flag elements explicitly in the XHTML namespace; skip custom elements (contain "-").
      if (child.ns === HTML_NS && !name.includes('-') && !isKnownHtmlElement(name)) {
        messages.push(msg('RSC-005', child.loc, doc.path, `Unknown element "${name}" in the XHTML namespace.`))
      }
      walk(child)
    }
  }
  walk(doc.root)
  return messages
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/checks/content.test.ts`
Expected: PASS — references + fragments + elements.

- [ ] **Step 5: Lint + typecheck + commit**

Run: `npm run lint && npx tsc --noEmit` (Expected: clean)
```bash
git add src/checks/content.ts src/checks/content.test.ts
git commit -m "feat: add unknown-element check for content documents"
```

---

### Task 7: Wire content into `validateEpub` + public exports + integration

**Files:**
- Modify: `src/validate.ts`, `src/validate.test.ts`, `src/index.ts`
- Create: `test/integration/content.test.ts`

**Interfaces:**
- Consumes: `validateContentDocs` from `./checks/content.js`.
- Produces: for an EPUB 3 package, `validateEpub` runs content-document validation after `validateNav`. `index.ts` exports `parseContent`, `validateContentDocs`, and the content types.

- [ ] **Step 1: Add the failing unit test**

Append to `src/validate.test.ts`:
```ts
  it('runs content checks for an EPUB 3 package', async () => {
    const opf =
      '<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid">' +
      '<metadata><dc:identifier id="uid">u</dc:identifier><dc:title>T</dc:title><dc:language>en</dc:language>' +
      '<meta property="dcterms:modified">2020-01-01T00:00:00Z</meta></metadata>' +
      '<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' +
      '<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>' +
      '<spine><itemref idref="c1"/></spine></package>'
    const nav = '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>t</title></head><body><nav epub:type="toc"><ol><li><a href="c1.xhtml">One</a></li></ol></nav></body></html>'
    // c1 references an image that is not in the archive -> RSC-007
    const c1 = '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><img src="missing.png"/></body></html>'
    const bytes = zipSync({
      mimetype: [enc('application/epub+zip'), { level: 0 }],
      'META-INF/container.xml': [enc('<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'), { level: 6 }],
      'package.opf': [enc(opf), { level: 6 }],
      'nav.xhtml': [enc(nav), { level: 6 }],
      'c1.xhtml': [enc(c1), { level: 6 }],
    })
    const report = await validateEpub(bytes)
    expect(report.messages.map((m) => m.id)).toContain('RSC-007')
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/validate.test.ts`
Expected: FAIL — `RSC-007` absent (content not wired yet).

- [ ] **Step 3: Wire content into `validate.ts`**

In `src/validate.ts`, add the import:
```ts
import { validateContentDocs } from './checks/content.js'
```
Inside the `if (detectedVersion === '3.0') { ... }` block, AFTER the nav block, add:
```ts
        messages.push(...validateContentDocs(pkg, container))
```
(So the EPUB 3 block runs nav validation and then content validation.)

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/validate.test.ts`
Expected: PASS — including the new content test.

- [ ] **Step 5: Export the new public API**

In `src/index.ts`:
- add after the `validateNav` export:
```ts
export { parseContent } from './parse/content.js'
export { validateContentDocs } from './checks/content.js'
```
- add to the type re-exports:
```ts
export type { ContentDocument, ContentRef, RefType } from './parse/content.js'
```

- [ ] **Step 6: Add the integration test**

`test/integration/content.test.ts`
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
  '<item id="css" href="s.css" media-type="text/css"/></manifest>' +
  '<spine><itemref idref="c1"/></spine></package>'
const NAV = '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>t</title></head><body><nav epub:type="toc"><ol><li><a href="c1.xhtml">One</a></li></ol></nav></body></html>'

function epub(c1Body: string) {
  const c1 = '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title><link rel="stylesheet" href="s.css"/></head><body>' + c1Body + '</body></html>'
  return zipSync({
    mimetype: [enc('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': [CONTAINER, { level: 6 }],
    'EPUB/package.opf': [enc(OPF), { level: 6 }],
    'EPUB/nav.xhtml': [enc(NAV), { level: 6 }],
    'EPUB/c1.xhtml': [enc(c1), { level: 6 }],
    'EPUB/s.css': [enc('p{}'), { level: 6 }],
  })
}

describe('integration: content validation', () => {
  it('reports no content errors for a clean content document', async () => {
    const report = await validateEpub(epub('<p id="a">hello</p><a href="#a">self</a>'))
    const ids = report.messages.map((m) => m.id).filter((id) => id === 'RSC-006' || id === 'RSC-007' || id === 'RSC-008' || id === 'RSC-012')
    expect(ids).toEqual([])
  })
  it('flags a broken cross-reference and a missing fragment', async () => {
    const report = await validateEpub(epub('<a href="gone.xhtml">x</a><a href="#missing">y</a>'))
    const ids = report.messages.map((m) => m.id)
    expect(ids).toContain('RSC-007')
    expect(ids).toContain('RSC-012')
    expect(report.valid).toBe(false)
  })
})
```

- [ ] **Step 7: Run the full gate**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: lint clean; typecheck clean; ALL tests pass (Plans 1–3 suite + new content unit/integration); build emits `dist/index.js` + `dist/index.d.ts`.

- [ ] **Step 8: Commit**

```bash
git add src/validate.ts src/validate.test.ts src/index.ts test/integration/content.test.ts
git commit -m "feat: wire content document validation into validateEpub"
```

---

## Roadmap (subsequent plans)

- **Plan 5 — CSS validation:** CSS parsing + `url()` reference resolution + `@font-face` remote policy (`RSC-006`/`031`), `@import`.
- **Plan 6 — Fixture corpus + deferred rules:** ported epubcheck fixtures; deferred content rules (`RSC-010`/`011` hyperlink type/spine, `RSC-031`/`032` remote-HTTPS/fallback, SVG `use`/paint refs, standalone SVG docs); plus deferred OPF/nav rules, attribute-namespace resolution, and `LICENSE`/`ATTRIBUTION`.

---

## Self-Review

**Spec coverage (content portion of §2/§6/§7):** content-doc parse + reference extraction → Task 3; reference resolution (RSC-006/007/008) → Task 4; fragment ids (RSC-012) → Task 5; allowed-element (conservative unknown-element) check → Task 6 (+ Task 2 data); wiring + EPUB-3-gated content validation + exports → Task 7; named-entity handling (RSC-005, matches epubcheck) → Task 3 test. CSS, standalone SVG, hyperlink type/spine, remote-HTTPS/fallback are deferred (roadmap). No content-scope gaps.

**Placeholder scan:** No TBD/TODO; every code step has complete code; "later task" references are only the documented incremental wiring of `validateContentDocs` (Tasks 4→5→6, full code at each step) and the roadmap.

**Type consistency:** `RefType`/`ContentRef`/`ContentDocument` defined in Task 3, consumed unchanged in Tasks 4–7. `validateContentDocs(pkg, container)` signature identical across Tasks 4/5/6/7. `parseContent(item, container) => { doc?, messages }` consumed in Task 4. Catalog IDs added in Task 1 (`RSC-006`/`RSC-012`) plus reused `RSC-007`/`RSC-008` (Plan 3) and `RSC-005` (Plan 1) match every `msg(...)` call site. `isKnownHtmlElement` (Task 2) consumed in Task 6. `index.ts` re-exports resolve to real symbols. The nav doc is excluded from `validateContentDocs` to avoid double-reporting its links (validated by `validateNav`).
```
