# Plan 9 — Content Reference Integrity (RSC-010, RSC-011, RSC-031) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the content-document reference checks in `src/checks/content.ts` to emit three epubcheck reference-integrity messages: RSC-010 (hyperlink to a non-content-document resource type), RSC-011 (hyperlink to a content document that is not in the spine), and RSC-031 (remote reference that should use HTTPS) for content `audio`/`video` refs.

**Architecture:** All three rules slot into the existing `checkReferences` loop in `src/checks/content.ts`, which already classifies each `ContentRef` and resolves it against the container and the manifest path map. RSC-010/011 add a branch for `hyperlink` refs whose target exists and is declared, gated by a small "blessed content-document type" predicate plus a manifest `fallback`-chain walk and a spine-membership set. RSC-031 adds an HTTPS check inside the existing remote-reference branch (mirroring the already-shipped CSS implementation). No parser changes are needed — `parseContent` already collects `refs` with `type` and `loc`, and the OPF model already exposes `manifest`, `spine[].idref`, and `ManifestItem.fallback`.

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
- The integration corpus (`test/integration/corpus.test.ts`) uses an EXACT-MULTISET match: each fixture's `expected` set must exactly equal the validator's actual output. Every implemented ID must be in `test/fixtures/implemented.ts`.

### Verified epubcheck semantics (from `w3c/epubcheck` `MessageBundle.properties` + `DefaultSeverities.java` + `ResourceReferencesChecker.java`)

- **RSC-010** — template `Reference to non-standard resource type found.` (no positional args), severity **ERROR**. Fires for a `HYPERLINK` reference (`<a href>`, `<area href>`) whose **local** target resource has a media type that is not a "blessed" content-document type AND that has no content-document fallback in the manifest. (A hyperlink to e.g. `photo.jpg` fires it; a hyperlink to `chapter.xhtml` does not.)
- **RSC-011** — template `Found a reference to a resource that is not a spine item.` (no positional args), severity **ERROR**. Fires for a `HYPERLINK` reference whose local target is a blessed content document (so RSC-010 did not fire) but is **not in the spine**.
- **RSC-031** — template `Remote resource references should use HTTPS, but found "%1$s".` (`%1$s` = the URL), severity **WARNING**. **Already in the catalog and already implemented for CSS** (`src/checks/css.ts`). This plan extends it to content references: a remote, non-HYPERLINK reference whose scheme is neither `https` nor `file` (in practice: a remote `audio`/`video`/`cite` ref over `http://`).

"Blessed content-document type" for our purposes (EPUB 3) = `application/xhtml+xml`, `image/svg+xml`, plus the deprecated-blessed `text/x-oeb1-document` and `text/html`.

### Current code this plan extends (already on `main`)

`src/checks/content.ts`:
- `validateContentDocs(pkg, container)` builds `const manifest = manifestPathMap(pkg)`, parses every non-nav XHTML doc into `docs`, then per doc calls `checkReferences(doc, container, manifest)`, `checkFragments(...)`, `checkElements(...)`, and inline-CSS validation.
- `checkReferences(doc, container, manifest)` loop, per `ref` of `doc.refs`:
  - `url.startsWith('#')` → continue (same-document fragment).
  - `isRemote(url)` → `RSC-006` unless `REMOTE_ALLOWED.has(ref.type)`; then continue. `REMOTE_ALLOWED = new Set(['hyperlink','cite','audio','video'])`.
  - `hasScheme(url)` → continue (`data:`/`mailto:`/`tel:`…).
  - else resolve `target = resolvePath(doc.path, url)`; `RSC-007` if not in container; else `RSC-008` if not in manifest.
- `RefType = 'hyperlink' | 'image' | 'audio' | 'video' | 'stylesheet' | 'generic' | 'cite' | 'track'`.

`src/parse/opf.ts` types (already exist): `ManifestItem { id?, href?, mediaType?, properties: string[], fallback?, loc }`; `SpineItem { idref?, linear, properties: string[], loc }`; `PackageDocument { …, manifest: ManifestItem[], spine: SpineItem[], … }`; `manifestPathMap(pkg): Map<string, ManifestItem>` keyed by container-absolute path.

---

## Task 1: Catalog entries + implemented-ID registration

**Files:**
- Modify: `src/messages/catalog.ts` (add RSC-010 and RSC-011; RSC-031 already present)
- Modify: `src/messages/catalog.test.ts` (add one assertion block)
- Modify: `test/fixtures/implemented.ts` (add `'RSC-010'`, `'RSC-011'`; `'RSC-031'` already present)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: catalog entries for `'RSC-010'` (ERROR) and `'RSC-011'` (ERROR), consumed by `msg('RSC-010', …)` / `msg('RSC-011', …)` in Task 2.

- [ ] **Step 1: Write the failing catalog test**

Add this `it(...)` inside the existing top-level `describe('CATALOG', …)` block in `src/messages/catalog.test.ts`:

```ts
  it('defines content-reference message ids', () => {
    expect(CATALOG['RSC-010']).toEqual({
      severity: 'ERROR',
      template: 'Reference to non-standard resource type found.',
    })
    expect(CATALOG['RSC-011']).toEqual({
      severity: 'ERROR',
      template: 'Found a reference to a resource that is not a spine item.',
    })
  })
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/messages/catalog.test.ts`
Expected: FAIL (RSC-010 / RSC-011 are `undefined`).

- [ ] **Step 3: Add the catalog entries**

In `src/messages/catalog.ts`, add these two entries to the `CATALOG` object, placed next to the other `RSC-0xx` entries (e.g. immediately after the `'RSC-008'` entry). Do not modify any existing entry; `'RSC-031'` already exists and must be left as-is:

```ts
  'RSC-010': { severity: 'ERROR', template: 'Reference to non-standard resource type found.' },
  'RSC-011': { severity: 'ERROR', template: 'Found a reference to a resource that is not a spine item.' },
```

- [ ] **Step 4: Register the implemented IDs**

In `test/fixtures/implemented.ts`, add `'RSC-010'` and `'RSC-011'` to the `IMPLEMENTED_IDS` set, on the existing `RSC-*` line (keep `'RSC-031'` — it is already present). For example change:

```ts
  'RSC-001', 'RSC-002', 'RSC-003', 'RSC-005', 'RSC-006', 'RSC-007', 'RSC-008',
  'RSC-012', 'RSC-013', 'RSC-030', 'RSC-031',
```

to:

```ts
  'RSC-001', 'RSC-002', 'RSC-003', 'RSC-005', 'RSC-006', 'RSC-007', 'RSC-008',
  'RSC-010', 'RSC-011', 'RSC-012', 'RSC-013', 'RSC-030', 'RSC-031',
```

- [ ] **Step 5: Run catalog test + lint + typecheck**

Run: `npx vitest run src/messages/catalog.test.ts && npm run lint && npx tsc --noEmit`
Expected: all pass / clean.

- [ ] **Step 6: Commit**

```bash
git add src/messages/catalog.ts src/messages/catalog.test.ts test/fixtures/implemented.ts
git commit -m "feat: add RSC-010 and RSC-011 message ids"
```

---

## Task 2: RSC-010 + RSC-011 — hyperlink target type and spine membership

**Files:**
- Modify: `src/checks/content.ts` (add predicates + helpers; extend `validateContentDocs` and `checkReferences`)
- Modify: `src/checks/content.test.ts` (default-populate the test `setup` spine; add RSC-010/011 unit tests)
- Modify: `test/fixtures/corpus.ts` (add two content fixtures)

**Interfaces:**
- Consumes: `'RSC-010'`, `'RSC-011'` catalog entries from Task 1.
- Produces: an updated `checkReferences(doc, container, manifest, byId, spineIdrefs)` signature and the helpers `isBlessedContentType`, `hasFallbackToBlessed`, `inSpine` — Task 3 edits the same `checkReferences` (its remote branch) and must keep this signature.

**Why the test `setup` changes:** `src/checks/content.test.ts`'s `setup()` currently builds `pkg` with `spine: []`. Test #36 ("passes when every reference resolves and is declared") links `c1` → `c2.xhtml` (a declared content doc) and asserts `[]`. Once RSC-011 checks spine membership, an empty spine would make that link a non-spine reference and emit RSC-011. Populating the spine with every doc's idref (which is what a real EPUB does for content documents) preserves the existing tests' intent and is part of this task.

- [ ] **Step 1: Write the failing unit tests**

First update `setup()` in `src/checks/content.test.ts` so declared content docs are spine items by default. Change the `pkg` literal's spine line from:

```ts
    manifest, spinePresent: true, spine: [], loc: LOC,
```

to:

```ts
    manifest,
    spinePresent: true,
    spine: manifest.map((m) => ({ idref: m.id, linear: true, properties: [], loc: LOC })),
    loc: LOC,
```

Then add this new `describe` block at the end of `src/checks/content.test.ts`:

```ts
describe('validateContentDocs — hyperlink targets', () => {
  it('RSC-010 for a hyperlink to a non-content-document resource type', () => {
    const { pkg, container } = setup({ 'c1.xhtml': '<a href="photo.jpg">x</a>' })
    pkg.manifest.push({ id: 'photo', href: 'photo.jpg', mediaType: 'image/jpeg', properties: [], loc: LOC })
    container.resources.set('EPUB/photo.jpg', { path: 'EPUB/photo.jpg', bytes: enc('x'), compression: 'deflate' })
    const out = validateContentDocs(pkg, container).map((m) => m.id)
    expect(out).toContain('RSC-010')
    expect(out).not.toContain('RSC-011')
  })

  it('RSC-011 for a hyperlink to a content document that is not in the spine', () => {
    const { pkg, container } = setup({ 'c1.xhtml': '<a href="c2.xhtml">x</a>' })
    // c2 is a declared, present XHTML doc, but is intentionally NOT added to the spine.
    pkg.manifest.push({ id: 'c2', href: 'c2.xhtml', mediaType: 'application/xhtml+xml', properties: [], loc: LOC })
    container.resources.set('EPUB/c2.xhtml', { path: 'EPUB/c2.xhtml', bytes: enc(DOC('<p>2</p>')), compression: 'deflate' })
    const out = validateContentDocs(pkg, container).map((m) => m.id)
    expect(out).toContain('RSC-011')
    expect(out).not.toContain('RSC-010')
  })

  it('no RSC-010/011 for a hyperlink to a spine content document', () => {
    // c1 and c2 are both content docs; setup() puts both in the spine.
    const { pkg, container } = setup({ 'c1.xhtml': '<a href="c2.xhtml">x</a>', 'c2.xhtml': '<p>2</p>' })
    const out = validateContentDocs(pkg, container).map((m) => m.id)
    expect(out).not.toContain('RSC-010')
    expect(out).not.toContain('RSC-011')
  })

  it('RSC-010 is suppressed when the non-content target has a content-document fallback', () => {
    const { pkg, container } = setup({ 'c1.xhtml': '<a href="photo.jpg">x</a>' })
    // photo.jpg (non-blessed) falls back to fb (xhtml) via the manifest fallback chain.
    pkg.manifest.push({ id: 'photo', href: 'photo.jpg', mediaType: 'image/jpeg', properties: [], fallback: 'fb', loc: LOC })
    pkg.manifest.push({ id: 'fb', href: 'fb.xhtml', mediaType: 'application/xhtml+xml', properties: [], loc: LOC })
    container.resources.set('EPUB/photo.jpg', { path: 'EPUB/photo.jpg', bytes: enc('x'), compression: 'deflate' })
    container.resources.set('EPUB/fb.xhtml', { path: 'EPUB/fb.xhtml', bytes: enc(DOC('<p>fb</p>')), compression: 'deflate' })
    expect(validateContentDocs(pkg, container).map((m) => m.id)).not.toContain('RSC-010')
  })
})
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run src/checks/content.test.ts`
Expected: the four new tests FAIL (no RSC-010/011 emitted yet). The pre-existing tests should still PASS after the `setup` spine change (run the file and confirm only the new ones are red — if a pre-existing test went red, the spine change is wrong, fix it before continuing).

- [ ] **Step 3: Add predicates and helpers**

In `src/checks/content.ts`, add these module-level constants/functions (place them just below the existing `REMOTE_ALLOWED` / `HTML_NS` constants near the top):

```ts
const BLESSED_CONTENT_TYPES: ReadonlySet<string> = new Set<string>([
  'application/xhtml+xml',
  'image/svg+xml',
  'text/x-oeb1-document', // deprecated-blessed
  'text/html', // deprecated-blessed
])

function isBlessedContentType(mediaType: string | undefined): boolean {
  return mediaType !== undefined && BLESSED_CONTENT_TYPES.has(mediaType)
}

// Walk the manifest `fallback` chain (each fallback is a manifest item id) and
// report whether any item in the chain is a blessed content-document type.
function hasFallbackToBlessed(item: ManifestItem, byId: Map<string, ManifestItem>): boolean {
  const seen = new Set<string>()
  let current = item.fallback
  while (current !== undefined && !seen.has(current)) {
    seen.add(current)
    const next = byId.get(current)
    if (next === undefined) return false
    if (isBlessedContentType(next.mediaType)) return true
    current = next.fallback
  }
  return false
}

function inSpine(item: ManifestItem, spineIdrefs: ReadonlySet<string>): boolean {
  return item.id !== undefined && spineIdrefs.has(item.id)
}
```

- [ ] **Step 4: Build the id map + spine set and thread them into `checkReferences`**

In `validateContentDocs`, immediately after `const manifest = manifestPathMap(pkg)`, add:

```ts
  const byId = new Map<string, ManifestItem>()
  for (const item of pkg.manifest) {
    if (item.id !== undefined) byId.set(item.id, item)
  }
  const spineIdrefs = new Set<string>()
  for (const s of pkg.spine) {
    if (s.idref !== undefined) spineIdrefs.add(s.idref)
  }
```

Then update the call site in the per-doc loop from:

```ts
    messages.push(...checkReferences(doc, container, manifest))
```

to:

```ts
    messages.push(...checkReferences(doc, container, manifest, byId, spineIdrefs))
```

Update the `checkReferences` signature and add the RSC-010/011 branch. The function header becomes:

```ts
function checkReferences(
  doc: ContentDocument,
  container: EpubContainer,
  manifest: Map<string, ManifestItem>,
  byId: Map<string, ManifestItem>,
  spineIdrefs: ReadonlySet<string>,
): Message[] {
```

and the resolve-and-check tail of the loop body changes from:

```ts
    const target = resolvePath(doc.path, url)
    if (!getResource(container, target)) {
      messages.push(msg('RSC-007', ref.loc, url))
    } else if (!manifest.has(target)) {
      messages.push(msg('RSC-008', ref.loc, url))
    }
```

to:

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
    }
```

- [ ] **Step 5: Run the content unit tests**

Run: `npx vitest run src/checks/content.test.ts`
Expected: PASS (all four new tests plus every pre-existing test).

- [ ] **Step 6: Add the two corpus fixtures**

In `test/fixtures/corpus.ts`, add these two fixtures to the `CORPUS` array, in the `// ---- Content references ----` group (immediately after the `content-link-missing-fragment` fixture):

```ts
  {
    name: 'content-link-nonstandard-type',
    area: 'content',
    description: 'content a@href targets a non-content-document resource type (epubcheck RSC-010)',
    epub: buildEpub({
      files: {
        'EPUB/package.opf': OPF.replace(
          '</manifest>',
          '<item id="photo" href="photo.jpg" media-type="image/jpeg"/></manifest>',
        ),
        'EPUB/photo.jpg': 'JPEGDATA',
        'EPUB/content_001.xhtml': CONTENT.replace('<p>Hello</p>', '<p><a href="photo.jpg">x</a></p>'),
      },
    }),
    expected: [E('RSC-010', 'ERROR')],
  },
  {
    name: 'content-link-nonspine',
    area: 'content',
    description: 'content a@href targets a content doc that is not a spine item (epubcheck RSC-011)',
    // The nav doc is a declared XHTML resource that is not in the spine.
    epub: buildEpub({ files: { 'EPUB/content_001.xhtml': CONTENT.replace('<p>Hello</p>', '<p><a href="nav.xhtml">x</a></p>') } }),
    expected: [E('RSC-011', 'ERROR')],
  },
```

- [ ] **Step 7: Run the FULL suite**

Run: `npx vitest run`
Expected: all green. The exact-multiset corpus harness must pass. **Cross-cutting check:** enabling RSC-010/011 can only affect a fixture that has a content-document hyperlink (`<a href>`/`<area href>`) to a present, manifest-declared, local target. The analysis for this plan found that NO pre-existing fixture does so (existing content hyperlinks target either a missing file → RSC-007, or a `#fragment` → RSC-012). If the harness reports that any fixture OTHER than the two added here changed its output, STOP and report it (do not edit that fixture's `expected` to force green — that would hide a real interaction).

- [ ] **Step 8: Lint + typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add src/checks/content.ts src/checks/content.test.ts test/fixtures/corpus.ts
git commit -m "feat: detect hyperlinks to non-content or non-spine targets (RSC-010, RSC-011)"
```

---

## Task 3: RSC-031 for content references — remote refs should use HTTPS

**Files:**
- Modify: `src/checks/content.ts` (extend the remote branch of `checkReferences`)
- Modify: `src/checks/content.test.ts` (add RSC-031 unit tests)
- Modify: `test/fixtures/corpus.ts` (add one content fixture)

**Interfaces:**
- Consumes: the `checkReferences(doc, container, manifest, byId, spineIdrefs)` signature from Task 2 (unchanged here). RSC-031 already exists in the catalog and in `IMPLEMENTED_IDS` (Task 1 left it untouched).
- Produces: RSC-031 emitted for remote, non-hyperlink content refs whose scheme is not `https`/`file`.

- [ ] **Step 1: Write the failing unit tests**

Add this `describe` block at the end of `src/checks/content.test.ts`:

```ts
describe('validateContentDocs — remote HTTPS', () => {
  it('RSC-031 for a remote audio reference over HTTP', () => {
    const out = ids({ 'c1.xhtml': '<audio src="http://example.com/a.mp3"></audio>' })
    expect(out).toContain('RSC-031')
    expect(out).not.toContain('RSC-006') // audio is allowed to be remote
  })

  it('no RSC-031 for a remote audio reference over HTTPS', () => {
    expect(ids({ 'c1.xhtml': '<audio src="https://example.com/a.mp3"></audio>' })).not.toContain('RSC-031')
  })

  it('no RSC-031 for a remote hyperlink over HTTP', () => {
    expect(ids({ 'c1.xhtml': '<a href="http://example.com/">x</a>' })).not.toContain('RSC-031')
  })
})
```

- [ ] **Step 2: Run them and confirm the first fails**

Run: `npx vitest run src/checks/content.test.ts`
Expected: the "RSC-031 for a remote audio reference over HTTP" test FAILS (no RSC-031 yet); the two negative tests already pass.

- [ ] **Step 3: Extend the remote branch**

In `src/checks/content.ts`, change the remote branch of the `checkReferences` loop from:

```ts
    if (isRemote(url)) {
      if (!REMOTE_ALLOWED.has(ref.type)) messages.push(msg('RSC-006', ref.loc, url))
      continue
    }
```

to:

```ts
    if (isRemote(url)) {
      if (!REMOTE_ALLOWED.has(ref.type)) {
        messages.push(msg('RSC-006', ref.loc, url))
      } else if (ref.type !== 'hyperlink') {
        // Remote-allowed non-hyperlink refs (audio/video/cite) must use HTTPS.
        const scheme = url.slice(0, url.indexOf(':')).toLowerCase()
        if (scheme !== 'https' && scheme !== 'file') messages.push(msg('RSC-031', ref.loc, url))
      }
      continue
    }
```

- [ ] **Step 4: Run the content unit tests**

Run: `npx vitest run src/checks/content.test.ts`
Expected: PASS (all three new tests plus the pre-existing ones).

- [ ] **Step 5: Add the corpus fixture**

In `test/fixtures/corpus.ts`, add this fixture immediately after the `content-link-nonspine` fixture added in Task 2:

```ts
  {
    name: 'content-audio-remote-http',
    area: 'content',
    description: 'content audio@src is a remote HTTP url that should be HTTPS (epubcheck RSC-031)',
    epub: buildEpub({ files: { 'EPUB/content_001.xhtml': CONTENT.replace('<p>Hello</p>', '<p><audio src="http://example.com/a.mp3"></audio></p>') } }),
    expected: [E('RSC-031', 'WARNING')],
  },
```

- [ ] **Step 6: Run the FULL suite + lint + typecheck**

Run: `npx vitest run && npm run lint && npx tsc --noEmit`
Expected: all green / clean. As in Task 2, if any fixture other than the one added here changes output, STOP and report (do not paper over).

- [ ] **Step 7: Commit**

```bash
git add src/checks/content.ts src/checks/content.test.ts test/fixtures/corpus.ts
git commit -m "feat: flag remote content references that should use HTTPS (RSC-031)"
```

---

## Known limitations / carry-forward (not in scope for this plan)

- **RSC-032** (foreign-resource fallback: `img`/`audio`/`video`/`object` to a non-core-media-type with no fallback) is deferred to **Plan 10**. It needs a Core-Media-Type table, the same manifest `fallback`-chain walk introduced here (`hasFallbackToBlessed` generalizes to `hasFallbackToType(predicate)`), and `<picture>`/`<source>` intrinsic-fallback awareness that the current flat `ContentRef` model does not capture.
- RSC-010/011 only consider the first rootfile's package (consistent with the rest of the validator; multiple-rendition manifests are not modeled).
- RSC-031 for content is checked only for remote-allowed non-hyperlink refs (audio/video/cite); remote images/stylesheets are already rejected earlier by RSC-006, matching epubcheck.

## Self-review notes

- **Spec coverage:** RSC-010 → Task 2 branch + fixture `content-link-nonstandard-type`; RSC-011 → Task 2 branch + fixture `content-link-nonspine`; RSC-031 (content) → Task 3 branch + fixture `content-audio-remote-http`. Catalog + IMPLEMENTED_IDS → Task 1.
- **Type consistency:** `checkReferences` gains `byId: Map<string, ManifestItem>` and `spineIdrefs: ReadonlySet<string>` in Task 2; Task 3 edits only the remote branch and keeps that signature. `ManifestItem.fallback` is an id string; `hasFallbackToBlessed` resolves it through `byId`. `inSpine` compares `ManifestItem.id` against `SpineItem.idref` values — both are the manifest id namespace.
- **No placeholders:** every code step is complete and verbatim.
