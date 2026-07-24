# epubcheck-ts

A runtime-agnostic, TypeScript-native EPUB validator, distributed as a library.

epubcheck-ts validates EPUB 2 and EPUB 3 publications and reports problems
using the same message-id vocabulary as [w3c/epubcheck](https://github.com/w3c/epubcheck),
so results are compatible with existing epubcheck-aware tooling. It is a fresh,
functional implementation — not a port of epubcheck's code — with no Java
dependency and no Node-specific APIs, so it runs anywhere the Web Platform's
`Uint8Array` and `ReadableStream` are available (Node, Deno, Bun, browsers,
edge runtimes).

> **Not to be confused with [`@likecoin/epubcheck-ts`](https://www.npmjs.com/package/@likecoin/epubcheck-ts).**
> Despite the similar name, that is a separate, more mature project. See
> [How this compares](#how-this-compares-to-likecoinepubcheck-ts) below.

## How this compares to `@likecoin/epubcheck-ts`

[`@likecoin/epubcheck-ts`](https://github.com/likecoin/epubcheck-ts) is an
established, near-complete TypeScript port of the official EPUBCheck. If you
need maximum conformance today, use it (or the official Java EPUBCheck). The two
projects make deliberately different trade-offs:

| | epubcheck-ts (this project) | `@likecoin/epubcheck-ts` |
| --- | --- | --- |
| Goal | A small, embeddable, dependency-light validator | Near-complete parity (~99%) with Java EPUBCheck |
| Maturity | Early-stage; a curated subset of checks; accepts all published revisions (2.0, 2.0.1, 3.0, 3.0.1, 3.2, 3.3) as `version` targets | Mature; ~1300 tests, EPUB 2.0 & 3.0–3.3 |
| Validation approach | Hand-written checks against parsed structures | Ports EPUBCheck's RELAX NG / Schematron / XSD schemas |
| Schema engine | None | `libxml2-wasm` + `fontoxpath` + `slimdom` (XPath 3.1) |
| Runtime deps | 3 (`fflate`, `saxes`, `css-tree`) — no WASM | 6, including a WASM libxml2 build |
| Interface | Library only | Library **and** CLI (`npx`, profiles, JSON output) |
| API style | Functional & layered — compose the parse/check steps | Higher-level validator API |
| Footprint | Minimal | Larger (WASM payload) |

In short: reach for `@likecoin/epubcheck-ts` when you want the most complete,
schema-accurate validation or a ready-made CLI. Reach for this project when you
want a tiny, WASM-free, functionally composable library and are comfortable with
a smaller (but growing) set of checks. Both reuse epubcheck's message-id
vocabulary, so their output is broadly compatible.

## Features

- **EPUB 2 and EPUB 3** — full-pipeline validation for both majors: EPUB 3
  books get OCF → package → navigation-document → content → CSS checks; EPUB 2
  books get the same pipeline with the NCX in place of the navigation document,
  plus OPF 2.0 rules (`<guide>`, spine `toc`/NCX wiring, EPUB 2 blessed media
  types and fallback chains, and the OPF 2.0 `<meta>` content model — which
  rejects an EPUB 3 `<meta property="…">` written into a 2.x package). An EPUB 3
  book that ships a legacy NCX gets it
  validated too. The package document only distinguishes the major version
  (`2.0` or `3.0`); all published revisions (`2.0`, `2.0.1`, `3.0`, `3.0.1`,
  `3.2`, `3.3`) are accepted as `version` targets and are caller-selected via
  `options.version`.
- **Revision-aware rules** — checks that differ between revisions follow the
  resolved target: core media types, the `<bindings>` deprecation (`RSC-017`,
  EPUB 3.2+), `epub:switch` / `epub:trigger` deprecation, and EPUB 2 vs EPUB 3
  font handling in CSS.
- **Runtime-agnostic** — pure functions over byte buffers; no filesystem access.
- **Layered, functional API** — call the all-in-one `validateEpub`, or compose
  the underlying parse/check functions yourself.
- **Dual ESM + CJS** — ships both `import` and `require` builds, each with its
  own type declarations.
- **epubcheck-compatible messages** — message ids (`OPF-014`, `RSC-005`,
  `NAV-010`, …) and English templates match epubcheck's catalog.
- **Few, lightweight runtime deps** — only `fflate` (zip), `saxes` (XML), and
  `css-tree` (CSS).

### Validation coverage

The current checks span the container, package document, navigation document
(EPUB 3) or NCX (EPUB 2), content documents, and stylesheets:

| Area | Message ids |
| --- | --- |
| Package / container structure (OCF) | `PKG-*`, `RSC-001`–`RSC-003` |
| OPF manifest & spine semantics | `OPF-*`, `RSC-005`, `RSC-017` |
| Navigation document (EPUB 3) | `NAV-*`, `RSC-005` |
| NCX (EPUB 2, or a legacy NCX in an EPUB 3 book) | `NCX-*`, `RSC-005`–`RSC-012` |
| Content documents (XHTML / SVG) | `RSC-005`–`RSC-012`, `RSC-017`, `RSC-031`, `RSC-032`, `CSS-005`, `CSS-015` |
| CSS / style sheets | `CSS-*`, `RSC-006`–`RSC-008`, `RSC-013`, `RSC-030`, `RSC-031` |

## Installation

```sh
npm install @korzun/epubcheck-ts
```

## Usage

`validateEpub` accepts the raw bytes of an `.epub` file (a `Uint8Array`,
`ArrayBuffer`, or `ReadableStream<Uint8Array>`) and resolves to a `Report`.

```ts
import { readFile } from 'node:fs/promises'
import { validateEpub } from '@korzun/epubcheck-ts'

const bytes = await readFile('book.epub')
const report = await validateEpub(bytes)

if (report.valid) {
  console.log(`Valid EPUB ${report.epubVersion}`)
} else {
  for (const m of report.messages) {
    const where = m.location
      ? `${m.location.path}${m.location.line ? `:${m.location.line}` : ''}`
      : ''
    console.log(`${m.severity} ${m.id} ${where} — ${m.message}`)
  }
}
```

The package is published as both ESM and CommonJS, so `require` works too:

```js
const { validateEpub } = require('@korzun/epubcheck-ts')
```

### Options

```ts
// Force validation against a specific revision (e.g. '3.2' or '3.3'). If the
// detected major version differs, a PKG-001 warning is reported.
await validateEpub(bytes, { version: '3.2' })

// Choose the severity at which a book counts as invalid (default 'ERROR').
await validateEpub(bytes, { threshold: ValidationThreshold.WARNING })
```

When no `version` is given, EPUB 3 files are validated against the newest
revision (`3.3`) and EPUB 2 against `2.0`. `report.epubVersion` is the
revision whose rules were applied (the target), not necessarily the file's
declared major.

`threshold` is the least-severe level that still marks a report invalid:
`NONE` never rejects, `USAGE` rejects on any message at all. It only affects
`report.valid` — every message is collected and returned regardless.
`ValidationThreshold` is exported as both named constants and a type, so raw
strings (`'WARNING'`) type-check too.

### The report

```ts
interface Report {
  messages: Message[]
  epubVersion?: EpubVersion       // revision the rules were applied against
  counts: Record<Severity, number> // FATAL | ERROR | WARNING | INFO | USAGE
  threshold: ValidationThreshold  // the threshold this report was judged at
  fatal: boolean   // any FATAL message present
  valid: boolean   // no message at or above the threshold (default: ERROR)
}

interface Message {
  id: string                 // e.g. "OPF-014"
  severity: Severity
  message: string            // formatted, human-readable
  location?: { path: string; line?: number; column?: number }
  suggestion?: string
}
```

### Composing the lower-level API

`validateEpub` is a thin orchestration over independently usable parse and
check functions. You can drive the pipeline yourself — open the container, then
parse and check each part:

```ts
import {
  openEpub,
  validateOcf,
  parseOpf,
  validateOpf,
} from '@korzun/epubcheck-ts'

const container = await openEpub(bytes)
const ocfMessages = validateOcf(container)
const { pkg, messages } = parseOpf(container)
if (pkg) messages.push(...validateOpf(pkg, container))
```

Every check function returns a plain `Message[]` and never throws, so they're
easy to combine, filter, or test in isolation.

## Development

```sh
npm install
npm test          # run the vitest suite
npm run typecheck # tsc --noEmit
npm run lint      # eslint
npm run build     # bundle to dist/ via tsdown
```

Unit tests are colocated with their source (`src/**/*.test.ts`); integration
tests and fixtures live under `test/`.

### Differential testing

`test/differential` compares our output against the real EPUBCheck jar case by case.

```sh
brew install epubcheck
EPUBCHECK_DIFF=1 npx vitest run test/differential
```

It is skipped unless `EPUBCHECK_DIFF=1` is set and `epubcheck` is on `PATH`, so CI
without the jar stays green. The harness expands EPUBCheck's aggregated messages (a
single message with multiple `locations`) into one record per occurrence before
comparing multisets, and filters the jar side down to the message ids we implement
(`KNOWN_UNIMPLEMENTED` lists the out-of-scope ids it drops).

## Releasing

Publishing is automated by
[`.github/workflows/release.yml`](./.github/workflows/release.yml) and triggered
by **publishing a GitHub Release**:

1. Bump `version` in `package.json` (and the two `version` fields in
   `package-lock.json`) and land it on `main` via a PR — `main` is protected.
2. Create a GitHub Release whose tag matches that version (e.g. version `1.2.0`
   → tag `1.2.0`; a leading `v` is tolerated and stripped). The workflow fails
   the publish if the tag and `package.json` version disagree.
3. Tick **"Set as a pre-release"** for beta/rc builds. Pre-releases publish
   under the `beta` dist-tag (`npm install @korzun/epubcheck-ts@beta`) so they
   never become the default install; stable releases publish under `latest`.

Authentication uses npm [Trusted Publishing](https://docs.npmjs.com/trusted-publishers)
(OIDC) — there is no `NPM_TOKEN` secret, and build provenance is attached
automatically. This requires a one-time setup on npmjs.com: configure this
repository and the `Release` workflow as a trusted publisher for the
`@korzun/epubcheck-ts` package.

## License & attribution

epubcheck-ts is licensed under the [BSD 3-Clause License](./LICENSE).

It reuses epubcheck's message-id vocabulary and message templates — see
[ATTRIBUTION.md](./ATTRIBUTION.md) for details.
