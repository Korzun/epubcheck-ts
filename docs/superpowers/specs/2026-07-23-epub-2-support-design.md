# EPUB 2 support — full-pipeline validation

**Date:** 2026-07-23
**Status:** Approved design, pending implementation plan

## Goal

Give EPUB 2 books the same depth of validation EPUB 3 books get today. The
validator currently stops after OCF + generic OPF checks when the target major
is 2.0 (`validate.ts` gates the nav/content/CSS layers to major 3.0). This plan
adds:

1. **NCX parsing + validation** (`toc.ncx` is EPUB 2's navigation document).
2. **OPF 2.0 rules** — spine `toc` attribute, `<guide>`, EPUB 2 blessed media
   types, spine fallback chains.
3. **Content/CSS layers for EPUB 2** — the existing `validateContentDocs` /
   `validateCssDocs` run on 2.0 books with version-gated rules.

NCX validation also runs on **EPUB 3 books that ship a legacy NCX** (matching
epubcheck).

Approach: **extend in place with version gating** (the established
`majorVersion`/`atLeast` idiom) — no separate EPUB 2 module, no profile-object
refactor. All rule IDs, severities, and message texts are source-verified
against w3c/epubcheck (`OPFChecker.java`, `OPFHandler.java`, `NCXChecker.java`,
`NCXHandler.java`, `DefaultSeverities.java`, `MessageBundle.properties`).

Out of scope: OEBPS 1.2 rules (OPF-038/039), DTBook *content* parsing (DTBook
spine items are accepted at the OPF level; the content layer parses XHTML only
— under-validation, never false positives), NCX-002 (SUPPRESSED by default in
epubcheck), the CLI.

## Section 1: Pipeline & version flow (`validate.ts`)

The `majorVersion(target) === '3.0'` gate on the layered documents becomes a
version dispatch:

- **Major 3.0:** existing nav-doc flow unchanged, *plus* NCX validation when
  the book ships one (found via the spine `toc` idref, falling back to an
  `application/x-dtbncx+xml` manifest item).
- **Major 2.0:** NCX replaces the nav doc (parse + validate), then
  `validateContentDocs` and `validateCssDocs` run with the 2.0 target.

**Latent bug fixed:** `checkPackage` (`checks/opf.ts`) requires exactly one
`dcterms:modified` meta unconditionally — an EPUB 3-only rule that would
false-positive on every EPUB 2 book. It gets gated to major 3.0. Ungating the
content layers requires sweeping the version-agnostic checks for similar
3.0-isms; this is the known one.

Unchanged: `resolveTarget`, PKG-001 mismatch reporting, the `EpubVersion`
type (2.0/2.0.1 already rank 20 and share one validation profile).

## Section 2: NCX layer (`src/parse/ncx.ts` + `src/checks/ncx.ts`)

New parse/check pair following the `parse/nav.ts` / `checks/nav.ts` pattern.

**`parseNcx(item, container)` → `{ ncx?: NcxDocument, messages }`.** Total
function (never throws). Captures:

- `uid` — the `<meta name="dtb:uid" content="…">` value, **untrimmed**
  (whitespace matters for NCX-004), plus its location.
- `navPoints` — flattened navMap points, each with label text, `content@src`,
  and location.
- `navMapPresent`, docTitle presence, locations.
- All `<text>` label elements (navLabel, docTitle) with content + location.

**`validateNcx(ncx, pkg, container)`:**

| ID | Severity | Condition |
|---|---|---|
| `NCX-001` | ERROR | trimmed `dtb:uid` ≠ the OPF unique-identifier's value. Params: ncx uid, opf uid. |
| `NCX-004` | USAGE | `dtb:uid` has leading/trailing whitespace |
| `NCX-006` | USAGE | empty or whitespace-only `<text>` label |
| `RSC-005` | ERROR | structural violations the NCX RNG schema enforces, hand-written: missing `navMap`; navPoint without `content` or without a label (same approach as the existing OPF RSC-005s) |
| `RSC-007` / `RSC-012` | ERROR | `content@src` resolves to a missing resource / missing fragment — reuses the existing reference-check infrastructure |

**Verify during planning:** whether epubcheck fires `RSC-011` (link target not
in spine) for NCX `content@src` targets; include only if the reference
implementation does.

## Section 3: OPF 2.0 rules (`parse/opf.ts` + `checks/opf.ts`)

**Parser additions** (version-agnostic capture, following the `bindings`
precedent):

- `<guide>` → `guide: GuideReference[]` (`type`, `title`, `href`, `loc`).
- `<spine toc="…">` → `spineToc?: string` and the spine element's location.

**New checks, gated `majorVersion(version) === '2.0'` unless noted:**

| ID | Severity | Condition |
|---|---|---|
| `OPF-031` | ERROR | guide reference href not declared in the manifest |
| `OPF-032` | ERROR | guide reference to a non-content-document type |
| `OPF-034` | ERROR | spine references the same manifest item twice |
| `OPF-035` | WARNING | manifest item with `text/html` ("not appropriate for XHTML/OPS") |
| `OPF-037` | WARNING | deprecated media type (`text/x-oeb1-document`, `text/x-oeb1-css`) |
| `OPF-042` | ERROR | spine item is a style or image type |
| `OPF-043` | ERROR | spine item with non-blessed media type and no fallback |
| `OPF-044` | ERROR | spine item whose fallback chain never reaches a blessed content document — reuses the cycle-guarded `hasFallbackTo` walker |
| `OPF-049` | ERROR | spine `toc` idref not in the manifest (same ID epubcheck uses for itemref; `OPFHandler.java:591`) |
| `OPF-040` | ERROR | manifest item `fallback` idref not found in the manifest — **version-agnostic** (epubcheck `FallbackChainResolver` runs for both majors; added after verification surfaced it in the v2 test suite) |
| `OPF-050` | ERROR | spine `toc` idref resolves to a manifest item whose media type isn't `application/x-dtbncx+xml` (`OPFHandler.java:908-911`) |
| `RSC-005` | ERROR | spine missing the `toc` attribute (required by the OPF 2.0 schema) |
| `OPF-099` | ERROR | manifest lists the package document itself — **version-agnostic** (epubcheck fires it for both majors) |

**EPUB 2 blessed sets** (source-verified from `OPFChecker.java`):

- Content documents: `application/xhtml+xml`, `application/x-dtbook+xml`;
  deprecated: `text/x-oeb1-document`, `text/html`.
- Styles: `text/css`; deprecated: `text/x-oeb1-css`.
- Images: `image/gif`, `image/png`, `image/jpeg`, `image/svg+xml`.

## Section 4: Media types & content/CSS layers under EPUB 2

**`versions.ts`** — `coreMediaTypes(v)` becomes version-aware: for major 2.0 it
returns the EPUB 2 blessed set (XHTML, DTBook, CSS, the four image types, NCX
`application/x-dtbncx+xml`, + deprecated OEB types) instead of the 3.x core
list. The blessed content/style/image subsets live here too, exported for both
OPF and content checks.

**`checks/content.ts`** rule gating when the target is major 2.0:

| Rule | EPUB 2 behavior |
|---|---|
| `RSC-007`/`RSC-008`/`RSC-012` | unchanged — version-agnostic |
| `RSC-010` | runs with the EPUB 2 blessed-content set (XHTML, DTBook, deprecated types; **not** SVG — not a content doc in EPUB 2; verify exact epubcheck v2 set during planning) |
| `RSC-011` | unchanged |
| `RSC-032` | **runs for v2 too** (verified: epubcheck's EPUB 2 suite expects it — `opf-fallback-non-resolving-error` → OPF-040 + RSC-032; `checkFallbacks` has no version gate and keys off the EPUB 3 core list even under v2). Stays as-is, using `coreMediaTypes(target)` — for a 2.0 target that yields the 3.0 base list, matching epubcheck modulo the project's existing per-revision webp/ecmascript gating. |
| `RSC-006` | **new, 2.0-only**: remote resource reference (ERROR). Verified scope (`ResourceReferencesChecker.checkRemoteReference`): fires for every remote reference type except hyperlink/cite/link; the EPUB 3 audio/video/font exemptions don't apply under v2. `RSC-031` (https advice) is v3-only (verified: explicit `version == VERSION_3` guard). |
| `epub:switch`/`trigger`, bindings | already gated `atLeast(v, '3.2')` — unaffected |

**`checks/css.ts`** — runs as-is for EPUB 2 (CSS rules are version-agnostic in
epubcheck), except: verify during planning whether `CSS-007`'s blessed-font
check matches epubcheck's v2 behavior; worst case it gets gated.

## Section 5: Testing

**Unit tests (colocated):** `parse/ncx.test.ts`, `checks/ncx.test.ts`, plus
extended cases in `parse/opf.test.ts`, `checks/opf.test.ts`,
`checks/content.test.ts`, `versions.test.ts` for every new rule and gate —
including the regression case that an EPUB 2 book does **not** get the
`dcterms:modified` RSC-005.

**Corpus fixtures (`test/fixtures/`):**

- `build.ts` gains a valid EPUB 2 baseline (`buildEpub2` / `VALID_EPUB2_*`
  constants: OPF 2.0 package with NCX, spine `toc`, guide, XHTML content). The
  valid-clean harness proves a valid EPUB 2 book produces zero messages.
- One crafted corpus fixture per new rule, each mirroring an epubcheck
  `.feature` scenario: NCX-001, NCX-006, OPF-031, OPF-032, OPF-034, OPF-035,
  OPF-037, OPF-042, OPF-043, OPF-044, OPF-050, OPF-099, RSC-006,
  missing-navMap RSC-005, missing-spine-toc RSC-005, plus an "EPUB 3 with
  broken legacy NCX" fixture covering the cross-version NCX decision.
- New IDs added to `IMPLEMENTED_IDS`; new catalog entries in
  `messages/catalog.ts` with epubcheck's exact message text and default
  severities (already fetched from `MessageBundle.properties` /
  `DefaultSeverities.java`).

TDD throughout, per the project's standard workflow.

## Verify-during-planning items — RESOLVED

All four resolved against w3c/epubcheck main source during planning:

1. **RSC-011 for NCX targets: YES.** `NCXHandler` registers `content@src` as
   `Reference.Type.HYPERLINK`, so NCX links get the full hyperlink checks
   (RSC-007/008/010/011/012). The v2 feature suite confirms
   (`ncx-link-to-non-ops-error` → RSC-010, `ncx-missing-resource-error` →
   RSC-007). NCX links do NOT get the NAV-011 reading-order check (that is
   `NAV_TOC_LINK`-typed, EPUB 3 nav only).
2. **RSC-010 v2 blessed set:** `isBlessedItemType(v2)` =
   `application/xhtml+xml`, `application/x-dtbook+xml`; plus deprecated
   `text/x-oeb1-document`, `text/html`; plus content-document fallback. (SVG is
   v3-only, confirmed.)
3. **RSC-006 v2 scope:** every remote reference type except
   hyperlink/cite/link. RSC-031 is v3-only.
4. **CSS-007 under v2:** uses `OPFChecker.isBlessedFontMimetype20` — a prefix
   predicate (`font/*`, `application/font*`, `application/x-font*`, or exactly
   `application/vnd.ms-opentype`) instead of the 3.x exact-match set. Requires
   threading the version into `validateCss`/`validateCssDocs` (as a new
   optional trailing parameter — additive, non-breaking).

Additional verified details folded into the sections above: RSC-032 ungated
(runs for v2), OPF-040 added, OPF-032 checks the blessed set only (no fallback
walk), OPF-035 is scoped to `text/html` and OPF-037 to the two `x-oeb1` types.
