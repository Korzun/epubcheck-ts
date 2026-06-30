# Plan 13 — Corpus Expansion + NAV-011 Document-Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add eight confidence fixtures mirroring epubcheck scenarios we don't yet cover for rules shipped in Plans 9–12, and close the deferred NAV-011 "document-order" sub-case (toc links to fragments of the same spine item in the wrong document order).

**Architecture:** Two parts. (1) Corpus-only: eight crafted fixtures (variations across element types + valid-clean regression guards) added to `test/fixtures/corpus.ts`; no production code. (2) NAV-011 document-order: `parseContent` records an ordered `idPositions: Map<string, number>` per content document; `checkReadingOrder` in `src/checks/nav.ts` is extended with the document-order sub-case, which requires re-adding the `container` parameter to `validateNav` (dropped in Plan 11) so it can parse a toc link's target document on demand (cached) to read fragment-id positions.

**Tech Stack:** TypeScript (ESM, strict, `noUncheckedIndexedAccess`), vitest. No new dependencies.

## Global Constraints

- ESM-only TypeScript; every relative import uses a `.js` specifier.
- Functional style, NO classes anywhere.
- Runtime-agnostic: zero Node-only APIs (only `TextEncoder`/`TextDecoder`/`Uint8Array`/`Map`/`Set`/standard web APIs).
- Unit tests are colocated as `*.test.ts` beside source; integration fixtures live under `test/`.
- Types are colocated with the code that produces them; no types-only modules.
- No new runtime dependencies.
- Message IDs reuse epubcheck's vocabulary; severities come from the catalog (`src/messages/catalog.ts`).
- `validateEpub` must never throw.
- The integration corpus (`test/integration/corpus.test.ts`) uses an EXACT-MULTISET match: each fixture's `expected` set must exactly equal the validator's actual output (duplicates count — a fixture expecting two NAV-011 lists `E('NAV-011','WARNING')` twice).

### Verified epubcheck NAV-011 reading-order algorithm (source-verified: `ResourceReferencesChecker.checkReadingOrder`, `ResourceRegistry.getIDPosition`)

Single pass over the toc links (in document order), `lastSpinePosition = -1`, `lastAnchorPosition = -1`. For each link whose target is in the spine (others skipped):
- `pos = target spine position`.
- If `pos < lastSpinePosition`: report NAV-011 "spine"; set `lastSpinePosition = pos`, `lastAnchorPosition = -1`. (No anchor check for this link.)
- Else:
  - If `pos > lastSpinePosition`: set `lastSpinePosition = pos`, `lastAnchorPosition = -1`. (If `pos == lastSpinePosition`, no reset.)
  - `anchorPos = idPosition(fragment, targetDoc)`: **0** when the link has no fragment; the **1-based** ordinal of the fragment id among id-bearing elements in document order when found; **-1** when the fragment is not found.
  - If `anchorPos > -1`: if `anchorPos < lastAnchorPosition`, report NAV-011 "document"; then set `lastAnchorPosition = anchorPos`. (If `anchorPos == -1`, the whole anchor block is skipped and `lastAnchorPosition` is unchanged.)

`idPosition` ordinal is **1-based**, counts only elements that carry an `id` attribute, in document order, first-occurrence-wins for duplicate ids.

### Current code this plan extends (already on `main`, post-Plan-12)

`src/parse/content.ts` — `ContentDocument { path; root; refs; ids: Set<string>; inlineStyles }`. `collect(node, parent, refs, ids, inlineStyles)` records ids via `if (id) ids.add(id)` while walking children in document order; `parseContent` builds the `ContentDocument`.

`src/checks/nav.ts` — `validateNav(nav, pkg)` returns `[...checkOccurrence(nav), ...checkContent(nav), ...checkLinks(nav), ...checkReadingOrder(nav, pkg)]`. `checkReadingOrder(nav, pkg)` currently implements the spine sub-case only (a single `lastPos` cursor; no anchor tracking; never parses content docs). Imports include `findDescendants`, `resolvePath`, `isRemote`, `msg`, `NavDocument`/`NavSection`, `ManifestItem`/`PackageDocument`.

`src/validate.ts` — calls `validateNav(nav, pkg)` (container is in scope at that line).

`src/util/path.ts` — `resolvePath(fromFile, href)` strips the fragment; extract a fragment separately via `href.split('#')[1]`.

`test/fixtures/build.ts` — `buildEpub({ files })` (files now `Record<string, string | Uint8Array>`), `cssEpub(css, extra)`, baseline `OPF`/`NAV`/`CONTENT`. `OPF` has `content_001.xhtml` (id `content`) in the spine and `nav.xhtml` (id `nav`, not in spine). `NAV`'s toc is `<nav epub:type="toc"><ol><li><a href="content_001.xhtml">Content</a></li></ol></nav>`.

---

## Task 1: Eight confidence fixtures (corpus-only)

**Files:**
- Modify: `test/fixtures/corpus.ts` (add eight fixtures)

**Interfaces:**
- Consumes: existing rules (all already implemented; their ids are already in `IMPLEMENTED_IDS`).
- Produces: nothing (corpus only).

These mirror epubcheck scenarios we don't yet cover. All are expected to PASS against the current implementation (they are regression guards, including valid-clean cases). No production code changes.

- [ ] **Step 1: Add the fixtures**

In `test/fixtures/corpus.ts`, add the following. Place the `area: 'content'` ones in the Content-references group, the `area: 'nav'` ones in the Navigation group, and the `area: 'css'` ones in the CSS group:

```ts
  // content — RSC-032 variations + valid fallback
  {
    name: 'content-foreign-audio-no-fallback',
    area: 'content',
    description: 'content audio@src targets a non-core media type with no fallback (epubcheck RSC-032)',
    epub: buildEpub({
      files: {
        'EPUB/package.opf': OPF.replace('</manifest>', '<item id="snd" href="sound.bin" media-type="application/octet-stream"/></manifest>'),
        'EPUB/sound.bin': 'AUDIO',
        'EPUB/content_001.xhtml': CONTENT.replace('<p>Hello</p>', '<p><audio src="sound.bin"></audio></p>'),
      },
    }),
    expected: [E('RSC-032', 'ERROR')],
  },
  {
    name: 'content-foreign-embed-no-fallback',
    area: 'content',
    description: 'content embed@src targets a non-core media type with no fallback (epubcheck RSC-032)',
    epub: buildEpub({
      files: {
        'EPUB/package.opf': OPF.replace('</manifest>', '<item id="emb" href="thing.bin" media-type="application/octet-stream"/></manifest>'),
        'EPUB/thing.bin': 'DATA',
        'EPUB/content_001.xhtml': CONTENT.replace('<p>Hello</p>', '<p><embed src="thing.bin"/></p>'),
      },
    }),
    expected: [E('RSC-032', 'ERROR')],
  },
  {
    name: 'content-foreign-img-with-fallback-valid',
    area: 'content',
    description: 'content img@src targets a non-core type but has a manifest fallback to a core type (valid; no RSC-032)',
    epub: buildEpub({
      files: {
        'EPUB/package.opf': OPF.replace('</manifest>',
          '<item id="tiff" href="diagram.tiff" media-type="image/tiff" fallback="png"/>' +
          '<item id="png" href="diagram.png" media-type="image/png"/></manifest>'),
        'EPUB/diagram.tiff': 'TIFF',
        'EPUB/diagram.png': 'PNG',
        'EPUB/content_001.xhtml': CONTENT.replace('<p>Hello</p>', '<p><img src="diagram.tiff"/></p>'),
      },
    }),
    expected: [],
  },
  {
    name: 'content-video-remote-http',
    area: 'content',
    description: 'content video@src is a remote HTTP url that should be HTTPS (epubcheck RSC-031)',
    epub: buildEpub({ files: { 'EPUB/content_001.xhtml': CONTENT.replace('<p>Hello</p>', '<p><video src="http://example.com/v.mp4"></video></p>') } }),
    expected: [E('RSC-031', 'WARNING')],
  },
  // nav — RSC-010/011 via the routed nav document
  {
    name: 'nav-link-noncontent-type',
    area: 'nav',
    description: 'nav toc link targets a non-content-document resource type (epubcheck RSC-010, via nav-as-content)',
    epub: buildEpub({
      files: {
        'EPUB/package.opf': OPF.replace('</manifest>', '<item id="photo" href="photo.jpg" media-type="image/jpeg"/></manifest>'),
        'EPUB/photo.jpg': 'JPEG',
        'EPUB/nav.xhtml': NAV.replace('href="content_001.xhtml"', 'href="photo.jpg"'),
      },
    }),
    expected: [E('RSC-010', 'ERROR')],
  },
  {
    name: 'nav-link-nonspine',
    area: 'nav',
    description: 'nav toc link targets a content doc not in the spine (epubcheck RSC-011, via nav-as-content)',
    epub: buildEpub({
      files: {
        'EPUB/package.opf': OPF.replace('</manifest>', '<item id="extra" href="extra.xhtml" media-type="application/xhtml+xml"/></manifest>'),
        'EPUB/extra.xhtml': CONTENT,
        'EPUB/nav.xhtml': NAV.replace('href="content_001.xhtml"', 'href="extra.xhtml"'),
      },
    }),
    expected: [E('RSC-011', 'ERROR')],
  },
  // css — CSS-015 empty title + CSS-007 valid font
  {
    name: 'css-alternate-stylesheet-empty-title',
    area: 'css',
    description: 'an alternate stylesheet <link> has an empty title attribute (epubcheck CSS-015)',
    epub: cssEpub('p { color: red; }', {
      'EPUB/content_001.xhtml': CONTENT.replace(
        '<head><title>t</title></head>',
        '<head><title>t</title><link rel="stylesheet" href="style.css"/><link rel="alternate stylesheet" href="style.css" title=""/></head>',
      ),
    }),
    expected: [E('CSS-015', 'ERROR')],
  },
  {
    name: 'css-font-face-valid',
    area: 'css',
    description: '@font-face src targets a blessed font type (valid; no CSS-007)',
    epub: buildEpub({
      files: {
        'EPUB/package.opf': OPF.replace('</manifest>',
          '<item id="css" href="style.css" media-type="text/css"/>' +
          '<item id="fnt" href="f.woff2" media-type="font/woff2"/></manifest>'),
        'EPUB/content_001.xhtml': CONTENT.replace('<head><title>t</title></head>', '<head><title>t</title><link rel="stylesheet" href="style.css"/></head>'),
        'EPUB/style.css': '@font-face { font-family: F; src: url(f.woff2); }',
        'EPUB/f.woff2': 'WOFF2',
      },
    }),
    expected: [],
  },
```

- [ ] **Step 2: Run the FULL suite**

Run: `npx vitest run`
Expected: all green. These eight fixtures all pass against the current implementation. **If any fixture fails (its actual output differs from `expected`), STOP and report the exact diff** — do not blindly change `expected` to match; a mismatch means either the fixture markup is wrong or it reveals a real behavior difference worth investigating. Likely-correct reasoning per fixture:
- `content-foreign-audio-no-fallback` / `content-foreign-embed-no-fallback`: bare `<audio src>` / `<embed src>` → non-core declared target, no fallback → RSC-032.
- `content-foreign-img-with-fallback-valid`: `<img>` → `image/tiff` with manifest `fallback` to `image/png` (core) → no RSC-032 → `[]`.
- `content-video-remote-http`: remote http `<video src>` → RSC-031.
- `nav-link-noncontent-type`: routed nav's toc link to `photo.jpg` (image/jpeg, not a content type) → RSC-010 (not in spine, but RSC-010 fires first for the non-blessed type).
- `nav-link-nonspine`: routed nav's toc link to a declared, present, non-spine xhtml → RSC-011.
- `css-alternate-stylesheet-empty-title`: `<link rel="alternate stylesheet" title="">` → CSS-015 (empty title).
- `css-font-face-valid`: `@font-face` → `font/woff2` → no CSS-007 → `[]`.

- [ ] **Step 3: Lint + typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add test/fixtures/corpus.ts
git commit -m "test: add confidence fixtures mirroring epubcheck scenarios (RSC-031/032/010/011, CSS-007/015)"
```

---

## Task 2: Parser — record ordered id positions

**Files:**
- Modify: `src/parse/content.ts` (add `idPositions` to `ContentDocument`; populate in `collect`)
- Modify: `src/parse/content.test.ts` (unit tests)

**Interfaces:**
- Consumes: nothing.
- Produces: `ContentDocument.idPositions: Map<string, number>` (id → 1-based ordinal in document order, first occurrence wins), consumed by Task 3.

**Note:** Additive field on the exported `ContentDocument`; no check reads it yet, so the build stays green. The only constructor of `ContentDocument` is `parseContent`.

- [ ] **Step 1: Write the failing unit tests**

Append to `src/parse/content.test.ts` (reuses the file's `item`, `container`, `DOC` helpers):

```ts
describe('parseContent — id positions', () => {
  it('records 1-based id positions in document order', () => {
    const { doc } = parseContent(item, container(DOC('<h2 id="a">A</h2><p id="b">B</p><h2 id="c">C</h2>')))
    expect(doc!.idPositions.get('a')).toBe(1)
    expect(doc!.idPositions.get('b')).toBe(2)
    expect(doc!.idPositions.get('c')).toBe(3)
    expect(doc!.idPositions.get('missing')).toBeUndefined()
  })

  it('keeps the first occurrence for duplicate ids', () => {
    const { doc } = parseContent(item, container(DOC('<p id="x">1</p><p id="y">2</p><p id="x">3</p>')))
    expect(doc!.idPositions.get('x')).toBe(1)
    expect(doc!.idPositions.get('y')).toBe(2)
  })
})
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run src/parse/content.test.ts`
Expected: the new tests FAIL (`idPositions` does not exist on `ContentDocument`).

- [ ] **Step 3: Add the field and populate it**

In `src/parse/content.ts`, add `idPositions` to the `ContentDocument` interface:

```ts
export interface ContentDocument {
  path: string
  root: XmlNode
  refs: ContentRef[]
  ids: Set<string>
  /** id attribute value → 1-based ordinal among id-bearing elements in document order (first occurrence wins). */
  idPositions: Map<string, number>
  inlineStyles: InlineStyle[]
}
```

Change `collect`'s signature to thread `idPositions`, and populate it alongside `ids`:

```ts
function collect(
  node: XmlNode,
  parent: string | undefined,
  refs: ContentRef[],
  ids: Set<string>,
  idPositions: Map<string, number>,
  inlineStyles: InlineStyle[],
): void {
  for (const child of node.children ?? []) {
    if (child.type !== 'element') continue
    const attrs = child.attrs ?? {}
    const id = attrs['id']
    if (id) {
      ids.add(id)
      if (!idPositions.has(id)) idPositions.set(id, idPositions.size + 1)
    }
    addRefs(child, parent, attrs, refs)
    if (child.name === 'style') {
      inlineStyles.push({ context: 'stylesheet', text: textContent(child), loc: child.loc })
    }
    const styleAttr = attrs['style']
    if (styleAttr) {
      inlineStyles.push({ context: 'declarationList', text: styleAttr, loc: child.loc })
    }
    collect(child, child.name, refs, ids, idPositions, inlineStyles)
  }
}
```

(`idPositions.size + 1` is the next 1-based ordinal: it is evaluated before the `set`, so the first unique id gets `0 + 1 = 1`, the second gets `1 + 1 = 2`, etc.)

Update `parseContent` to create the map and include it in the returned doc:

```ts
  const refs: ContentRef[] = []
  const ids = new Set<string>()
  const idPositions = new Map<string, number>()
  const inlineStyles: InlineStyle[] = []
  collect(root, undefined, refs, ids, idPositions, inlineStyles)
  return { doc: { path, root, refs, ids, idPositions, inlineStyles }, messages }
```

- [ ] **Step 4: Run the parser tests + full suite**

Run: `npx vitest run src/parse/content.test.ts && npx vitest run && npm run lint && npx tsc --noEmit`
Expected: all green / clean (the new field is additive; nothing else reads it yet).

- [ ] **Step 5: Commit**

```bash
git add src/parse/content.ts src/parse/content.test.ts
git commit -m "feat: record ordered id positions on parsed content documents"
```

---

## Task 3: NAV-011 document-order sub-case

**Files:**
- Modify: `src/checks/nav.ts` (extend `checkReadingOrder`; re-add `container` to it and `validateNav`)
- Modify: `src/validate.ts` (update the `validateNav` call site)
- Modify: `src/checks/nav.test.ts` (update `validateNav` call sites; add document-order tests)
- Modify: `test/fixtures/corpus.ts` (add two fixtures)

**Interfaces:**
- Consumes: `ContentDocument.idPositions` (Task 2).
- Produces: `validateNav(nav, pkg, container)` (re-adds the `container` parameter dropped in Plan 11) — `checkReadingOrder` parses a toc link's target document on demand (cached) to read fragment-id positions for the document-order sub-case.

**Why re-add `container`:** the document-order sub-case must read the *target content document's* id positions, which means parsing that document — so `checkReadingOrder` needs `container`. Plan 11 dropped `container` from `validateNav` because the spine-only check didn't need it; the document-order sub-case does.

- [ ] **Step 1: Write the failing unit tests**

Append to `src/checks/nav.test.ts` (reuses `enc`, `LOC`, `navItem`, `parseNav`, and the `Resource`/`EpubContainer`/`PackageDocument` imports):

```ts
describe('validateNav — reading order document sub-case (NAV-011)', () => {
  // One spine item (c1) whose body provides the id'd elements; nav links into it.
  function oneSpineFragments(navBody: string, contentBody: string): string[] {
    const navXml =
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>t</title></head><body>' +
      navBody + '</body></html>'
    const contentXml =
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>' + contentBody + '</body></html>'
    const resources = new Map<string, Resource>()
    resources.set('EPUB/nav.xhtml', { path: 'EPUB/nav.xhtml', bytes: enc(navXml), compression: 'deflate' })
    resources.set('EPUB/c1.xhtml', { path: 'EPUB/c1.xhtml', bytes: enc(contentXml), compression: 'deflate' })
    const container: EpubContainer = { resources, rootfiles: ['EPUB/package.opf'], hasEncryption: false }
    const { nav } = parseNav(navItem, container)
    const pkg: PackageDocument = {
      path: 'EPUB/package.opf', version: '3.0', uniqueIdentifier: 'uid',
      metadata: { identifiers: [{ id: 'uid', value: 'u' }], titles: ['T'], languages: ['en'], modifiedCount: 1 },
      manifest: [navItem, { id: 'c1', href: 'c1.xhtml', mediaType: 'application/xhtml+xml', properties: [], loc: LOC }],
      spinePresent: true, spine: [{ idref: 'c1', linear: true, properties: [], loc: LOC }], loc: LOC,
    }
    return validateNav(nav!, pkg, container).map((m) => m.id)
  }

  it('NAV-011 when toc fragment links are out of document order', () => {
    const out = oneSpineFragments(
      '<nav epub:type="toc"><ol><li><a href="c1.xhtml#p2">2</a></li><li><a href="c1.xhtml#p1">1</a></li></ol></nav>',
      '<p id="p1">1</p><p id="p2">2</p>',
    )
    expect(out).toContain('NAV-011')
  })

  it('no NAV-011 when toc fragment links are in document order', () => {
    const out = oneSpineFragments(
      '<nav epub:type="toc"><ol><li><a href="c1.xhtml#p1">1</a></li><li><a href="c1.xhtml#p2">2</a></li></ol></nav>',
      '<p id="p1">1</p><p id="p2">2</p>',
    )
    expect(out).not.toContain('NAV-011')
  })

  it('no NAV-011 when the fragment id is not found in the target document', () => {
    const out = oneSpineFragments(
      '<nav epub:type="toc"><ol><li><a href="c1.xhtml#p2">2</a></li><li><a href="c1.xhtml#nope">x</a></li></ol></nav>',
      '<p id="p2">2</p>',
    )
    expect(out).not.toContain('NAV-011')
  })
})
```

- [ ] **Step 2: Run them and confirm the first fails**

Run: `npx vitest run src/checks/nav.test.ts`
Expected: a TypeScript/call-arity error or failure — `validateNav` currently takes two args while `oneSpineFragments` passes three. (This is the expected red state; it resolves once the signature is updated in Step 4. The "out of document order" assertion is the behavioral target.)

- [ ] **Step 3: Add imports to `src/checks/nav.ts`**

Ensure these imports exist (merge with the current ones; `manifestPathMap` is a value import, `parseContent` a value import, `EpubContainer` a type import):

```ts
import type { EpubContainer } from '../io/zip.js'
import { parseContent } from '../parse/content.js'
import { manifestPathMap, type ManifestItem, type PackageDocument } from '../parse/opf.js'
```

(If `ManifestItem`/`PackageDocument` are already imported from `../parse/opf.js`, fold `manifestPathMap` into that line as a value import.)

- [ ] **Step 4: Replace `checkReadingOrder` and re-add `container` to `validateNav`**

In `src/checks/nav.ts`, change `validateNav` to take and pass `container`:

```ts
export function validateNav(nav: NavDocument, pkg: PackageDocument, container: EpubContainer): Message[] {
  return [...checkOccurrence(nav), ...checkContent(nav), ...checkLinks(nav), ...checkReadingOrder(nav, pkg, container)]
}
```

Replace the entire `checkReadingOrder` function with the spine + document-order version:

```ts
function anchorPosition(href: string, idPositions: Map<string, number>): number {
  const hash = href.indexOf('#')
  const fragment = hash < 0 ? '' : href.slice(hash + 1)
  if (fragment.trim() === '') return 0 // no fragment → start of document
  return idPositions.get(fragment) ?? -1 // not found → -1 (skip the document-order check)
}

function checkReadingOrder(nav: NavDocument, pkg: PackageDocument, container: EpubContainer): Message[] {
  const messages: Message[] = []

  const itemById = new Map<string, ManifestItem>()
  for (const item of pkg.manifest) {
    if (item.id !== undefined) itemById.set(item.id, item)
  }
  const spinePos = new Map<string, number>()
  pkg.spine.forEach((s, i) => {
    if (s.idref === undefined) return
    const item = itemById.get(s.idref)
    if (item?.href && !isRemote(item.href)) spinePos.set(resolvePath(pkg.path, item.href), i)
  })

  // Parse a target content doc on demand (cached) to read its id positions.
  const manifest = manifestPathMap(pkg)
  const idPosCache = new Map<string, Map<string, number>>()
  const idPositionsFor = (path: string): Map<string, number> => {
    const cached = idPosCache.get(path)
    if (cached) return cached
    const item = manifest.get(path)
    const positions = item ? (parseContent(item, container).doc?.idPositions ?? new Map<string, number>()) : new Map<string, number>()
    idPosCache.set(path, positions)
    return positions
  }

  for (const section of nav.sections) {
    if (!hasType(section, 'toc')) continue
    let lastSpinePos = -1
    let lastAnchorPos = -1
    for (const a of findDescendants(section.node, 'a')) {
      const href = a.attrs?.['href']
      if (!href || isRemote(href)) continue
      const target = resolvePath(nav.path, href) // strips the fragment
      const pos = spinePos.get(target)
      if (pos === undefined) continue // target not in the spine → skipped

      if (pos < lastSpinePos) {
        messages.push(msg('NAV-011', a.loc, 'toc', target, 'spine'))
        lastSpinePos = pos
        lastAnchorPos = -1
      } else {
        if (pos > lastSpinePos) {
          lastSpinePos = pos
          lastAnchorPos = -1
        }
        const anchorPos = anchorPosition(href, idPositionsFor(target))
        if (anchorPos > -1) {
          if (anchorPos < lastAnchorPos) messages.push(msg('NAV-011', a.loc, 'toc', target, 'document'))
          lastAnchorPos = anchorPos
        }
      }
    }
  }

  return messages
}
```

- [ ] **Step 5: Update the `validateNav` call site in `src/validate.ts`**

Change `if (nav) messages.push(...validateNav(nav, pkg))` to:

```ts
    if (nav) messages.push(...validateNav(nav, pkg, container))
```

- [ ] **Step 6: Update the `validateNav` call sites in `src/checks/nav.test.ts`**

The `ids` and `msgs` helpers and the existing `twoSpine` helper call `validateNav(nav, pkg)` — add the `container` argument (all three already build a `container`). For example:

```ts
const ids = (body: string, targets?: string[]) => {
  const { nav, pkg, container } = navDoc(body, targets)
  return validateNav(nav, pkg, container).map((m) => m.id)
}
const msgs = (body: string, targets?: string[]) => {
  const { nav, pkg, container } = navDoc(body, targets)
  return validateNav(nav, pkg, container)
}
```

and in `twoSpine`, change `validateNav(nav!, pkg)` to `validateNav(nav!, pkg, container)` (the helper already constructs `container`). The new `oneSpineFragments` helper (Step 1) already passes `container`.

- [ ] **Step 7: Run the nav unit tests**

Run: `npx vitest run src/checks/nav.test.ts`
Expected: PASS — the three new document-order tests plus every pre-existing nav test (the spine-order tests still pass: their links have no fragments, so `anchorPos` is always `0` and never goes backwards).

- [ ] **Step 8: Add the two corpus fixtures**

In `test/fixtures/corpus.ts`, add to the Navigation group (after `nav-reading-order`):

```ts
  {
    name: 'nav-reading-order-fragments',
    area: 'nav',
    description: 'toc links to fragments of the same spine item are out of document order (epubcheck NAV-011 x2)',
    epub: buildEpub({
      files: {
        'EPUB/content_001.xhtml': CONTENT.replace('<p>Hello</p>', '<h2 id="ch1">1</h2><h2 id="ch2">2</h2><h2 id="ch3">3</h2>'),
        'EPUB/nav.xhtml': NAV.replace(
          '<nav epub:type="toc"><ol><li><a href="content_001.xhtml">Content</a></li></ol></nav>',
          '<nav epub:type="toc"><ol>' +
            '<li><a href="content_001.xhtml#ch1">1</a></li>' +
            '<li><a href="content_001.xhtml">M</a></li>' +
            '<li><a href="content_001.xhtml#ch3">3</a></li>' +
            '<li><a href="content_001.xhtml#ch2">2</a></li>' +
            '</ol></nav>',
        ),
      },
    }),
    expected: [E('NAV-011', 'WARNING'), E('NAV-011', 'WARNING')],
  },
  {
    name: 'nav-reading-order-fragments-valid',
    area: 'nav',
    description: 'toc links to fragments of the same spine item in correct document order (valid; no NAV-011)',
    epub: buildEpub({
      files: {
        'EPUB/content_001.xhtml': CONTENT.replace('<p>Hello</p>', '<h2 id="ch1">1</h2><h2 id="ch2">2</h2><h2 id="ch3">3</h2>'),
        'EPUB/nav.xhtml': NAV.replace(
          '<nav epub:type="toc"><ol><li><a href="content_001.xhtml">Content</a></li></ol></nav>',
          '<nav epub:type="toc"><ol>' +
            '<li><a href="content_001.xhtml">M</a></li>' +
            '<li><a href="content_001.xhtml#ch1">1</a></li>' +
            '<li><a href="content_001.xhtml#ch2">2</a></li>' +
            '<li><a href="content_001.xhtml#ch3">3</a></li>' +
            '</ol></nav>',
        ),
      },
    }),
    expected: [],
  },
```

- [ ] **Step 9: Run the FULL suite**

Run: `npx vitest run`
Expected: all green. The `nav-reading-order-fragments` fixture's toc links (ch1=1, no-frag=0 → fires, ch3=3, ch2=2 → fires) produce exactly two NAV-011 "document"; all four links target the single in-spine `content_001.xhtml` (blessed, in spine, fragments defined) so no RSC-010/011/012 fires. The valid fixture's links are monotonic (0,1,2,3) → no NAV-011. The pre-existing `nav-reading-order` fixture still emits exactly one NAV-011 (spine). If any other fixture changes output, STOP and report.

- [ ] **Step 10: Lint + typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 11: Commit**

```bash
git add src/checks/nav.ts src/validate.ts src/checks/nav.test.ts test/fixtures/corpus.ts
git commit -m "feat: flag toc fragment links out of document order (NAV-011 document sub-case)"
```

---

## Known limitations / carry-forward (not in scope for this plan)

- `checkReadingOrder` parses a toc link's target document on demand to read id positions, which double-parses documents also parsed by `validateContentDocs` (their parse *messages* are discarded here to avoid double-reporting). This is bounded (only spine-item targets of toc links, cached per path) and acceptable; a future refactor could share a single parsed-docs model across `validateNav`/`validateContentDocs`/`validateCssDocs`.
- PKG-001 remains unit-test-only (it needs a forced version via `validateEpub(bytes, { version })`, which a static corpus fixture cannot express — epubcheck itself does not fixture it).
- Prior carry-forwards (Plan-10 audio-source/object intrinsic fallback; Plan-12 BOM-less UTF-16 detection) remain deferred.

## Self-review notes

- **Spec coverage:** eight confidence fixtures → Task 1; `ContentDocument.idPositions` → Task 2; NAV-011 document-order (algorithm + `container` re-add + fixtures) → Task 3.
- **Type consistency:** `ContentDocument.idPositions: Map<string, number>` (Task 2) is read by `idPositionsFor` in Task 3. `validateNav(nav, pkg, container)` signature is updated in Task 3 across `validate.ts` and all `nav.test.ts` call sites. NAV-011 args: `msg('NAV-011', a.loc, 'toc', target, 'spine' | 'document')`.
- **No placeholders:** every code step is complete and verbatim.
- **Corpus:** Task 1 adds 8 fixtures, Task 3 adds 2; no existing fixture's `expected` changes (the pre-existing `nav-reading-order` still emits one spine-order NAV-011, verified by trace). Enforced by the exact-multiset harness.
