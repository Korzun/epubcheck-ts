# epubcheck-ts — Plan 8: Package + Manifest Completeness (OPF-003, PKG-001)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two long-tail package/container rules — `OPF-003` (a container file is not declared in the OPF manifest) and `PKG-001` (validating against a different version than detected) — with corpus + unit coverage.

**Architecture:** A new `checkUndeclaredResources(pkg, container)` walks the container's resources and flags any not declared in the manifest (excluding `mimetype`, `META-INF/*`, and the rootfile OPF), emitting `OPF-003`. `validateEpub` calls it after `validateOpf`, and emits `PKG-001` when `options.version` is set and differs from the detected version. No new public API surface, no new deps.

**Tech Stack:** TypeScript (ESM), reuses the message catalog, `manifestPathMap`, and the fixture corpus.

**Spec:** `docs/superpowers/specs/2026-06-28-epubcheck-ts-design.md` (deferred long-tail rules; this is the first long-tail chunk).

## Global Constraints

From the spec + Plans 1–7.

- **ESM-only**, TypeScript source. Target **ES2022 / Node 18+ / browsers**.
- **Functional style, no classes.** Plain data + functions.
- **Runtime-agnostic core:** zero Node-only APIs in `src/`.
- **Runtime deps unchanged:** `fflate`, `saxes`, `css-tree`. No new deps (`package-lock.json` must be untouched).
- **Types live with their producer** — no types-only files.
- **Unit tests colocated**; integration/corpus under `test/`.
- **Lint is type-aware.** Every task keeps `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` green.
- **`validateEpub` always resolves to a `Report`** and never rejects.
- **Message-ID strategy:** reuse epubcheck's exact ids/templates/severities.

### Carry-forwards / known limitations (honor + document)

- `OPF-003` exclusions (per epubcheck `OCFChecker`): a container path is exempt if it equals `mimetype`, starts with `META-INF/`, is a rootfile (the OPF), or is a declared manifest item. epubcheck additionally exempts EPUB 3 OPF `<link>` resources and the Multiple-Renditions mapping document — **we don't model OPF `<link>`/mapping resources**, so an EPUB that ships such a resource (present-but-only-linked, not a manifest item) would get a false `OPF-003`. This is rare; document it as a deferred limitation.
- `PKG-001` fires only when the caller forces `options.version` and it differs from the detected version. Our version-gated checks (nav/content/css) still gate on the **detected** version, not the forced one — so forcing a version changes the report version + triggers `PKG-001` but does not re-gate which checks run. Faithful enough for now; document it.

---

## Reference: epubcheck rules (verified from source)

| ID | Severity | Template | Trigger |
|----|----------|----------|---------|
| `OPF-003` | USAGE | `Item "%1$s" exists in the EPUB, but is not declared in the OPF manifest.` | a container file (not `mimetype`, not under `META-INF/`, not a rootfile, not a manifest item) — `%1$s` = its container path |
| `PKG-001` | WARNING | `Validating the EPUB against version %1$s but detected version %2$s.` | `options.version` is set AND differs from the detected version — `%1$s` = requested, `%2$s` = detected |

`OPF-003` is reported once per undeclared file (container resources are a set). `PKG-001` is reported once.

---

## File Structure (this plan)

```
src/
  messages/
    catalog.ts           # (modify) add OPF-003 (USAGE), PKG-001 (WARNING)
  checks/
    opf.ts               # (modify) add exported checkUndeclaredResources(pkg, container)  (+ opf.test.ts)
  validate.ts            # (modify) call checkUndeclaredResources after validateOpf; emit PKG-001 on version mismatch  (+ validate.test.ts)
test/
  fixtures/
    implemented.ts       # (modify) add OPF-003, PKG-001 to IMPLEMENTED_IDS
    corpus.ts            # (modify) add opf-undeclared-resource fixture; reconcile two css fixtures that now also emit OPF-003
```

---

### Task 1: Catalog + IMPLEMENTED_IDS

**Files:**
- Modify: `src/messages/catalog.ts`, `src/messages/catalog.test.ts`, `test/fixtures/implemented.ts`

**Interfaces:**
- Produces: catalog entries `OPF-003` (USAGE), `PKG-001` (WARNING); both added to `IMPLEMENTED_IDS`.

- [ ] **Step 1: Add the failing catalog test**

Append inside the existing `describe('CATALOG', ...)` block in `src/messages/catalog.test.ts`:
```ts
  it('defines manifest-completeness message ids', () => {
    expect(CATALOG['OPF-003']?.severity).toBe('USAGE')
    expect(CATALOG['PKG-001']?.severity).toBe('WARNING')
    expect(CATALOG['OPF-003']?.template).toContain('%1$s')
    expect(CATALOG['PKG-001']?.template).toContain('%2$s')
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/messages/catalog.test.ts`
Expected: FAIL — `OPF-003`/`PKG-001` undefined.

- [ ] **Step 3: Add the catalog entries**

In `src/messages/catalog.ts`, add to `CATALOG`:
- next to the existing `PKG-*` entries:
```ts
  'PKG-001': { severity: 'WARNING', template: 'Validating the EPUB against version %1$s but detected version %2$s.' },
```
- next to the existing `OPF-*` entries:
```ts
  'OPF-003': { severity: 'USAGE', template: 'Item "%1$s" exists in the EPUB, but is not declared in the OPF manifest.' },
```

- [ ] **Step 4: Add the ids to IMPLEMENTED_IDS**

In `test/fixtures/implemented.ts`, add `'PKG-001'` to the container/package-archive line and `'OPF-003'` to the package-document line, e.g.:
```ts
  'PKG-001', 'PKG-003', 'PKG-005', 'PKG-006', 'PKG-007',
  ...
  'OPF-001', 'OPF-003', 'OPF-030', 'OPF-033', 'OPF-048', 'OPF-049', 'OPF-074',
```

- [ ] **Step 5: Run + lint + typecheck**

Run: `npx vitest run src/messages/catalog.test.ts && npm run lint && npx tsc --noEmit`
Expected: PASS / clean.

- [ ] **Step 6: Commit**

```bash
git add src/messages/catalog.ts src/messages/catalog.test.ts test/fixtures/implemented.ts
git commit -m "feat: add OPF-003 and PKG-001 message ids"
```

---

### Task 2: `checkUndeclaredResources` (OPF-003)

**Files:**
- Modify: `src/checks/opf.ts`, `src/checks/opf.test.ts`

**Interfaces:**
- Consumes: `manifestPathMap`, `PackageDocument` from `../parse/opf.js`; `EpubContainer` from `../io/zip.js`; `msg`, `Message` from `../messages/format.js`.
- Produces: `function checkUndeclaredResources(pkg: PackageDocument, container: EpubContainer): Message[]` — emits `OPF-003` for each container resource path that is not `mimetype`, not under `META-INF/`, not a rootfile (`container.rootfiles`), and not a declared manifest item (`manifestPathMap(pkg)`).

- [ ] **Step 1: Write the failing test**

Append to `src/checks/opf.test.ts`:
```ts
import { checkUndeclaredResources } from './opf.js'

describe('checkUndeclaredResources', () => {
  const LOC2 = { path: 'EPUB/package.opf' }
  function pkgWith(): PackageDocument {
    return {
      path: 'EPUB/package.opf', version: '3.0', uniqueIdentifier: 'uid',
      metadata: { identifiers: [{ id: 'uid', value: 'u' }], titles: ['T'], languages: ['en'], modifiedCount: 1 },
      manifest: [{ id: 'nav', href: 'nav.xhtml', mediaType: 'application/xhtml+xml', properties: ['nav'], loc: LOC2 }],
      spinePresent: true, spine: [], loc: LOC2,
    }
  }
  function containerWith(paths: string[]): EpubContainer {
    const resources = new Map<string, Resource>()
    for (const p of paths) resources.set(p, { path: p, bytes: new Uint8Array(), compression: 'deflate' })
    return { resources, rootfiles: ['EPUB/package.opf'], hasEncryption: false }
  }

  it('OPF-003 for a container file not declared in the manifest', () => {
    const msgs = checkUndeclaredResources(pkgWith(), containerWith(['EPUB/nav.xhtml', 'EPUB/orphan.txt']))
    expect(msgs.map((m) => m.id)).toEqual(['OPF-003'])
    expect(msgs[0]?.severity).toBe('USAGE')
  })

  it('does not flag mimetype, META-INF/*, the rootfile OPF, or declared items', () => {
    const msgs = checkUndeclaredResources(
      pkgWith(),
      containerWith(['mimetype', 'META-INF/container.xml', 'META-INF/encryption.xml', 'EPUB/package.opf', 'EPUB/nav.xhtml']),
    )
    expect(msgs).toEqual([])
  })
})
```
(The `EpubContainer`, `Resource`, `PackageDocument` types are already imported at the top of `opf.test.ts` from prior tasks; if `Resource` is not imported, add it to the existing `../io/zip.js` import.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/checks/opf.test.ts`
Expected: FAIL — `checkUndeclaredResources` not exported.

- [ ] **Step 3: Implement `checkUndeclaredResources`**

In `src/checks/opf.ts`:
- Ensure `manifestPathMap` is imported (extend the existing `../parse/opf.js` import to include the value `manifestPathMap`, keeping the `type` imports):
```ts
import { manifestPathMap, type ManifestItem, type PackageDocument } from '../parse/opf.js'
```
- Add the exported function (place it near `validateOpf`):
```ts
/**
 * OPF-003: a container resource that is not declared in the manifest.
 * Excludes `mimetype`, everything under `META-INF/`, and the rootfile package
 * document(s). (epubcheck also exempts EPUB 3 OPF `<link>` resources and the
 * Multiple-Renditions mapping document, which we do not model.)
 */
export function checkUndeclaredResources(pkg: PackageDocument, container: EpubContainer): Message[] {
  const messages: Message[] = []
  const declared = manifestPathMap(pkg)
  const rootfiles = new Set(container.rootfiles)
  for (const path of container.resources.keys()) {
    if (path === 'mimetype') continue
    if (path.startsWith('META-INF/')) continue
    if (rootfiles.has(path)) continue
    if (declared.has(path)) continue
    messages.push(msg('OPF-003', { path }, path))
  }
  return messages
}
```
(`EpubContainer` and `ManifestItem` are already imported in `opf.ts`; if `ManifestItem` becomes unused after edits, leave the existing imports as they were — only add `manifestPathMap`.)

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/checks/opf.test.ts`
Expected: PASS — both new tests + all existing opf tests (unchanged, since `validateOpf` is NOT modified).

- [ ] **Step 5: Lint + typecheck + commit**

Run: `npm run lint && npx tsc --noEmit` (Expected: clean)
```bash
git add src/checks/opf.ts src/checks/opf.test.ts
git commit -m "feat: add OPF-003 undeclared-resource check"
```

---

### Task 3: Wire OPF-003 + PKG-001 into `validateEpub`; reconcile corpus

**Files:**
- Modify: `src/validate.ts`, `src/validate.test.ts`, `test/fixtures/corpus.ts`

**Interfaces:**
- Consumes: `checkUndeclaredResources` from `./checks/opf.js`.
- Produces: `validateEpub` emits `OPF-003` (via `checkUndeclaredResources`) and `PKG-001` (on forced-version mismatch). New corpus fixture `opf-undeclared-resource`; two existing css fixtures reconciled.

- [ ] **Step 1: Add the failing unit tests**

Append to `src/validate.test.ts`:
```ts
  it('reports OPF-003 for a container file not in the manifest', async () => {
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
      'orphan.txt': [enc('x'), { level: 6 }], // present, undeclared
    })
    const report = await validateEpub(bytes)
    expect(report.messages.some((m) => m.id === 'OPF-003' && m.severity === 'USAGE')).toBe(true)
  })

  it('reports PKG-001 when options.version differs from the detected version', async () => {
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
    expect(report.messages.some((m) => m.id === 'PKG-001' && m.severity === 'WARNING')).toBe(true)
  })
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/validate.test.ts`
Expected: FAIL — neither OPF-003 nor PKG-001 emitted yet.

- [ ] **Step 3: Wire both rules into `validate.ts`**

In `src/validate.ts`:
- extend the opf-checks import to include `checkUndeclaredResources`:
```ts
import { validateOpf, checkUndeclaredResources } from './checks/opf.js'
```
- inside the `if (pkg) { ... }` block, add the undeclared-resources call right after `validateOpf`, and add the PKG-001 check right after `detectedVersion` is computed. The block becomes:
```ts
    if (pkg) {
      messages.push(...validateOpf(pkg, container))
      messages.push(...checkUndeclaredResources(pkg, container))

      if (pkg.version === '2.0') detectedVersion = '2.0'
      else if (pkg.version === '3.0') detectedVersion = '3.0'

      if (options.version && detectedVersion && options.version !== detectedVersion) {
        messages.push(msg('PKG-001', pkg.loc, options.version, detectedVersion))
      }

      if (detectedVersion === '3.0') {
        // ...existing nav + content + css blocks unchanged...
      }
    }
```
(Keep the existing nav/content/css code inside the `if (detectedVersion === '3.0')` block exactly as it is.)

- [ ] **Step 4: Run the validate unit tests**

Run: `npx vitest run src/validate.test.ts`
Expected: PASS — both new tests.

- [ ] **Step 5: Reconcile the corpus (two existing css fixtures now also emit OPF-003) + add the OPF-003 fixture**

Now that `validateEpub` emits `OPF-003`, the two existing css fixtures that ship an undeclared `.css` file emit it too — the exact-match harness will flag them. In `test/fixtures/corpus.ts`:
- update `css-import-not-declared`'s `expected` to add `E('OPF-003', 'USAGE')` (the `extra.css` it adds is present-but-undeclared):
```ts
    expected: [E('RSC-008', 'ERROR'), E('OPF-003', 'USAGE')],
```
- update `css-import-fragment`'s `expected` to add `E('OPF-003', 'USAGE')` (the `other.css` it adds is present-but-undeclared):
```ts
    expected: [E('RSC-013', 'ERROR'), E('RSC-008', 'ERROR'), E('OPF-003', 'USAGE')],
```
- add a dedicated positive fixture to the `CORPUS` array (in the OPF group):
```ts
  {
    name: 'opf-undeclared-resource',
    area: 'opf',
    description: 'a container file is not declared in the manifest (epubcheck OPF-003, usage)',
    epub: buildEpub({ files: { 'EPUB/orphan.txt': 'orphan' } }),
    expected: [E('OPF-003', 'USAGE')],
  },
```

- [ ] **Step 6: Run the full gate**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: lint clean; typecheck clean; ALL tests pass (the reconciled css fixtures now match; the new fixture passes; baseline `minimal`/`css-valid` stay clean because all their files are excluded or declared); build emits `dist/index.js` + `dist/index.d.ts`.

If any OTHER fixture or integration test newly fails because of `OPF-003`, that fixture ships an undeclared container file — reconcile its `expected` to add `E('OPF-003','USAGE')` (this is the corpus correctly reflecting the new rule), and note it. Do NOT suppress `OPF-003`.

- [ ] **Step 7: Commit**

```bash
git add src/validate.ts src/validate.test.ts test/fixtures/corpus.ts
git commit -m "feat: wire OPF-003 + PKG-001 into validateEpub; reconcile corpus"
```

---

## Roadmap (subsequent long-tail chunks)

- **Content type + spine refs:** `RSC-010` (hyperlink to non-core-media-type w/o fallback), `RSC-011` (hyperlink to non-spine resource), `RSC-031` (remote audio/video over HTTP) — needs a Core-Media-Type set + spine id set.
- **CSS completeness:** `CSS-003/004` (UTF-16/non-UTF-8 css), `CSS-005/015` (alternate-stylesheet `<link>` titles), `CSS-007` (non-standard `@font-face` MIME).
- **Nav completeness:** `NAV-011` (reading-order), `RSC-012` for nav links.
- **Then:** attribute-namespace resolution; CDATA `<style>`; EPUB 2.

---

## Self-Review

**Spec coverage (this long-tail chunk):** `OPF-003` → Task 2 (`checkUndeclaredResources`) + Task 3 (wiring + corpus); `PKG-001` → Task 3 (validate.ts + unit test); catalog + IMPLEMENTED_IDS → Task 1. The OPF `<link>`/mapping-resource and forced-version-gating limitations are documented (Global Constraints). No chunk gaps.

**Placeholder scan:** No TBD/TODO; every code step has complete code. The Task 3 Step 6 "reconcile any other fixture" instruction is a concrete corpus-maintenance procedure (the exact-match harness makes any miss a hard failure), not a placeholder — the two known fixtures are reconciled explicitly.

**Type consistency:** `checkUndeclaredResources(pkg: PackageDocument, container: EpubContainer): Message[]` defined in Task 2, consumed by Task 3's validate.ts. `OPF-003`/`PKG-001` catalog ids (Task 1) match every `msg(...)` call site (`msg('OPF-003', { path }, path)` — 1 arg; `msg('PKG-001', pkg.loc, options.version, detectedVersion)` — 2 args, matching the templates). `IMPLEMENTED_IDS` additions (Task 1) cover the new corpus expected ids (Task 3). `manifestPathMap` (parse/opf.ts, Plan 5) and the `Fixture`/`E` corpus helpers (Plan 7) are reused unchanged.
```
