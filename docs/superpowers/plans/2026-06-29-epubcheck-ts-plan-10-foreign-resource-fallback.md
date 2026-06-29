# Plan 10 — Foreign-Resource Fallback (RSC-032) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emit epubcheck's RSC-032 for content-document references (`img`/`audio`/`video`/`object`-style refs) whose local target is a non–Core-Media-Type resource with no fallback to a Core Media Type, while suppressing it when the referencing context supplies an intrinsic fallback (e.g. `<img>` inside `<picture>`, `<source>` inside `<audio>`).

**Architecture:** RSC-032 slots into the existing `checkReferences` loop in `src/checks/content.ts`, as a new branch parallel to the Plan-9 hyperlink (RSC-010/011) branch, reached only for local, present, manifest-declared targets of ref types `image`/`audio`/`video`/`generic`. It needs three pieces: (1) a Core-Media-Type predicate; (2) a generalization of Plan-9's `hasFallbackToBlessed` into a predicate-parameterized `hasFallbackTo` so the manifest `fallback` chain can be walked for a Core-Media-Type target; (3) a new `hasIntrinsicFallback` boolean on `ContentRef`, set by the parser, to suppress the rule for picture/audio-source/object contexts. The parser already tracks the parent element's tag name, so the intrinsic-fallback flag is a small, local addition to `addRefs`.

**Tech Stack:** TypeScript (ESM, strict, `noUncheckedIndexedAccess`), vitest. No new dependencies.

## Global Constraints

- ESM-only TypeScript; every relative import uses a `.js` specifier.
- Functional style, NO classes anywhere.
- Runtime-agnostic: zero Node-only APIs (only `TextEncoder`/`TextDecoder`/`Uint8Array`/`Map`/`Set`/`RegExp`/standard web APIs).
- Unit tests are colocated as `*.test.ts` beside source; integration fixtures live under `test/`.
- Types are colocated with the code that produces them; no types-only modules.
- No new runtime dependencies.
- Message IDs reuse epubcheck's vocabulary; severities come from the catalog (`src/messages/catalog.ts`).
- `validateEpub` must never throw.
- The integration corpus (`test/integration/corpus.test.ts`) uses an EXACT-MULTISET match: each fixture's `expected` set must exactly equal the validator's actual output. Every implemented ID must be in `test/fixtures/implemented.ts`.
- This plan adds a required field (`hasIntrinsicFallback`) to the exported `ContentRef` interface — an ADDITIVE change to public output data. The set of exported names in `src/index.ts` is unchanged.

### Verified epubcheck semantics (source-verified against `w3c/epubcheck`: `MessageBundle.properties`, `DefaultSeverities.java`, `ResourceReferencesChecker.java`, `OPFChecker30.java`, `OPFChecker.java`, `OPSHandler30.java`)

- **RSC-032** — template `Fallback must be provided for foreign resources, but found none for resource "%1$s" of type "%2$s".` (`%1$s` = the target resource path, `%2$s` = the target's manifest media type), severity **ERROR**.
- **Trigger** (`checkFallbacks`): for a reference of type IMAGE / AUDIO / VIDEO / GENERIC, fire RSC-032 when `!reference.hasIntrinsicFallback && !isCoreMediaType(targetMimetype) && !targetResource.hasCoreMediaTypeFallback()`. HYPERLINK / STYLESHEET / TRACK / CITE are excluded.
- **Core Media Types** (`isCoreMediaType`, EPUB 3): images `image/gif`, `image/jpeg`, `image/png`, `image/webp`, `image/svg+xml`; audio `audio/mpeg`, `audio/mp4`, and `audio/ogg; codecs=opus` (Opus only); **all** `video/*`; fonts `font/ttf`, `font/otf`, `font/woff`, `font/woff2`, `application/font-sfnt`, `application/vnd.ms-opentype`, `application/font-woff`, `application/x-font-ttf`; blessed content/script/style/other: `application/xhtml+xml`, `image/svg+xml`, `text/javascript`, `application/javascript`, `application/ecmascript`, `text/css`, `application/pls+xml`, `application/smil+xml`.
- **`hasCoreMediaTypeFallback`** is epubcheck's manifest `fallback`-chain walk: true if the item itself or any item reachable via `fallback` is a Core Media Type (cycle-protected). Equivalent here to walking `ManifestItem.fallback` ids.
- **`hasIntrinsicFallback`** is set by epubcheck's content handler per referencing context. The cases this plan models:
  - `<img>` (src or srcset) inside `<picture>` → **true**; a bare `<img>` → false.
  - `<source>` inside `<picture>` → **true**.
  - `<source>` inside `<audio>` → **true** (epubcheck sets it true iff a sibling `<source>` is a Core Media Type; we conservatively set it true for all audio `<source>` — this can only under-report, never over-report).
  - `<source>` inside `<video>` → false (matches epubcheck; and `video/*` targets are core anyway).
  - bare `<audio src>` / `<video src>` / `<video poster>` → false.
  - `<object data>` → **true** (epubcheck sets it true iff the `<object>` has palpable fallback content; we conservatively set it true for all `<object>` — under-reports only).
  - `<iframe>` / `<embed>` / `<input>` / `<script>` → false.

  Conservative choices (audio `<source>`, `<object>`) trade exact fidelity for a guarantee of no false positives on valid EPUBs; both are recorded as known limitations.

### Current code this plan extends (already on `main`, post-Plan-9)

`src/parse/content.ts` — `ContentRef { url; type: RefType; loc }`; `RefType = 'hyperlink'|'image'|'audio'|'video'|'stylesheet'|'generic'|'cite'|'track'`. `addRefs(el, parent: string | undefined, attrs, refs)` builds every ref via local `push(url, type)` / `pushAll(urls, type)` helpers; `parent` is the parent element's tag name. `<source>` is already typed by `parent` (`audio`→audio, `video`→video, else→image). `collect` recurses with `child.name` as the parent.

`src/checks/content.ts` — `validateContentDocs` builds `manifest = manifestPathMap(pkg)`, `byId` (id→ManifestItem), `spineIdrefs` (Set of spine idrefs), and calls `checkReferences(doc, container, manifest, byId, spineIdrefs)`. Helpers present: `isBlessedContentType`, `hasFallbackToBlessed(item, byId)` (cycle-guarded `fallback`-chain walk), `inSpine`. The `checkReferences` resolve-tail is: `RSC-007` (missing) → else `RSC-008` (undeclared) → else `if (ref.type === 'hyperlink')` RSC-010/011.

`src/parse/opf.ts` — `ManifestItem { id?; href?; mediaType?; properties: string[]; fallback?; loc }`.

---

## Task 1: Catalog entry + implemented-ID registration

**Files:**
- Modify: `src/messages/catalog.ts` (add RSC-032)
- Modify: `src/messages/catalog.test.ts` (add one assertion)
- Modify: `test/fixtures/implemented.ts` (add `'RSC-032'`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: catalog entry `'RSC-032'` (ERROR), consumed by `msg('RSC-032', …)` in Task 3.

- [ ] **Step 1: Write the failing catalog test**

Add this `it(...)` inside the existing top-level `describe('CATALOG', …)` block in `src/messages/catalog.test.ts`:

```ts
  it('defines the foreign-resource-fallback message id', () => {
    expect(CATALOG['RSC-032']).toEqual({
      severity: 'ERROR',
      template: 'Fallback must be provided for foreign resources, but found none for resource "%1$s" of type "%2$s".',
    })
  })
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/messages/catalog.test.ts`
Expected: FAIL (`RSC-032` is `undefined`).

- [ ] **Step 3: Add the catalog entry**

In `src/messages/catalog.ts`, add this entry to `CATALOG`, immediately after the existing `'RSC-031'` entry. Do not modify any existing entry:

```ts
  'RSC-032': { severity: 'ERROR', template: 'Fallback must be provided for foreign resources, but found none for resource "%1$s" of type "%2$s".' },
```

- [ ] **Step 4: Register the implemented ID**

In `test/fixtures/implemented.ts`, add `'RSC-032'` to `IMPLEMENTED_IDS` on the existing `RSC-*` line, immediately after `'RSC-031'`. For example change:

```ts
  'RSC-010', 'RSC-011', 'RSC-012', 'RSC-013', 'RSC-030', 'RSC-031',
```

to:

```ts
  'RSC-010', 'RSC-011', 'RSC-012', 'RSC-013', 'RSC-030', 'RSC-031', 'RSC-032',
```

- [ ] **Step 5: Run catalog test + lint + typecheck**

Run: `npx vitest run src/messages/catalog.test.ts && npm run lint && npx tsc --noEmit`
Expected: all pass / clean.

- [ ] **Step 6: Commit**

```bash
git add src/messages/catalog.ts src/messages/catalog.test.ts test/fixtures/implemented.ts
git commit -m "feat: add RSC-032 message id"
```

---

## Task 2: Parser — record intrinsic-fallback context on each ref

**Files:**
- Modify: `src/parse/content.ts` (add `hasIntrinsicFallback` to `ContentRef`; set it in `addRefs`)
- Modify: `src/parse/content.test.ts` (add intrinsic-fallback assertions)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `ContentRef.hasIntrinsicFallback: boolean`, consumed by Task 3's RSC-032 branch.

**Note:** This task does not change any check; after it, `checkReferences` simply ignores the new field. The build stays green because the only constructor of `ContentRef` is `addRefs`, which this task updates to always set the field.

- [ ] **Step 1: Write the failing parser tests**

Append this block to `src/parse/content.test.ts` (it reuses the file's existing `item`, `container`, and `DOC` helpers):

```ts
describe('parseContent — intrinsic fallback', () => {
  const refFor = (body: string, url: string) => {
    const { doc } = parseContent(item, container(DOC(body)))
    return doc!.refs.find((r) => r.url === url)
  }

  it('marks <img> and <source> inside <picture> as having intrinsic fallback', () => {
    const body = '<picture><source srcset="a.webp"/><img src="a.png"/></picture>'
    expect(refFor(body, 'a.png')?.hasIntrinsicFallback).toBe(true)
    expect(refFor(body, 'a.webp')?.hasIntrinsicFallback).toBe(true)
  })

  it('marks a bare <img> as having no intrinsic fallback', () => {
    expect(refFor('<p><img src="b.png"/></p>', 'b.png')?.hasIntrinsicFallback).toBe(false)
  })

  it('marks <source> inside <audio> as having intrinsic fallback', () => {
    expect(refFor('<audio><source src="a.ogg"/></audio>', 'a.ogg')?.hasIntrinsicFallback).toBe(true)
  })

  it('marks <source> inside <video> and a bare <video src> as having no intrinsic fallback', () => {
    expect(refFor('<video src="v.mp4"><source src="v2.webm"/></video>', 'v2.webm')?.hasIntrinsicFallback).toBe(false)
    expect(refFor('<video src="v.mp4"></video>', 'v.mp4')?.hasIntrinsicFallback).toBe(false)
  })

  it('marks <object> as having intrinsic fallback and <iframe> as not', () => {
    expect(refFor('<object data="x.pdf"></object>', 'x.pdf')?.hasIntrinsicFallback).toBe(true)
    expect(refFor('<iframe src="y.xhtml"></iframe>', 'y.xhtml')?.hasIntrinsicFallback).toBe(false)
  })
})
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run src/parse/content.test.ts`
Expected: the new tests FAIL to compile/run (`hasIntrinsicFallback` does not exist on `ContentRef` yet). (TypeScript/vitest will error on the unknown property — that is the expected red state.)

- [ ] **Step 3: Add the field to `ContentRef`**

In `src/parse/content.ts`, change the `ContentRef` interface to:

```ts
export interface ContentRef {
  url: string
  type: RefType
  loc: Location
  /**
   * True when the referencing context itself supplies a fallback (e.g. an
   * <img> inside <picture>, a <source> inside <audio>, an <object> with
   * fallback content). Used to suppress RSC-032.
   */
  hasIntrinsicFallback: boolean
}
```

- [ ] **Step 4: Set the flag in `addRefs`**

In `src/parse/content.ts`, update `addRefs` so the `push`/`pushAll` helpers take an `intrinsic` flag (defaulting to `false`) and the picture/audio-source/object cases pass `true`. Replace the body of `addRefs` (from the `const push = …` line through the end of the `switch`) with:

```ts
  const push = (url: string | undefined, type: RefType, intrinsic = false): void => {
    if (url) refs.push({ url, type, loc: el.loc, hasIntrinsicFallback: intrinsic })
  }
  const pushAll = (urls: string[], type: RefType, intrinsic = false): void => {
    for (const url of urls) refs.push({ url, type, loc: el.loc, hasIntrinsicFallback: intrinsic })
  }
  const inPicture = parent === 'picture'

  switch (el.name) {
    case 'a':
    case 'area':
      push(attrs['href'] ?? attrs['xlink:href'], 'hyperlink')
      break
    case 'img':
      push(attrs['src'], 'image', inPicture)
      if (attrs['srcset']) pushAll(parseSrcset(attrs['srcset']), 'image', inPicture)
      break
    case 'image': // SVG <image>
      push(attrs['xlink:href'] ?? attrs['href'], 'image')
      break
    case 'source':
      if (attrs['srcset']) pushAll(parseSrcset(attrs['srcset']), 'image', inPicture)
      else if (parent === 'audio') push(attrs['src'], 'audio', true)
      else if (parent === 'video') push(attrs['src'], 'video', false)
      else push(attrs['src'], 'image', true) // <source> in <picture>
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
      push(attrs['data'], 'generic', true)
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
```

- [ ] **Step 5: Run the parser tests**

Run: `npx vitest run src/parse/content.test.ts`
Expected: PASS (the five new tests plus every pre-existing parser test — the existing `types source/@src by its audio/video parent` test still passes because ref `type` values are unchanged).

- [ ] **Step 6: Lint + typecheck + full suite**

Run: `npx vitest run && npm run lint && npx tsc --noEmit`
Expected: all green / clean. (The full suite must stay green: adding the field is additive and no check reads it yet.)

- [ ] **Step 7: Commit**

```bash
git add src/parse/content.ts src/parse/content.test.ts
git commit -m "feat: record intrinsic-fallback context on content references"
```

---

## Task 3: RSC-032 — foreign-resource fallback check

**Files:**
- Modify: `src/checks/content.ts` (add `CORE_MEDIA_TYPES`/`isCoreMediaType`; generalize the fallback-chain walk to `hasFallbackTo`; add the RSC-032 branch)
- Modify: `src/checks/content.test.ts` (add RSC-032 unit tests)
- Modify: `test/fixtures/corpus.ts` (add one content fixture)

**Interfaces:**
- Consumes: `'RSC-032'` catalog entry (Task 1); `ContentRef.hasIntrinsicFallback` (Task 2); the existing `byId`/`spineIdrefs` already threaded into `checkReferences` by Plan 9.
- Produces: RSC-032 emissions; no signature changes (uses the current `checkReferences(doc, container, manifest, byId, spineIdrefs)` signature).

- [ ] **Step 1: Write the failing unit tests**

Append this block to `src/checks/content.test.ts` (it reuses the file's `setup`, `enc`, `LOC` helpers):

```ts
describe('validateContentDocs — foreign-resource fallback', () => {
  it('RSC-032 for an <img> whose target is a non-core media type with no fallback', () => {
    const { pkg, container } = setup({ 'c1.xhtml': '<img src="diagram.tiff"/>' })
    pkg.manifest.push({ id: 'tiff', href: 'diagram.tiff', mediaType: 'image/tiff', properties: [], loc: LOC })
    container.resources.set('EPUB/diagram.tiff', { path: 'EPUB/diagram.tiff', bytes: enc('x'), compression: 'deflate' })
    expect(validateContentDocs(pkg, container).map((m) => m.id)).toContain('RSC-032')
  })

  it('no RSC-032 when the image target is a core media type', () => {
    const { pkg, container } = setup({ 'c1.xhtml': '<img src="ok.png"/>' })
    pkg.manifest.push({ id: 'png', href: 'ok.png', mediaType: 'image/png', properties: [], loc: LOC })
    container.resources.set('EPUB/ok.png', { path: 'EPUB/ok.png', bytes: enc('x'), compression: 'deflate' })
    expect(validateContentDocs(pkg, container).map((m) => m.id)).not.toContain('RSC-032')
  })

  it('no RSC-032 when the non-core target has a core-media-type fallback in the manifest', () => {
    const { pkg, container } = setup({ 'c1.xhtml': '<img src="diagram.tiff"/>' })
    pkg.manifest.push({ id: 'tiff', href: 'diagram.tiff', mediaType: 'image/tiff', properties: [], fallback: 'png', loc: LOC })
    pkg.manifest.push({ id: 'png', href: 'ok.png', mediaType: 'image/png', properties: [], loc: LOC })
    container.resources.set('EPUB/diagram.tiff', { path: 'EPUB/diagram.tiff', bytes: enc('x'), compression: 'deflate' })
    container.resources.set('EPUB/ok.png', { path: 'EPUB/ok.png', bytes: enc('x'), compression: 'deflate' })
    expect(validateContentDocs(pkg, container).map((m) => m.id)).not.toContain('RSC-032')
  })

  it('no RSC-032 for a non-core image inside <picture> (intrinsic fallback)', () => {
    const { pkg, container } = setup({ 'c1.xhtml': '<picture><img src="diagram.tiff"/></picture>' })
    pkg.manifest.push({ id: 'tiff', href: 'diagram.tiff', mediaType: 'image/tiff', properties: [], loc: LOC })
    container.resources.set('EPUB/diagram.tiff', { path: 'EPUB/diagram.tiff', bytes: enc('x'), compression: 'deflate' })
    expect(validateContentDocs(pkg, container).map((m) => m.id)).not.toContain('RSC-032')
  })

  it('no RSC-032 for a video/* target (all video types are core media types)', () => {
    const { pkg, container } = setup({ 'c1.xhtml': '<video src="m.mkv"></video>' })
    pkg.manifest.push({ id: 'vid', href: 'm.mkv', mediaType: 'video/x-matroska', properties: [], loc: LOC })
    container.resources.set('EPUB/m.mkv', { path: 'EPUB/m.mkv', bytes: enc('x'), compression: 'deflate' })
    expect(validateContentDocs(pkg, container).map((m) => m.id)).not.toContain('RSC-032')
  })
})
```

- [ ] **Step 2: Run them and confirm the firing one fails**

Run: `npx vitest run src/checks/content.test.ts`
Expected: the first test ("RSC-032 for an `<img>` …") FAILS (no RSC-032 yet); the four negative tests already pass (nothing emits RSC-032 yet).

- [ ] **Step 3: Add the Core-Media-Type predicate**

In `src/checks/content.ts`, add these module-level definitions next to the existing `BLESSED_CONTENT_TYPES` / helper block:

```ts
const CORE_MEDIA_TYPES: ReadonlySet<string> = new Set<string>([
  // images
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/svg+xml',
  // audio
  'audio/mpeg',
  'audio/mp4',
  // fonts
  'font/ttf',
  'font/otf',
  'font/woff',
  'font/woff2',
  'application/font-sfnt',
  'application/vnd.ms-opentype',
  'application/font-woff',
  'application/x-font-ttf',
  // blessed content / script / style / other core types
  'application/xhtml+xml',
  'text/javascript',
  'application/javascript',
  'application/ecmascript',
  'text/css',
  'application/pls+xml',
  'application/smil+xml',
])

function isCoreMediaType(mediaType: string | undefined): boolean {
  if (mediaType === undefined) return false
  if (CORE_MEDIA_TYPES.has(mediaType)) return true
  if (mediaType.startsWith('video/')) return true // all video/* are EPUB 3 core media types
  if (/^audio\/ogg\s*;\s*codecs=opus$/i.test(mediaType)) return true // Opus in Ogg
  return false
}
```

- [ ] **Step 4: Generalize the fallback-chain walk**

In `src/checks/content.ts`, replace the existing `hasFallbackToBlessed` function with a generic `hasFallbackTo` plus a thin `hasFallbackToBlessed` that delegates to it (behavior-preserving for the Plan-9 RSC-010 path):

```ts
// Walk the manifest `fallback` chain (each fallback is a manifest item id) and
// report whether any item in the chain satisfies the predicate. Cycle-guarded.
function hasFallbackTo(
  item: ManifestItem,
  byId: Map<string, ManifestItem>,
  predicate: (i: ManifestItem) => boolean,
): boolean {
  const seen = new Set<string>()
  let current = item.fallback
  while (current !== undefined && !seen.has(current)) {
    seen.add(current)
    const next = byId.get(current)
    if (next === undefined) return false
    if (predicate(next)) return true
    current = next.fallback
  }
  return false
}

function hasFallbackToBlessed(item: ManifestItem, byId: Map<string, ManifestItem>): boolean {
  return hasFallbackTo(item, byId, (i) => isBlessedContentType(i.mediaType))
}
```

- [ ] **Step 5: Add the RSC-032 branch**

In `src/checks/content.ts`, in the `checkReferences` resolve-tail, add a new branch AFTER the existing `else if (ref.type === 'hyperlink') { … }` branch (which handles RSC-010/011). The tail becomes:

```ts
    const target = resolvePath(doc.path, url)
    if (!getResource(container, target)) {
      messages.push(msg('RSC-007', ref.loc, url))
    } else if (!manifest.has(target)) {
      messages.push(msg('RSC-008', ref.loc, url))
    } else if (ref.type === 'hyperlink') {
      const item = manifest.get(target)
      if (item) {
        if (!isBlessedContentType(item.mediaType) && !hasFallbackToBlessed(item, byId)) {
          messages.push(msg('RSC-010', ref.loc))
        } else if (!inSpine(item, spineIdrefs)) {
          messages.push(msg('RSC-011', ref.loc))
        }
      }
    } else if (ref.type === 'image' || ref.type === 'audio' || ref.type === 'video' || ref.type === 'generic') {
      const item = manifest.get(target)
      if (
        item &&
        !ref.hasIntrinsicFallback &&
        !isCoreMediaType(item.mediaType) &&
        !hasFallbackTo(item, byId, (i) => isCoreMediaType(i.mediaType))
      ) {
        messages.push(msg('RSC-032', ref.loc, target, item.mediaType ?? ''))
      }
    }
```

(Only the final `else if (ref.type === 'image' || …)` branch is new; the RSC-007/008/hyperlink branches above are unchanged.)

- [ ] **Step 6: Run the content unit tests**

Run: `npx vitest run src/checks/content.test.ts`
Expected: PASS (all five new tests plus every pre-existing test, including the Plan-9 RSC-010/011 tests that exercise `hasFallbackToBlessed`).

- [ ] **Step 7: Add the corpus fixture**

In `test/fixtures/corpus.ts`, add this fixture to the `// ---- Content references ----` group, immediately after the `content-audio-remote-http` fixture:

```ts
  {
    name: 'content-foreign-resource-no-fallback',
    area: 'content',
    description: 'content img@src targets a non-core media type with no fallback (epubcheck RSC-032)',
    epub: buildEpub({
      files: {
        'EPUB/package.opf': OPF.replace(
          '</manifest>',
          '<item id="tiff" href="diagram.tiff" media-type="image/tiff"/></manifest>',
        ),
        'EPUB/diagram.tiff': 'TIFFDATA',
        'EPUB/content_001.xhtml': CONTENT.replace('<p>Hello</p>', '<p><img src="diagram.tiff"/></p>'),
      },
    }),
    expected: [E('RSC-032', 'ERROR')],
  },
```

- [ ] **Step 8: Run the FULL suite**

Run: `npx vitest run`
Expected: all green. **Cross-cutting check:** enabling RSC-032 can only affect a fixture that has a local, present, manifest-declared `image`/`audio`/`video`/`generic` content ref to a non-core media type with no fallback and no intrinsic fallback. The analysis for this plan found NO pre-existing fixture does so (existing content media refs are either remote → RSC-031 path, or absent; CSS `url()` refs go through the CSS checker, not `checkReferences`). If the harness reports that any fixture OTHER than the one added here changed output, STOP and report it — do not edit that fixture's `expected` to force green.

- [ ] **Step 9: Lint + typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add src/checks/content.ts src/checks/content.test.ts test/fixtures/corpus.ts
git commit -m "feat: require fallback for foreign content resources (RSC-032)"
```

---

## Known limitations / carry-forward (not in scope for this plan)

- **Audio `<source>` grouping:** epubcheck sets a `<source>`'s intrinsic fallback true iff a sibling `<source>` is a Core Media Type; we mark all audio `<source>` refs as having intrinsic fallback. Effect: an `<audio>` whose every `<source>` is a non-core type with no manifest fallback will NOT emit RSC-032 here (under-report only; never a false positive).
- **`<object>` palpable content:** epubcheck sets intrinsic fallback true only when the `<object>` has palpable fallback content; we mark all `<object data>` refs as having intrinsic fallback. Effect: an empty `<object>` to a foreign resource will NOT emit RSC-032 here (under-report only).
- The remaining Plan-9 carry-forward (RSC-011/RSC-012 cross-pass abort) is independent and still deferred.

## Self-review notes

- **Spec coverage:** RSC-032 catalog/severity/template → Task 1; intrinsic-fallback context → Task 2 (`ContentRef.hasIntrinsicFallback` + `addRefs`); Core-Media-Type predicate + fallback-chain walk + emission + fixture → Task 3.
- **Type consistency:** Task 2 adds `ContentRef.hasIntrinsicFallback: boolean` (set in `addRefs`); Task 3 reads it. `hasFallbackTo(item, byId, predicate)` generalizes Plan-9's `hasFallbackToBlessed`, which is rewritten to delegate (same behavior). `isCoreMediaType(mediaType: string | undefined)` matches the `ManifestItem.mediaType?` type. RSC-032 args: `msg('RSC-032', ref.loc, target, item.mediaType ?? '')` → `%1$s` = resolved target path, `%2$s` = media type.
- **No placeholders:** every code step is complete and verbatim.
- **Additive corpus:** one new fixture; no existing fixture's `expected` changes (verified by analysis; enforced by the exact-multiset harness in Step 8).
