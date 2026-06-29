# epubcheck-ts — Plan 7: Fixture Corpus + LICENSE/ATTRIBUTION

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a data-driven fixture corpus — small EPUBs crafted to mirror epubcheck's own `.feature` test scenarios — and a harness that asserts our validator's emitted `{id, severity}` set per fixture, plus add the root `LICENSE` + `ATTRIBUTION` for the ported epubcheck message catalog.

**Architecture:** A `buildEpub()` helper assembles an EPUB from a valid baseline plus per-fixture overrides (fixtures are authored as code; no third-party files are vendored). A `CORPUS` array lists fixtures, each with its built `epub` bytes and an `expected: {id, severity}[]` set (over our IMPLEMENTED ids; `[]` = clean). A data-driven harness runs `validateEpub` over each fixture and asserts the emitted set equals `expected` exactly, and that fixtures without a FATAL/ERROR are `valid`.

**Tech Stack:** TypeScript (ESM), `vitest`, `fflate` (zip), the project's public `validateEpub` API.

**Spec:** `docs/superpowers/specs/2026-06-28-epubcheck-ts-design.md` (§10 testing: "port a curated subset of epubcheck's fixtures … assert the set of `{id, severity}`"). Decided with the user: **craft** EPUBs modeled on epubcheck cases (don't vendor binaries); **subset-match + valid-clean** reconciliation.

## Global Constraints

From the spec + Plans 1–6.

- **ESM-only**, TypeScript source. Target **ES2022 / Node 18+ / browsers**.
- **Functional style, no classes.** Plain data + functions.
- **Runtime-agnostic:** test/fixture helpers use `TextEncoder` + fflate only — no Node-only APIs (the fixtures must build in any runtime, consistent with the library).
- **Runtime deps unchanged:** `fflate`, `saxes`, `css-tree`. No new deps (this plan touches `test/` + repo-root docs only; `package-lock.json` must be untouched).
- **Lint is type-aware.** Every task keeps `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` green. (Test files ARE linted/typechecked — `test/` is in the tsconfig include.)
- **Fixtures are crafted (authored as code), modeled on epubcheck's `.feature` scenarios.** Each fixture's `name`/`description` references the epubcheck scenario it mirrors.
- **Reconciliation (decided):** per fixture, `expected` lists only ids in our IMPLEMENTED set; the harness asserts the emitted `{id,severity}` multiset equals `expected` exactly, AND that `report.valid === true` iff `expected` has no FATAL/ERROR. epubcheck ids we don't implement are simply not crafted into the fixture's deviation (we control the fixture, so it triggers only our-implemented rules).

### Implementer discipline for `expected` (important)

`expected` must equal what OUR validator actually emits for the fixture. The plan authors `expected` from our known rules. If the harness shows actual ≠ expected for a fixture:
- If actual is correct per our documented rules (the plan's `expected` was miswritten) → fix `expected` to match, and note it in the report.
- If actual reveals a real validator bug or a missing/spurious message → STOP and report it (do NOT silently change `expected` to hide it). The corpus's job is to catch exactly this.

---

## Reference: epubcheck scenarios mirrored (from the `.feature` files)

Each crafted fixture mirrors an epubcheck scenario. Our `expected` lists only the ids WE implement for that deviation (epubcheck may additionally emit a schema-level RSC-005 for some; we emit only our specific id).

| epubcheck scenario | our fixture | our expected |
|---|---|---|
| `ocf-mimetype-file-missing-error` → PKG-006 | mimetype omitted | PKG-006 |
| `ocf-mimetype-file-incorrect-value-error` → PKG-007 | mimetype wrong value | PKG-007 |
| `ocf-zip-mimetype-entry-extra-field-error` → PKG-005 | mimetype compressed | PKG-005 |
| `ocf-container-file-missing-fatal` → RSC-002 | container.xml omitted | RSC-002 (FATAL) |
| `ocf-metainf-container-mediatype-invalid` → RSC-003 | rootfile wrong media-type | RSC-003 |
| `metadata-title-missing-error` → RSC-005 | OPF without dc:title | RSC-005 |
| `metadata-modified-missing-error` → RSC-005 | OPF without dcterms:modified | RSC-005 |
| `item-nav-missing-error` → RSC-005 | manifest has no nav item | RSC-005 |
| `spine-missing-error` → RSC-005 | OPF without spine | RSC-005 |
| `spine-no-linear-itemref-error` → OPF-033 | spine itemref linear="no" | OPF-033 |
| `spine-item-unknown-error` → OPF-049 (+RSC-005) | itemref idref unknown | OPF-049 |
| `item-duplicate-resource-error` → OPF-074 | two items same href | OPF-074 |
| `package-unique-identifier-attribute-missing-error` → OPF-048 (+RSC-005) | no unique-identifier attr | OPF-048 |
| `package-manifest-item-missing-error` → RSC-001 | manifest item file absent | RSC-001 |
| `nav-toc-missing-error` → RSC-005 | nav without toc | RSC-005 |
| `nav-links-remote-error` → NAV-010 | toc link is remote | NAV-010 |
| `content-xhtml-link-to-missing-doc-error` → RSC-007 | a href to missing doc | RSC-007 |
| `content-xhtml-link-to-missing-id-error` → RSC-012 | a href fragment not defined | RSC-012 |
| `content-css-property-direction-error` → CSS-001 | css `direction` | CSS-001 |
| `content-css-font-face-empty-error` → CSS-019 | css `@font-face {}` | CSS-019 (WARNING) |
| `content-css-font-face-url-empty-error` → CSS-002 | css `url()` empty | CSS-002 |
| `content-css-url-not-present-error` → RSC-007 | css `url(missing)` | RSC-007 |
| `content-css-import-not-declared-error` → RSC-008 | css `@import` undeclared | RSC-008 |

**Supplementary fixtures** (no direct epubcheck fixture found in research, but they exercise ids WE implement — mark `description` "supplementary"): `OPF-001` (unsupported version), `OPF-030` (unique-identifier unresolved), `RSC-006` (remote css image), `RSC-013` (@import with fragment), `RSC-030` (`url(file:)`), `RSC-031` (remote @font-face over HTTP), `CSS-006` (position:fixed), inline `<style>`/`style=""` CSS (RSC-007 / CSS-006).

**Not corpus-tested** (documented, not crafted): `CSS-008` (css-tree is error-tolerant — a parse error is not reliably reproducible; covered by best-effort wiring + unit-level robustness), `PKG-003`/`CHK-001` (internal error paths, not reachable via a well-formed crafted EPUB).

---

## File Structure (this plan)

```
test/
  fixtures/
    build.ts             # buildEpub() + valid baseline constants (MIMETYPE/CONTAINER/OPF/NAV/CONTENT) + cssEpub()  (+ build.test.ts)
    implemented.ts       # IMPLEMENTED_IDS set (the ids our validator can emit)
    corpus.ts            # Fixture type + CORPUS array (the crafted fixtures + expected)
  integration/
    corpus.test.ts       # data-driven harness: per-fixture exact {id,severity} assertion + valid-clean
LICENSE                  # BSD-3-Clause (project)
ATTRIBUTION.md           # credits epubcheck for the ported message catalog (+ scenario modeling)
README.md                # (create or modify) reference LICENSE + ATTRIBUTION
package.json             # (modify) ensure "license": "BSD-3-Clause" + LICENSE/ATTRIBUTION in files allowlist not needed (publish defaults include LICENSE)
```

---

### Task 1: Harness foundation + OCF fixtures

**Files:**
- Create: `test/fixtures/build.ts`, `test/fixtures/build.test.ts`, `test/fixtures/implemented.ts`, `test/fixtures/corpus.ts`, `test/integration/corpus.test.ts`

**Interfaces:**
- Produces:
  - `function buildEpub(o?: EpubOverrides): Uint8Array` and the baseline constants `MIMETYPE`, `CONTAINER`, `OPF`, `NAV`, `CONTENT`, plus `cssEpub(css, extra?)`, `enc` (from `build.ts`).
  - `const IMPLEMENTED_IDS: ReadonlySet<string>` (from `implemented.ts`).
  - `interface Expected { id: string; severity: Severity }`, `interface Fixture { name: string; area: 'ocf'|'opf'|'nav'|'content'|'css'; description: string; epub: Uint8Array; expected: Expected[] }`, `const CORPUS: Fixture[]` (from `corpus.ts`), seeded with the valid baseline + OCF fixtures.
  - `test/integration/corpus.test.ts` — the data-driven harness.

- [ ] **Step 1: Write the build helper**

`test/fixtures/build.ts`
```ts
import { zipSync } from 'fflate'

export const enc = (s: string): Uint8Array => new TextEncoder().encode(s)

export const MIMETYPE = 'application/epub+zip'

export const CONTAINER =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">' +
  '<rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles>' +
  '</container>'

// A fully-valid EPUB 3 package document. Substrings below are stable targets for fixture .replace() edits.
export const OPF =
  '<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid">' +
  '<metadata>' +
  '<dc:identifier id="uid">urn:uuid:00000000-0000-0000-0000-000000000000</dc:identifier>' +
  '<dc:title>Title</dc:title>' +
  '<dc:language>en</dc:language>' +
  '<meta property="dcterms:modified">2020-01-01T00:00:00Z</meta>' +
  '</metadata>' +
  '<manifest>' +
  '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' +
  '<item id="content" href="content_001.xhtml" media-type="application/xhtml+xml"/>' +
  '</manifest>' +
  '<spine><itemref idref="content"/></spine>' +
  '</package>'

export const NAV =
  '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">' +
  '<head><title>t</title></head><body>' +
  '<nav epub:type="toc"><ol><li><a href="content_001.xhtml">Content</a></li></ol></nav>' +
  '</body></html>'

export const CONTENT =
  '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><p>Hello</p></body></html>'

export interface EpubOverrides {
  /** container-path → text content; overrides/extends the baseline. */
  files?: Record<string, string>
  /** container-paths to remove from the baseline (e.g. 'mimetype'). */
  omit?: string[]
  /** compress the mimetype entry (deflate) instead of storing it (for PKG-005). */
  mimetypeDeflate?: boolean
}

export function buildEpub(o: EpubOverrides = {}): Uint8Array {
  const base: Record<string, string> = {
    mimetype: MIMETYPE,
    'META-INF/container.xml': CONTAINER,
    'EPUB/package.opf': OPF,
    'EPUB/nav.xhtml': NAV,
    'EPUB/content_001.xhtml': CONTENT,
  }
  const merged: Record<string, string> = { ...base, ...(o.files ?? {}) }
  for (const k of o.omit ?? []) delete merged[k]

  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {}
  for (const [path, text] of Object.entries(merged)) {
    const level: 0 | 6 = path === 'mimetype' ? (o.mimetypeDeflate ? 6 : 0) : 6
    entries[path] = [enc(text), { level }]
  }
  return zipSync(entries)
}

/** Build a valid EPUB that links a stylesheet `EPUB/style.css` from the content doc. */
export function cssEpub(css: string, extra: Record<string, string> = {}): Uint8Array {
  return buildEpub({
    files: {
      'EPUB/package.opf': OPF.replace(
        '</manifest>',
        '<item id="css" href="style.css" media-type="text/css"/></manifest>',
      ),
      'EPUB/content_001.xhtml': CONTENT.replace(
        '<head><title>t</title></head>',
        '<head><title>t</title><link rel="stylesheet" href="style.css"/></head>',
      ),
      'EPUB/style.css': css,
      ...extra,
    },
  })
}
```

- [ ] **Step 2: Write a smoke test for the build helper, run it (should fail), then it passes once build.ts exists**

`test/fixtures/build.test.ts`
```ts
import { describe, it, expect } from 'vitest'
import { validateEpub } from '../../src/index.js'
import { buildEpub } from './build.js'

describe('buildEpub baseline', () => {
  it('produces a fully-valid EPUB 3 (zero messages)', async () => {
    const report = await validateEpub(buildEpub())
    expect(report.messages).toEqual([])
    expect(report.valid).toBe(true)
  })
})
```
Run: `npx vitest run test/fixtures/build.test.ts` — Expected: PASS (this is the critical baseline; if it emits ANY message, fix the baseline constants until it is clean before proceeding).

- [ ] **Step 3: Write the implemented-ids set**

`test/fixtures/implemented.ts`
```ts
/** Message ids the TS validator can currently emit (Plans 1–6). Expected fixtures must only reference these. */
export const IMPLEMENTED_IDS: ReadonlySet<string> = new Set([
  // container / package-archive
  'PKG-003', 'PKG-005', 'PKG-006', 'PKG-007',
  // resources
  'RSC-001', 'RSC-002', 'RSC-003', 'RSC-005', 'RSC-006', 'RSC-007', 'RSC-008', 'RSC-013', 'RSC-030', 'RSC-031',
  // package document
  'OPF-001', 'OPF-030', 'OPF-033', 'OPF-048', 'OPF-049', 'OPF-074',
  // navigation
  'NAV-010',
  // css
  'CSS-001', 'CSS-002', 'CSS-006', 'CSS-008', 'CSS-019',
  // internal
  'CHK-001',
])
```

- [ ] **Step 4: Write the corpus module (types + OCF fixtures)**

`test/fixtures/corpus.ts`
```ts
import type { Severity } from '../../src/index.js'
import { buildEpub, CONTAINER, OPF } from './build.js'

export interface Expected {
  id: string
  severity: Severity
}
export interface Fixture {
  name: string
  area: 'ocf' | 'opf' | 'nav' | 'content' | 'css'
  description: string
  epub: Uint8Array
  expected: Expected[]
}

const E = (id: string, severity: Severity): Expected => ({ id, severity })

export const CORPUS: Fixture[] = [
  // ---- baseline ----
  { name: 'minimal', area: 'ocf', description: 'minimal valid EPUB 3', epub: buildEpub(), expected: [] },

  // ---- OCF (mirrors epub3/04-ocf) ----
  {
    name: 'ocf-mimetype-missing',
    area: 'ocf',
    description: 'no mimetype entry (epubcheck PKG-006)',
    epub: buildEpub({ omit: ['mimetype'] }),
    expected: [E('PKG-006', 'ERROR')],
  },
  {
    name: 'ocf-mimetype-wrong-value',
    area: 'ocf',
    description: 'mimetype contains the wrong string (epubcheck PKG-007)',
    epub: buildEpub({ files: { mimetype: 'application/oops' } }),
    expected: [E('PKG-007', 'ERROR')],
  },
  {
    name: 'ocf-mimetype-compressed',
    area: 'ocf',
    description: 'mimetype entry is compressed, not stored (epubcheck PKG-005)',
    epub: buildEpub({ mimetypeDeflate: true }),
    expected: [E('PKG-005', 'ERROR')],
  },
  {
    name: 'ocf-container-missing',
    area: 'ocf',
    description: 'META-INF/container.xml absent (epubcheck RSC-002, fatal)',
    epub: buildEpub({ omit: ['META-INF/container.xml'] }),
    expected: [E('RSC-002', 'FATAL')],
  },
  {
    name: 'ocf-rootfile-wrong-mediatype',
    area: 'ocf',
    description: 'container.xml rootfile has the wrong media-type (epubcheck RSC-003)',
    epub: buildEpub({
      files: {
        'META-INF/container.xml': CONTAINER.replace('application/oebps-package+xml', 'text/plain'),
      },
    }),
    expected: [E('RSC-003', 'ERROR')],
  },
]
```
Note: `OPF` is imported for use by later tasks (OPF/CSS fixtures). If lint flags it as unused in THIS task, remove the `OPF` import here and add it back in Task 2. (Cleaner: import only `buildEpub`, `CONTAINER` now; add `OPF` in Task 2.)

- [ ] **Step 5: Write the harness**

`test/integration/corpus.test.ts`
```ts
import { describe, it, expect } from 'vitest'
import { validateEpub, type Severity } from '../../src/index.js'
import { CORPUS, type Expected } from '../fixtures/corpus.js'
import { IMPLEMENTED_IDS } from '../fixtures/implemented.js'

const key = (m: { id: string; severity: Severity }): string => `${m.severity} ${m.id}`

describe('fixture corpus', () => {
  for (const fixture of CORPUS) {
    it(`${fixture.area}: ${fixture.name}`, async () => {
      // Guard: expected only references implemented ids.
      for (const e of fixture.expected) {
        expect(IMPLEMENTED_IDS.has(e.id), `expected id ${e.id} is not implemented`).toBe(true)
      }

      const report = await validateEpub(fixture.epub)
      const actual = report.messages.map(key).sort()
      const want = fixture.expected.map(key).sort()
      expect(actual).toEqual(want)

      const hasError = fixture.expected.some((e: Expected) => e.severity === 'FATAL' || e.severity === 'ERROR')
      expect(report.valid).toBe(!hasError)
    })
  }
})
```

- [ ] **Step 6: Run the harness + lint + typecheck**

Run: `npx vitest run test/fixtures/build.test.ts test/integration/corpus.test.ts && npm run lint && npx tsc --noEmit`
Expected: PASS / clean. Every OCF fixture's actual emitted set equals its `expected`. If any fixture mismatches, apply the "Implementer discipline for `expected`" rule above.

- [ ] **Step 7: Commit**

```bash
git add test/fixtures/build.ts test/fixtures/build.test.ts test/fixtures/implemented.ts test/fixtures/corpus.ts test/integration/corpus.test.ts
git commit -m "test: add fixture-corpus harness and OCF fixtures"
```

---

### Task 2: OPF fixtures

**Files:**
- Modify: `test/fixtures/corpus.ts`

**Interfaces:**
- Consumes: `buildEpub`, `OPF` from `./build.js`; the `CORPUS`/`Fixture`/`E` already defined.
- Produces: OPF fixtures appended to `CORPUS`.

- [ ] **Step 1: Append the OPF fixtures**

Ensure `OPF` is imported from `./build.js` (add it to the import if Task 1 removed it). Append these entries to the `CORPUS` array:
```ts
  // ---- OPF (mirrors epub3/05-package-document) ----
  {
    name: 'opf-title-missing',
    area: 'opf',
    description: 'package metadata has no dc:title (epubcheck RSC-005)',
    epub: buildEpub({ files: { 'EPUB/package.opf': OPF.replace('<dc:title>Title</dc:title>', '') } }),
    expected: [E('RSC-005', 'ERROR')],
  },
  {
    name: 'opf-modified-missing',
    area: 'opf',
    description: 'no dcterms:modified meta (epubcheck RSC-005)',
    epub: buildEpub({ files: { 'EPUB/package.opf': OPF.replace('<meta property="dcterms:modified">2020-01-01T00:00:00Z</meta>', '') } }),
    expected: [E('RSC-005', 'ERROR')],
  },
  {
    name: 'opf-nav-missing',
    area: 'opf',
    description: 'no manifest item declares the nav property (epubcheck RSC-005)',
    epub: buildEpub({ files: { 'EPUB/package.opf': OPF.replace(' properties="nav"', '') } }),
    expected: [E('RSC-005', 'ERROR')],
  },
  {
    name: 'opf-spine-missing',
    area: 'opf',
    description: 'package has no spine element (epubcheck RSC-005)',
    epub: buildEpub({ files: { 'EPUB/package.opf': OPF.replace('<spine><itemref idref="content"/></spine>', '') } }),
    expected: [E('RSC-005', 'ERROR')],
  },
  {
    name: 'opf-spine-no-linear',
    area: 'opf',
    description: 'spine has no linear itemref (epubcheck OPF-033)',
    epub: buildEpub({ files: { 'EPUB/package.opf': OPF.replace('<itemref idref="content"/>', '<itemref idref="content" linear="no"/>') } }),
    expected: [E('OPF-033', 'ERROR')],
  },
  {
    name: 'opf-spine-item-unknown',
    area: 'opf',
    description: 'spine itemref idref is not a manifest item (epubcheck OPF-049)',
    epub: buildEpub({ files: { 'EPUB/package.opf': OPF.replace('idref="content"', 'idref="nope"') } }),
    expected: [E('OPF-049', 'ERROR')],
  },
  {
    name: 'opf-duplicate-resource',
    area: 'opf',
    description: 'two manifest items resolve to the same href (epubcheck OPF-074)',
    epub: buildEpub({ files: { 'EPUB/package.opf': OPF.replace('</manifest>', '<item id="dup" href="content_001.xhtml" media-type="application/xhtml+xml"/></manifest>') } }),
    expected: [E('OPF-074', 'ERROR')],
  },
  {
    name: 'opf-unique-identifier-attr-missing',
    area: 'opf',
    description: 'package has no unique-identifier attribute (epubcheck OPF-048)',
    epub: buildEpub({ files: { 'EPUB/package.opf': OPF.replace(' unique-identifier="uid"', '') } }),
    expected: [E('OPF-048', 'ERROR')],
  },
  {
    name: 'opf-manifest-item-missing-file',
    area: 'opf',
    description: 'manifest declares a file absent from the container (epubcheck RSC-001)',
    epub: buildEpub({ files: { 'EPUB/package.opf': OPF.replace('</manifest>', '<item id="missing" href="missing.xhtml" media-type="application/xhtml+xml"/></manifest>') } }),
    expected: [E('RSC-001', 'ERROR')],
  },
  {
    name: 'opf-version-unsupported',
    area: 'opf',
    description: 'supplementary: package version is not 2.0/3.0 (OPF-001)',
    epub: buildEpub({ files: { 'EPUB/package.opf': OPF.replace('version="3.0"', 'version="4.0"') } }),
    expected: [E('OPF-001', 'ERROR')],
  },
  {
    name: 'opf-unique-identifier-unresolved',
    area: 'opf',
    description: 'supplementary: unique-identifier does not match any dc:identifier id (OPF-030)',
    epub: buildEpub({ files: { 'EPUB/package.opf': OPF.replace('<dc:identifier id="uid">', '<dc:identifier id="other">') } }),
    expected: [E('OPF-030', 'ERROR')],
  },
```

- [ ] **Step 2: Run the harness + lint + typecheck**

Run: `npx vitest run test/integration/corpus.test.ts && npm run lint && npx tsc --noEmit`
Expected: PASS / clean. If a fixture mismatches, apply the "Implementer discipline for `expected`" rule (most likely cause: our validator emits an additional correct message you must add to `expected`, or the deviation triggered a second rule — investigate and reconcile honestly).

- [ ] **Step 3: Commit**

```bash
git add test/fixtures/corpus.ts
git commit -m "test: add OPF fixtures to the corpus"
```

---

### Task 3: Nav + content fixtures

**Files:**
- Modify: `test/fixtures/corpus.ts`

**Interfaces:**
- Consumes: `buildEpub`, `NAV`, `CONTENT` from `./build.js`.
- Produces: nav + content fixtures appended to `CORPUS`.

- [ ] **Step 1: Append the nav + content fixtures**

Add `NAV` and `CONTENT` to the `./build.js` import. Append:
```ts
  // ---- Navigation (mirrors epub3/07-navigation-document) ----
  {
    name: 'nav-toc-missing',
    area: 'nav',
    description: 'nav document has no toc nav (epubcheck RSC-005)',
    epub: buildEpub({
      files: {
        // Remove the <nav> entirely so the only deviation is "no toc nav"
        // (renaming to landmarks would add a second RSC-005 for the anchor's missing epub:type).
        'EPUB/nav.xhtml': NAV.replace(
          '<nav epub:type="toc"><ol><li><a href="content_001.xhtml">Content</a></li></ol></nav>',
          '<p>no nav</p>',
        ),
      },
    }),
    expected: [E('RSC-005', 'ERROR')],
  },
  {
    name: 'nav-link-remote',
    area: 'nav',
    description: 'toc nav link points to a remote URL (epubcheck NAV-010)',
    epub: buildEpub({ files: { 'EPUB/nav.xhtml': NAV.replace('href="content_001.xhtml"', 'href="https://example.com/x"') } }),
    expected: [E('NAV-010', 'ERROR')],
  },

  // ---- Content references (mirrors epub3/06-content-document) ----
  {
    name: 'content-link-missing-doc',
    area: 'content',
    description: 'content a@href points to a missing document (epubcheck RSC-007)',
    epub: buildEpub({ files: { 'EPUB/content_001.xhtml': CONTENT.replace('<p>Hello</p>', '<p><a href="missing.xhtml">x</a></p>') } }),
    expected: [E('RSC-007', 'ERROR')],
  },
  {
    name: 'content-link-missing-fragment',
    area: 'content',
    description: 'content a@href has a same-doc fragment that is not defined (epubcheck RSC-012)',
    epub: buildEpub({ files: { 'EPUB/content_001.xhtml': CONTENT.replace('<p>Hello</p>', '<p><a href="#nope">x</a></p>') } }),
    expected: [E('RSC-012', 'ERROR')],
  },
```
Note: `nav-toc-missing` removes the entire `<nav>` element (so the document has zero nav sections → exactly one "missing toc" RSC-005, with no incidental landmarks/anchor errors). If any fixture's actual ≠ expected, reconcile honestly per the discipline rule.

- [ ] **Step 2: Run the harness + lint + typecheck**

Run: `npx vitest run test/integration/corpus.test.ts && npm run lint && npx tsc --noEmit`
Expected: PASS / clean (reconcile `expected` honestly per the discipline rule if any mismatch — especially `nav-toc-missing` per the note above).

- [ ] **Step 3: Commit**

```bash
git add test/fixtures/corpus.ts
git commit -m "test: add nav and content fixtures to the corpus"
```

---

### Task 4: CSS fixtures (external + inline)

**Files:**
- Modify: `test/fixtures/corpus.ts`

**Interfaces:**
- Consumes: `buildEpub`, `cssEpub`, `CONTENT` from `./build.js`.
- Produces: CSS fixtures appended to `CORPUS`.

- [ ] **Step 1: Append the CSS fixtures**

Add `cssEpub` to the `./build.js` import. Append:
```ts
  // ---- CSS (mirrors epub3/06-content-document css scenarios) ----
  { name: 'css-valid', area: 'css', description: 'valid EPUB with a stylesheet', epub: cssEpub('p { color: red; }'), expected: [] },
  {
    name: 'css-property-direction',
    area: 'css',
    description: 'stylesheet uses the direction property (epubcheck CSS-001)',
    epub: cssEpub('body { direction: rtl; }'),
    expected: [E('CSS-001', 'ERROR')],
  },
  {
    name: 'css-font-face-empty',
    area: 'css',
    description: 'empty @font-face block (epubcheck CSS-019)',
    epub: cssEpub('@font-face {}'),
    expected: [E('CSS-019', 'WARNING')],
  },
  {
    name: 'css-url-empty',
    area: 'css',
    description: 'empty url() reference (epubcheck CSS-002)',
    epub: cssEpub('body { background: url(); }'),
    expected: [E('CSS-002', 'ERROR')],
  },
  {
    name: 'css-url-missing',
    area: 'css',
    description: 'url() target is absent from the container (epubcheck RSC-007)',
    epub: cssEpub('body { background: url(missing.png); }'),
    expected: [E('RSC-007', 'ERROR')],
  },
  {
    name: 'css-import-not-declared',
    area: 'css',
    description: '@import target is present but not in the manifest (epubcheck RSC-008)',
    epub: cssEpub('@import "extra.css";', { 'EPUB/extra.css': 'p{}' }),
    expected: [E('RSC-008', 'ERROR')],
  },
  {
    name: 'css-remote-image',
    area: 'css',
    description: 'supplementary: remote background image not allowed (RSC-006)',
    epub: cssEpub('body { background: url(https://example.com/a.png); }'),
    expected: [E('RSC-006', 'ERROR')],
  },
  {
    name: 'css-import-fragment',
    area: 'css',
    description: 'supplementary: @import url has a fragment (RSC-013) + target undeclared (RSC-008)',
    epub: cssEpub('@import "other.css#x";', { 'EPUB/other.css': 'p{}' }),
    expected: [E('RSC-013', 'ERROR'), E('RSC-008', 'ERROR')],
  },
  {
    name: 'css-file-url',
    area: 'css',
    description: 'supplementary: file: URL is not allowed (RSC-030)',
    epub: cssEpub('body { background: url(file:///etc/passwd); }'),
    expected: [E('RSC-030', 'ERROR')],
  },
  {
    name: 'css-font-remote-http',
    area: 'css',
    description: 'supplementary: remote @font-face over HTTP should be HTTPS (RSC-031)',
    epub: cssEpub('@font-face { font-family: F; src: url(http://example.com/f.woff2); }'),
    expected: [E('RSC-031', 'WARNING')],
  },
  {
    name: 'css-position-fixed',
    area: 'css',
    description: 'supplementary: position:fixed (CSS-006, usage)',
    epub: cssEpub('div { position: fixed; }'),
    expected: [E('CSS-006', 'USAGE')],
  },
  {
    name: 'inline-style-element-url-missing',
    area: 'css',
    description: 'supplementary: <style> element url() target missing (RSC-007)',
    epub: buildEpub({ files: { 'EPUB/content_001.xhtml': CONTENT.replace('<head><title>t</title></head>', '<head><title>t</title><style>body { background: url(missing.png); }</style></head>') } }),
    expected: [E('RSC-007', 'ERROR')],
  },
  {
    name: 'inline-style-attr-position-fixed',
    area: 'css',
    description: 'supplementary: style="" attribute position:fixed (CSS-006, usage)',
    epub: buildEpub({ files: { 'EPUB/content_001.xhtml': CONTENT.replace('<p>Hello</p>', '<p style="position: fixed">x</p>') } }),
    expected: [E('CSS-006', 'USAGE')],
  },
```

- [ ] **Step 2: Run the harness + lint + typecheck**

Run: `npx vitest run test/integration/corpus.test.ts && npm run lint && npx tsc --noEmit`
Expected: PASS / clean (reconcile `expected` honestly per the discipline rule on any mismatch — e.g. confirm `css-import-fragment` emits exactly RSC-013 + RSC-008).

- [ ] **Step 3: Run the FULL gate**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: all green; build emits `dist/index.js` + `dist/index.d.ts`.

- [ ] **Step 4: Commit**

```bash
git add test/fixtures/corpus.ts
git commit -m "test: add CSS fixtures to the corpus"
```

---

### Task 5: LICENSE + ATTRIBUTION

**Files:**
- Create: `LICENSE`, `ATTRIBUTION.md`
- Create or modify: `README.md`
- Modify: `package.json` (confirm `license` field; no other change needed)

**Interfaces:**
- Produces: a BSD-3-Clause `LICENSE` for the project, an `ATTRIBUTION.md` crediting epubcheck for the ported message-catalog templates and the scenario modeling, and a README reference.

- [ ] **Step 1: Create the LICENSE (BSD-3-Clause)**

`LICENSE`
```
BSD 3-Clause License

Copyright (c) 2026, epubcheck-ts contributors

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

- [ ] **Step 2: Create ATTRIBUTION.md**

`ATTRIBUTION.md`
```markdown
# Attribution

epubcheck-ts is a fresh, TypeScript-native EPUB validator inspired by
[w3c/epubcheck](https://github.com/w3c/epubcheck). It is not a port of
epubcheck's code.

## Message catalog

The validation message identifiers (e.g. `OPF-014`, `RSC-005`, `NAV-010`) and
their English message templates are reused from epubcheck's
`MessageBundle.properties` so that results are compatible with existing
epubcheck-aware tooling. epubcheck is distributed under the BSD 3-Clause
License:

```
Copyright (c) 2007, Adobe Systems Incorporated
Copyright (c) 2008, IDPF
Copyright (c) 2017, W3C
```

## Test fixtures

The fixtures under `test/fixtures/` are original works authored for this
project. They are *modeled on* the scenarios described in epubcheck's
Cucumber `.feature` test files (which document the expected message for each
case), but no epubcheck source or binary test files are redistributed here.
```

- [ ] **Step 3: Reference LICENSE + ATTRIBUTION in the README**

If `README.md` does not exist, create it; otherwise append a License section:
```markdown
## License

epubcheck-ts is licensed under the [BSD 3-Clause License](./LICENSE).

It reuses epubcheck's message-id vocabulary and message templates — see
[ATTRIBUTION.md](./ATTRIBUTION.md).
```
(If creating the README from scratch, add a one-line project title/description above the License section, e.g. `# epubcheck-ts` and a sentence describing it.)

- [ ] **Step 4: Confirm package.json license + run the gate**

Confirm `package.json` has `"license": "BSD-3-Clause"` (it should already, from Plan 1). No change needed if so.
Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: all green (these files don't affect the build, but run the gate to be safe).

- [ ] **Step 5: Commit**

```bash
git add LICENSE ATTRIBUTION.md README.md
git commit -m "docs: add BSD-3-Clause LICENSE and epubcheck ATTRIBUTION"
```

---

## Roadmap (subsequent plans)

- **Long-tail rules:** content `RSC-010/011` (hyperlink type/spine) + `RSC-031/032`; nav `NAV-011` reading-order + `RSC-012` for nav links; OPF `OPF-003` (undeclared files) + `PKG-001` (version mismatch); CSS `CSS-003/004` charset + `CSS-005/015` alternate-stylesheet titles + `CSS-007` font-MIME. Each new rule adds a corpus fixture mirroring its epubcheck scenario.
- **Attribute-namespace resolution** in `parseXml` (so `epub:type`/`xlink:href` match by URI, not prefix); CDATA-wrapped `<style>` handling; the container.xml parse-error path.
- **EPUB 2** support (NCX/OPF2/guide) behind the existing interfaces.

---

## Self-Review

**Spec coverage (§10 fixture corpus):** crafted EPUBs modeled on epubcheck `.feature` scenarios → Tasks 1–4; data-driven harness asserting per-fixture `{id,severity}` exact match + valid-clean → Task 1; subset-match reconciliation via `expected` over `IMPLEMENTED_IDS` → Tasks 1–4; LICENSE + ATTRIBUTION for the ported catalog → Task 5. Every implemented id with a craftable trigger is covered at least once (OCF: PKG-005/006/007, RSC-002/003; OPF: RSC-005 ×4 forms, OPF-001/030/033/048/049/074, RSC-001; nav: RSC-005, NAV-010; content: RSC-007, RSC-012; CSS: CSS-001/002/006/019, RSC-006/007/008/013/030/031). `CSS-008` and `PKG-003`/`CHK-001` are documented as not corpus-craftable. No fixture-corpus gaps.

**Placeholder scan:** No TBD/TODO; every code step has complete code. The "Implementer discipline for `expected`" rule is a real reconciliation procedure (not a placeholder) — `expected` values are authored concretely; the rule governs how to handle a genuine actual-vs-expected mismatch (a real corpus need), and explicitly forbids hiding bugs.

**Type consistency:** `buildEpub`/`cssEpub`/baseline constants (Task 1, build.ts) consumed unchanged in Tasks 2–4. `Fixture`/`Expected`/`E`/`CORPUS` defined in Task 1 (corpus.ts) and appended to in Tasks 2–4 with identical shapes. `IMPLEMENTED_IDS` (Task 1) consumed by the harness (Task 1). `Severity` imported from the public `src/index.js` in both corpus.ts and the harness. The harness's `key`-based multiset comparison + `valid` check are defined once (Task 1). LICENSE/ATTRIBUTION (Task 5) are docs, no type surface.
```
