# EPUB 2 Full-Pipeline Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** EPUB 2 books get the same depth of validation as EPUB 3: NCX parsing/validation, OPF 2.0 rules (guide, spine `toc`, fallback chains, blessed media types), and the content/CSS layers running with version-gated rules.

**Architecture:** Extend in place using the established `majorVersion`/`atLeast` gating idiom. New `parse/ncx.ts` + `checks/ncx.ts` layer mirrors the existing nav layer. Version-aware blessed-type sets live in `versions.ts`. `validate.ts` dispatches: major 2.0 → NCX replaces the nav doc; major 3.0 → existing nav flow plus legacy-NCX validation. All rule IDs/severities/texts are source-verified against w3c/epubcheck (see spec `docs/superpowers/specs/2026-07-23-epub-2-support-design.md`).

**Tech Stack:** TypeScript (strict), vitest, saxes + fflate (existing deps — no new dependencies).

## Global Constraints

- **Functional style, no classes** — pure functions over parsed structures.
- **Types colocated** with the module that produces them; no types-only files.
- **Unit tests colocated** beside source (`foo.ts` / `foo.test.ts`); integration corpus under `test/`.
- **Parse functions are total** — `parseNcx` must never throw (same contract as `parseOpf`/`parseNav`/`parseContent`).
- **Message IDs, severities, and templates match epubcheck exactly** (already source-verified; copy them verbatim from this plan).
- **No new npm dependencies.** If you somehow must run `npm install`, check the `@emnapi/core` lockfile gotcha (see CLAUDE memory `ci-and-lockfile-setup`): verify `grep '@emnapi/core' package-lock.json` still matches after any install.
- Verification commands: `npm test` (vitest run), `npm run lint`, `npm run typecheck`, `npm run build`.

---

### Task 1: Version-aware blessed media-type sets

**Files:**
- Modify: `src/versions.ts`
- Modify: `src/util/media-types.ts`
- Test: `src/versions.test.ts`, `src/util/media-types.test.ts` (create if absent)

**Interfaces:**
- Consumes: existing `EpubVersion`, `majorVersion`, `BLESSED_FONT_TYPES`.
- Produces (used by Tasks 4, 6, 7, 8):
  - `versions.ts`: `blessedContentTypes(v: EpubVersion): ReadonlySet<string>`, `EPUB2_IMAGE_TYPES: ReadonlySet<string>`, `EPUB2_STYLE_TYPES: ReadonlySet<string>`, `NCX_MEDIA_TYPE: string`
  - `util/media-types.ts`: `isBlessedFontMimetype20(mediaType: string | undefined): boolean`

- [ ] **Step 1: Write the failing tests**

Append to `src/versions.test.ts`:

```ts
describe('blessedContentTypes', () => {
  it('EPUB 2 blesses XHTML and DTBook plus deprecated OEB types, not SVG', () => {
    const v2 = blessedContentTypes('2.0')
    expect(v2.has('application/xhtml+xml')).toBe(true)
    expect(v2.has('application/x-dtbook+xml')).toBe(true)
    expect(v2.has('text/x-oeb1-document')).toBe(true)
    expect(v2.has('text/html')).toBe(true)
    expect(v2.has('image/svg+xml')).toBe(false)
  })

  it('EPUB 3 blesses XHTML and SVG plus deprecated OEB types, not DTBook', () => {
    const v3 = blessedContentTypes('3.3')
    expect(v3.has('application/xhtml+xml')).toBe(true)
    expect(v3.has('image/svg+xml')).toBe(true)
    expect(v3.has('text/x-oeb1-document')).toBe(true)
    expect(v3.has('text/html')).toBe(true)
    expect(v3.has('application/x-dtbook+xml')).toBe(false)
  })

  it('exports the EPUB 2 image/style sets and the NCX media type', () => {
    expect(EPUB2_IMAGE_TYPES.has('image/gif')).toBe(true)
    expect(EPUB2_IMAGE_TYPES.has('image/svg+xml')).toBe(true)
    expect(EPUB2_IMAGE_TYPES.has('image/webp')).toBe(false)
    expect(EPUB2_STYLE_TYPES.has('text/css')).toBe(true)
    expect(EPUB2_STYLE_TYPES.has('text/x-oeb1-css')).toBe(true)
    expect(NCX_MEDIA_TYPE).toBe('application/x-dtbncx+xml')
  })
})
```

Update the import at the top of `src/versions.test.ts` to include the new names:

```ts
import { majorVersion, atLeast, coreMediaTypes, blessedContentTypes, EPUB2_IMAGE_TYPES, EPUB2_STYLE_TYPES, NCX_MEDIA_TYPE } from './versions.js'
```

(Keep whatever names the file already imports; just add the new ones.)

Create `src/util/media-types.test.ts` if it does not exist (check first — if it exists, append):

```ts
import { describe, it, expect } from 'vitest'
import { isBlessedFontMimetype20 } from './media-types.js'

describe('isBlessedFontMimetype20', () => {
  it('accepts prefix-matched EPUB 2 font types (epubcheck isBlessedFontMimetype20)', () => {
    expect(isBlessedFontMimetype20('font/otf')).toBe(true)
    expect(isBlessedFontMimetype20('application/font-woff')).toBe(true)
    expect(isBlessedFontMimetype20('application/x-font-opentype')).toBe(true)
    expect(isBlessedFontMimetype20('application/vnd.ms-opentype')).toBe(true)
  })
  it('rejects non-font types and undefined', () => {
    expect(isBlessedFontMimetype20('image/png')).toBe(false)
    expect(isBlessedFontMimetype20(undefined)).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/versions.test.ts src/util/media-types.test.ts`
Expected: FAIL — `blessedContentTypes` / `isBlessedFontMimetype20` not exported.

- [ ] **Step 3: Implement**

Append to `src/versions.ts`:

```ts
/** NCX media type — the EPUB 2 navigation document (also valid as an EPUB 3 legacy compat doc). */
export const NCX_MEDIA_TYPE = 'application/x-dtbncx+xml'

/** EPUB 2 blessed image types (epubcheck OPFChecker.isBlessedImageType, VERSION_2). */
export const EPUB2_IMAGE_TYPES: ReadonlySet<string> = new Set<string>([
  'image/gif',
  'image/png',
  'image/jpeg',
  'image/svg+xml',
])

/** EPUB 2 style types: blessed + deprecated-blessed (epubcheck isBlessedStyleType / isDeprecatedBlessedStyleType). */
export const EPUB2_STYLE_TYPES: ReadonlySet<string> = new Set<string>([
  'text/css',
  'text/x-oeb1-css',
])

// Blessed content-document types per major (epubcheck isBlessedItemType + isDeprecatedBlessedItemType).
const BLESSED_CONTENT_V2: ReadonlySet<string> = new Set<string>([
  'application/xhtml+xml',
  'application/x-dtbook+xml',
  'text/x-oeb1-document', // deprecated-blessed
  'text/html', // deprecated-blessed
])
const BLESSED_CONTENT_V3: ReadonlySet<string> = new Set<string>([
  'application/xhtml+xml',
  'image/svg+xml',
  'text/x-oeb1-document', // deprecated-blessed
  'text/html', // deprecated-blessed
])

/** Content-document types acceptable as hyperlink/guide/spine targets for a revision. */
export function blessedContentTypes(v: EpubVersion): ReadonlySet<string> {
  return majorVersion(v) === '2.0' ? BLESSED_CONTENT_V2 : BLESSED_CONTENT_V3
}
```

Append to `src/util/media-types.ts`:

```ts
/** EPUB 2 blessed font types (epubcheck OPFChecker.isBlessedFontMimetype20) — prefix-based. */
export function isBlessedFontMimetype20(mediaType: string | undefined): boolean {
  return (
    mediaType !== undefined &&
    (mediaType.startsWith('font/') ||
      mediaType.startsWith('application/font') ||
      mediaType.startsWith('application/x-font') ||
      mediaType === 'application/vnd.ms-opentype')
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/versions.test.ts src/util/media-types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/versions.ts src/versions.test.ts src/util/media-types.ts src/util/media-types.test.ts
git commit -m "feat: version-aware blessed media-type sets for EPUB 2"
```

---

### Task 2: Message catalog entries

**Files:**
- Modify: `src/messages/catalog.ts`
- Test: `src/messages/catalog.test.ts`

**Interfaces:**
- Produces: catalog entries for `NCX-001`, `NCX-004`, `NCX-006`, `OPF-031`, `OPF-032`, `OPF-034`, `OPF-035`, `OPF-037`, `OPF-040`, `OPF-042`, `OPF-043`, `OPF-044`, `OPF-050`, `OPF-099` — consumed via `msg(id, loc, …args)` by Tasks 4 and 6. Templates/severities below are verbatim from epubcheck `MessageBundle.properties` / `DefaultSeverities.java` — do not edit them.

- [ ] **Step 1: Write the failing tests**

Append to `src/messages/catalog.test.ts` inside the existing `describe('CATALOG', …)` block:

```ts
  it('defines EPUB 2 OPF message ids with epubcheck severities', () => {
    expect(CATALOG['OPF-031']?.severity).toBe('ERROR')
    expect(CATALOG['OPF-032']?.severity).toBe('ERROR')
    expect(CATALOG['OPF-034']?.severity).toBe('ERROR')
    expect(CATALOG['OPF-035']?.severity).toBe('WARNING')
    expect(CATALOG['OPF-037']?.severity).toBe('WARNING')
    expect(CATALOG['OPF-040']?.severity).toBe('ERROR')
    expect(CATALOG['OPF-042']?.severity).toBe('ERROR')
    expect(CATALOG['OPF-043']?.severity).toBe('ERROR')
    expect(CATALOG['OPF-044']?.severity).toBe('ERROR')
    expect(CATALOG['OPF-050']?.severity).toBe('ERROR')
    expect(CATALOG['OPF-099']?.severity).toBe('ERROR')
  })

  it('defines NCX message ids with epubcheck severities', () => {
    expect(CATALOG['NCX-001']?.severity).toBe('ERROR')
    expect(CATALOG['NCX-004']?.severity).toBe('USAGE')
    expect(CATALOG['NCX-006']?.severity).toBe('USAGE')
  })

  it('NCX-001 template carries both identifier placeholders', () => {
    expect(CATALOG['NCX-001']?.template).toContain('%1$s')
    expect(CATALOG['NCX-001']?.template).toContain('%2$s')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/messages/catalog.test.ts`
Expected: FAIL — new ids undefined.

- [ ] **Step 3: Implement**

In `src/messages/catalog.ts`, extend the `CATALOG` record. After the existing `'OPF-030'` line add:

```ts
  'OPF-031': { severity: 'ERROR', template: 'File listed in reference element in guide was not declared in OPF manifest: %1$s.' },
  'OPF-032': { severity: 'ERROR', template: 'Guide references "%1$s" which is not a valid "OPS Content Document".' },
```

After the existing `'OPF-033'` line add:

```ts
  'OPF-034': { severity: 'ERROR', template: 'The spine contains multiple references to the manifest item with id "%1$s".' },
  'OPF-035': { severity: 'WARNING', template: 'Media type "text/html" is not appropriate for XHTML/OPS.' },
  'OPF-037': { severity: 'WARNING', template: 'Found deprecated media-type "%1$s".' },
  'OPF-040': { severity: 'ERROR', template: 'Fallback item with id "%1$s" could not be found.' },
  'OPF-042': { severity: 'ERROR', template: '"%1$s" is not a permissible spine media-type.' },
  'OPF-043': { severity: 'ERROR', template: 'Spine item with non-standard media-type "%1$s" has no fallback.' },
  'OPF-044': { severity: 'ERROR', template: 'Spine item with non-standard media-type "%1$s" has no EPUB content document fallback.' },
  'OPF-050': { severity: 'ERROR', template: 'TOC attribute references resource with non-NCX mime type; "application/x-dtbncx+xml" is expected.' },
  'OPF-099': { severity: 'ERROR', template: 'The manifest must not list the package document.' },
```

After the `// Navigation` section's last entry (`'NAV-011'`) add:

```ts
  // NCX (EPUB 2 navigation)
  'NCX-001': { severity: 'ERROR', template: 'NCX identifier ("%1$s") does not match OPF identifier ("%2$s").' },
  'NCX-004': { severity: 'USAGE', template: 'NCX identifier ("dtb:uid" metadata) should not contain leading or trailing whitespace.' },
  'NCX-006': { severity: 'USAGE', template: 'Empty "text" label in the NCX document' },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/messages/catalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/messages/catalog.ts src/messages/catalog.test.ts
git commit -m "feat: catalog entries for EPUB 2 OPF and NCX messages"
```

---

### Task 3: OPF parser — guide and spine toc capture

**Files:**
- Modify: `src/parse/opf.ts`
- Test: `src/parse/opf.test.ts`

**Interfaces:**
- Produces (used by Tasks 4, 9):
  - `interface GuideReference { type?: string; title?: string; href?: string; loc: Location }`
  - `PackageDocument` gains: `guide: GuideReference[]`, `spineToc?: string`, `spineLoc?: Location`
  - `export function hasFallbackTo(item: ManifestItem, byId: Map<string, ManifestItem>, predicate: (i: ManifestItem) => boolean): boolean` — MOVED here from `src/checks/content.ts` (it operates on `ManifestItem`, so it colocates with the type). `src/checks/content.ts` imports it from here.

- [ ] **Step 1: Write the failing tests**

Append to `src/parse/opf.test.ts` (reuse the file's existing helpers for building a container — read the file first and follow its established pattern for constructing test containers; every existing test builds one, copy that recipe):

```ts
describe('guide and spine toc parsing', () => {
  it('captures guide references and the spine toc attribute', () => {
    // Build a container whose OPF is:
    // <package … version="2.0" unique-identifier="uid"> … 
    //   <spine toc="ncx"><itemref idref="content"/></spine>
    //   <guide><reference type="text" title="Start" href="content.xhtml"/></guide>
    // </package>
    // using this file's existing container-building helper.
    const { pkg } = parseOpf(container)
    expect(pkg?.spineToc).toBe('ncx')
    expect(pkg?.spineLoc).toBeDefined()
    expect(pkg?.guide).toHaveLength(1)
    expect(pkg?.guide[0]).toMatchObject({ type: 'text', title: 'Start', href: 'content.xhtml' })
  })

  it('yields an empty guide and undefined spineToc when absent', () => {
    const { pkg } = parseOpf(containerWithoutGuide) // OPF with <spine> but no toc attr, no <guide>
    expect(pkg?.guide).toEqual([])
    expect(pkg?.spineToc).toBeUndefined()
  })
})
```

```ts
describe('hasFallbackTo', () => {
  const item = (id: string, mediaType: string, fallback?: string): ManifestItem =>
    ({ id, href: `${id}.bin`, mediaType, properties: [], fallback, loc: { path: 'p.opf' } })

  it('walks the chain to a matching item', () => {
    const a = item('a', 'application/pdf', 'b')
    const b = item('b', 'application/xhtml+xml')
    const byId = new Map([['a', a], ['b', b]])
    expect(hasFallbackTo(a, byId, (i) => i.mediaType === 'application/xhtml+xml')).toBe(true)
  })

  it('is cycle-safe and returns false on a dangling id', () => {
    const a = item('a', 'application/pdf', 'b')
    const b = item('b', 'application/pdf', 'a')
    const byId = new Map([['a', a], ['b', b]])
    expect(hasFallbackTo(a, byId, () => false)).toBe(false)
    expect(hasFallbackTo(item('c', 'x/y', 'nope'), byId, () => true)).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/parse/opf.test.ts`
Expected: FAIL — `guide`/`spineToc` undefined on `PackageDocument`, `hasFallbackTo` not exported.

- [ ] **Step 3: Implement**

In `src/parse/opf.ts`:

Add the interface next to `SpineItem`:

```ts
export interface GuideReference {
  type?: string
  title?: string
  href?: string
  loc: Location
}
```

Extend `PackageDocument`:

```ts
export interface PackageDocument {
  path: string
  version?: string
  uniqueIdentifier?: string
  metadata: Metadata
  manifest: ManifestItem[]
  spinePresent: boolean
  spine: SpineItem[]
  /** <spine toc="…"> idref (EPUB 2 NCX pointer); undefined when absent. */
  spineToc?: string
  /** Location of the <spine> element (for RSC-005 on a missing toc attribute). */
  spineLoc?: Location
  guide: GuideReference[]
  bindings?: Location
  loc: Location
}
```

In `parseOpf`, after `const bindingsEl = …` add:

```ts
  const guideEl = firstChild(root, 'guide')
```

After the `spine` const add:

```ts
  const guide: GuideReference[] = guideEl
    ? childElements(guideEl)
        .filter((el) => el.name === 'reference')
        .map((el) => ({
          type: el.attrs?.['type'],
          title: el.attrs?.['title'],
          href: el.attrs?.['href'],
          loc: el.loc,
        }))
    : []
```

Extend the `pkg` literal:

```ts
    spinePresent: spineEl !== undefined,
    spine,
    spineToc: spineEl?.attrs?.['toc'],
    spineLoc: spineEl?.loc,
    guide,
```

Move `hasFallbackTo` from `src/checks/content.ts` to the bottom of `src/parse/opf.ts` (verbatim, but exported):

```ts
/**
 * Walk the manifest `fallback` chain (each fallback is a manifest item id) and
 * report whether any item in the chain satisfies the predicate. Cycle-guarded.
 */
export function hasFallbackTo(
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
```

In `src/checks/content.ts`: delete the local `hasFallbackTo` definition and add `hasFallbackTo` to the existing import from `'../parse/opf.js'`.

- [ ] **Step 3b: Update existing `PackageDocument` literal constructors**

`guide` is a required field, so every hand-built `PackageDocument` literal needs `guide: []` (matching how `manifest`/`spine` are required arrays). `parseOpf` is already handled above. Add `guide: [],` to each of these six test-helper literals (the parser sets it in production; tests build literals directly):

- `src/checks/opf.test.ts` — `validPkg` (near `spinePresent: true,`) **and** `pkgWith` (near `spinePresent: true, spine: [],`)
- `src/checks/css.test.ts` — `setup`'s `pkg` literal (near `spinePresent: true, spine: [],`)
- `src/checks/content.test.ts` — `setup`'s `pkg` literal (near `spinePresent: true,`)
- `src/checks/nav.test.ts` — all three `pkg` literals (lines near `spinePresent: true`)

Do NOT add `spineToc`/`spineLoc` — they are optional and default to `undefined`.

- [ ] **Step 4: Run the full suite to verify nothing broke**

Run: `npx vitest run`
Expected: PASS (the moved helper keeps `checks/content.ts` behavior identical; other `parseOpf` tests unaffected — `guide: []` is additive).

- [ ] **Step 5: Commit**

```bash
git add src/parse/opf.ts src/parse/opf.test.ts src/checks/content.ts src/checks/opf.test.ts src/checks/css.test.ts src/checks/content.test.ts src/checks/nav.test.ts
git commit -m "feat: parse OPF guide references and spine toc attribute"
```

---

### Task 4: OPF 2.0 checks

**Files:**
- Modify: `src/checks/opf.ts`
- Test: `src/checks/opf.test.ts`

**Interfaces:**
- Consumes: Task 1 sets (`blessedContentTypes`, `EPUB2_IMAGE_TYPES`, `EPUB2_STYLE_TYPES`, `NCX_MEDIA_TYPE`), Task 3 (`GuideReference`, `pkg.spineToc`, `pkg.spineLoc`, `pkg.guide`, `hasFallbackTo`), Task 2 catalog ids.
- Produces: `validateOpf(pkg, container, version)` (signature unchanged) now also emits OPF-031/032/034/035/037/040/042/043/044/049(toc)/050, RSC-005 (missing spine toc), OPF-099; and gates the `dcterms:modified` RSC-005 to major 3.0.

Rule conditions (source-verified; keep exactly):

| ID | Gate | Condition | `msg` args |
|---|---|---|---|
| OPF-099 | none | manifest item href resolves to `pkg.path` | none |
| OPF-040 | none | `item.fallback` set but id not in manifest | `item.fallback` |
| OPF-031 | v2 | guide href (fragment stripped, non-remote) not a declared manifest path | `ref.href` |
| OPF-032 | v2 | guide target's media type not in `blessedContentTypes('2.0')` (no fallback walk — epubcheck checks the type only) | `ref.href` |
| OPF-034 | v2 | same `idref` appears twice in the spine | `idref` |
| OPF-035 | v2 | manifest item media type `text/html` | none |
| OPF-037 | v2 | manifest item media type `text/x-oeb1-document` or `text/x-oeb1-css` | `mediaType` |
| OPF-042 | v2 | spine item media type in `EPUB2_STYLE_TYPES` ∪ `EPUB2_IMAGE_TYPES` | `mediaType` |
| OPF-043 | v2 | spine item type not blessed-content, item has NO `fallback` attr | `mediaType` |
| OPF-044 | v2 | spine item type not blessed-content, HAS `fallback` but chain never reaches a blessed-content type | `mediaType` |
| RSC-005 | v2 | `spinePresent` and `spineToc` undefined | `pkg.path`, `'The spine element must include the toc attribute in EPUB 2.'` |
| OPF-049 | v2 | `spineToc` id not in the manifest | `pkg.spineToc` |
| OPF-050 | v2 | `spineToc` item's media type ≠ `NCX_MEDIA_TYPE` | none |
| modified gate | — | the existing `modifiedCount !== 1` RSC-005 fires only when `version` is undefined or major 3.0 | (unchanged) |

- [ ] **Step 1: Write the failing tests**

Append to `src/checks/opf.test.ts`. Follow the file's existing pattern for building a `PackageDocument` + container (read it first; reuse its helpers). Cover, minimally:

```ts
describe('EPUB 2 rules', () => {
  // Build helpers: a v2 pkg has version '2.0', spineToc 'ncx', an NCX manifest item
  // (id 'ncx', media-type 'application/x-dtbncx+xml'), one XHTML spine item, guide: [].

  it('does not require dcterms:modified for a 2.0 target', () => {
    // pkg with metadata.modifiedCount = 0, version target '2.0'
    const messages = validateOpf(pkg2, container, '2.0')
    expect(messages.filter((m) => m.message.includes('dcterms:modified'))).toHaveLength(0)
  })

  it('still requires dcterms:modified for a 3.x target', () => {
    const messages = validateOpf(pkg3NoModified, container, '3.3')
    expect(messages.some((m) => m.message.includes('dcterms:modified'))).toBe(true)
  })

  it('OPF-031: guide reference to an undeclared file', () => {
    // guide: [{ type: 'text', href: 'nowhere.xhtml', loc }]
    expect(ids(validateOpf(pkg, container, '2.0'))).toContain('OPF-031')
  })

  it('OPF-032: guide reference to a non-content-document type', () => {
    // guide href → declared image/gif item
    expect(ids(validateOpf(pkg, container, '2.0'))).toContain('OPF-032')
  })

  it('OPF-034: duplicate spine idref', () => {
    // spine: [itemref content, itemref content]
    expect(ids(validateOpf(pkg, container, '2.0'))).toContain('OPF-034')
  })

  it('OPF-035/OPF-037: html and deprecated media types', () => {
    // manifest extra items: text/html → OPF-035; text/x-oeb1-css → OPF-037
  })

  it('OPF-042: image type in the spine', () => {
    // spine itemref → image/gif item
    expect(ids(validateOpf(pkg, container, '2.0'))).toContain('OPF-042')
  })

  it('OPF-043/OPF-044: foreign spine item without / with non-resolving fallback', () => {
    // application/pdf spine item, no fallback → OPF-043
    // application/pdf spine item, fallback → image/gif item → OPF-044
  })

  it('OPF-040: fallback idref not found (any version)', () => {
    // item fallback: 'ghost' with no such id; assert for both '2.0' and '3.3' targets
  })

  it('OPF-099: manifest lists the package document (any version)', () => {
    // manifest item href resolving to pkg.path
  })

  it('RSC-005 / OPF-049 / OPF-050 for the spine toc attribute', () => {
    // spineToc undefined → RSC-005 mentioning 'toc attribute'
    // spineToc 'ghost' → OPF-049
    // spineToc → XHTML item → OPF-050
  })

  it('emits none of the EPUB 2 rules for a 3.x target', () => {
    // same fixtures validated with '3.3': no OPF-031/032/034/035/037/042/043/044/050
  })
})
```

(`ids` = `(ms: Message[]) => ms.map((m) => m.id)` — define locally or reuse if the file has one.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/checks/opf.test.ts`
Expected: FAIL — new ids not emitted; modified-gate test fails (RSC-005 currently fires for 2.0).

- [ ] **Step 3: Implement**

In `src/checks/opf.ts`:

Update imports:

```ts
import { manifestPathMap, hasFallbackTo, type ManifestItem, type PackageDocument } from '../parse/opf.js'
import { majorVersion, atLeast, blessedContentTypes, EPUB2_IMAGE_TYPES, EPUB2_STYLE_TYPES, NCX_MEDIA_TYPE, type EpubVersion } from '../versions.js'
```

Change `validateOpf` to:

```ts
export function validateOpf(
  pkg: PackageDocument,
  container: EpubContainer,
  version: EpubVersion | undefined,
): Message[] {
  return [
    ...checkPackage(pkg, version),
    ...checkManifest(pkg, container),
    ...checkSpineAndNav(pkg, version),
    ...checkDeprecatedFeatures(pkg, version),
    ...checkEpub2(pkg, version),
  ]
}
```

`checkPackage` gains the version parameter; gate only the modified check:

```ts
function checkPackage(pkg: PackageDocument, version: EpubVersion | undefined): Message[] {
  // … existing body unchanged, except:
  // dcterms:modified is an EPUB 3 requirement; do not demand it of EPUB 2 books.
  if ((version === undefined || majorVersion(version) === '3.0') && pkg.metadata.modifiedCount !== 1) {
    messages.push(msg('RSC-005', loc, pkg.path, 'The package dcterms:modified meta element must occur exactly once.'))
  }
```

In `checkManifest`, add OPF-099 and OPF-040. Build `byId` at the top:

```ts
  const byId = new Map<string, ManifestItem>()
  for (const item of pkg.manifest) {
    if (item.id !== undefined) byId.set(item.id, item)
  }
```

Inside the existing `for (const item of pkg.manifest)` loop:

```ts
    if (item.fallback !== undefined && !byId.has(item.fallback)) {
      messages.push(msg('OPF-040', item.loc, item.fallback))
    }
```

and inside the existing `if (item.href && !isRemote(item.href))` block, after `resolved` is computed:

```ts
      if (resolved === pkg.path) {
        messages.push(msg('OPF-099', item.loc))
      }
```

Add the new `checkEpub2` function at the bottom:

```ts
/** EPUB 2 (OPF 2.0) rules: guide, spine toc/NCX, blessed types, fallback chains. */
function checkEpub2(pkg: PackageDocument, version: EpubVersion | undefined): Message[] {
  if (version === undefined || majorVersion(version) !== '2.0') return []
  const messages: Message[] = []
  const blessed = blessedContentTypes(version)
  const isBlessedContent = (mediaType: string | undefined): boolean =>
    mediaType !== undefined && blessed.has(mediaType)

  const byId = new Map<string, ManifestItem>()
  for (const item of pkg.manifest) {
    if (item.id !== undefined) byId.set(item.id, item)
  }
  const declared = manifestPathMap(pkg)

  // Manifest media-type hygiene (epubcheck OPFChecker.checkItem, OPF 2.0 branch).
  for (const item of pkg.manifest) {
    if (item.mediaType === 'text/html') {
      messages.push(msg('OPF-035', item.loc))
    } else if (item.mediaType === 'text/x-oeb1-document' || item.mediaType === 'text/x-oeb1-css') {
      messages.push(msg('OPF-037', item.loc, item.mediaType))
    }
  }

  // Spine: duplicates + permissible media types (epubcheck checkSpineItem).
  const seenIdrefs = new Set<string>()
  for (const ref of pkg.spine) {
    if (ref.idref === undefined) continue
    if (seenIdrefs.has(ref.idref)) messages.push(msg('OPF-034', ref.loc, ref.idref))
    seenIdrefs.add(ref.idref)

    const item = byId.get(ref.idref)
    const mediaType = item?.mediaType
    if (item === undefined || mediaType === undefined) continue // unknown idref → OPF-049 elsewhere
    if (EPUB2_STYLE_TYPES.has(mediaType) || EPUB2_IMAGE_TYPES.has(mediaType)) {
      messages.push(msg('OPF-042', item.loc, mediaType))
    } else if (!isBlessedContent(mediaType)) {
      if (item.fallback === undefined) {
        messages.push(msg('OPF-043', item.loc, mediaType))
      } else if (!hasFallbackTo(item, byId, (i) => isBlessedContent(i.mediaType))) {
        messages.push(msg('OPF-044', item.loc, mediaType))
      }
    }
  }

  // Spine toc attribute → NCX (required in EPUB 2; epubcheck OPFHandler).
  if (pkg.spinePresent) {
    if (pkg.spineToc === undefined) {
      messages.push(msg('RSC-005', pkg.spineLoc ?? pkg.loc, pkg.path, 'The spine element must include the toc attribute in EPUB 2.'))
    } else {
      const tocItem = byId.get(pkg.spineToc)
      if (tocItem === undefined) {
        messages.push(msg('OPF-049', pkg.spineLoc ?? pkg.loc, pkg.spineToc))
      } else if (tocItem.mediaType !== NCX_MEDIA_TYPE) {
        messages.push(msg('OPF-050', tocItem.loc))
      }
    }
  }

  // Guide references (epubcheck OPFChecker.checkGuide).
  for (const ref of pkg.guide) {
    if (ref.href === undefined || isRemote(ref.href)) continue
    const target = resolvePath(pkg.path, ref.href)
    const item = declared.get(target)
    if (item === undefined) {
      messages.push(msg('OPF-031', ref.loc, ref.href))
    } else if (!isBlessedContent(item.mediaType)) {
      messages.push(msg('OPF-032', ref.loc, ref.href))
    }
  }

  return messages
}
```

Note: the spine-toc RSC-005 and OPF-049 duplicate-fire risk with `checkSpineAndNav`'s OPF-049 loop is nil — that loop keys off `pkg.spine` idrefs, this one off `pkg.spineToc`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/checks/opf.test.ts` then `npx vitest run`
Expected: PASS, full suite green (existing EPUB 3 fixtures unaffected: all new rules are v2-gated except OPF-040/OPF-099, which no existing fixture triggers).

- [ ] **Step 5: Commit**

```bash
git add src/checks/opf.ts src/checks/opf.test.ts
git commit -m "feat: EPUB 2 OPF rules (guide, spine toc, blessed types, fallbacks)"
```

---

### Task 5: NCX parser

**Files:**
- Create: `src/parse/ncx.ts`
- Test: `src/parse/ncx.test.ts`

**Interfaces:**
- Consumes: `parseXml`/`childElements`/`findDescendants`/`textContent` (`io/xml.js`), `getResource` (`io/zip.js`), `resolvePath` (`util/path.js`), `ManifestItem` (`parse/opf.js`).
- Produces (used by Tasks 6, 9):

```ts
export interface NcxNavPoint { hasLabel: boolean; hasContent: boolean; src?: string; loc: Location }
export interface NcxTextLabel { text: string; loc: Location }
export interface NcxDocument {
  path: string
  root: XmlNode
  uid?: string          // dtb:uid content, UNTRIMMED (NCX-004 needs raw whitespace)
  uidLoc?: Location
  navMapPresent: boolean
  navPoints: NcxNavPoint[]
  textLabels: NcxTextLabel[]
  loc: Location
}
export function parseNcx(item: ManifestItem, container: EpubContainer): { ncx?: NcxDocument; messages: Message[] }
```

- [ ] **Step 1: Write the failing tests**

Create `src/parse/ncx.test.ts`. Model container construction on `src/parse/nav.test.ts` (read it first and reuse its recipe — it builds an `EpubContainer` from in-memory resources):

```ts
import { describe, it, expect } from 'vitest'
import { parseNcx } from './ncx.js'

const NCX =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">' +
  '<head><meta name="dtb:uid" content=" urn:uuid:x "/></head>' +
  '<docTitle><text>Title</text></docTitle>' +
  '<navMap>' +
  '<navPoint id="np1" playOrder="1"><navLabel><text>One</text></navLabel><content src="content_001.xhtml"/></navPoint>' +
  '<navPoint id="np2" playOrder="2"><navLabel><text></text></navLabel></navPoint>' +
  '</navMap>' +
  '</ncx>'

// buildContainer: same helper style as parse/nav.test.ts — container with
// rootfiles ['EPUB/package.opf'] and resource 'EPUB/toc.ncx' → NCX bytes.
// ncxItem: { id: 'ncx', href: 'toc.ncx', mediaType: 'application/x-dtbncx+xml', properties: [], loc: { path: 'EPUB/package.opf' } }

describe('parseNcx', () => {
  it('captures uid untrimmed, navMap, navPoints, and text labels', () => {
    const { ncx, messages } = parseNcx(ncxItem, buildContainer(NCX))
    expect(messages).toEqual([])
    expect(ncx?.uid).toBe(' urn:uuid:x ')
    expect(ncx?.navMapPresent).toBe(true)
    expect(ncx?.navPoints).toHaveLength(2)
    expect(ncx?.navPoints[0]).toMatchObject({ hasLabel: true, hasContent: true, src: 'content_001.xhtml' })
    expect(ncx?.navPoints[1]).toMatchObject({ hasLabel: true, hasContent: false, src: undefined })
    // 3 <text> elements: docTitle 'Title', 'One', ''
    expect(ncx?.textLabels.map((t) => t.text)).toEqual(['Title', 'One', ''])
  })

  it('reports navMapPresent false when navMap is missing', () => {
    const { ncx } = parseNcx(ncxItem, buildContainer(NCX.replace(/<navMap>[\s\S]*<\/navMap>/, '')))
    expect(ncx?.navMapPresent).toBe(false)
    expect(ncx?.navPoints).toEqual([])
  })

  it('is total: missing resource yields no ncx and no messages', () => {
    const { ncx, messages } = parseNcx({ ...ncxItem, href: 'ghost.ncx' }, buildContainer(NCX))
    expect(ncx).toBeUndefined()
    expect(messages).toEqual([]) // missing file is RSC-001 territory (OPF manifest check)
  })

  it('surfaces XML parse errors as RSC-005 messages without throwing', () => {
    const { ncx, messages } = parseNcx(ncxItem, buildContainer('<ncx><unclosed'))
    expect(ncx).toBeUndefined()
    expect(messages.some((m) => m.id === 'RSC-005')).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/parse/ncx.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `src/parse/ncx.ts`:

```ts
import { parseXml, childElements, findDescendants, textContent, type XmlNode } from '../io/xml.js'
import { getResource, type EpubContainer } from '../io/zip.js'
import { resolvePath } from '../util/path.js'
import type { Location, Message } from '../messages/format.js'
import type { ManifestItem } from './opf.js'

const NCX_NS = 'http://www.daisy.org/z3986/2005/ncx/'

export interface NcxNavPoint {
  hasLabel: boolean
  hasContent: boolean
  src?: string
  loc: Location
}
export interface NcxTextLabel {
  text: string
  loc: Location
}
export interface NcxDocument {
  path: string
  root: XmlNode
  /** dtb:uid meta content, untrimmed — NCX-004 checks raw whitespace. */
  uid?: string
  uidLoc?: Location
  navMapPresent: boolean
  navPoints: NcxNavPoint[]
  /** Every <text> element in the NCX namespace (docTitle + navLabels), for NCX-006. */
  textLabels: NcxTextLabel[]
  loc: Location
}

export function parseNcx(
  item: ManifestItem,
  container: EpubContainer,
): { ncx?: NcxDocument; messages: Message[] } {
  const messages: Message[] = []
  const opfPath = container.rootfiles[0]
  if (!opfPath || !item.href) return { messages }

  const path = resolvePath(opfPath, item.href)
  const resource = getResource(container, path)
  // A missing NCX file is reported as RSC-001 by the OPF manifest check; don't double-report.
  if (!resource) return { messages }

  const parsed = parseXml(resource.bytes, path)
  messages.push(...parsed.messages)
  const root = parsed.root
  if (!root) return { messages }

  const uidMeta = findDescendants(root, 'meta').find((m) => m.attrs?.['name'] === 'dtb:uid')
  const navMap = childElements(root).find((c) => c.name === 'navMap')

  const navPoints: NcxNavPoint[] = navMap
    ? findDescendants(navMap, 'navPoint').map((np) => {
        const content = childElements(np).find((c) => c.name === 'content')
        const label = childElements(np).find((c) => c.name === 'navLabel')
        return {
          hasLabel: label !== undefined,
          hasContent: content !== undefined,
          src: content?.attrs?.['src'],
          loc: np.loc,
        }
      })
    : []

  const textLabels: NcxTextLabel[] = findDescendants(root, 'text')
    .filter((t) => t.ns === NCX_NS)
    .map((t) => ({ text: textContent(t).trim(), loc: t.loc }))

  return {
    ncx: {
      path,
      root,
      uid: uidMeta?.attrs?.['content'],
      uidLoc: uidMeta?.loc,
      navMapPresent: navMap !== undefined,
      navPoints,
      textLabels,
      loc: root.loc,
    },
    messages,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/parse/ncx.test.ts`
Expected: PASS. (If the `textLabels` expectation `['Title', 'One', '']` fails on the empty label: `parseXml` drops whitespace-only text nodes, so `<text></text>` yields no children and `textContent` returns `''` — the expectation is correct; debug against the actual failure, don't loosen the assertion.)

- [ ] **Step 5: Commit**

```bash
git add src/parse/ncx.ts src/parse/ncx.test.ts
git commit -m "feat: NCX parser (dtb:uid, navMap, navPoints, text labels)"
```

---

### Task 6: NCX checks

**Files:**
- Create: `src/checks/ncx.ts`
- Test: `src/checks/ncx.test.ts`

**Interfaces:**
- Consumes: Task 5 `NcxDocument`; Task 1 `blessedContentTypes`; Task 3 `hasFallbackTo`, `manifestPathMap`; `parseContent` (for RSC-012 fragment ids).
- Produces (used by Task 9):

```ts
export function validateNcx(
  ncx: NcxDocument,
  pkg: PackageDocument,
  container: EpubContainer,
  version: EpubVersion,
): Message[]
```

Checks (severities from the catalog): NCX-001 (uid mismatch; args: raw ncx uid, opf uid), NCX-004 (uid whitespace), NCX-006 (each empty `textLabel`), RSC-005 (missing navMap; navPoint missing navLabel; navPoint missing content), and per-`src` reference chain RSC-007 → RSC-008 → RSC-010 → RSC-011 → RSC-012 (first failure stops that ref's chain — matches epubcheck's per-reference abort).

- [ ] **Step 1: Write the failing tests**

Create `src/checks/ncx.test.ts`. Build `NcxDocument`/`PackageDocument` literals directly (cheaper than container round-trips; follow `src/checks/nav.test.ts` conventions — read it first). Cover:

```ts
describe('validateNcx', () => {
  // Baseline: pkg2 with uniqueIdentifier 'uid', identifiers [{ id: 'uid', value: 'urn:uuid:x' }],
  // manifest [ncx item, content item (application/xhtml+xml, href 'content_001.xhtml')],
  // spine [itemref content]; container holding EPUB/content_001.xhtml (valid XHTML with id 'frag').
  // ncx: uid 'urn:uuid:x', navMapPresent true,
  // navPoints [{ hasLabel: true, hasContent: true, src: 'content_001.xhtml', loc }].

  it('valid NCX yields no messages', () => {
    expect(validateNcx(ncx, pkg2, container, '2.0')).toEqual([])
  })

  it('NCX-001 on uid mismatch (trimmed compare, raw uid reported)', () => {
    const m = validateNcx({ ...ncx, uid: ' urn:uuid:OTHER ' }, pkg2, container, '2.0')
    const ncx001 = m.find((x) => x.id === 'NCX-001')
    expect(ncx001?.message).toContain(' urn:uuid:OTHER ')
    expect(ncx001?.message).toContain('urn:uuid:x')
    // whitespace also triggers NCX-004
    expect(m.map((x) => x.id)).toContain('NCX-004')
  })

  it('NCX-004 only (no NCX-001) when uid matches after trimming', () => {
    const m = validateNcx({ ...ncx, uid: ' urn:uuid:x ' }, pkg2, container, '2.0')
    expect(m.map((x) => x.id)).toEqual(['NCX-004'])
  })

  it('NCX-006 per empty text label', () => {
    const m = validateNcx({ ...ncx, textLabels: [{ text: '', loc }, { text: 'ok', loc }, { text: '', loc }] }, pkg2, container, '2.0')
    expect(m.filter((x) => x.id === 'NCX-006')).toHaveLength(2)
  })

  it('RSC-005 for missing navMap and malformed navPoints', () => {
    const m = validateNcx({ ...ncx, navMapPresent: false, navPoints: [] }, pkg2, container, '2.0')
    expect(m.map((x) => x.id)).toEqual(['RSC-005'])
    const m2 = validateNcx({ ...ncx, navPoints: [{ hasLabel: false, hasContent: false, loc }] }, pkg2, container, '2.0')
    expect(m2.filter((x) => x.id === 'RSC-005')).toHaveLength(2) // no label + no content
  })

  it('RSC-007 for a src to a missing resource', () => { /* src: 'ghost.xhtml' */ })
  it('RSC-008 for a src present in the zip but undeclared', () => { /* file exists, not in manifest */ })
  it('RSC-010 for a src to a non-content-document (v2 blessed set)', () => { /* src → image/gif item */ })
  it('RSC-011 for a src to a content doc not in the spine', () => { /* xhtml item not in spine */ })
  it('RSC-012 for a src with a missing fragment', () => { /* src: 'content_001.xhtml#nope' */ })
  it('no RSC-012 when the fragment exists', () => { /* src: 'content_001.xhtml#frag' */ })
  it('remote srcs are skipped (hyperlink refs may be remote)', () => { /* src: 'https://x.example/y' → [] */ })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/checks/ncx.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `src/checks/ncx.ts`:

```ts
import { getResource, type EpubContainer } from '../io/zip.js'
import { resolvePath, isRemote, hasScheme } from '../util/path.js'
import { msg, type Message } from '../messages/format.js'
import { manifestPathMap, hasFallbackTo, type ManifestItem, type PackageDocument } from '../parse/opf.js'
import { parseContent } from '../parse/content.js'
import type { NcxDocument } from '../parse/ncx.js'
import { blessedContentTypes, type EpubVersion } from '../versions.js'

export function validateNcx(
  ncx: NcxDocument,
  pkg: PackageDocument,
  container: EpubContainer,
  version: EpubVersion,
): Message[] {
  return [
    ...checkIdentifier(ncx, pkg),
    ...checkStructure(ncx),
    ...checkLabels(ncx),
    ...checkReferences(ncx, pkg, container, version),
  ]
}

/** NCX-001/NCX-004: dtb:uid vs the OPF unique identifier (epubcheck NCXChecker). */
function checkIdentifier(ncx: NcxDocument, pkg: PackageDocument): Message[] {
  const messages: Message[] = []
  if (ncx.uid === undefined) return messages
  if (ncx.uid !== ncx.uid.trim()) {
    messages.push(msg('NCX-004', ncx.uidLoc ?? ncx.loc))
  }
  const opfUid = pkg.metadata.identifiers.find((i) => i.id === pkg.uniqueIdentifier)?.value
  if (opfUid !== undefined && ncx.uid.trim() !== opfUid) {
    messages.push(msg('NCX-001', ncx.uidLoc ?? ncx.loc, ncx.uid, opfUid))
  }
  return messages
}

/** Structural requirements the NCX RNG schema enforces (hand-written, as RSC-005). */
function checkStructure(ncx: NcxDocument): Message[] {
  const messages: Message[] = []
  if (!ncx.navMapPresent) {
    messages.push(msg('RSC-005', ncx.loc, ncx.path, 'The NCX document must contain a navMap element.'))
  }
  for (const np of ncx.navPoints) {
    if (!np.hasLabel) {
      messages.push(msg('RSC-005', np.loc, ncx.path, 'A navPoint must contain a navLabel element.'))
    }
    if (!np.hasContent) {
      messages.push(msg('RSC-005', np.loc, ncx.path, 'A navPoint must contain a content element.'))
    }
  }
  return messages
}

/** NCX-006: empty text labels (epubcheck NCXHandler). */
function checkLabels(ncx: NcxDocument): Message[] {
  return ncx.textLabels.filter((t) => t.text === '').map((t) => msg('NCX-006', t.loc))
}

/**
 * navPoint content@src integrity. epubcheck registers these as HYPERLINK
 * references, so they get the full hyperlink chain: RSC-007 (missing),
 * RSC-008 (undeclared), RSC-010 (non-content-document), RSC-011 (not in
 * spine), RSC-012 (missing fragment). The first failure aborts that src's
 * chain (epubcheck CheckAbortException semantics).
 */
function checkReferences(
  ncx: NcxDocument,
  pkg: PackageDocument,
  container: EpubContainer,
  version: EpubVersion,
): Message[] {
  const messages: Message[] = []
  const manifest = manifestPathMap(pkg)
  const blessed = blessedContentTypes(version)
  const isBlessedContent = (mediaType: string | undefined): boolean =>
    mediaType !== undefined && blessed.has(mediaType)

  const byId = new Map<string, ManifestItem>()
  for (const item of pkg.manifest) {
    if (item.id !== undefined) byId.set(item.id, item)
  }
  const spinePaths = new Set<string>()
  for (const s of pkg.spine) {
    if (s.idref === undefined) continue
    const item = byId.get(s.idref)
    if (item?.href && !isRemote(item.href)) spinePaths.add(resolvePath(pkg.path, item.href))
  }

  // Parse a target XHTML doc on demand (cached) to check fragment ids.
  const idsCache = new Map<string, Set<string>>()
  const idsFor = (path: string): Set<string> => {
    const cached = idsCache.get(path)
    if (cached) return cached
    const item = manifest.get(path)
    const ids = item ? (parseContent(item, container).doc?.ids ?? new Set<string>()) : new Set<string>()
    idsCache.set(path, ids)
    return ids
  }

  for (const np of ncx.navPoints) {
    const src = np.src
    if (src === undefined || isRemote(src) || hasScheme(src)) continue // remote hyperlinks are allowed
    const target = resolvePath(ncx.path, src)
    if (!getResource(container, target)) {
      messages.push(msg('RSC-007', np.loc, src))
      continue
    }
    const item = manifest.get(target)
    if (item === undefined) {
      messages.push(msg('RSC-008', np.loc, src))
      continue
    }
    if (!isBlessedContent(item.mediaType) && !hasFallbackTo(item, byId, (i) => isBlessedContent(i.mediaType))) {
      messages.push(msg('RSC-010', np.loc))
      continue
    }
    if (!spinePaths.has(target)) {
      messages.push(msg('RSC-011', np.loc))
      continue
    }
    const hash = src.indexOf('#')
    const frag = hash < 0 ? '' : src.slice(hash + 1)
    if (frag !== '' && item.mediaType === 'application/xhtml+xml' && !idsFor(target).has(frag)) {
      messages.push(msg('RSC-012', np.loc))
    }
  }
  return messages
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/checks/ncx.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/checks/ncx.ts src/checks/ncx.test.ts
git commit -m "feat: NCX validation (uid, structure, labels, link integrity)"
```

---

### Task 7: Content-layer EPUB 2 gating

**Files:**
- Modify: `src/checks/content.ts`
- Test: `src/checks/content.test.ts`

**Interfaces:**
- Consumes: Task 1 `blessedContentTypes`, `majorVersion`; Task 3 `hasFallbackTo` (import already switched in Task 3).
- Produces: `validateContentDocs(pkg, container, version)` (signature unchanged) with v2 behavior: RSC-010 uses the v2 blessed set; remote refs allowed only for hyperlink/cite (RSC-006 otherwise); RSC-031 emitted only for major 3.0; RSC-032 unchanged (runs for v2 with `coreMediaTypes(version)` — the 3.0 base list).

- [ ] **Step 1: Write the failing tests**

Append to `src/checks/content.test.ts` (reuse the file's existing container/doc-building helpers — read it first):

```ts
describe('EPUB 2 gating', () => {
  it('RSC-006 for a remote audio ref under a 2.0 target (allowed under 3.x)', () => {
    // content doc with <audio src="https://x.example/a.mp3"/>
    expect(ids(validateContentDocs(pkg, container, '2.0'))).toContain('RSC-006')
    expect(ids(validateContentDocs(pkg, container, '3.3'))).not.toContain('RSC-006')
  })

  it('no RSC-031 https advice under a 2.0 target', () => {
    // content doc with <blockquote cite="http://x.example/q"/> (remote-allowed cite, http)
    expect(ids(validateContentDocs(pkg, container, '3.3'))).toContain('RSC-031')
    expect(ids(validateContentDocs(pkg, container, '2.0'))).not.toContain('RSC-031')
  })

  it('RSC-010 blessed set is version-aware: SVG hyperlink target is blessed in 3.x, not 2.0', () => {
    // hyperlink → declared image/svg+xml item that is in the spine
    expect(ids(validateContentDocs(pkg, container, '3.3'))).not.toContain('RSC-010')
    expect(ids(validateContentDocs(pkg, container, '2.0'))).toContain('RSC-010')
  })

  it('RSC-032 still fires under a 2.0 target (epubcheck v2 suite expects it)', () => {
    // <img src="chart.bmp"/> with image/bmp declared, no fallback
    expect(ids(validateContentDocs(pkg, container, '2.0'))).toContain('RSC-032')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/checks/content.test.ts`
Expected: FAIL — remote audio passes under 2.0, RSC-031 fires under 2.0, SVG hyperlink accepted under 2.0. (The RSC-032 test should already pass — keep it as a regression guard.)

- [ ] **Step 3: Implement**

In `src/checks/content.ts`:

Update the versions import:

```ts
import { coreMediaTypes, atLeast, majorVersion, blessedContentTypes, type EpubVersion } from '../versions.js'
```

Replace the module-level constants `REMOTE_ALLOWED` and `BLESSED_CONTENT_TYPES`/`isBlessedContentType`/`hasFallbackToBlessed` (the latter two are removed; `hasFallbackTo` now comes from `parse/opf.js` since Task 3):

```ts
// Remote references EPUB 3 permits without RSC-006. EPUB 2 forbids remote
// publication resources outright; only hyperlink/cite (which are not
// publication resources) escape (epubcheck ResourceReferencesChecker).
const REMOTE_ALLOWED_V3: ReadonlySet<RefType> = new Set<RefType>(['hyperlink', 'cite', 'audio', 'video'])
const REMOTE_ALLOWED_V2: ReadonlySet<RefType> = new Set<RefType>(['hyperlink', 'cite'])
```

In `checkReferences`, at the top:

```ts
  const messages: Message[] = []
  const major = majorVersion(version)
  const remoteAllowed = major === '2.0' ? REMOTE_ALLOWED_V2 : REMOTE_ALLOWED_V3
  const blessed = blessedContentTypes(version)
  const isBlessedContent = (mediaType: string | undefined): boolean =>
    mediaType !== undefined && blessed.has(mediaType)
```

Replace the remote branch:

```ts
    if (isRemote(url)) {
      if (!remoteAllowed.has(ref.type)) {
        messages.push(msg('RSC-006', ref.loc, url))
      } else if (ref.type !== 'hyperlink' && major === '3.0') {
        // Remote-allowed non-hyperlink refs (audio/video/cite) must use HTTPS. EPUB 3 only.
        const scheme = url.slice(0, url.indexOf(':')).toLowerCase()
        if (scheme !== 'https' && scheme !== 'file') messages.push(msg('RSC-031', ref.loc, url))
      }
      continue
    }
```

Replace the hyperlink branch's blessed check:

```ts
        if (!isBlessedContent(item.mediaType) && !hasFallbackTo(item, byId, (i) => isBlessedContent(i.mediaType))) {
          messages.push(msg('RSC-010', ref.loc))
        } else if (!spinePaths.has(target)) {
```

Leave the RSC-032 branch untouched (it already runs for every version; `coreMediaTypes('2.0')` returns the 3.0 base list, matching epubcheck's version-independent `OPFChecker30.isCoreMediaType` modulo the project's existing per-revision webp/ecmascript gating).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/checks/content.test.ts` then `npx vitest run`
Expected: PASS; full suite green (3.x fixtures see identical behavior).

- [ ] **Step 5: Commit**

```bash
git add src/checks/content.ts src/checks/content.test.ts
git commit -m "feat: EPUB 2 gating for content reference checks (RSC-006/010/031)"
```

---

### Task 8: CSS version threading (CSS-007 under v2)

**Files:**
- Modify: `src/checks/css.ts`, `src/checks/content.ts` (call site), `src/validate.ts` deferred to Task 9
- Test: `src/checks/css.test.ts`

**Interfaces:**
- Consumes: Task 1 `isBlessedFontMimetype20` (`util/media-types.js`), `majorVersion` (`versions.js`).
- Produces: `validateCss(css, container, manifest, version?: EpubVersion)` and `validateCssDocs(pkg, container, version?: EpubVersion)` — optional trailing parameter, additive/non-breaking. When major 2.0, CSS-007 uses the prefix predicate; otherwise (including `undefined`) the existing 3.x exact-match set.

- [ ] **Step 1: Write the failing tests**

Append to `src/checks/css.test.ts` (reuse its existing helpers):

```ts
describe('CSS-007 version awareness', () => {
  // font-face src → declared local item with media-type 'application/x-font-opentype'
  it('v2 prefix predicate accepts application/x-font-opentype (no CSS-007)', () => {
    expect(ids(validateCss(css, container, manifest, '2.0'))).not.toContain('CSS-007')
  })
  it('3.x exact set rejects it (CSS-007)', () => {
    expect(ids(validateCss(css, container, manifest, '3.3'))).toContain('CSS-007')
    expect(ids(validateCss(css, container, manifest))).toContain('CSS-007') // default unchanged
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/checks/css.test.ts`
Expected: FAIL — the v2 call still emits CSS-007 (and TypeScript may reject the 4th argument until implemented; that is the failure signal).

- [ ] **Step 3: Implement**

In `src/checks/css.ts`:

```ts
import { isBlessedFontType, isBlessedFontMimetype20 } from '../util/media-types.js'
import { majorVersion, type EpubVersion } from '../versions.js'

export function validateCss(
  css: CssDocument,
  container: EpubContainer,
  manifest: Map<string, ManifestItem>,
  version?: EpubVersion,
): Message[] {
  return [...checkReferences(css, container, manifest, version), ...checkProperties(css)]
}

export function validateCssDocs(
  pkg: PackageDocument,
  container: EpubContainer,
  version?: EpubVersion,
): Message[] {
  // … unchanged, but pass version through:
  if (css) messages.push(...validateCss(css, container, manifest, version))
```

`checkReferences` gains the parameter and a predicate:

```ts
function checkReferences(
  css: CssDocument,
  container: EpubContainer,
  manifest: Map<string, ManifestItem>,
  version?: EpubVersion,
): Message[] {
  const isBlessedFont =
    version !== undefined && majorVersion(version) === '2.0' ? isBlessedFontMimetype20 : isBlessedFontType
  // … in the font branch:
      if (item && item.mediaType !== undefined && !isBlessedFont(item.mediaType)) {
        messages.push(msg('CSS-007', ref.loc, url, item.mediaType))
      }
```

In `src/checks/content.ts`, pass the version to the inline-style call:

```ts
        ...validateCss(
          { path: doc.path, refs: a.refs, declarations: a.declarations, fontFaces: a.fontFaces },
          container,
          manifest,
          version,
        ),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/checks/css.test.ts` then `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/checks/css.ts src/checks/css.test.ts src/checks/content.ts
git commit -m "feat: thread version into CSS checks; EPUB 2 font predicate for CSS-007"
```

---

### Task 9: Pipeline wiring + EPUB 2 fixture builder + exports

**Files:**
- Modify: `src/validate.ts`, `src/index.ts`
- Modify: `test/fixtures/build.ts`
- Test: `src/validate.test.ts`

**Interfaces:**
- Consumes: Tasks 1–8. `parseNcx`/`validateNcx`, `NCX_MEDIA_TYPE`, `pkg.spineToc`.
- Produces:
  - `validateEpub` runs the full pipeline for major 2.0 and validates a legacy NCX under 3.0.
  - `test/fixtures/build.ts` exports `OPF2: string`, `NCX2: string`, `buildEpub2(o?: EpubOverrides): Uint8Array` (used by Task 10 and by these tests).
  - `src/index.ts` exports `parseNcx`, `validateNcx`, and types `NcxDocument`, `NcxNavPoint`, `NcxTextLabel`, `GuideReference`.

- [ ] **Step 1: Add the EPUB 2 fixture builder (test infrastructure, no assertions yet)**

Append to `test/fixtures/build.ts`:

```ts
// A fully-valid EPUB 2 (OPF 2.0 + NCX) package. Substrings below are stable
// targets for fixture .replace() edits.
export const OPF2 =
  '<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="2.0" unique-identifier="uid">' +
  '<metadata>' +
  '<dc:identifier id="uid">urn:uuid:00000000-0000-0000-0000-000000000000</dc:identifier>' +
  '<dc:title>Title</dc:title>' +
  '<dc:language>en</dc:language>' +
  '</metadata>' +
  '<manifest>' +
  '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' +
  '<item id="content" href="content_001.xhtml" media-type="application/xhtml+xml"/>' +
  '</manifest>' +
  '<spine toc="ncx"><itemref idref="content"/></spine>' +
  '<guide><reference type="text" title="Text" href="content_001.xhtml"/></guide>' +
  '</package>'

export const NCX2 =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">' +
  '<head><meta name="dtb:uid" content="urn:uuid:00000000-0000-0000-0000-000000000000"/></head>' +
  '<docTitle><text>Title</text></docTitle>' +
  '<navMap>' +
  '<navPoint id="np1" playOrder="1"><navLabel><text>Content</text></navLabel><content src="content_001.xhtml"/></navPoint>' +
  '</navMap>' +
  '</ncx>'

/** Build an EPUB 2 publication (OPF 2.0 + NCX baseline). */
export function buildEpub2(o: EpubOverrides = {}): Uint8Array {
  return assembleEpub(
    {
      mimetype: MIMETYPE,
      'META-INF/container.xml': CONTAINER,
      'EPUB/package.opf': OPF2,
      'EPUB/toc.ncx': NCX2,
      'EPUB/content_001.xhtml': CONTENT,
    },
    o,
  )
}
```

To avoid duplicating the zip-assembly logic, extract a shared private helper and refactor `buildEpub` to use it (behavior identical — all existing fixtures/tests must still pass). Add this helper ABOVE `buildEpub`:

```ts
/** Merge a baseline file set with overrides and zip it (mimetype stored, rest deflated). */
function assembleEpub(base: Record<string, string | Uint8Array>, o: EpubOverrides): Uint8Array {
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

and replace the body of the existing `buildEpub` with:

```ts
export function buildEpub(o: EpubOverrides = {}): Uint8Array {
  return assembleEpub(
    {
      mimetype: MIMETYPE,
      'META-INF/container.xml': CONTAINER,
      'EPUB/package.opf': OPF,
      'EPUB/nav.xhtml': NAV,
      'EPUB/content_001.xhtml': CONTENT,
    },
    o,
  )
}
```

- [ ] **Step 2: Write the failing pipeline tests**

Append to `src/validate.test.ts`:

```ts
import { buildEpub2, NCX2, OPF2, buildEpub, OPF } from '../test/fixtures/build.js'
```

(Match the file's existing import path for fixtures — read the top of the file and follow it.)

```ts
describe('EPUB 2 pipeline', () => {
  it('a valid EPUB 2 book produces zero messages', async () => {
    const report = await validateEpub(buildEpub2())
    expect(report.messages).toEqual([])
    expect(report.epubVersion).toBe('2.0')
  })

  it('validates the NCX: uid mismatch → NCX-001', async () => {
    const epub = buildEpub2({
      files: { 'EPUB/toc.ncx': NCX2.replace('urn:uuid:00000000-0000-0000-0000-000000000000', 'urn:uuid:mismatch') },
    })
    const report = await validateEpub(epub)
    expect(report.messages.map((m) => m.id)).toContain('NCX-001')
  })

  it('runs the content layer for EPUB 2: broken hyperlink → RSC-007', async () => {
    const epub = buildEpub2({
      files: {
        'EPUB/content_001.xhtml':
          '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><a href="ghost.xhtml">x</a></body></html>',
      },
    })
    const report = await validateEpub(epub)
    expect(report.messages.map((m) => m.id)).toContain('RSC-007')
  })

  it('validates a legacy NCX in an EPUB 3 book', async () => {
    const epub = buildEpub({
      files: {
        'EPUB/package.opf': OPF.replace(
          '</manifest>',
          '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest>',
        ),
        'EPUB/toc.ncx': NCX2.replace('urn:uuid:00000000-0000-0000-0000-000000000000', 'urn:uuid:mismatch'),
      },
    })
    const report = await validateEpub(epub)
    expect(report.messages.map((m) => m.id)).toContain('NCX-001')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/validate.test.ts`
Expected: FAIL — valid-EPUB-2 currently reports the dcterms:modified RSC-005? No — that was fixed in Task 4; but NCX-001/RSC-007 tests fail because the 2.0 path never parses NCX or content docs.

- [ ] **Step 4: Implement**

In `src/validate.ts`:

Add imports:

```ts
import { parseNcx } from './parse/ncx.js'
import { validateNcx } from './checks/ncx.js'
import type { ManifestItem } from './parse/opf.js'
import { majorVersion, NCX_MEDIA_TYPE, type EpubVersion } from './versions.js'
```

Replace the layered-documents block (currently `if (target !== undefined && majorVersion(target) === '3.0') { … }`) with:

```ts
      if (target !== undefined) {
        // NCX: EPUB 2's navigation document; also validated as a legacy compat
        // doc when an EPUB 3 book ships one. Found via the spine toc idref,
        // falling back to media-type discovery.
        const byId = new Map<string, ManifestItem>()
        for (const item of pkg.manifest) {
          if (item.id !== undefined) byId.set(item.id, item)
        }
        const ncxItem =
          (pkg.spineToc !== undefined ? byId.get(pkg.spineToc) : undefined) ??
          pkg.manifest.find((i) => i.mediaType === NCX_MEDIA_TYPE)
        if (ncxItem) {
          const { ncx, messages: ncxMessages } = parseNcx(ncxItem, container)
          messages.push(...ncxMessages)
          if (ncx) messages.push(...validateNcx(ncx, pkg, container, target))
        }

        // EPUB 3 navigation document.
        if (majorVersion(target) === '3.0') {
          const navItem = pkg.manifest.find((i) => i.properties.includes('nav'))
          if (navItem) {
            const { nav, messages: navMessages } = parseNav(navItem, container)
            messages.push(...navMessages)
            if (nav) messages.push(...validateNav(nav, pkg, container))
          }
        }

        // Content and CSS layers run for both majors, version-gated internally.
        messages.push(...validateContentDocs(pkg, container, target))
        messages.push(...validateCssDocs(pkg, container, target))
      }
```

In `src/index.ts` add:

```ts
export { parseNcx } from './parse/ncx.js'
export { validateNcx } from './checks/ncx.js'
```

and to the type exports:

```ts
export type { NcxDocument, NcxNavPoint, NcxTextLabel } from './parse/ncx.js'
export type { GuideReference } from './parse/opf.js'
```

(`PackageDocument`'s type export line already exists; `GuideReference` joins that line's source module list.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/validate.test.ts` then `npx vitest run`
Expected: PASS, full suite green. If the valid-EPUB-2 test reports messages, list them — each is a latent 3.0-ism in a version-agnostic check; fix by gating it the way Task 4 gated dcterms:modified (and add a unit test for the gate).

- [ ] **Step 6: Commit**

```bash
git add src/validate.ts src/index.ts src/validate.test.ts test/fixtures/build.ts
git commit -m "feat: full EPUB 2 pipeline (NCX + content/CSS layers) in validateEpub"
```

---

### Task 10: Corpus fixtures, IMPLEMENTED_IDS, README

**Files:**
- Modify: `test/fixtures/corpus.ts`, `test/fixtures/implemented.ts`
- Modify: `README.md`
- Test: `test/integration/corpus.test.ts` (existing harness — no changes expected)

**Interfaces:**
- Consumes: `buildEpub2`, `OPF2`, `NCX2`, `buildEpub`, `OPF` from Task 9; `Fixture` type.

- [ ] **Step 1: Extend the fixture area union**

In `test/fixtures/corpus.ts` change:

```ts
  area: 'ocf' | 'opf' | 'nav' | 'content' | 'css' | 'ncx'
```

- [ ] **Step 2: Add the new ids to IMPLEMENTED_IDS**

In `test/fixtures/implemented.ts`, extend the package-document line and add an ncx line:

```ts
  // package document
  'OPF-001', 'OPF-003', 'OPF-030', 'OPF-031', 'OPF-032', 'OPF-033', 'OPF-034', 'OPF-035', 'OPF-037', 'OPF-040', 'OPF-042', 'OPF-043', 'OPF-044', 'OPF-048', 'OPF-049', 'OPF-050', 'OPF-074', 'OPF-099',
  // ncx
  'NCX-001', 'NCX-004', 'NCX-006',
```

- [ ] **Step 3: Add the corpus fixtures**

Update the import in `test/fixtures/corpus.ts`:

```ts
import { buildEpub, buildEpub2, cssEpub, CONTAINER, OPF, OPF2, NAV, NCX2, CONTENT } from './build.js'
```

Append to `CORPUS` (each mirrors an epubcheck `epub2/*.feature` scenario or is crafted per the project's subset-match philosophy):

```ts
  // ---- EPUB 2 baseline ----
  { name: 'minimal-epub2', area: 'ocf', description: 'minimal valid EPUB 2 (OPF 2.0 + NCX)', epub: buildEpub2(), expected: [] },

  // ---- NCX (mirrors epub2/ncx-publication.feature) ----
  {
    name: 'ncx-uid-mismatch',
    area: 'ncx',
    description: 'dtb:uid does not match the OPF unique identifier (epubcheck NCX-001)',
    epub: buildEpub2({ files: { 'EPUB/toc.ncx': NCX2.replace('urn:uuid:00000000-0000-0000-0000-000000000000', 'urn:uuid:mismatch') } }),
    expected: [E('NCX-001', 'ERROR')],
  },
  {
    name: 'ncx-uid-spaces',
    area: 'ncx',
    description: 'dtb:uid has leading/trailing whitespace (epubcheck NCX-004, usage; matches after trim so no NCX-001)',
    epub: buildEpub2({ files: { 'EPUB/toc.ncx': NCX2.replace('content="urn:uuid:00000000-0000-0000-0000-000000000000"', 'content=" urn:uuid:00000000-0000-0000-0000-000000000000 "') } }),
    expected: [E('NCX-004', 'USAGE')],
  },
  {
    name: 'ncx-label-empty',
    area: 'ncx',
    description: 'empty navLabel text (epubcheck NCX-006, usage)',
    epub: buildEpub2({ files: { 'EPUB/toc.ncx': NCX2.replace('<text>Content</text>', '<text></text>') } }),
    expected: [E('NCX-006', 'USAGE')],
  },
  {
    name: 'ncx-navmap-missing',
    area: 'ncx',
    description: 'NCX without a navMap (schema-level, epubcheck RSC-005)',
    epub: buildEpub2({ files: { 'EPUB/toc.ncx': NCX2.replace(/<navMap>[\s\S]*<\/navMap>/, '') } }),
    expected: [E('RSC-005', 'ERROR')],
  },
  {
    name: 'ncx-link-missing-resource',
    area: 'ncx',
    description: 'navPoint src to a file not in the EPUB (epubcheck RSC-007; mirrors ncx-missing-resource-error)',
    epub: buildEpub2({ files: { 'EPUB/toc.ncx': NCX2.replace('src="content_001.xhtml"', 'src="ghost.xhtml"') } }),
    expected: [E('RSC-007', 'ERROR')],
  },
  {
    name: 'ncx-link-non-ops',
    area: 'ncx',
    description: 'navPoint src to a non-content-document (epubcheck RSC-010; mirrors ncx-link-to-non-ops-error)',
    epub: buildEpub2({
      files: {
        'EPUB/package.opf': OPF2.replace('</manifest>', '<item id="img" href="cover.gif" media-type="image/gif"/></manifest>'),
        'EPUB/cover.gif': 'GIF89a',
        'EPUB/toc.ncx': NCX2.replace('src="content_001.xhtml"', 'src="cover.gif"'),
      },
    }),
    expected: [E('RSC-010', 'ERROR')],
  },

  // ---- OPF 2.0 (mirrors epub2/opf-package-document.feature + opf-publication.feature) ----
  {
    name: 'opf2-guide-undeclared',
    area: 'opf',
    description: 'guide reference to a file not in the manifest (epubcheck OPF-031)',
    epub: buildEpub2({ files: { 'EPUB/package.opf': OPF2.replace('href="content_001.xhtml"/></guide>', 'href="ghost.xhtml"/></guide>') } }),
    expected: [E('OPF-031', 'ERROR')],
  },
  {
    name: 'opf2-guide-non-content',
    area: 'opf',
    description: 'guide reference to a non-content-document (epubcheck OPF-032)',
    epub: buildEpub2({
      files: {
        'EPUB/package.opf': OPF2
          .replace('</manifest>', '<item id="img" href="cover.gif" media-type="image/gif"/></manifest>')
          .replace('href="content_001.xhtml"/></guide>', 'href="cover.gif"/></guide>'),
        'EPUB/cover.gif': 'GIF89a',
      },
    }),
    expected: [E('OPF-032', 'ERROR')],
  },
  {
    name: 'opf2-spine-duplicate',
    area: 'opf',
    description: 'spine references the same manifest item twice (epubcheck OPF-034)',
    epub: buildEpub2({ files: { 'EPUB/package.opf': OPF2.replace('<itemref idref="content"/>', '<itemref idref="content"/><itemref idref="content"/>') } }),
    expected: [E('OPF-034', 'ERROR')],
  },
  {
    name: 'opf2-text-html',
    area: 'opf',
    description: 'manifest item with text/html media type (epubcheck OPF-035, warning)',
    epub: buildEpub2({
      files: {
        'EPUB/package.opf': OPF2.replace('</manifest>', '<item id="html" href="old.html" media-type="text/html"/></manifest>'),
        'EPUB/old.html': CONTENT,
      },
    }),
    expected: [E('OPF-035', 'WARNING')],
  },
  {
    name: 'opf2-deprecated-type',
    area: 'opf',
    description: 'manifest item with deprecated text/x-oeb1-css media type (epubcheck OPF-037, warning)',
    epub: buildEpub2({
      files: {
        'EPUB/package.opf': OPF2.replace('</manifest>', '<item id="oeb" href="old.css" media-type="text/x-oeb1-css"/></manifest>'),
        'EPUB/old.css': 'p { color: black }',
      },
    }),
    expected: [E('OPF-037', 'WARNING')],
  },
  {
    name: 'opf2-spine-image',
    area: 'opf',
    description: 'image media type in the spine (epubcheck OPF-042)',
    epub: buildEpub2({
      files: {
        'EPUB/package.opf': OPF2
          .replace('</manifest>', '<item id="img" href="cover.gif" media-type="image/gif"/></manifest>')
          .replace('<itemref idref="content"/>', '<itemref idref="content"/><itemref idref="img"/>'),
        'EPUB/cover.gif': 'GIF89a',
      },
    }),
    expected: [E('OPF-042', 'ERROR')],
  },
  {
    name: 'opf2-spine-foreign-no-fallback',
    area: 'opf',
    description: 'foreign spine item without fallback (epubcheck OPF-043)',
    epub: buildEpub2({
      files: {
        'EPUB/package.opf': OPF2
          .replace('</manifest>', '<item id="pdf" href="doc.pdf" media-type="application/pdf"/></manifest>')
          .replace('<itemref idref="content"/>', '<itemref idref="content"/><itemref idref="pdf"/>'),
        'EPUB/doc.pdf': '%PDF-1.4',
      },
    }),
    expected: [E('OPF-043', 'ERROR')],
  },
  {
    name: 'opf2-spine-foreign-bad-fallback',
    area: 'opf',
    description: 'foreign spine item whose fallback chain never reaches a content document (epubcheck OPF-044)',
    epub: buildEpub2({
      files: {
        'EPUB/package.opf': OPF2
          .replace(
            '</manifest>',
            '<item id="pdf" href="doc.pdf" media-type="application/pdf" fallback="img"/>' +
              '<item id="img" href="cover.gif" media-type="image/gif"/></manifest>',
          )
          .replace('<itemref idref="content"/>', '<itemref idref="content"/><itemref idref="pdf"/>'),
        'EPUB/doc.pdf': '%PDF-1.4',
        'EPUB/cover.gif': 'GIF89a',
      },
    }),
    expected: [E('OPF-044', 'ERROR')],
  },
  {
    name: 'opf2-fallback-unresolved',
    area: 'opf',
    description: 'fallback idref not in the manifest (epubcheck OPF-040; the dangling chain also fails the content-document requirement → OPF-044)',
    epub: buildEpub2({
      files: {
        'EPUB/package.opf': OPF2
          .replace('</manifest>', '<item id="pdf" href="doc.pdf" media-type="application/pdf" fallback="ghost"/></manifest>')
          .replace('<itemref idref="content"/>', '<itemref idref="content"/><itemref idref="pdf"/>'),
        'EPUB/doc.pdf': '%PDF-1.4',
      },
    }),
    expected: [E('OPF-040', 'ERROR'), E('OPF-044', 'ERROR')],
  },
  {
    name: 'opf2-spine-toc-missing',
    area: 'opf',
    description: 'EPUB 2 spine without the required toc attribute (schema-level, epubcheck RSC-005; NCX still found by media type)',
    epub: buildEpub2({ files: { 'EPUB/package.opf': OPF2.replace('<spine toc="ncx">', '<spine>') } }),
    expected: [E('RSC-005', 'ERROR')],
  },
  {
    name: 'opf2-toc-not-ncx',
    area: 'opf',
    description: 'spine toc idref resolves to a non-NCX item (epubcheck OPF-050); the XHTML then fails NCX structure (RSC-005)',
    epub: buildEpub2({ files: { 'EPUB/package.opf': OPF2.replace('<spine toc="ncx">', '<spine toc="content">') } }),
    expected: [E('OPF-050', 'ERROR'), E('RSC-005', 'ERROR')],
  },
  {
    name: 'opf-manifest-self',
    area: 'opf',
    description: 'manifest lists the package document itself (epubcheck OPF-099; version-agnostic, EPUB 3 fixture)',
    epub: buildEpub({
      files: {
        'EPUB/package.opf': OPF.replace('</manifest>', '<item id="self" href="package.opf" media-type="application/oebps-package+xml"/></manifest>'),
      },
    }),
    expected: [E('OPF-099', 'ERROR')],
  },

  // ---- EPUB 2 content layer ----
  {
    name: 'epub2-remote-image',
    area: 'content',
    description: 'remote image reference in an EPUB 2 content doc (epubcheck RSC-006; remote publication resources are forbidden in EPUB 2)',
    epub: buildEpub2({
      files: {
        'EPUB/content_001.xhtml':
          '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>' +
          '<img src="https://example.com/x.png" alt="x"/></body></html>',
      },
    }),
    expected: [E('RSC-006', 'ERROR')],
  },

  // ---- EPUB 3 legacy NCX ----
  {
    name: 'epub3-legacy-ncx-broken',
    area: 'ncx',
    description: 'EPUB 3 book shipping a legacy NCX with a mismatched dtb:uid (epubcheck NCX-001 fires for EPUB 3 too)',
    epub: buildEpub({
      files: {
        'EPUB/package.opf': OPF.replace('</manifest>', '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest>'),
        'EPUB/toc.ncx': NCX2.replace('urn:uuid:00000000-0000-0000-0000-000000000000', 'urn:uuid:mismatch'),
      },
    }),
    expected: [E('NCX-001', 'ERROR')],
  },
```

- [ ] **Step 4: Run the corpus and full suite**

Run: `npx vitest run test/integration/corpus.test.ts` then `npx vitest run`
Expected: PASS. The harness is exact-multiset — if a fixture reports extra messages, first determine whether epubcheck would report them too (check the epubcheck feature files under `src/test/resources/epub2/`); adjust the fixture's `expected` only for true positives, fix the validator for false positives. Do not weaken the harness.

- [ ] **Step 5: Update the README**

In `README.md`, update the Features bullet for EPUB versions — replace the existing "EPUB 2 and EPUB 3" bullet's text so it reflects reality:

```markdown
- **EPUB 2 and EPUB 3** — full-pipeline validation for both majors: EPUB 3
  books get OCF → package → navigation-document → content → CSS checks; EPUB 2
  books get the same pipeline with the NCX in place of the navigation document,
  plus OPF 2.0 rules (`<guide>`, spine `toc`/NCX wiring, EPUB 2 blessed media
  types and fallback chains). An EPUB 3 book that ships a legacy NCX gets it
  validated too. The package document only distinguishes the major version
  (`2.0` or `3.0`); all published revisions (`2.0`, `2.0.1`, `3.0`, `3.0.1`,
  `3.2`, `3.3`) are accepted as `version` targets and are caller-selected via
  `options.version`.
```

Also check the comparison table row "Maturity" — update "accepts all published revisions … as `version` targets" only if it now under-sells (leave if accurate).

- [ ] **Step 6: Full verification**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: all four pass.

- [ ] **Step 7: Commit**

```bash
git add test/fixtures/corpus.ts test/fixtures/implemented.ts README.md
git commit -m "test: EPUB 2 corpus fixtures; docs: EPUB 2 support in README"
```

---

## Post-plan roadmap (not in this plan)

- The CLI (second half of the original project goal — highest-value next step).
- Attribute-namespace resolution in `parseXml`; CDATA `<style>` handling.
- DTBook content parsing; OPF-041 (`fallback-style`); OEBPS 1.2 rules (OPF-038/039).
- NCX `pageList`/`pageTarget` structural checks.
