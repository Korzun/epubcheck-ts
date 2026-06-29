# Plan 11 — Navigation Completeness (NAV-011 + nav-as-content) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add NAV-011 (toc links not in spine reading order) and route the EPUB 3 navigation document through the existing content-document reference/inline-CSS checks (so its links get RSC-007/008/010/011/012 and its inline styles get CSS validation), instead of the nav doc being excluded and only partially link-checked.

**Architecture:** Two independent changes. (1) NAV-011 is a new `checkReadingOrder` sub-check inside `src/checks/nav.ts`'s `validateNav`, comparing each toc `<a>` link's spine position to the running maximum. (2) The nav doc is un-excluded from `src/checks/content.ts`'s `validateContentDocs` loop; to avoid double-reporting, the now-redundant RSC-007/008 emissions are removed from `validateNav`'s link check (which keeps only NAV-010 for remote links), and `validateNav` drops its now-unused `container` parameter. Both existing nav corpus fixtures remain clean under routing (verified by analysis).

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

### Verified epubcheck semantics (source-verified against `w3c/epubcheck`: `MessageBundle.properties`, `DefaultSeverities.java`, `NavHandler.java`, `ResourceReferencesChecker.java`, `NavChecker.java`)

- **NAV-011** — template `"%1$s" nav must be in reading order; link target "%2$s" is before the previous link's target in %3$s order.` (`%1$s` = nav type, e.g. `toc`; `%2$s` = the target URL; `%3$s` = `spine` or `document`), severity **WARNING**. Trigger: within a `toc` nav, walking `<a href>` links in document order, skipping remote links and links whose target is not in the spine; if a link's target spine position is **before** the previous (in-spine) link's target spine position, emit NAV-011 with `%3$s = "spine"`. (epubcheck also has a `document`-order sub-case for links into the *same* spine item at an earlier id position; see "Known limitations" — this plan implements the spine sub-case only.) Applies to `toc` only (page-list is not reading-order-checked by epubcheck; landmarks is exempt).
- **Nav as content document:** epubcheck validates the EPUB 3 navigation document as an XHTML content document — its `<a href>` links are HYPERLINK references subject to RSC-006/007/008/010/011 and fragment check RSC-012, and its inline styles get CSS checks. Broken-nav-link → id mapping: missing file → **RSC-007**; not in manifest → **RSC-008**; remote → **NAV-010** (hyperlink is remote-allowed, so no RSC-006); non-content target type → **RSC-010**; non-spine content target → **RSC-011**; undefined fragment → **RSC-012**. (RSC-032 does not apply to hyperlinks.)

### Current code this plan changes (already on `main`, post-Plan-10)

`src/checks/nav.ts` — `validateNav(nav, pkg, container)` returns `[...checkOccurrence(nav), ...checkContent(nav), ...checkLinks(nav, pkg, container)]`. `checkLinks` builds a manifest-path set and, per `<a href>` in each nav section: remote → `NAV-010`; else resolve `target = resolvePath(nav.path, href)` (strips fragment) and emit `RSC-007` (not in container) or `RSC-008` (not in manifest). `checkOccurrence`/`checkContent` emit `RSC-005` for nav-structural issues. `getResource`, `resolvePath`, `isRemote` are imported.

`src/checks/content.ts` — `validateContentDocs(pkg, container)` loop currently SKIPS the nav doc:
```ts
  // Parse every XHTML content doc except the nav doc (validated by validateNav).
  const docs = new Map<string, ContentDocument>()
  for (const item of pkg.manifest) {
    if (item.mediaType !== 'application/xhtml+xml') continue
    if (item.properties.includes('nav')) continue
    const { doc, messages: m } = parseContent(item, container)
    messages.push(...m)
    if (doc) docs.set(doc.path, doc)
  }
```
Per parsed doc it runs `checkReferences` (RSC-006/007/008/010/011/031/032), `checkFragments` (RSC-012), `checkElements` (RSC-005 for unknown elements), and inline-CSS validation. `<nav>`, `<ol>`, `<li>`, `<span>`, `<a>` are all known HTML elements (so routing the nav doc does not trip RSC-005).

`src/validate.ts` — the EPUB3 block calls `parseNav`/`validateNav(nav, pkg, container)` then `validateContentDocs(pkg, container)` then `validateCssDocs(pkg, container)`.

`src/parse/opf.ts` — `ManifestItem { id?; href?; mediaType?; properties; fallback?; loc }`; `SpineItem { idref?; linear; properties; loc }`; `PackageDocument { …; manifest: ManifestItem[]; spine: SpineItem[]; … }` (spine is an ordered array; index = spine position).

---

## Task 1: Catalog entry + implemented-ID registration

**Files:**
- Modify: `src/messages/catalog.ts` (add NAV-011)
- Modify: `src/messages/catalog.test.ts` (add one assertion)
- Modify: `test/fixtures/implemented.ts` (add `'NAV-011'`)

**Interfaces:**
- Consumes: nothing.
- Produces: catalog entry `'NAV-011'` (WARNING), consumed by `msg('NAV-011', …)` in Task 2.

- [ ] **Step 1: Write the failing catalog test**

Add this `it(...)` inside the existing top-level `describe('CATALOG', …)` block in `src/messages/catalog.test.ts`:

```ts
  it('defines the navigation reading-order message id', () => {
    expect(CATALOG['NAV-011']).toEqual({
      severity: 'WARNING',
      template: '"%1$s" nav must be in reading order; link target "%2$s" is before the previous link\'s target in %3$s order.',
    })
  })
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/messages/catalog.test.ts`
Expected: FAIL (`NAV-011` is `undefined`).

- [ ] **Step 3: Add the catalog entry**

In `src/messages/catalog.ts`, add this entry immediately after the existing `'NAV-010'` entry (note the apostrophe in `link's` is escaped because the template string is single-quoted):

```ts
  'NAV-011': { severity: 'WARNING', template: '"%1$s" nav must be in reading order; link target "%2$s" is before the previous link\'s target in %3$s order.' },
```

- [ ] **Step 4: Register the implemented ID**

In `test/fixtures/implemented.ts`, add `'NAV-011'` to `IMPLEMENTED_IDS` on the existing nav line, immediately after `'NAV-010'`. For example change `'NAV-010',` to `'NAV-010', 'NAV-011',`.

- [ ] **Step 5: Run catalog test + lint + typecheck**

Run: `npx vitest run src/messages/catalog.test.ts && npm run lint && npx tsc --noEmit`
Expected: all pass / clean.

- [ ] **Step 6: Commit**

```bash
git add src/messages/catalog.ts src/messages/catalog.test.ts test/fixtures/implemented.ts
git commit -m "feat: add NAV-011 message id"
```

---

## Task 2: NAV-011 — toc reading-order check

**Files:**
- Modify: `src/checks/nav.ts` (add `checkReadingOrder`; call it from `validateNav`)
- Modify: `src/checks/nav.test.ts` (add reading-order tests)
- Modify: `test/fixtures/corpus.ts` (add one nav fixture)

**Interfaces:**
- Consumes: `'NAV-011'` catalog entry (Task 1).
- Produces: `validateNav` now also emits NAV-011. (Signature unchanged in this task — still `validateNav(nav, pkg, container)`.)

- [ ] **Step 1: Write the failing unit tests**

Append this block to `src/checks/nav.test.ts` (it reuses the file's `enc`, `LOC`, `navItem`, and `parseNav` imports):

```ts
describe('validateNav — reading order (NAV-011)', () => {
  // Build a nav + a two-item spine (c1 at position 0, c2 at position 1).
  function twoSpine(navBody: string): string[] {
    const navXml =
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>t</title></head><body>' +
      navBody + '</body></html>'
    const resources = new Map<string, Resource>()
    resources.set('EPUB/nav.xhtml', { path: 'EPUB/nav.xhtml', bytes: enc(navXml), compression: 'deflate' })
    resources.set('EPUB/c1.xhtml', { path: 'EPUB/c1.xhtml', bytes: enc('<html/>'), compression: 'deflate' })
    resources.set('EPUB/c2.xhtml', { path: 'EPUB/c2.xhtml', bytes: enc('<html/>'), compression: 'deflate' })
    const container: EpubContainer = { resources, rootfiles: ['EPUB/package.opf'], hasEncryption: false }
    const { nav } = parseNav(navItem, container)
    const pkg: PackageDocument = {
      path: 'EPUB/package.opf', version: '3.0', uniqueIdentifier: 'uid',
      metadata: { identifiers: [{ id: 'uid', value: 'u' }], titles: ['T'], languages: ['en'], modifiedCount: 1 },
      manifest: [
        navItem,
        { id: 'c1', href: 'c1.xhtml', mediaType: 'application/xhtml+xml', properties: [], loc: LOC },
        { id: 'c2', href: 'c2.xhtml', mediaType: 'application/xhtml+xml', properties: [], loc: LOC },
      ],
      spinePresent: true,
      spine: [
        { idref: 'c1', linear: true, properties: [], loc: LOC },
        { idref: 'c2', linear: true, properties: [], loc: LOC },
      ],
      loc: LOC,
    }
    return validateNav(nav!, pkg, container).map((m) => m.id)
  }

  it('NAV-011 when toc links go backwards in spine order', () => {
    const body = '<nav epub:type="toc"><ol><li><a href="c2.xhtml">2</a></li><li><a href="c1.xhtml">1</a></li></ol></nav>'
    expect(twoSpine(body)).toContain('NAV-011')
  })

  it('no NAV-011 when toc links follow spine order', () => {
    const body = '<nav epub:type="toc"><ol><li><a href="c1.xhtml">1</a></li><li><a href="c2.xhtml">2</a></li></ol></nav>'
    expect(twoSpine(body)).not.toContain('NAV-011')
  })

  it('skips non-spine link targets for reading order', () => {
    // c1 (pos 0), nav.xhtml (not in spine → skipped), c2 (pos 1) → still in order → no NAV-011.
    const body = '<nav epub:type="toc"><ol>' +
      '<li><a href="c1.xhtml">1</a></li><li><a href="nav.xhtml">n</a></li><li><a href="c2.xhtml">2</a></li></ol></nav>'
    expect(twoSpine(body)).not.toContain('NAV-011')
  })
})
```

(The file already imports `Resource`, `EpubContainer`, `PackageDocument`, `parseNav`, `validateNav`, `enc`, `LOC`, `navItem` — confirm those imports exist at the top; they are used by the existing `navDoc` helper.)

- [ ] **Step 2: Run them and confirm the first fails**

Run: `npx vitest run src/checks/nav.test.ts`
Expected: "NAV-011 when toc links go backwards in spine order" FAILS; the two negative tests pass (nothing emits NAV-011 yet).

- [ ] **Step 3: Add the `checkReadingOrder` function**

In `src/checks/nav.ts`, add an import for `ManifestItem` (alongside the existing `PackageDocument` import) so the line becomes:

```ts
import type { ManifestItem, PackageDocument } from '../parse/opf.js'
```

Then add this function (place it after `checkLinks`):

```ts
function checkReadingOrder(nav: NavDocument, pkg: PackageDocument): Message[] {
  const messages: Message[] = []

  // Container path of each spine item → its spine position (index).
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

  for (const section of nav.sections) {
    if (!hasType(section, 'toc')) continue // NAV-011 applies to the toc nav only
    let lastPos = -1
    for (const a of findDescendants(section.node, 'a')) {
      const href = a.attrs?.['href']
      if (!href || isRemote(href)) continue
      const target = resolvePath(nav.path, href) // strips the fragment
      const pos = spinePos.get(target)
      if (pos === undefined) continue // target not in the spine → skipped (epubcheck behavior)
      if (pos < lastPos) messages.push(msg('NAV-011', a.loc, 'toc', target, 'spine'))
      lastPos = pos
    }
  }

  return messages
}
```

- [ ] **Step 4: Call it from `validateNav`**

In `src/checks/nav.ts`, change `validateNav`'s return to include the new check:

```ts
export function validateNav(
  nav: NavDocument,
  pkg: PackageDocument,
  container: EpubContainer,
): Message[] {
  return [...checkOccurrence(nav), ...checkContent(nav), ...checkLinks(nav, pkg, container), ...checkReadingOrder(nav, pkg)]
}
```

- [ ] **Step 5: Run the nav unit tests**

Run: `npx vitest run src/checks/nav.test.ts`
Expected: PASS (the three new tests plus every pre-existing nav test).

- [ ] **Step 6: Add the corpus fixture**

In `test/fixtures/corpus.ts`, add this fixture to the `// ---- Navigation ----` group (after `nav-link-remote`):

```ts
  {
    name: 'nav-reading-order',
    area: 'nav',
    description: 'toc links are not in spine reading order (epubcheck NAV-011)',
    epub: buildEpub({
      files: {
        'EPUB/package.opf': OPF
          .replace('</manifest>', '<item id="content2" href="content_002.xhtml" media-type="application/xhtml+xml"/></manifest>')
          .replace('<itemref idref="content"/>', '<itemref idref="content"/><itemref idref="content2"/>'),
        'EPUB/content_002.xhtml': CONTENT,
        'EPUB/nav.xhtml': NAV.replace(
          '<nav epub:type="toc"><ol><li><a href="content_001.xhtml">Content</a></li></ol></nav>',
          '<nav epub:type="toc"><ol><li><a href="content_002.xhtml">Two</a></li><li><a href="content_001.xhtml">One</a></li></ol></nav>',
        ),
      },
    }),
    expected: [E('NAV-011', 'WARNING')],
  },
```

- [ ] **Step 7: Run the FULL suite + lint + typecheck**

Run: `npx vitest run && npm run lint && npx tsc --noEmit`
Expected: all green / clean. The new fixture has two spine items (`content_001` at position 0, `content_002` at position 1) and a toc that links `content_002` then `content_001` — the second link goes backwards → NAV-011. Both content docs are present, declared, and in the spine, so no other message fires. If any fixture OTHER than the new one changes output, STOP and report.

- [ ] **Step 8: Commit**

```bash
git add src/checks/nav.ts src/checks/nav.test.ts test/fixtures/corpus.ts
git commit -m "feat: flag toc links that are out of spine reading order (NAV-011)"
```

---

## Task 3: Route the nav document through content validation

**Files:**
- Modify: `src/checks/content.ts` (stop skipping the nav doc)
- Modify: `src/checks/nav.ts` (simplify `checkLinks` to NAV-010 only; drop the now-unused `container` param from `validateNav`)
- Modify: `src/validate.ts` (update the `validateNav` call site)
- Modify: `src/checks/nav.test.ts` (update `validateNav` call sites; replace the RSC-007/008 link tests with an ownership-move assertion)
- Modify: `test/fixtures/corpus.ts` (add two nav fixtures)

**Interfaces:**
- Consumes: the content-document checks already run by `validateContentDocs`.
- Produces: `validateNav(nav, pkg)` (the `container` parameter is removed); the nav doc now flows through `validateContentDocs` and so its links get RSC-007/008/010/011/012 and its inline styles get CSS validation.

**Why move RSC-007/008 off `validateNav`:** once the nav doc is processed by `validateContentDocs`, its `<a href>` links get RSC-007 (missing) and RSC-008 (undeclared) from `checkReferences`. Leaving the same emissions in `validateNav.checkLinks` would double-report them. So `checkLinks` is reduced to its still-unique responsibility (NAV-010 for remote links), and the resolution that needed `pkg`/`container` is removed. `validateNav` then no longer needs `container`.

- [ ] **Step 1: Stop skipping the nav doc in `validateContentDocs`**

In `src/checks/content.ts`, delete the nav-skip line and update the comment. Change:

```ts
  // Parse every XHTML content doc except the nav doc (validated by validateNav).
  const docs = new Map<string, ContentDocument>()
  for (const item of pkg.manifest) {
    if (item.mediaType !== 'application/xhtml+xml') continue
    if (item.properties.includes('nav')) continue
    const { doc, messages: m } = parseContent(item, container)
    messages.push(...m)
    if (doc) docs.set(doc.path, doc)
  }
```

to:

```ts
  // Parse every XHTML content document, including the nav doc (its links and
  // inline styles get the same reference/CSS checks; validateNav additionally
  // checks nav-specific structure, NAV-010 remote links, and NAV-011 order).
  const docs = new Map<string, ContentDocument>()
  for (const item of pkg.manifest) {
    if (item.mediaType !== 'application/xhtml+xml') continue
    const { doc, messages: m } = parseContent(item, container)
    messages.push(...m)
    if (doc) docs.set(doc.path, doc)
  }
```

- [ ] **Step 2: Simplify `checkLinks` and drop `validateNav`'s `container` param**

In `src/checks/nav.ts`:

(a) Replace the entire `checkLinks` function with this NAV-010-only version:

```ts
function checkLinks(nav: NavDocument): Message[] {
  const messages: Message[] = []
  for (const section of nav.sections) {
    const label = section.types[0] ?? 'toc'
    for (const a of findDescendants(section.node, 'a')) {
      const href = a.attrs?.['href']
      // RSC-007/008 (missing/undeclared) and RSC-012 (fragment) for nav links are
      // emitted by validateContentDocs, which now processes the nav document.
      if (href && isRemote(href)) messages.push(msg('NAV-010', a.loc, label, href))
    }
  }
  return messages
}
```

(b) Update `validateNav` to drop the `container` parameter and the `checkLinks` arguments:

```ts
export function validateNav(nav: NavDocument, pkg: PackageDocument): Message[] {
  return [...checkOccurrence(nav), ...checkContent(nav), ...checkLinks(nav), ...checkReadingOrder(nav, pkg)]
}
```

(c) Remove the now-unused `getResource` import. The import line:

```ts
import { getResource, type EpubContainer } from '../io/zip.js'
```

becomes:

```ts
import type { EpubContainer } from '../io/zip.js'
```

(`EpubContainer` is still referenced by the type imports; if after these edits `EpubContainer` is no longer referenced anywhere in the file, remove it from the import entirely. Run `npx tsc --noEmit` to confirm there are no unused-import or unused-variable errors and fix accordingly.)

- [ ] **Step 3: Update the `validateNav` call site**

In `src/validate.ts`, change:

```ts
    if (nav) messages.push(...validateNav(nav, pkg, container))
```

to:

```ts
    if (nav) messages.push(...validateNav(nav, pkg))
```

- [ ] **Step 4: Update `validateNav` call sites and link tests in `nav.test.ts`**

In `src/checks/nav.test.ts`:

(a) Update the two helper functions `ids` and `msgs` (and the Task-2 `twoSpine` helper) so they call `validateNav(nav, pkg)` / `validateNav(nav!, pkg)` — i.e. drop the `container` argument from every `validateNav(...)` call in the file. For example `ids` becomes:

```ts
const ids = (body: string, targets?: string[]) => {
  const { nav, pkg } = navDoc(body, targets)
  return validateNav(nav, pkg).map((m) => m.id)
}
```

and `msgs` similarly; in the Task-2 `twoSpine` helper change `validateNav(nav!, pkg, container)` to `validateNav(nav!, pkg)`. (The `navDoc` helper may now leave `container` unused in `ids`/`msgs`; destructure only what you use to avoid an unused-variable lint error.)

(b) In `describe('validateNav — links', …)`, the RSC-007 and RSC-008 emissions now belong to `validateContentDocs`, not `validateNav`. Replace the `'RSC-007 when a nav link target is not in the container'` and `'RSC-008 when the target exists in the container but is not in the manifest'` tests with a single ownership-move test, and keep the NAV-010 and resolvable-link tests:

```ts
  it('no longer emits RSC-007/008 for broken nav links (now owned by content validation)', () => {
    // validateNav itself does not resolve link targets anymore; a missing target
    // produces no message here (RSC-007 is emitted by validateContentDocs).
    expect(ids('<nav epub:type="toc"><ol><li><a href="missing.xhtml">x</a></li></ol></nav>')).toEqual([])
  })
```

(Keep the existing `'NAV-010 when a nav link is remote'` and `'does not flag a resolvable, manifest-declared link'` tests unchanged.)

- [ ] **Step 5: Run the nav unit tests**

Run: `npx vitest run src/checks/nav.test.ts`
Expected: PASS (all reading-order, occurrence, content, and links tests — the links block now has NAV-010, the ownership-move test, and the resolvable-link test).

- [ ] **Step 6: Add the two corpus fixtures**

In `test/fixtures/corpus.ts`, add these fixtures to the `// ---- Navigation ----` group (after `nav-reading-order`):

```ts
  {
    name: 'nav-link-missing-target',
    area: 'nav',
    description: 'nav toc link points to a missing file (epubcheck RSC-007, via content validation of the nav doc)',
    epub: buildEpub({ files: { 'EPUB/nav.xhtml': NAV.replace('href="content_001.xhtml"', 'href="missing.xhtml"') } }),
    expected: [E('RSC-007', 'ERROR')],
  },
  {
    name: 'nav-link-bad-fragment',
    area: 'nav',
    description: 'nav toc link has an undefined fragment in its target (epubcheck RSC-012, via content validation of the nav doc)',
    epub: buildEpub({ files: { 'EPUB/nav.xhtml': NAV.replace('href="content_001.xhtml"', 'href="content_001.xhtml#nope"') } }),
    expected: [E('RSC-012', 'ERROR')],
  },
```

- [ ] **Step 7: Run the FULL suite**

Run: `npx vitest run`
Expected: all green. **Cross-cutting checks:**
- The two pre-existing nav fixtures stay unchanged: `nav-toc-missing` → `[RSC-005]` (its `<p>no nav</p>` body has no refs and uses known elements; validateNav still flags the missing toc), and `nav-link-remote` → `[NAV-010]` (validateNav emits NAV-010; the remote hyperlink produces nothing in `checkReferences` because hyperlink is remote-allowed and exempt from RSC-031).
- `nav-link-missing-target`: the nav's toc link to `missing.xhtml` (absent, undeclared) → `checkReferences` emits RSC-007; validateNav no longer does → `[RSC-007]`.
- `nav-link-bad-fragment`: link to `content_001.xhtml#nope` (present, in spine, blessed → no RSC-010/011) with an undefined fragment → `checkFragments` emits RSC-012 → `[RSC-012]`.
- If any fixture not named above changes output, STOP and report (do not edit a fixture's `expected` to force green).

- [ ] **Step 8: Lint + typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: clean (no unused imports/variables — confirm `getResource` and any unused `container`/`EpubContainer` references were cleaned up).

- [ ] **Step 9: Commit**

```bash
git add src/checks/content.ts src/checks/nav.ts src/validate.ts src/checks/nav.test.ts test/fixtures/corpus.ts
git commit -m "feat: validate the nav document as a content document (RSC-007/008/010/011/012 + inline CSS on nav links)"
```

---

## Known limitations / carry-forward (not in scope for this plan)

- **NAV-011 document-order sub-case:** epubcheck also flags toc links into the *same* spine item whose target id appears at an earlier ordinal position than the previous link's target id. Implementing it requires `ContentDocument` to expose ordered id positions (currently `ids: Set<string>` is unordered). Deferred. This plan implements the spine-position sub-case only.
- **page-list reading order:** epubcheck collects page-list links but does not currently run them through the reading-order check; this plan matches that (toc only).
- The Plan-9 carry-forward (RSC-011/RSC-012 cross-pass abort) and Plan-10 carry-forwards (audio-source/object intrinsic fallback; `<video>` mixed-source grouping) remain independent and deferred.

## Self-review notes

- **Spec coverage:** NAV-011 catalog/severity → Task 1; NAV-011 reading-order check + fixture → Task 2; nav-as-content routing (RSC-007/008/010/011/012 + inline CSS for nav links) + RSC-007/008 ownership move + fixtures → Task 3.
- **Type consistency:** Task 2 adds `checkReadingOrder(nav, pkg)` and keeps `validateNav(nav, pkg, container)`. Task 3 changes `validateNav` to `(nav, pkg)`, `checkLinks` to `(nav)`, and updates `validate.ts` + all `nav.test.ts` call sites accordingly. NAV-011 args: `msg('NAV-011', a.loc, 'toc', target, 'spine')` → `%1$s`='toc', `%2$s`=target path, `%3$s`='spine'.
- **No placeholders:** every code step is complete and verbatim.
- **Corpus:** Task 2 adds one fixture (NAV-011); Task 3 adds two (RSC-007, RSC-012 via nav); the two pre-existing nav fixtures are unchanged (verified). Enforced by the exact-multiset harness.
