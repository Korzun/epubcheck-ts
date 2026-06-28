# epubcheck-ts — Design Spec

**Date:** 2026-06-28
**Status:** Approved (design)
**Topic:** A fresh, TypeScript-native EPUB validator, distributable as an NPM module, inspired by [w3c/epubcheck](https://github.com/w3c/epubcheck).

---

## 1. Goal & intent

Build a **fresh, TypeScript-native EPUB validator** — not a 1:1 port of epubcheck's Java engine, and not a wrapper around it. The validation *rules* are inspired by epubcheck (and reuse its message vocabulary), but the implementation is idiomatic TypeScript. This deliberately removes the largest porting risk in a faithful port: epubcheck's schema engine (RelaxNG via Jing, Schematron via XSLT, NVDL). We express checks as TypeScript functions instead of running a schema engine.

The long-term project works as **both a CLI and an NPM TypeScript module**. **This MVP delivers the module only**; the CLI is a named, deferred phase (see §10).

### Non-goals (this MVP)
- No CLI and no Node file-path/stream-from-disk adapter (architected for, not built).
- No CSS validation, SVG deep validation, media overlays (SMIL), scripting, or font checks.
- No EPUB 2 (NCX / OPF 2.0 / `guide`) — architected for, shipped later.
- No severity-override configuration, non-English localization, or JSON/XML/XMP reporters.

---

## 2. Scope

### EPUB version
**EPUB 3 first**, architected so EPUB 2 slots in behind the same interfaces later. `PackageDocument.version` discriminates; checks branch on it where rules differ.

### MVP validation surface
1. **OCF container** — ZIP structure, `mimetype` (first entry, stored/uncompressed, exact bytes `application/epub+zip`), `META-INF/container.xml` presence + parse → rootfile(s), `encryption.xml` awareness.
2. **OPF package document** — manifest, spine, metadata; required EPUB 3 metadata (`dc:identifier` matching `unique-identifier`, `dc:title`, `dc:language`, `dcterms:modified`); media types; manifest↔resource cross-references; spine↔manifest `idref` integrity; fallbacks; `nav` item identification.
3. **Navigation document** — locate the manifest item with `properties` containing `nav`, parse it as XHTML, validate the toc nav presence and basic structure.
4. **XHTML content documents** — for each XHTML content document in the manifest: well-formedness, allowed element/attribute subset (EPUB 3), reference resolution (`src`/`href` resolve within the container and are declared in the manifest where required), fragment-id checks.

---

## 3. Architecture & data flow

The core is a **pipeline of pure functions over plain data**. Bytes in, a `Report` out. Validation problems become messages; they never throw. Every stage is independently callable (the layered API, §6).

```
bytes (Uint8Array | ArrayBuffer | ReadableStream<Uint8Array>)
   │
   ▼
[ openEpub ]      unzip via fflate → EpubContainer
   │              (resource map: path → bytes; mimetype + encryption awareness)
   ▼
[ parse layer ]   parseXml  → positioned XmlNode tree (saxes)
   │              parseOpf  → PackageDocument
   │              parseNav  → NavDocument
   │              parseContent → content XmlNode tree(s)
   ▼
[ check layer ]   validateOcf(container)                → Message[]
   │              validateOpf(pkg, container)           → Message[]
   │              validateNav(nav, pkg)                 → Message[]
   │              validateContentDocs(pkg, container)   → Message[]
   ▼
[ report ]        buildReport(messages) → Report (counts, severities, version)
```

### Key properties
- **Short-circuiting, not throwing.** If the input is not a ZIP, or `container.xml`/OPF is missing or unparseable, emit a FATAL/ERROR message and skip the downstream checks that depend on that artifact — but still return a `Report`.
- **Pure checks.** Each check is `(data) => Message[]`: trivially unit-testable, composable, and free of I/O.
- **Functional style, no classes.** All structures are plain data; all behavior is functions. (Project-wide constraint.)
- **Runtime-agnostic core.** Operates on bytes with zero Node-only dependencies; runs in Node, browser, Deno, Bun, and edge runtimes.

---

## 4. Module layout

Unit tests are **colocated** with their module (`foo.ts` + `foo.test.ts`). Only the fixture-driven integration suite lives under `test/`. Types are defined in the module that **produces** them — no types-only files.

```
src/
  index.ts            # public exports + type re-exports
  validate.ts         # validateEpub() orchestration            (+ .test.ts)
  report.ts           # owns Report; buildReport(messages)       (+ .test.ts)
  io/
    zip.ts            # owns EpubContainer, Resource; openEpub()  (+ .test.ts)   [fflate]
    xml.ts            # owns XmlNode; parseXml()                  (+ .test.ts)   [saxes]
  parse/
    opf.ts            # owns PackageDocument, ManifestItem, SpineItem, Metadata; parseOpf()  (+ .test.ts)
    nav.ts            # owns NavDocument; parseNav()              (+ .test.ts)
    content.ts        # parseContent()                           (+ .test.ts)
  checks/
    ocf.ts            # validateOcf(container)                   (+ .test.ts)
    opf.ts            # validateOpf(pkg, container)              (+ .test.ts)
    nav.ts            # validateNav(nav, pkg)                    (+ .test.ts)
    content.ts        # validateContentDocs(pkg, container)      (+ .test.ts)
  messages/
    catalog.ts        # owns Severity; CATALOG (id → severity, template)  (+ .test.ts)
    format.ts         # owns Location, Message; msg()            (+ .test.ts)
  util/               # path resolution, media types, encoding helpers  (*.ts + *.test.ts)
test/
  fixtures/           # ported epubcheck EPUBs + expected results (+ ATTRIBUTION)
  integration/        # run validateEpub over fixtures, assert message sets
```

The **future CLI + Node adapter** slot into a separate entry (e.g. `src/node/`, `src/cli/`) that adds file-path/stream-from-disk convenience and reporters on top of this core — no core changes required.

---

## 5. Data model

All plain types, no classes. Each lives with its producer; consumers import.

```ts
// messages/catalog.ts
type Severity = 'FATAL' | 'ERROR' | 'WARNING' | 'INFO' | 'USAGE'

// messages/format.ts
interface Location {
  path: string          // resource path within the EPUB, e.g. "EPUB/package.opf"
  line?: number         // 1-based (from saxes)
  column?: number       // 1-based
}
interface Message {
  id: string            // epubcheck id, e.g. "OPF-014"
  severity: Severity
  message: string       // formatted English (catalog template + args)
  location?: Location
  suggestion?: string   // optional remediation hint, where epubcheck has one
}

// report.ts
interface Report {
  messages: Message[]
  epubVersion?: '2.0' | '3.0'
  counts: Record<Severity, number>
  fatal: boolean        // counts.FATAL > 0
  valid: boolean        // no FATAL and no ERROR
}

// io/xml.ts — light positioned "DOM" (plain objects)
interface XmlNode {
  type: 'element' | 'text'
  name?: string                       // qualified name for elements
  ns?: string                         // resolved namespace URI
  attrs?: Record<string, string>
  children?: XmlNode[]
  text?: string
  loc: Location                       // start position of the node
}

// io/zip.ts
interface Resource {
  path: string                        // normalized container path
  bytes: Uint8Array
  compression: 'stored' | 'deflate'
  mediaType?: string                  // filled in post-OPF-parse
}
interface EpubContainer {
  resources: Map<string, Resource>    // pure data, no methods
  rootfiles: string[]                 // from container.xml
  hasEncryption: boolean              // META-INF/encryption.xml present
}
// Resource lookup is a standalone helper (util/), keeping EpubContainer pure data:
function getResource(container: EpubContainer, path: string): Resource | undefined

// parse/opf.ts
interface ManifestItem { id: string; href: string; mediaType: string; properties: string[]; fallback?: string }
interface SpineItem    { idref: string; linear: boolean; properties: string[] }
interface Metadata     { identifiers: string[]; titles: string[]; languages: string[]; modified?: string }
interface PackageDocument {
  version: '2.0' | '3.0'
  uniqueIdentifier?: string
  metadata: Metadata
  manifest: ManifestItem[]
  spine: SpineItem[]
  navItem?: ManifestItem              // manifest item whose properties include "nav"
  loc: Location
}

// parse/nav.ts
interface NavDocument {
  root: XmlNode
  tocNav?: XmlNode                     // <nav epub:type="toc">
  loc: Location
}
```

---

## 6. Check & message framework

The **catalog** is the single source of truth for `id → severity → template`, ported from epubcheck's `MessageBundle.properties` (BSD-3, see §9).

```ts
// messages/catalog.ts
const CATALOG: Record<string, { severity: Severity; template: string }> = {
  'OPF-014': { severity: 'ERROR', template: 'The property "%1$s" should not be declared in the spine.' },
  // …ported entries
}

// messages/format.ts
function msg(id: string, location: Location | undefined, ...args: unknown[]): Message
//   looks up severity + template from CATALOG, formats args, returns a Message.
```

Each check imports `msg` and emits messages; it never hardcodes severities or English text. This makes:
- **severity overrides** a future single-point concern,
- **localization** a future swap of the template source (no check changes),
- **checks pure and unit-testable** — data in, `Message[]` out.

Check signatures:
```ts
function validateOcf(container: EpubContainer): Message[]
function validateOpf(pkg: PackageDocument, container: EpubContainer): Message[]
function validateNav(nav: NavDocument, pkg: PackageDocument): Message[]
function validateContentDocs(pkg: PackageDocument, container: EpubContainer): Message[]
```

---

## 7. Public API

```ts
// Convenience entry point.
function validateEpub(
  input: Uint8Array | ArrayBuffer | ReadableStream<Uint8Array>,
  options?: ValidateOptions,
): Promise<Report>

interface ValidateOptions {
  version?: '2.0' | '3.0'   // override auto-detected version
  // severityOverrides?, locale? — reserved for later phases
}

// Layered, composable functions (all exported).
function openEpub(input: Uint8Array | ArrayBuffer | ReadableStream<Uint8Array>): Promise<EpubContainer>
function getResource(container: EpubContainer, path: string): Resource | undefined
function parseOpf(container: EpubContainer): { pkg?: PackageDocument; messages: Message[] }
function parseNav(item: ManifestItem, container: EpubContainer): { nav?: NavDocument; messages: Message[] }
function validateOcf(container: EpubContainer): Message[]
function validateOpf(pkg: PackageDocument, container: EpubContainer): Message[]
function validateNav(nav: NavDocument, pkg: PackageDocument): Message[]
function validateContentDocs(pkg: PackageDocument, container: EpubContainer): Message[]

// Types are re-exported from index.ts:
//   Report, Message, Severity, Location, EpubContainer, Resource,
//   PackageDocument, ManifestItem, SpineItem, Metadata, NavDocument, XmlNode, ValidateOptions
```

`validateEpub` is the orchestration of the layered functions with short-circuiting. Power users call the pieces directly.

### Usage
```ts
import { validateEpub } from 'epubcheck-ts'

const report = await validateEpub(bytes)
if (!report.valid) {
  for (const m of report.messages) {
    console.log(`${m.severity} ${m.id} ${m.location?.path ?? ''}: ${m.message}`)
  }
}
```
```ts
// Or compose the layers:
const epub = await openEpub(bytes)
const { pkg } = parseOpf(epub)
const messages = [
  ...validateOcf(epub),
  ...(pkg ? validateOpf(pkg, epub) : []),
  ...(pkg ? validateContentDocs(pkg, epub) : []),
]
```

---

## 8. Error handling

- **Validation problems → messages, never exceptions.** The pipeline short-circuits past dependent stages when a prerequisite artifact is missing/unparseable (no ZIP → only the FATAL; no OPF → skip OPF/nav/content checks).
- **Parsers return `{ value?, messages }`** so a parse failure is both reported and gracefully degraded.
- **Unexpected internal exceptions** are caught at the orchestration boundary and recorded as a single internal-error message (epubcheck-style `CHK` code). `validateEpub` **always resolves to a `Report`** and never rejects on a malformed EPUB.

---

## 9. Reuse of epubcheck material (licensing)

epubcheck is **BSD-3-Clause**. We reuse two things, with attribution:
1. **Message-ID vocabulary + severities + templates** — ported from `MessageBundle.properties`. Reusing the IDs preserves compatibility with CI/tooling that greps for them, and each ID is a ready-made spec of a rule.
2. **Test fixtures** — a curated subset of EPUBs and expected results from epubcheck's `src/test/resources`.

The project license is **BSD-3-Clause** (mirrors upstream). Upstream copyright notices are retained in `ATTRIBUTION`/`NOTICE`.

---

## 10. Testing strategy

- **Vitest** — TS-native, fast, runs in Node and browser environments.
- **TDD** per the test-driven-development workflow.
- **Unit tests** colocated with each module; cover each check's positive and negative cases.
- **Integration tests** under `test/integration/`: run `validateEpub` over the ported fixtures in `test/fixtures/` and assert the **set of `{ id, severity }`** emitted matches expected. Fixtures are curated to the implemented surface so the suite stays green as scope grows.

---

## 11. Packaging & tooling

- **ESM-only**, TypeScript source, ship `.d.ts`. Target ES2022 / Node 18+ / evergreen browsers.
- Build with **tsup** (emits ESM + types).
- **Runtime deps:** `fflate` (ZIP), `saxes` (streaming XML/XHTML with line/column).
- **Dev deps:** `vitest`, `tsup`, `typescript`.
- Single package: `epubcheck-ts`.

---

## 12. Deferred phases (named, for architectural seams)

| Phase | Scope |
|------|-------|
| CLI + Node adapter | File-path/stream-from-disk input; CLI with reporters + epubcheck-compatible flags |
| CSS validation | CSS parsing/checking subsystem |
| SVG / media / scripting / fonts | SVG deep validation, SMIL media overlays, scripting rules, embedded-font checks |
| EPUB 2 | NCX, OPF 2.0, `guide` — behind existing interfaces |
| Config & i18n | Severity overrides; non-English localization |
| Reporters | JSON / XML / XMP output formats |
```
