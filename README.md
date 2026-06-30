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
| Maturity | Early-stage; a curated subset of checks | Mature; ~1300 tests, EPUB 2.0 & 3.0–3.3 |
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

- **EPUB 2 and EPUB 3** — version is auto-detected from the package document.
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

The current checks span the container, package document, navigation document,
content documents, and stylesheets:

| Area | Message ids |
| --- | --- |
| Package / container structure (OCF) | `PKG-*`, `RSC-001`–`RSC-003` |
| OPF manifest & spine semantics | `OPF-*`, `RSC-005`–`RSC-012` |
| Navigation document (EPUB 3) | `NAV-*` |
| CSS / style sheets | `CSS-*` |

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
// Force validation against a specific version. If the detected version differs,
// a PKG-001 warning is reported.
await validateEpub(bytes, { version: '3.0' })
```

### The report

```ts
interface Report {
  messages: Message[]
  epubVersion?: '2.0' | '3.0'
  counts: Record<Severity, number> // FATAL | ERROR | WARNING | INFO | USAGE
  fatal: boolean   // any FATAL message present
  valid: boolean   // no FATAL and no ERROR messages
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

## License & attribution

epubcheck-ts is licensed under the [BSD 3-Clause License](./LICENSE).

It reuses epubcheck's message-id vocabulary and message templates — see
[ATTRIBUTION.md](./ATTRIBUTION.md) for details.
