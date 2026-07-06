# Configurable Validation Threshold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let callers configure at what severity level validation rejects an EPUB, from `NONE` (No Rejection) up to `USAGE` (reject on any message), defaulting to `ERROR` (today's behavior).

**Architecture:** Add a `SEVERITY_RANK` map next to `Severity` in `catalog.ts`. Add a `ValidationThreshold` const-object + derived union in `report.ts`, and have `buildReport` compute `valid` by comparing message ranks against the threshold rank. Thread a `threshold` option through `validateEpub`. Echo the applied threshold on `Report`. Re-export the new symbol from `index.ts`.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest, functional style (no classes/enums).

## Global Constraints

- Functional style only — no classes, no TypeScript `enum`. Use a frozen `as const` object + derived union type for the threshold.
- Colocate types with the code that produces them; unit tests live beside source.
- All intra-package imports use `.js` specifiers (e.g. `./catalog.js`).
- Fully backward-compatible: default threshold is `ERROR`, reproducing `counts.FATAL === 0 && counts.ERROR === 0` exactly.
- Threshold controls the `valid` flag ONLY. Messages are never filtered or reordered. `fatal` stays `counts.FATAL > 0`.
- Run tests with `npx vitest run <path>`.

---

## File Structure

- `src/messages/catalog.ts` — add `SEVERITY_RANK` (ordering is a property of `Severity`).
- `src/report.ts` — add `ValidationThreshold` const + type; add `threshold` param to `buildReport`; add `threshold` to `Report`; compute `valid` from rank.
- `src/report.test.ts` — extend with threshold unit tests.
- `src/validate.ts` — add `threshold?` to `ValidateOptions`; pass through both `buildReport` calls.
- `src/validate.test.ts` — add one integration test threading the option.
- `src/index.ts` — re-export `ValidationThreshold` (value + type).

---

### Task 1: Severity ranking

**Files:**
- Modify: `src/messages/catalog.ts:1`
- Test: `src/messages/catalog.test.ts`

**Interfaces:**
- Produces: `SEVERITY_RANK: Record<Severity, number>` with `FATAL: 5, ERROR: 4, WARNING: 3, INFO: 2, USAGE: 1`.

- [ ] **Step 1: Write the failing test**

Add to `src/messages/catalog.test.ts` (add `SEVERITY_RANK` to the existing import from `./catalog.js`):

```ts
import { CATALOG, SEVERITY_RANK } from './catalog.js'

describe('SEVERITY_RANK', () => {
  it('orders severities from FATAL (highest) to USAGE (lowest)', () => {
    expect(SEVERITY_RANK.FATAL).toBeGreaterThan(SEVERITY_RANK.ERROR)
    expect(SEVERITY_RANK.ERROR).toBeGreaterThan(SEVERITY_RANK.WARNING)
    expect(SEVERITY_RANK.WARNING).toBeGreaterThan(SEVERITY_RANK.INFO)
    expect(SEVERITY_RANK.INFO).toBeGreaterThan(SEVERITY_RANK.USAGE)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/messages/catalog.test.ts`
Expected: FAIL — `SEVERITY_RANK` is not exported / undefined.

- [ ] **Step 3: Write minimal implementation**

In `src/messages/catalog.ts`, immediately after the `Severity` type on line 1:

```ts
export type Severity = 'FATAL' | 'ERROR' | 'WARNING' | 'INFO' | 'USAGE'

/** Severity ordering used by rejection thresholds. Higher = more severe. */
export const SEVERITY_RANK: Record<Severity, number> = {
  FATAL: 5,
  ERROR: 4,
  WARNING: 3,
  INFO: 2,
  USAGE: 1,
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/messages/catalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/messages/catalog.ts src/messages/catalog.test.ts
git commit -m "feat: add SEVERITY_RANK ordering map"
```

---

### Task 2: Threshold type + threshold-aware buildReport

**Files:**
- Modify: `src/report.ts` (whole file)
- Test: `src/report.test.ts`

**Interfaces:**
- Consumes: `SEVERITY_RANK` from `./messages/catalog.js` (Task 1).
- Produces:
  - `ValidationThreshold` const object `{ NONE, FATAL, ERROR, WARNING, INFO, USAGE }` (values equal to their keys) and a derived type of the same name.
  - `Report.threshold: ValidationThreshold`.
  - `buildReport(messages: Message[], epubVersion?: '2.0' | '3.0', threshold?: ValidationThreshold): Report` — `threshold` defaults to `'ERROR'`.

- [ ] **Step 1: Write the failing tests**

Replace the body of `src/report.test.ts` with:

```ts
import { describe, it, expect } from 'vitest'
import { buildReport, ValidationThreshold } from './report.js'
import type { Message } from './messages/format.js'

const m = (severity: Message['severity']): Message => ({ id: 'X', severity, message: '' })

describe('buildReport', () => {
  it('counts messages by severity', () => {
    const r = buildReport([m('ERROR'), m('ERROR'), m('WARNING')])
    expect(r.counts.ERROR).toBe(2)
    expect(r.counts.WARNING).toBe(1)
    expect(r.counts.FATAL).toBe(0)
  })

  it('defaults to the ERROR threshold (legacy behavior)', () => {
    expect(buildReport([m('ERROR')]).valid).toBe(false)
    expect(buildReport([m('FATAL')]).valid).toBe(false)
    expect(buildReport([m('FATAL')]).fatal).toBe(true)
    expect(buildReport([m('WARNING')]).valid).toBe(true)
    expect(buildReport([]).valid).toBe(true)
    expect(buildReport([m('ERROR')]).threshold).toBe('ERROR')
  })

  it('NONE never rejects, even on FATAL', () => {
    const r = buildReport([m('FATAL')], undefined, ValidationThreshold.NONE)
    expect(r.valid).toBe(true)
    expect(r.fatal).toBe(true)
    expect(r.threshold).toBe('NONE')
  })

  it('WARNING rejects on a warning but not on info', () => {
    expect(buildReport([m('WARNING')], undefined, 'WARNING').valid).toBe(false)
    expect(buildReport([m('INFO')], undefined, 'WARNING').valid).toBe(true)
  })

  it('USAGE rejects on any single message', () => {
    expect(buildReport([m('USAGE')], undefined, ValidationThreshold.USAGE).valid).toBe(false)
    expect(buildReport([], undefined, 'USAGE').valid).toBe(true)
  })

  it('records the epub version when provided', () => {
    expect(buildReport([], '3.0').epubVersion).toBe('3.0')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/report.test.ts`
Expected: FAIL — `ValidationThreshold` not exported; `threshold` field missing.

- [ ] **Step 3: Write the implementation**

Replace the entire contents of `src/report.ts` with:

```ts
import type { Message } from './messages/format.js'
import { SEVERITY_RANK, type Severity } from './messages/catalog.js'

/**
 * Rejection threshold: the least-severe level that still marks a report
 * invalid. `NONE` never rejects; `USAGE` rejects on any message at all.
 * Frozen const object + derived union (no TS enum) so callers get named
 * constants while raw strings still type-check.
 */
export const ValidationThreshold = {
  NONE: 'NONE',
  FATAL: 'FATAL',
  ERROR: 'ERROR',
  WARNING: 'WARNING',
  INFO: 'INFO',
  USAGE: 'USAGE',
} as const

export type ValidationThreshold = (typeof ValidationThreshold)[keyof typeof ValidationThreshold]

export interface Report {
  messages: Message[]
  epubVersion?: '2.0' | '3.0'
  counts: Record<Severity, number>
  threshold: ValidationThreshold
  fatal: boolean
  valid: boolean
}

export function buildReport(
  messages: Message[],
  epubVersion?: '2.0' | '3.0',
  threshold: ValidationThreshold = 'ERROR',
): Report {
  const counts: Record<Severity, number> = { FATAL: 0, ERROR: 0, WARNING: 0, INFO: 0, USAGE: 0 }
  for (const message of messages) counts[message.severity]++
  const valid =
    threshold === 'NONE'
      ? true
      : !messages.some((message) => SEVERITY_RANK[message.severity] >= SEVERITY_RANK[threshold])
  return {
    messages,
    epubVersion,
    counts,
    threshold,
    fatal: counts.FATAL > 0,
    valid,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/report.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/report.ts src/report.test.ts
git commit -m "feat: threshold-aware buildReport with ValidationThreshold"
```

---

### Task 3: Thread threshold through validateEpub

**Files:**
- Modify: `src/validate.ts:9` (import), `src/validate.ts:12-14` (options), `src/validate.ts:56` and `src/validate.ts:61` (both `buildReport` calls)
- Test: `src/validate.test.ts`

**Interfaces:**
- Consumes: `ValidationThreshold` type + `buildReport` from `./report.js` (Task 2).
- Produces: `ValidateOptions.threshold?: ValidationThreshold`.

- [ ] **Step 1: Write the failing test**

Add to `src/validate.test.ts`, inside the existing `describe('validateEpub', ...)` block. A non-zip input yields a single FATAL `PKG-003`, which lets us prove the threshold changes only the `valid`/rejection decision:

```ts
  it('respects a NONE threshold — no rejection even on FATAL', async () => {
    const report = await validateEpub(enc('not a zip'), { threshold: 'NONE' })
    expect(report.fatal).toBe(true)
    expect(report.valid).toBe(true)
    expect(report.threshold).toBe('NONE')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/validate.test.ts`
Expected: FAIL — `threshold` not accepted / `valid` is `false` / `report.threshold` undefined.

- [ ] **Step 3: Write the implementation**

In `src/validate.ts`, update the import on line 9 to also bring in the type:

```ts
import { buildReport, type Report, type ValidationThreshold } from './report.js'
```

Update `ValidateOptions` (lines 12-14):

```ts
export interface ValidateOptions {
  version?: '2.0' | '3.0'
  threshold?: ValidationThreshold
}
```

Update the success-path return (line 56):

```ts
    return buildReport(messages, options.version ?? detectedVersion, options.threshold)
```

Update the error-path return (line 61):

```ts
    return buildReport(messages, options.version, options.threshold)
```

(Both pass `options.threshold`; `undefined` falls back to `buildReport`'s `'ERROR'` default.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/validate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/validate.ts src/validate.test.ts
git commit -m "feat: accept threshold option in validateEpub"
```

---

### Task 4: Export ValidationThreshold from the public API

**Files:**
- Modify: `src/index.ts:20` (value re-export), `src/index.ts:24` (type re-export)
- Test: `src/index.test.ts`

**Interfaces:**
- Consumes: `ValidationThreshold` (value + type) and `Report` from `./report.js`.
- Produces: public re-export of `ValidationThreshold`.

- [ ] **Step 1: Write the failing test**

Add to `src/index.test.ts` (import `ValidationThreshold` from `./index.js` alongside whatever it already imports):

```ts
import { ValidationThreshold } from './index.js'

describe('public API', () => {
  it('re-exports the ValidationThreshold constants', () => {
    expect(ValidationThreshold.NONE).toBe('NONE')
    expect(ValidationThreshold.USAGE).toBe('USAGE')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/index.test.ts`
Expected: FAIL — `ValidationThreshold` is not exported from `./index.js`.

- [ ] **Step 3: Write the implementation**

In `src/index.ts`, change the value re-export on line 20 to include the const object:

```ts
export { buildReport, ValidationThreshold } from './report.js'
```

And update the `Report` type re-export on line 24 to also export the threshold type:

```ts
export type { Report, ValidationThreshold } from './report.js'
```

(Exporting the same name as both a value and a type is valid TypeScript — the value carries the runtime constants, the type carries the union.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Full verification**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts src/index.test.ts
git commit -m "feat: export ValidationThreshold from public API"
```

---

## Self-Review

**Spec coverage:**
- Threshold type (const object + union, no enum) → Task 2. ✓
- `NONE`…`USAGE` levels → Task 2. ✓
- `SEVERITY_RANK` in `catalog.ts` → Task 1. ✓
- Rejection logic / behavior table → Task 2 (tests cover NONE, ERROR default, WARNING, USAGE). ✓
- `ValidateOptions.threshold` threaded through both `buildReport` calls → Task 3. ✓
- `Report.threshold` echo field → Task 2. ✓
- Messages never filtered; `fatal` unchanged → Task 2 implementation keeps `counts`/`fatal` intact; NONE test asserts `fatal` still true. ✓
- Public export → Task 4. ✓
- Backward compat (default ERROR) → Task 2 default-threshold test. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `ValidationThreshold`, `SEVERITY_RANK`, `buildReport(messages, epubVersion?, threshold?)`, `ValidateOptions.threshold` used identically across Tasks 1–4. ✓
