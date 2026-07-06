# Expand supported EPUB versions to per-revision validation

**Date:** 2026-07-06
**Status:** Approved design, pending implementation plan

## Goal

Expand the versions this validator understands from the two major versions
(`2.0`, `3.0`) to the full set of published revisions — **2.0, 2.0.1, 3.0,
3.0.1, 3.2, 3.3** — and apply revision-specific validation rules where the
specs actually differ.

EPUB 3.4 is explicitly **out of scope**: it is not a published W3C spec (3.3,
from 2023, is the current Recommendation). It can be added later once it exists.

## Key structural fact

The OPF `<package version="…">` attribute is only ever `"2.0"` or `"3.0"`.
Every EPUB 3.x revision (3.0, 3.0.1, 3.2, 3.3) carries `version="3.0"`; 2.0 and
2.0.1 both carry `version="2.0"`. **There is no in-document signal that
distinguishes revisions within a major version.** Consequently:

- Auto-detection from the package document resolves the **major version only**
  (`2.0` or `3.0`).
- The specific revision to validate against is **caller-specified**, via
  `options.version`. This mirrors how the reference epubcheck operates (you tell
  it the target).

### What is actually checkable (research-verified)

The differences that matter for the checks this project performs cluster in a
small, well-bounded set. Verified against the live IDPF/W3C specs:

**Collapses — no distinct, checkable rules:**

- **2.0 vs 2.0.1** — identical validation profile. Maintenance/errata release,
  same `version="2.0"`, no mechanically-checkable OPF/XHTML/CSS difference.
- **3.0 vs 3.0.1** — both `version="3.0"`; the only real delta (fixed-layout
  `rendition:*` metadata merged into core) is not something this checker
  validates today, and there is no in-file signal to branch on. Treated as one
  profile.

**Stable across all 3.x — no branching needed** (confirmed, so existing checks
are already correct): `dcterms:modified` requirement (required in every 3.x —
the "it loosened" rumor is false), required `dc:` metadata (identifier/title/
language, each ≥ 1), Navigation Document required types (toc required; page-list
and landmarks optional), and the `meta`/`property`/`scheme`/`refines` syntax.

**Genuine, checkable revision deltas — the scope of this work:**

| Feature | 2.0.1 | 3.0 / 3.0.1 | 3.2 | 3.3 | We flag? |
|---|---|---|---|---|---|
| `<bindings>` (OPF) | n/a | active | deprecated | deprecated | yes (3.2+) |
| `epub:switch` (content) | n/a | active | deprecated | deprecated | yes (3.2+) |
| `epub:trigger` (content) | n/a | active | deprecated | deprecated | yes (3.2+) |
| `<guide>` (OPF) | allowed | deprecated | legacy | legacy | **no** |
| NCX + spine `toc` attr | required | optional (superseded) | legacy | legacy | **no** |
| Core Media Types | 2.0 set | base 3.0 set | +WOFF2, +SFNT, +`application/javascript` | +WebP, +Opus, +`application/ecmascript`, −PLS | yes |

**Fidelity note (why guide/NCX are not flagged):** the reference epubcheck emits
*no* deprecation or legacy warning for `<guide>` or for NCX / the spine `toc`
attribute — it treats NCX as a valid EPUB-2 compatibility feature and only
validates guide *references*. Since this project is a faithful port of
epubcheck's message vocabulary, emitting warnings epubcheck never produces would
be a divergence (and noise on otherwise-valid files). So the deprecation scope is
`bindings` + `epub:switch` + `epub:trigger` only. These three are reported by
epubcheck through the generic **`RSC-017` (WARNING)** message with
feature-specific wording as the parameter; we additionally gate them to
`atLeast(v,'3.2')`, which is *more* revision-accurate than epubcheck (which does
not maintain a per-revision distinction and warns for all EPUB 3).

The `switch` **manifest-property token** has a quirk worth noting: present in
3.0/3.0.1, absent in 3.2 (6-token vocab), re-added as deprecated in 3.3. We do
not validate the manifest property vocabulary today, so this is informational.

## Architecture (Approach B: central revision module + threaded target)

All knowledge that varies by revision lives in one declarative module; the check
modules stay thin and ask that module. Chosen over inline branching (knowledge
scatters) and per-revision strategy modules (heavy duplication for a curated
subset, fights the functional ethos).

### End-to-end flow

```
input → openEpub → parseOpf (now captures guide/bindings/toc + switch/trigger)
      → resolveVersion(detectedMajor, options.version) → target: EpubVersion
      → validateOpf(pkg, container, target)          // + deprecation/legacy gating
      → if majorVersion(target) === '3.0':
            nav / content(coreMediaTypes(target)) / css
      → buildReport(messages, target)
```

## Components

### 1. `src/versions.ts` (new — single source of truth)

```ts
export type EpubVersion = '2.0' | '2.0.1' | '3.0' | '3.0.1' | '3.2' | '3.3'

// Gating rank encodes "these are one profile":
//   2.0 / 2.0.1 → 20,  3.0 / 3.0.1 → 30,  3.2 → 32,  3.3 → 33
majorVersion(v: EpubVersion): '2.0' | '3.0'   // EPUB3-only gating + PKG-001 compare
atLeast(v: EpubVersion, floor: EpubVersion): boolean   // rank(v) >= rank(floor)
coreMediaTypes(v: EpubVersion): ReadonlySet<string>
```

`coreMediaTypes` is built by **layering** the research matrix, so the diffs read
as data:

```
base EPUB3 set
  + 3.2 : font/woff2, application/font-sfnt, application/javascript
  + 3.3 : image/webp, audio/ogg;codecs=opus, application/ecmascript
  − 3.3 : application/pls+xml
```

Deprecation/legacy gating uses `atLeast` with the floors documented here in one
place (`bindings`/`switch`/`trigger` → `'3.2'`; `guide` → EPUB 3; NCX legacy →
`'3.2'`).

Types are colocated with the module that produces them (no types-only file), and
the module is pure functions (no classes), consistent with project conventions.

### 2. Version resolution in `src/validate.ts`

Replaces the current inline `detectedVersion` logic:

- **Detect major**: `pkg.version === '2.0'` → `'2.0'`; `=== '3.0'` → `'3.0'`;
  otherwise `undefined` (which still triggers `OPF-001` in `checkPackage`).
- **Resolve target**: if `options.version` is set, that is the target;
  otherwise the **default is the detected major's base** (`'2.0'` or `'3.0'`) —
  the most lenient ruleset, so a bare EPUB 3 file emits no deprecation warnings
  unless the caller explicitly opts into `3.2`/`3.3`.
- **PKG-001 mismatch** compares **majors**:
  `majorVersion(target) !== detectedMajor`. So `{version:'3.3'}` against a
  `version="3.0"` file is not a false mismatch, but `{version:'3.3'}` against a
  `version="2.0"` file correctly fires PKG-001.
- The resolved `target` threads into the checks and becomes `report.epubVersion`.

### 3. Parser extensions (`src/parse/opf.ts`, `src/parse/content.ts`)

Capture the signals the deprecation checks need. Add to `PackageDocument`:

- `bindings?: Location` — presence + location of the `<bindings>` element

In `parse/content.ts`, capture `epub:switch` / `epub:trigger` occurrences (with
locations) on the `ContentDocument` so the content check can flag them. Both are
elements in the OPS namespace (`http://www.idpf.org/2007/ops`), matched by local
name (`switch` / `trigger`) plus namespace.

(No `guide` or spine-`toc` capture — those are not flagged; see the fidelity
note above.)

### 4. Check changes

Thread the resolved `EpubVersion` into checks that branch on it:

- `validateOpf(pkg, container, version)` — flag `bindings` present +
  `atLeast(v,'3.2')` → `RSC-017` (WARNING), message parameter
  `"Use of the bindings element is deprecated"`.
- `validateContentDocs(pkg, container, version)` — (a) replace the flat
  `CORE_MEDIA_TYPES` set with `coreMediaTypes(version)`, making RSC-032
  foreign-resource fallback logic revision-correct; (b) flag `epub:switch` /
  `epub:trigger` when `atLeast(v,'3.2')` → `RSC-017` (WARNING), parameters
  `'The "epub:switch" element is deprecated.'` /
  `'The "epub:trigger" element is deprecated.'`.
- The EPUB-3-only gate in `validate.ts` flips from `detectedVersion === '3.0'`
  to `majorVersion(target) === '3.0'`.

### 5. Message catalog (`src/messages/catalog.ts`)

Add one entry — `RSC-017` (WARNING), template
`Warning while parsing file: %1$s` — which is exactly how epubcheck surfaces the
three deprecation warnings (generic ID, feature-specific wording passed as the
parameter). No other new IDs are needed.

### 6. API surface (`src/index.ts`, `README.md`)

- `ValidateOptions.version` and `Report.epubVersion` widen from `'2.0'|'3.0'` to
  `EpubVersion`.
- Export the `EpubVersion` type from the public API.
- Update the README version table and the auto-detection note to describe
  caller-specified revision targets and the lenient default.

## Error handling

- Invalid `options.version` values are prevented at compile time by the
  `EpubVersion` union; no runtime guard is added (consistent with current code).
- `OPF-001` still fires only for genuinely unsupported *in-file* version values
  (anything not `2.0`/`3.0`).
- The `parseOpf` → checks pipeline remains pure and non-throwing; the
  `validate.ts` catch behavior is unchanged.

## Testing

Colocated unit tests beside source; integration fixtures under `test/`.

- **`src/versions.test.ts`** (new) — `majorVersion`, `atLeast` ordering, and
  `coreMediaTypes(v)` asserted against the research matrix: WOFF2 absent in 3.0 /
  present in 3.2; WebP absent in 3.2 / present in 3.3; PLS present in 3.2 /
  removed in 3.3.
- **`src/checks/opf.test.ts`** — `bindings` present warns (`RSC-017`) at 3.2+ but
  not at 3.0.
- **`src/checks/content.test.ts`** — revision-sensitive RSC-032: a WebP resource
  with no fallback → RSC-032 under target `3.2`, clean under `3.3`;
  `epub:switch`/`epub:trigger` warn (`RSC-017`) at 3.2+ but not at 3.0.
- **`src/parse/opf.test.ts` / `src/parse/content.test.ts`** — parser captures the
  `bindings` location and the `switch`/`trigger` signals.
- **`src/validate.test.ts`** — target threading end-to-end: `{version:'3.3'}` on
  a `version="3.0"` file yields `epubVersion:'3.3'` and no PKG-001;
  `{version:'3.3'}` on a `version="2.0"` file fires PKG-001; default (no option)
  resolves to the major base.
- **`test/integration/`** — a small set of per-revision fixture EPUBs exercising
  the deltas (a 3.2 file with a deprecated `<bindings>`, a 3.3 file using WebP,
  etc.).

## Out of scope

- EPUB 3.4 (unpublished).
- A 3.0-strict vs 3.0.1 distinction (no in-file signal; the one real delta,
  fixed-layout `rendition:*`, is not validated by this project today).
- Deprecation/legacy warnings for `<guide>` and NCX / spine `toc` — the reference
  epubcheck emits none, so neither do we (see the fidelity note above).
- Accessibility-metadata conformance (a separate EPUB Accessibility spec; never
  a MUST for core EPUB conformance in any revision).
- Fixed-layout `rendition:*` metadata validation.
