# Configurable Validation Threshold — Design

**Date:** 2026-07-05
**Status:** Approved (design)

## Problem

`buildReport` (`src/report.ts`) hardcodes the pass/fail decision:

```ts
valid: counts.FATAL === 0 && counts.ERROR === 0
```

Callers cannot change how strict validation is. Some want to reject an EPUB
only on `FATAL`, others want to reject on any `WARNING`, and some want
"never reject, just report". We need a single configurable knob that ranges
from **No Rejection** all the way up to **Usage** (reject on any message at all).

## Scope

In scope:
- A `threshold` option that determines the `valid` flag only.
- Threshold values spanning the full severity ladder plus a "no rejection" level.
- Echoing the applied threshold back on the `Report`.

Explicitly out of scope (decided during brainstorming):
- **Message filtering.** The threshold controls rejection *only*. Every message
  is always included in the report regardless of threshold.
- Changing the `fatal` flag semantics (stays `counts.FATAL > 0`).
- CLI / config-file surface (library API only for now).

## Design

### Threshold type

Not a TypeScript `enum` — the codebase is functional and `Severity` is already
a string union, so an `enum` would be inconsistent and carries runtime/type
quirks. Instead, a frozen `const` object plus a derived union gives named
constants (no magic strings at call sites) while still accepting raw strings:

```ts
export const ValidationThreshold = {
  NONE: 'NONE',      // No Rejection — never reject
  FATAL: 'FATAL',
  ERROR: 'ERROR',    // default (matches legacy behavior)
  WARNING: 'WARNING',
  INFO: 'INFO',
  USAGE: 'USAGE',    // reject on any message at all
} as const

export type ValidationThreshold =
  (typeof ValidationThreshold)[keyof typeof ValidationThreshold]
```

Location: `src/report.ts` (colocated with `buildReport`, which consumes it).

### Severity ordering

Rejection compares severities, which requires a rank. Ordering is an intrinsic
property of `Severity`, so it lives next to `Severity` in `src/messages/catalog.ts`:

```ts
export const SEVERITY_RANK: Record<Severity, number> = {
  FATAL: 5,
  ERROR: 4,
  WARNING: 3,
  INFO: 2,
  USAGE: 1,
}
```

### Rejection logic

In `buildReport`:

```ts
valid =
  threshold === 'NONE'
    ? true
    : !messages.some(m => SEVERITY_RANK[m.severity] >= thresholdRank)
```

where `thresholdRank = SEVERITY_RANK[threshold]` (well-defined because `NONE`
is short-circuited first).

Behavior by threshold:

| Threshold      | Rejects when a message is…      | `valid` is false when… |
|----------------|----------------------------------|------------------------|
| `NONE`         | never                            | never                  |
| `FATAL`        | FATAL                            | any FATAL              |
| `ERROR` (dflt) | FATAL or ERROR                   | any FATAL/ERROR        |
| `WARNING`      | WARNING or above                 | any WARNING+           |
| `INFO`         | INFO or above                    | any INFO+              |
| `USAGE`        | any message                      | any message            |

`ERROR` reproduces today's `counts.FATAL === 0 && counts.ERROR === 0` exactly.

### API surface & data flow

```
ValidateOptions.threshold?  →  validateEpub  →  buildReport(messages, version, threshold)
```

- `ValidateOptions` (`src/validate.ts`) gains `threshold?: ValidationThreshold`.
- `validateEpub` passes it through to both `buildReport` call sites (success and
  error paths), defaulting to `ERROR`.
- `buildReport` signature becomes
  `buildReport(messages, epubVersion?, threshold: ValidationThreshold = 'ERROR')`.
  Default preserves all existing callers (backward-compatible).

### Report shape

`Report` (`src/report.ts`) gains an echoed field:

```ts
export interface Report {
  messages: Message[]
  epubVersion?: '2.0' | '3.0'
  counts: Record<Severity, number>
  threshold: ValidationThreshold   // new — what determined `valid`
  fatal: boolean
  valid: boolean
}
```

### Public exports

`src/index.ts` re-exports `ValidationThreshold` (the const + type) so consumers
can reference the named constants.

## Testing

- `src/report.test.ts` (colocated unit tests):
  - Each threshold level produces the correct `valid` for a representative
    message set.
  - Default (no threshold arg) matches the legacy FATAL/ERROR behavior.
  - `NONE` is always valid, even with a FATAL message.
  - `USAGE` is invalid with only a single USAGE message.
  - `threshold` is echoed on the returned report.
- `src/validate.test.ts` (or existing integration test): one case threading
  `{ threshold: 'WARNING' }` through `validateEpub` and asserting `valid`
  flips based on a warning in the fixture.

## Backward compatibility

Fully backward-compatible: `threshold` defaults to `ERROR`, which is the current
hardcoded behavior. The only additive change to `Report` is the new `threshold`
field. No existing message is filtered or reordered.
