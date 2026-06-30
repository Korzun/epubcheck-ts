# Plan 12 — CSS Completeness (CSS-003/004/005/007/015) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five epubcheck CSS-area rules: CSS-007 (`@font-face` src to a non-font resource), CSS-005 and CSS-015 (`<link>` alternate-stylesheet class/title rules), and CSS-003/CSS-004 (CSS file encoding must be UTF-8).

**Architecture:** Three independent areas. (1) CSS-007 is a pure extension of `checkReferences` in `src/checks/css.ts` for `font`-type refs, reusing a new shared blessed-font-type set. (2) CSS-005/CSS-015 are HTML `<link>`-element checks added as a new `checkLinkElements` pass over each content document's parsed tree in `src/checks/content.ts` (no parser change — `doc.root` already holds the `<link>` elements with their attributes). (3) CSS-003/CSS-004 are byte-level encoding detection in `src/parse/css.ts` before decoding, requiring a tiny additive enhancement to the `buildEpub` test helper so a fixture can supply raw (UTF-16) bytes.

**Tech Stack:** TypeScript (ESM, strict, `noUncheckedIndexedAccess`), vitest, css-tree. No new dependencies.

## Global Constraints

- ESM-only TypeScript; every relative import uses a `.js` specifier.
- Functional style, NO classes anywhere.
- Runtime-agnostic: zero Node-only APIs (only `TextEncoder`/`TextDecoder`/`Uint8Array`/`Map`/`Set`/`RegExp`/standard web APIs).
- Unit tests are colocated as `*.test.ts` beside source; integration fixtures live under `test/`.
- Types are colocated with the code that produces them; no types-only modules (a small shared constants/predicate util is fine).
- No new runtime dependencies.
- Message IDs reuse epubcheck's vocabulary; severities come from the catalog (`src/messages/catalog.ts`).
- `validateEpub` must never throw.
- The integration corpus (`test/integration/corpus.test.ts`) uses an EXACT-MULTISET match: each fixture's `expected` set must exactly equal the validator's actual output. Every implemented ID must be in `test/fixtures/implemented.ts`.

### Verified epubcheck semantics (source-verified against `w3c/epubcheck`: `MessageBundle.properties`, `DefaultSeverities.java`, `CSSChecker.java`, `OPSHandler30.java`, `OPFChecker30.java`)

- **CSS-003** — template `CSS document is encoded in UTF-16. It should be encoded in UTF-8 instead.` (no args), severity **WARNING**. Trigger: the CSS file's encoding (from a BOM or an `@charset` declaration) starts with `utf-16`.
- **CSS-004** — template `CSS documents must be encoded in UTF-8, detected %1$s;` (`%1$s` = detected encoding name, includes the trailing semicolon literally), severity **ERROR**. Trigger: the CSS file's encoding (BOM or `@charset`) is not `utf-8` and not a `utf-16*` (which is CSS-003).
- **CSS-005** — template `Conflicting alternate style tags found: %1$s.` (`%1$s` = the `class` attribute value), severity **USAGE**. Trigger: a `<link>` element whose `class` attribute contains conflicting EPUB alternate-style-sheet vocabulary tokens — both `vertical` and `horizontal`, or both `day` and `night`.
- **CSS-007** — template `Font-face reference "%1$s" refers to non-standard font type "%2$s".` (`%1$s` = the font URL from the `src`, `%2$s` = the target's manifest media-type), severity **INFO**. Trigger: an `@font-face` `src` URL whose **local, manifest-declared** target's media-type is not a blessed font type.
- **CSS-015** — template `Alternative style sheets must have a title.` (no args), severity **ERROR**. Trigger: a `<link>` element whose `rel` (whitespace-tokenized) contains both `alternate` and `stylesheet`, and whose `title` attribute is missing or empty.

Blessed font types (epubcheck `OPFChecker30.isBlessedFontType`): `font/ttf`, `font/otf`, `font/woff`, `font/woff2`, `application/font-sfnt`, `application/vnd.ms-opentype`, `application/font-woff`, `application/x-font-ttf` — the same eight already embedded in `CORE_MEDIA_TYPES` in `src/checks/content.ts`.

### Current code this plan extends (already on `main`, post-Plan-11)

`src/parse/css.ts` — `parseCss(item, container)` does `const text = new TextDecoder('utf-8').decode(resource.bytes)` (no BOM/charset handling) then `analyzeCss(text, path, 'stylesheet')`. `@font-face` `src` URLs are collected as `CssRef` with `type: 'font'`.

`src/checks/css.ts` — `checkReferences(css, container, manifest)` per `ref` of `css.refs`: `file:` → RSC-030; `import` with `#` → RSC-013; remote → font over non-HTTPS → RSC-031, else RSC-006; `hasScheme` → skip; else resolve `target` → RSC-007 (missing) / RSC-008 (undeclared). No media-type check on font refs.

`src/checks/content.ts` — `validateContentDocs` per-doc loop runs `checkReferences`, `checkFragments`, `checkElements`, inline-CSS. `<link rel="stylesheet">` is parsed (href only) in `src/parse/content.ts` `addRefs`. `ContentDocument.root` is the parsed XML tree; `findDescendants(root, name)` (from `../io/xml.js`) returns matching elements with `.attrs` and `.loc`.

`test/fixtures/build.ts` — `buildEpub(o)` with `o.files?: Record<string, string>` (text encoded UTF-8 via `enc`); `cssEpub(css, extra)` declares `EPUB/style.css` (text/css) and links it from the content doc.

---

## Task 1: Catalog entries + implemented-ID registration

**Files:**
- Modify: `src/messages/catalog.ts` (add CSS-003, CSS-004, CSS-005, CSS-007, CSS-015)
- Modify: `src/messages/catalog.test.ts` (add one assertion block)
- Modify: `test/fixtures/implemented.ts` (add the five ids)

**Interfaces:**
- Consumes: nothing.
- Produces: catalog entries consumed by `msg(...)` in Tasks 2–4.

- [ ] **Step 1: Write the failing catalog test**

Add inside the existing top-level `describe('CATALOG', …)` block in `src/messages/catalog.test.ts`:

```ts
  it('defines the CSS-completeness message ids', () => {
    expect(CATALOG['CSS-003']).toEqual({ severity: 'WARNING', template: 'CSS document is encoded in UTF-16. It should be encoded in UTF-8 instead.' })
    expect(CATALOG['CSS-004']).toEqual({ severity: 'ERROR', template: 'CSS documents must be encoded in UTF-8, detected %1$s;' })
    expect(CATALOG['CSS-005']).toEqual({ severity: 'USAGE', template: 'Conflicting alternate style tags found: %1$s.' })
    expect(CATALOG['CSS-007']).toEqual({ severity: 'INFO', template: 'Font-face reference "%1$s" refers to non-standard font type "%2$s".' })
    expect(CATALOG['CSS-015']).toEqual({ severity: 'ERROR', template: 'Alternative style sheets must have a title.' })
  })
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/messages/catalog.test.ts`
Expected: FAIL (all five are `undefined`).

- [ ] **Step 3: Add the catalog entries**

In `src/messages/catalog.ts`, add these entries next to the other `CSS-0xx` entries (do not modify existing entries):

```ts
  'CSS-003': { severity: 'WARNING', template: 'CSS document is encoded in UTF-16. It should be encoded in UTF-8 instead.' },
  'CSS-004': { severity: 'ERROR', template: 'CSS documents must be encoded in UTF-8, detected %1$s;' },
  'CSS-005': { severity: 'USAGE', template: 'Conflicting alternate style tags found: %1$s.' },
  'CSS-007': { severity: 'INFO', template: 'Font-face reference "%1$s" refers to non-standard font type "%2$s".' },
  'CSS-015': { severity: 'ERROR', template: 'Alternative style sheets must have a title.' },
```

- [ ] **Step 4: Register the implemented IDs**

In `test/fixtures/implemented.ts`, add `'CSS-003'`, `'CSS-004'`, `'CSS-005'`, `'CSS-007'`, `'CSS-015'` to `IMPLEMENTED_IDS` on the existing CSS line (keeping the already-present `'CSS-001'`, `'CSS-002'`, `'CSS-006'`, `'CSS-008'`, `'CSS-019'`). Resulting CSS line (order not significant, but keep it readable):

```ts
  'CSS-001', 'CSS-002', 'CSS-003', 'CSS-004', 'CSS-005', 'CSS-006', 'CSS-007', 'CSS-008', 'CSS-015', 'CSS-019',
```

- [ ] **Step 5: Run catalog test + lint + typecheck**

Run: `npx vitest run src/messages/catalog.test.ts && npm run lint && npx tsc --noEmit`
Expected: all pass / clean.

- [ ] **Step 6: Commit**

```bash
git add src/messages/catalog.ts src/messages/catalog.test.ts test/fixtures/implemented.ts
git commit -m "feat: add CSS-003/004/005/007/015 message ids"
```

---

## Task 2: CSS-007 — non-standard font-face resource type

**Files:**
- Create: `src/util/media-types.ts` (shared `BLESSED_FONT_TYPES` + `isBlessedFontType`)
- Modify: `src/checks/content.ts` (build `CORE_MEDIA_TYPES` from the shared set — DRY)
- Modify: `src/checks/css.ts` (CSS-007 branch in `checkReferences`)
- Modify: `src/checks/css.test.ts` (unit tests)
- Modify: `test/fixtures/corpus.ts` (one fixture)

**Interfaces:**
- Consumes: `'CSS-007'` catalog entry (Task 1).
- Produces: `BLESSED_FONT_TYPES: ReadonlySet<string>` and `isBlessedFontType(mediaType?): boolean` from `src/util/media-types.js`.

- [ ] **Step 1: Write the failing unit tests**

Append to `src/checks/css.test.ts` (the `setup` helper declares `declared` resources with media-type `application/octet-stream`, which is a non-font type):

```ts
describe('validateCssDocs — font-face type (CSS-007)', () => {
  it('CSS-007 when a @font-face src targets a non-font media type', () => {
    const out = ids('@font-face { font-family: F; src: url(f.bin); }', { present: ['f.bin'], declared: ['f.bin'] })
    expect(out).toContain('CSS-007')
  })

  it('no CSS-007 when the @font-face src targets a blessed font type', () => {
    const { pkg, container } = setup('@font-face { font-family: F; src: url(f.woff2); }')
    pkg.manifest.push({ id: 'fnt', href: 'f.woff2', mediaType: 'font/woff2', properties: [], loc: LOC })
    container.resources.set('EPUB/f.woff2', { path: 'EPUB/f.woff2', bytes: enc('x'), compression: 'deflate' })
    expect(validateCssDocs(pkg, container).map((m) => m.id)).not.toContain('CSS-007')
  })

  it('no CSS-007 for a non-font url() (only @font-face src is checked)', () => {
    const out = ids('body { background: url(pic.bin); }', { present: ['pic.bin'], declared: ['pic.bin'] })
    expect(out).not.toContain('CSS-007')
  })
})
```

- [ ] **Step 2: Run them and confirm the first fails**

Run: `npx vitest run src/checks/css.test.ts`
Expected: "CSS-007 when a @font-face src targets a non-font media type" FAILS; the two negatives pass.

- [ ] **Step 3: Create the shared media-types util**

Create `src/util/media-types.ts`:

```ts
/** EPUB 3 blessed font media types (epubcheck OPFChecker30.isBlessedFontType). */
export const BLESSED_FONT_TYPES: ReadonlySet<string> = new Set<string>([
  'font/ttf',
  'font/otf',
  'font/woff',
  'font/woff2',
  'application/font-sfnt',
  'application/vnd.ms-opentype',
  'application/font-woff',
  'application/x-font-ttf',
])

export function isBlessedFontType(mediaType: string | undefined): boolean {
  return mediaType !== undefined && BLESSED_FONT_TYPES.has(mediaType)
}
```

- [ ] **Step 4: DRY — build `CORE_MEDIA_TYPES` from the shared set**

In `src/checks/content.ts`, add the import and replace the eight inline font entries in `CORE_MEDIA_TYPES` with a spread of `BLESSED_FONT_TYPES`. Add near the other imports:

```ts
import { BLESSED_FONT_TYPES } from '../util/media-types.js'
```

and change the `CORE_MEDIA_TYPES` definition's font section so the whole set reads:

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
  // fonts (shared blessed-font set)
  ...BLESSED_FONT_TYPES,
  // blessed content / script / style / other core types
  'application/xhtml+xml',
  'text/javascript',
  'application/javascript',
  'application/ecmascript',
  'text/css',
  'application/pls+xml',
  'application/smil+xml',
])
```

(This is behavior-preserving — the eight font strings are identical; the Plan-10 RSC-032 tests must still pass.)

- [ ] **Step 5: Add the CSS-007 branch**

In `src/checks/css.ts`, add the import:

```ts
import { isBlessedFontType } from '../util/media-types.js'
```

Then in `checkReferences`, change the resolve-tail from:

```ts
    const target = resolvePath(css.path, url) // resolvePath strips the fragment
    if (!getResource(container, target)) {
      messages.push(msg('RSC-007', ref.loc, url))
    } else if (!manifest.has(target)) {
      messages.push(msg('RSC-008', ref.loc, url))
    }
```

to:

```ts
    const target = resolvePath(css.path, url) // resolvePath strips the fragment
    if (!getResource(container, target)) {
      messages.push(msg('RSC-007', ref.loc, url))
    } else if (!manifest.has(target)) {
      messages.push(msg('RSC-008', ref.loc, url))
    } else if (ref.type === 'font') {
      const item = manifest.get(target)
      if (item && !isBlessedFontType(item.mediaType)) {
        messages.push(msg('CSS-007', ref.loc, url, item.mediaType ?? ''))
      }
    }
```

- [ ] **Step 6: Run the CSS unit tests + the content tests**

Run: `npx vitest run src/checks/css.test.ts src/checks/content.test.ts`
Expected: PASS (new CSS-007 tests + all pre-existing CSS tests + the Plan-10 RSC-032 tests that depend on `CORE_MEDIA_TYPES`).

- [ ] **Step 7: Add the corpus fixture**

In `test/fixtures/corpus.ts`, add this fixture to the `// ---- CSS ----` group (after `css-font-remote-http`):

```ts
  {
    name: 'css-font-face-nonstandard-type',
    area: 'css',
    description: '@font-face src targets a resource whose manifest media-type is not a font type (epubcheck CSS-007)',
    epub: buildEpub({
      files: {
        'EPUB/package.opf': OPF.replace(
          '</manifest>',
          '<item id="css" href="style.css" media-type="text/css"/>' +
            '<item id="fnt" href="f.bin" media-type="application/octet-stream"/></manifest>',
        ),
        'EPUB/content_001.xhtml': CONTENT.replace(
          '<head><title>t</title></head>',
          '<head><title>t</title><link rel="stylesheet" href="style.css"/></head>',
        ),
        'EPUB/style.css': '@font-face { font-family: F; src: url(f.bin); }',
        'EPUB/f.bin': 'FONTBYTES',
      },
    }),
    expected: [E('CSS-007', 'INFO')],
  },
```

- [ ] **Step 8: Run the FULL suite + lint + typecheck**

Run: `npx vitest run && npm run lint && npx tsc --noEmit`
Expected: all green / clean. CSS-007 only fires for a local, declared, present `@font-face` src whose media-type is not a blessed font type — no existing fixture has such a resource (the `css-font-remote-http` fixture is remote → RSC-031 path, not CSS-007). If any fixture other than the new one changes output, STOP and report.

- [ ] **Step 9: Commit**

```bash
git add src/util/media-types.ts src/checks/content.ts src/checks/css.ts src/checks/css.test.ts test/fixtures/corpus.ts
git commit -m "feat: flag @font-face references to non-font resource types (CSS-007)"
```

---

## Task 3: CSS-005 + CSS-015 — `<link>` alternate-stylesheet rules

**Files:**
- Modify: `src/checks/content.ts` (new `checkLinkElements`; call it from `validateContentDocs`)
- Modify: `src/checks/content.test.ts` (unit tests)
- Modify: `test/fixtures/corpus.ts` (two fixtures)

**Interfaces:**
- Consumes: `'CSS-005'`, `'CSS-015'` catalog entries (Task 1).
- Produces: `validateContentDocs` now emits CSS-005/CSS-015 for content/nav `<link>` elements.

- [ ] **Step 1: Write the failing unit tests**

Append to `src/checks/content.test.ts` (reuses the file's `setup`/`ids` helpers; the `ids` helper runs `validateContentDocs` over content docs built from `<body>` fragments — note `<link>` lives in `<head>`, so these tests put the link in the body, which `findDescendants` still finds since it walks the whole document):

```ts
describe('validateContentDocs — link elements (CSS-005/015)', () => {
  it('CSS-015 when an alternate stylesheet link has no title', () => {
    expect(ids({ 'c1.xhtml': '<link rel="alternate stylesheet" href="alt.css"/>' })).toContain('CSS-015')
  })

  it('no CSS-015 when the alternate stylesheet link has a title', () => {
    expect(ids({ 'c1.xhtml': '<link rel="alternate stylesheet" href="alt.css" title="Night"/>' })).not.toContain('CSS-015')
  })

  it('no CSS-015 for an ordinary (non-alternate) stylesheet link', () => {
    expect(ids({ 'c1.xhtml': '<link rel="stylesheet" href="s.css"/>' })).not.toContain('CSS-015')
  })

  it('CSS-005 when a link class has conflicting alternate-style vocabulary', () => {
    expect(ids({ 'c1.xhtml': '<link rel="stylesheet" href="s.css" class="vertical horizontal"/>' })).toContain('CSS-005')
    expect(ids({ 'c1.xhtml': '<link rel="stylesheet" href="s.css" class="day night"/>' })).toContain('CSS-005')
  })

  it('no CSS-005 for non-conflicting link classes', () => {
    expect(ids({ 'c1.xhtml': '<link rel="stylesheet" href="s.css" class="vertical day"/>' })).not.toContain('CSS-005')
  })
})
```

(Note: these links reference `alt.css`/`s.css` which aren't declared/present, so the result also contains RSC-007 — the tests use `toContain`/`not.toContain` to isolate CSS-005/015. That's intentional.)

- [ ] **Step 2: Run them and confirm the CSS-005/015 cases fail**

Run: `npx vitest run src/checks/content.test.ts`
Expected: the CSS-015 and CSS-005 positive assertions FAIL (not emitted yet); the negatives pass.

- [ ] **Step 3: Add the `checkLinkElements` function**

In `src/checks/content.ts`, ensure `findDescendants` is imported from `../io/xml.js` (it is currently only `import type { XmlNode } from '../io/xml.js'` — change to a combined import):

```ts
import { findDescendants, type XmlNode } from '../io/xml.js'
```

Then add this function (place it near `checkElements`):

```ts
// EPUB alternate-style-sheet vocabulary terms that conflict when both appear.
const ALTCSS_CONFLICTS: ReadonlyArray<readonly [string, string]> = [
  ['vertical', 'horizontal'],
  ['day', 'night'],
]

function checkLinkElements(doc: ContentDocument): Message[] {
  const messages: Message[] = []
  for (const link of findDescendants(doc.root, 'link')) {
    const attrs = link.attrs ?? {}
    const rel = (attrs['rel'] ?? '').split(/\s+/).filter(Boolean)
    if (rel.includes('alternate') && rel.includes('stylesheet') && (attrs['title'] ?? '').trim() === '') {
      messages.push(msg('CSS-015', link.loc))
    }
    const classes = new Set((attrs['class'] ?? '').split(/\s+/).filter(Boolean))
    if (ALTCSS_CONFLICTS.some(([a, b]) => classes.has(a) && classes.has(b))) {
      messages.push(msg('CSS-005', link.loc, attrs['class'] ?? ''))
    }
  }
  return messages
}
```

- [ ] **Step 4: Call it from `validateContentDocs`**

In `src/checks/content.ts`, in the per-doc loop, add the call alongside the other per-doc checks (e.g. right after `messages.push(...checkElements(doc))`):

```ts
    messages.push(...checkLinkElements(doc))
```

- [ ] **Step 5: Run the content unit tests**

Run: `npx vitest run src/checks/content.test.ts`
Expected: PASS (the five new assertions plus every pre-existing content test).

- [ ] **Step 6: Add the two corpus fixtures**

In `test/fixtures/corpus.ts`, add to the `// ---- CSS ----` group (after the Task-2 fixture):

```ts
  {
    name: 'css-alternate-stylesheet-no-title',
    area: 'css',
    description: 'an alternate stylesheet <link> has no title (epubcheck CSS-015)',
    epub: cssEpub('p { color: red; }', {
      'EPUB/content_001.xhtml': CONTENT.replace(
        '<head><title>t</title></head>',
        '<head><title>t</title><link rel="stylesheet" href="style.css"/><link rel="alternate stylesheet" href="style.css"/></head>',
      ),
    }),
    expected: [E('CSS-015', 'ERROR')],
  },
  {
    name: 'css-link-conflicting-class',
    area: 'css',
    description: 'a stylesheet <link> has conflicting alternate-style class tokens (epubcheck CSS-005)',
    epub: cssEpub('p { color: red; }', {
      'EPUB/content_001.xhtml': CONTENT.replace(
        '<head><title>t</title></head>',
        '<head><title>t</title><link rel="stylesheet" href="style.css" class="day night"/></head>',
      ),
    }),
    expected: [E('CSS-005', 'USAGE')],
  },
```

Note on the CSS-015 fixture: `cssEpub`'s `extra` map overrides `EPUB/content_001.xhtml` entirely, so the override must itself include the ordinary `<link rel="stylesheet" href="style.css"/>` (kept so `style.css` is still referenced and no RSC rule fires) plus the title-less alternate link. The alternate link reuses `style.css` (declared + present) so only CSS-015 is emitted.

- [ ] **Step 7: Run the FULL suite + lint + typecheck**

Run: `npx vitest run && npm run lint && npx tsc --noEmit`
Expected: all green / clean. No pre-existing fixture has an `<link>` with `rel="alternate stylesheet"` or a conflicting `class`, so only the two new fixtures are affected. If any other fixture changes output, STOP and report.

- [ ] **Step 8: Commit**

```bash
git add src/checks/content.ts src/checks/content.test.ts test/fixtures/corpus.ts
git commit -m "feat: check <link> alternate-stylesheet title and conflicting class vocab (CSS-005, CSS-015)"
```

---

## Task 4: CSS-003 + CSS-004 — CSS file encoding

**Files:**
- Modify: `test/fixtures/build.ts` (allow raw-byte file contents)
- Modify: `src/parse/css.ts` (detect encoding before decoding; emit CSS-003/004)
- Modify: `src/parse/css.test.ts` (unit tests)
- Modify: `test/fixtures/corpus.ts` (two fixtures)

**Interfaces:**
- Consumes: `'CSS-003'`, `'CSS-004'` catalog entries (Task 1).
- Produces: `parseCss` returns `{ messages: [CSS-003 | CSS-004] }` (no `css` document) when the CSS file's declared encoding is not UTF-8.

- [ ] **Step 1: Allow raw bytes in `buildEpub` (additive helper change)**

In `test/fixtures/build.ts`, widen the file-content type so a fixture can supply raw bytes (needed for a UTF-16 BOM). Change the `EpubOverrides.files` type and the `base`/`merged`/encoding lines:

```ts
export interface EpubOverrides {
  /** container-path → text or raw bytes; overrides/extends the baseline. */
  files?: Record<string, string | Uint8Array>
  /** container-paths to remove from the baseline (e.g. 'mimetype'). */
  omit?: string[]
  /** compress the mimetype entry (deflate) instead of storing it (for PKG-005). */
  mimetypeDeflate?: boolean
}

export function buildEpub(o: EpubOverrides = {}): Uint8Array {
  const base: Record<string, string | Uint8Array> = {
    mimetype: MIMETYPE,
    'META-INF/container.xml': CONTAINER,
    'EPUB/package.opf': OPF,
    'EPUB/nav.xhtml': NAV,
    'EPUB/content_001.xhtml': CONTENT,
  }
  const merged: Record<string, string | Uint8Array> = { ...base, ...(o.files ?? {}) }
  for (const k of o.omit ?? []) delete merged[k]

  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {}
  for (const [path, content] of Object.entries(merged)) {
    const level: 0 | 6 = path === 'mimetype' ? (o.mimetypeDeflate ? 6 : 0) : 6
    entries[path] = [typeof content === 'string' ? enc(content) : content, { level }]
  }
  return zipSync(entries)
}
```

(This is additive — all existing string callers are unaffected.)

- [ ] **Step 2: Write the failing unit tests**

Append to `src/parse/css.test.ts` (it has `enc`, `item`, `container` helpers; add a raw-bytes container helper inline):

```ts
describe('parseCss — encoding', () => {
  function bytesContainer(bytes: Uint8Array, path = 'EPUB/styles/s.css'): EpubContainer {
    const resources = new Map<string, Resource>()
    resources.set(path, { path, bytes, compression: 'deflate' })
    return { resources, rootfiles: ['EPUB/package.opf'], hasEncryption: false }
  }

  it('CSS-003 for a UTF-16 (BOM) stylesheet and returns no document', () => {
    const { css, messages } = parseCss(item, bytesContainer(new Uint8Array([0xff, 0xfe, 0x70, 0x00])))
    expect(messages.map((m) => m.id)).toContain('CSS-003')
    expect(css).toBeUndefined()
  })

  it('CSS-004 for a non-UTF-8 @charset and returns no document', () => {
    const { css, messages } = parseCss(item, container('@charset "iso-8859-1";\np { color: red; }'))
    expect(messages.map((m) => m.id)).toContain('CSS-004')
    expect(css).toBeUndefined()
  })

  it('no encoding message for a plain UTF-8 stylesheet', () => {
    const { messages } = parseCss(item, container('p { color: red; }'))
    expect(messages.map((m) => m.id)).not.toContain('CSS-003')
    expect(messages.map((m) => m.id)).not.toContain('CSS-004')
  })

  it('no encoding message for a UTF-8 @charset', () => {
    const { css, messages } = parseCss(item, container('@charset "utf-8";\np { color: red; }'))
    expect(messages.map((m) => m.id)).not.toContain('CSS-004')
    expect(css).toBeDefined()
  })
})
```

- [ ] **Step 3: Run them and confirm the encoding cases fail**

Run: `npx vitest run src/parse/css.test.ts`
Expected: the CSS-003 and CSS-004 assertions FAIL (not emitted yet); the UTF-8 negatives pass.

- [ ] **Step 4: Add encoding detection to `parseCss`**

In `src/parse/css.ts`, add a detection helper and use it in `parseCss`. Add the helper above `parseCss`:

```ts
/**
 * Detect a CSS file's declared encoding from a leading BOM or an `@charset`
 * rule (which, per the CSS syntax, must be the very first bytes). Returns the
 * lowercased encoding name, or undefined when none is declared (assume UTF-8).
 */
function detectCssCharset(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be'
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le'
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8' // UTF-8 BOM
  const prefix = '@charset "'
  let head = ''
  for (let i = 0; i < Math.min(bytes.length, 100); i++) head += String.fromCharCode(bytes[i] ?? 0)
  if (head.startsWith(prefix)) {
    const end = head.indexOf('"', prefix.length)
    if (end > prefix.length) return head.slice(prefix.length, end).toLowerCase()
  }
  return undefined
}
```

Then change `parseCss`'s decode section from:

```ts
  const text = new TextDecoder('utf-8').decode(resource.bytes)
  const a = analyzeCss(text, path, 'stylesheet')
```

to:

```ts
  const charset = detectCssCharset(resource.bytes)
  if (charset !== undefined && charset !== 'utf-8') {
    // Non-UTF-8 CSS: report the encoding rule and skip parsing (decoding as
    // UTF-8 would produce mojibake and spurious CSS-008 errors).
    const message = charset.startsWith('utf-16')
      ? msg('CSS-003', { path })
      : msg('CSS-004', { path }, charset)
    return { messages: [message] }
  }

  const text = new TextDecoder('utf-8').decode(resource.bytes)
  const a = analyzeCss(text, path, 'stylesheet')
```

- [ ] **Step 5: Run the parse-css unit tests**

Run: `npx vitest run src/parse/css.test.ts`
Expected: PASS (all four new tests plus every pre-existing parse-css test).

- [ ] **Step 6: Add the two corpus fixtures**

In `test/fixtures/corpus.ts`, add to the `// ---- CSS ----` group (after the Task-3 fixtures):

```ts
  {
    name: 'css-charset-non-utf8',
    area: 'css',
    description: 'CSS @charset declares a non-UTF-8 encoding (epubcheck CSS-004)',
    epub: cssEpub('@charset "iso-8859-1";\np { color: red; }'),
    expected: [E('CSS-004', 'ERROR')],
  },
  {
    name: 'css-encoding-utf16',
    area: 'css',
    description: 'CSS file is UTF-16 (BOM) and should be UTF-8 (epubcheck CSS-003)',
    epub: buildEpub({
      files: {
        'EPUB/package.opf': OPF.replace(
          '</manifest>',
          '<item id="css" href="style.css" media-type="text/css"/></manifest>',
        ),
        'EPUB/content_001.xhtml': CONTENT.replace(
          '<head><title>t</title></head>',
          '<head><title>t</title><link rel="stylesheet" href="style.css"/></head>',
        ),
        'EPUB/style.css': new Uint8Array([0xff, 0xfe, 0x70, 0x00, 0x7b, 0x00, 0x7d, 0x00]), // UTF-16LE BOM + "p{}"
      },
    }),
    expected: [E('CSS-003', 'WARNING')],
  },
```

- [ ] **Step 7: Run the FULL suite + lint + typecheck**

Run: `npx vitest run && npm run lint && npx tsc --noEmit`
Expected: all green / clean. `css-charset-non-utf8` → `[CSS-004]` (parse skipped, no other CSS message); `css-encoding-utf16` → `[CSS-003]`. No existing fixture supplies non-UTF-8 CSS, so nothing else changes. If any other fixture changes output, STOP and report.

- [ ] **Step 8: Commit**

```bash
git add test/fixtures/build.ts src/parse/css.ts src/parse/css.test.ts test/fixtures/corpus.ts
git commit -m "feat: require UTF-8 encoding for CSS documents (CSS-003, CSS-004)"
```

---

## Known limitations / carry-forward (not in scope for this plan)

- CSS-003/CSS-004 detect encoding only from a leading BOM or a byte-level `@charset` rule. A UTF-16 file with no BOM and no `@charset` is not detected (it would decode to mojibake and likely produce CSS-008) — epubcheck's detection is also BOM/`@charset`-driven, so this matches in practice.
- CSS-005 checks the conflicting-vocabulary pairs (`vertical`/`horizontal`, `day`/`night`) on `<link class>`; it does not model the full EPUB alternate-style-sheet vocabulary beyond those conflict pairs (which are the only ones epubcheck flags as conflicting).
- Prior carry-forwards (Plan-9 RSC-011/012 cross-pass; Plan-10 audio-source/object intrinsic fallback; Plan-11 NAV-011 document-order) remain deferred.

## Self-review notes

- **Spec coverage:** catalog (5 ids) → Task 1; CSS-007 + shared font-type util → Task 2; CSS-005/CSS-015 (`checkLinkElements`) → Task 3; CSS-003/CSS-004 (encoding) + `buildEpub` bytes → Task 4.
- **Type consistency:** `isBlessedFontType(mediaType?: string)` / `BLESSED_FONT_TYPES` from `src/util/media-types.js` used by both `css.ts` (CSS-007) and `content.ts` (`CORE_MEDIA_TYPES`). CSS-007 args `(url, item.mediaType ?? '')`; CSS-004 arg `(charset)`; CSS-005 arg `(classValue)`. `checkLinkElements(doc)` uses `findDescendants(doc.root, 'link')`.
- **No placeholders:** every code step is complete and verbatim.
- **Corpus:** five new fixtures across the four tasks; no existing fixture's expected changes (verified by analysis; enforced by the exact-multiset harness).
