# Systematic OPF Content-Model Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate every OPF 2.0 and package-30 element for attributes, content model, datatypes and package-level ordering, reproducing real EPUBCheck's ids, severities and wording.

**Architecture:** A scoped RelaxNG derivative validator (James Clark's *An algorithm for RELAX NG validation*) in `src/schema/`, with `opf20.rng` and `package-30.rnc` transcribed as plain-data grammars. The dynamic "expected element/attribute" lists in EPUBCheck's messages are the accepted-name set of the current derivative, so they fall out of the engine rather than being special-cased. A driver walks the retained OPF `XmlNode` tree, recovers from each failure, and emits `RSC-005`.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), vitest, saxes, fflate. No new runtime dependencies.

## Global Constraints

- Functional style, no classes. Plain functions and plain-data types throughout.
- Unit tests colocated beside source (`foo.ts` → `foo.test.ts`); integration tests in `test/integration/`.
- Types are defined in the module that produces them. No types-only files.
- All import specifiers use the `.js` extension, even from `.ts` sources.
- Every schema failure is `RSC-005`, catalog template `Error while parsing file '%1$s': %2$s`. Arg 1 is the OPF path, arg 2 is the detail string. The duplicate-`reference` schematron rule is `RSC-017` WARNING.
- Expected-name lists are sorted by plain lexicographic order on the display name and rendered with the nested `joinOr` rule (Task 6).
- **Containment rule:** where the differential harness shows a case the engine cannot reproduce exactly, the driver suppresses the message rather than emitting approximate wording. Every suppression gets a named entry in `SUPPRESSED` (Task 7) with a comment.
- Permissive datatypes stay permissive: `property`, `properties`, `languagecode`, `mimetype`, `anyURI` are free text unless a harness case pins a concrete message.
- Baseline before this plan: **374 tests, 31 files** passing.
- `npm run lint`, `npm run typecheck` and `npm test` must all pass at every commit.

---
### Task 1: Namespace-aware attributes on XmlNode

`XmlNode.attrs` is `Record<string, string>` and carries no namespace information, but the grammar distinguishes `opf:file-as` (in the OPF namespace) from `scheme` (in no namespace). The schema layer also needs attributes in document order, because the expected-attribute list narrows by what was consumed *before* the offender.

`attrs` is left exactly as-is so no existing consumer changes.

**Files:**
- Modify: `src/io/xml.ts:4-14` (add `XmlAttr`, add `attributes` to `XmlNode`), `src/io/xml.ts:29-43` (populate it)
- Test: `src/io/xml.test.ts`

**Interfaces:**
- Produces: `XmlAttr { qname: string; local: string; ns?: string; value: string }`, and `XmlNode.attributes?: XmlAttr[]` — document order, `xmlns`/`xmlns:*` declarations excluded.

- [ ] **Step 1: Write the failing test**

Append to `src/io/xml.test.ts`:

```ts
describe('namespace-aware attributes', () => {
  const doc = (s: string): XmlNode =>
    parseXml(new TextEncoder().encode(s), 'p.opf').root!

  it('records qname, local, ns and value in document order', () => {
    const root = doc(
      '<package xmlns="http://www.idpf.org/2007/opf" xmlns:opf="http://www.idpf.org/2007/opf">' +
        '<meta id="a" opf:role="aut" xml:lang="en" scheme="s"/></package>',
    )
    const meta = root.children!.find((c) => c.name === 'meta')!
    expect(meta.attributes).toEqual([
      { qname: 'id', local: 'id', value: 'a' },
      { qname: 'opf:role', local: 'role', ns: 'http://www.idpf.org/2007/opf', value: 'aut' },
      { qname: 'xml:lang', local: 'lang', ns: 'http://www.w3.org/XML/1998/namespace', value: 'en' },
      { qname: 'scheme', local: 'scheme', value: 's' },
    ])
  })

  it('excludes xmlns declarations', () => {
    const root = doc('<package xmlns="http://x" xmlns:opf="http://y" id="p"/>')
    expect(root.attributes).toEqual([{ qname: 'id', local: 'id', value: 'p' }])
  })

  it('leaves the legacy attrs map untouched', () => {
    const root = doc('<package xmlns="http://x" id="p"/>')
    expect(root.attrs).toEqual({ xmlns: 'http://x', id: 'p' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/io/xml.test.ts`
Expected: FAIL — `meta.attributes` is `undefined`.

- [ ] **Step 3: Implement**

In `src/io/xml.ts`, add above `XmlNode`:

```ts
/** One attribute with its namespace resolved. `xmlns` declarations are not attributes to a schema. */
export interface XmlAttr {
  /** Qualified name as written (`opf:role`, `id`). Schema messages echo this form. */
  qname: string
  local: string
  /** Resolved namespace URI; undefined for unprefixed attributes. */
  ns?: string
  value: string
}
```

Add to the `XmlNode` interface, after `attrs`:

```ts
  /** Attributes in document order, namespace-resolved, xmlns declarations excluded. */
  attributes?: XmlAttr[]
```

Replace the body of the `opentag` handler's attribute loop (currently `src/io/xml.ts:30-31`):

```ts
    const attrs: Record<string, string> = {}
    const attributes: XmlAttr[] = []
    for (const [key, value] of Object.entries(tag.attributes)) {
      attrs[key] = value.value
      if (key === 'xmlns' || key.startsWith('xmlns:')) continue
      attributes.push({
        qname: key,
        local: value.local,
        ...(value.uri ? { ns: value.uri } : {}),
        value: value.value,
      })
    }
```

and add `attributes,` to the `XmlNode` literal immediately after `attrs,`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/io/xml.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/io/xml.ts src/io/xml.test.ts
git commit -m "feat: namespace-aware, document-ordered attributes on XmlNode"
```

---
### Task 2: Pattern types, smart constructors, nullable

**Files:**
- Create: `src/schema/pattern.ts`
- Test: `src/schema/pattern.test.ts`

**Interfaces:**
- Produces: `Pattern`, `NameClass`, `Datatype`; constants `EMPTY`, `NOT_ALLOWED`, `TEXT`; constructors `name`, `anyNameExcept`, `data`, `element`, `attribute`, `ref`, `choice`, `group`, `interleave`, `oneOrMore`, `optional`, `zeroOrMore`, `seq`, `all`, `after`; `nullable(p)`, `deref(p)`, `nameMatches(nc, ns, local)`, `displayOf(nc)`. (RelaxNG `<value>` is modelled in Task 3 as `data(dtEnum([...]))`, so there is no separate `value` constructor.)

- [ ] **Step 1: Write the failing test**

Create `src/schema/pattern.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  EMPTY, NOT_ALLOWED, TEXT, choice, group, interleave, oneOrMore, optional,
  element, attribute, name, anyNameExcept, nullable, nameMatches, displayOf,
} from './pattern.js'

describe('smart constructors', () => {
  it('absorbs notAllowed in choice', () => {
    expect(choice(NOT_ALLOWED, TEXT)).toBe(TEXT)
    expect(choice(TEXT, NOT_ALLOWED)).toBe(TEXT)
  })
  it('absorbs notAllowed in group and interleave', () => {
    expect(group(NOT_ALLOWED, TEXT)).toBe(NOT_ALLOWED)
    expect(interleave(TEXT, NOT_ALLOWED)).toBe(NOT_ALLOWED)
  })
  it('drops empty in group', () => {
    expect(group(EMPTY, TEXT)).toBe(TEXT)
    expect(group(TEXT, EMPTY)).toBe(TEXT)
  })
})

describe('nullable', () => {
  const el = element(name(undefined, 'a', 'a'), EMPTY)
  it('is true for empty and text', () => {
    expect(nullable(EMPTY)).toBe(true)
    expect(nullable(TEXT)).toBe(true)
  })
  it('is false for element, attribute and notAllowed', () => {
    expect(nullable(el)).toBe(false)
    expect(nullable(attribute(name(undefined, 'x', 'x'), TEXT))).toBe(false)
    expect(nullable(NOT_ALLOWED)).toBe(false)
  })
  it('is true for optional and for oneOrMore of a nullable', () => {
    expect(nullable(optional(el))).toBe(true)
    expect(nullable(oneOrMore(el))).toBe(false)
  })
  it('requires both sides for group and interleave', () => {
    expect(nullable(group(EMPTY, el))).toBe(false)
    expect(nullable(interleave(EMPTY, EMPTY))).toBe(true)
  })
})

describe('name classes', () => {
  it('matches on namespace and local name', () => {
    const nc = name('http://x', 'title', 'dc:title')
    expect(nameMatches(nc, 'http://x', 'title')).toBe(true)
    expect(nameMatches(nc, 'http://y', 'title')).toBe(false)
    expect(nameMatches(nc, undefined, 'title')).toBe(false)
    expect(displayOf(nc)).toBe('dc:title')
  })
  it('matches any name outside the excepted namespaces', () => {
    const nc = anyNameExcept(['http://x'])
    expect(nameMatches(nc, 'http://y', 'anything')).toBe(true)
    expect(nameMatches(nc, 'http://x', 'anything')).toBe(false)
    expect(nameMatches(nc, undefined, 'anything')).toBe(true)
    expect(displayOf(nc)).toBe('an element from another namespace')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/schema/pattern.test.ts`
Expected: FAIL — cannot resolve `./pattern.js`.

- [ ] **Step 3: Implement**

Create `src/schema/pattern.ts`:

```ts
/**
 * RelaxNG patterns, scoped to the constructs opf20.rng and package-30.rnc actually use.
 * This is deliberately not a general RelaxNG implementation: no `list`, no `mixed`,
 * no external refs, no datatype library beyond `Datatype` below.
 */

/** A name class. `display` is the spelling EPUBCheck echoes in messages. */
export type NameClass =
  | { k: 'name'; ns?: string; local: string; display: string }
  | { k: 'anyNameExcept'; exceptNs: readonly string[] }

/** A datatype constraint. `describe` is the tail of `... is invalid; must be <describe>`. */
export interface Datatype {
  allows: (value: string) => boolean
  describe: (value: string) => string
}

export type Pattern =
  | { k: 'empty' }
  | { k: 'notAllowed' }
  | { k: 'text' }
  | { k: 'data'; type: Datatype }
  | { k: 'choice'; p1: Pattern; p2: Pattern }
  | { k: 'group'; p1: Pattern; p2: Pattern }
  | { k: 'interleave'; p1: Pattern; p2: Pattern }
  | { k: 'oneOrMore'; p: Pattern }
  | { k: 'element'; name: NameClass; p: Pattern }
  | { k: 'attribute'; name: NameClass; p: Pattern }
  /** Internal to the derivative algorithm: "p1, then continue with p2 after the end-tag". */
  | { k: 'after'; p1: Pattern; p2: Pattern }
  /** Lazy indirection, for the one recursive production (package-30 `collection`). */
  | { k: 'ref'; resolve: () => Pattern }

export const EMPTY: Pattern = { k: 'empty' }
export const NOT_ALLOWED: Pattern = { k: 'notAllowed' }
export const TEXT: Pattern = { k: 'text' }

export function name(ns: string | undefined, local: string, display: string): NameClass {
  return { k: 'name', ns, local, display }
}
export function anyNameExcept(exceptNs: readonly string[]): NameClass {
  return { k: 'anyNameExcept', exceptNs }
}

export function data(type: Datatype): Pattern {
  return { k: 'data', type }
}
export function element(nc: NameClass, p: Pattern): Pattern {
  return { k: 'element', name: nc, p }
}
export function attribute(nc: NameClass, p: Pattern): Pattern {
  return { k: 'attribute', name: nc, p }
}
export function ref(resolve: () => Pattern): Pattern {
  return { k: 'ref', resolve }
}

export function choice(p1: Pattern, p2: Pattern): Pattern {
  if (p1.k === 'notAllowed') return p2
  if (p2.k === 'notAllowed') return p1
  return { k: 'choice', p1, p2 }
}
export function group(p1: Pattern, p2: Pattern): Pattern {
  if (p1.k === 'notAllowed' || p2.k === 'notAllowed') return NOT_ALLOWED
  if (p1.k === 'empty') return p2
  if (p2.k === 'empty') return p1
  return { k: 'group', p1, p2 }
}
export function interleave(p1: Pattern, p2: Pattern): Pattern {
  if (p1.k === 'notAllowed' || p2.k === 'notAllowed') return NOT_ALLOWED
  if (p1.k === 'empty') return p2
  if (p2.k === 'empty') return p1
  return { k: 'interleave', p1, p2 }
}
export function oneOrMore(p: Pattern): Pattern {
  if (p.k === 'notAllowed') return NOT_ALLOWED
  return { k: 'oneOrMore', p }
}
export function after(p1: Pattern, p2: Pattern): Pattern {
  if (p1.k === 'notAllowed' || p2.k === 'notAllowed') return NOT_ALLOWED
  return { k: 'after', p1, p2 }
}
export function optional(p: Pattern): Pattern {
  return choice(p, EMPTY)
}
/** Zero or more of p. */
export function zeroOrMore(p: Pattern): Pattern {
  return optional(oneOrMore(p))
}
/** Left-fold a list into nested groups (an ordered sequence). */
export function seq(...ps: Pattern[]): Pattern {
  return ps.reduce(group, EMPTY)
}
/** Left-fold a list into nested interleaves (order-free). */
export function all(...ps: Pattern[]): Pattern {
  return ps.reduce(interleave, EMPTY)
}

/** Expand a `ref` one level. Every ref in these grammars is guarded by an `element`. */
export function deref(p: Pattern): Pattern {
  return p.k === 'ref' ? deref(p.resolve()) : p
}

export function nullable(p: Pattern): boolean {
  switch (p.k) {
    case 'empty':
    case 'text':
      return true
    case 'notAllowed':
    case 'data':
    case 'element':
    case 'attribute':
    case 'after':
      return false
    case 'choice':
      return nullable(p.p1) || nullable(p.p2)
    case 'group':
    case 'interleave':
      return nullable(p.p1) && nullable(p.p2)
    case 'oneOrMore':
      return nullable(p.p)
    case 'ref':
      return nullable(p.resolve())
  }
}

export function nameMatches(nc: NameClass, ns: string | undefined, local: string): boolean {
  if (nc.k === 'name') return nc.ns === ns && nc.local === local
  return !nc.exceptNs.includes(ns ?? '')
}

export function displayOf(nc: NameClass): string {
  return nc.k === 'name' ? nc.display : 'an element from another namespace'
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/schema/pattern.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/schema/pattern.ts src/schema/pattern.test.ts
git commit -m "feat: RelaxNG pattern types and smart constructors"
```

---
### Task 3: Datatypes

Only the datatypes these grammars need, with the exact message tails EPUBCheck emits.

**Files:**
- Create: `src/schema/datatypes.ts`
- Test: `src/schema/datatypes.test.ts`

**Interfaces:**
- Produces: `DT_TEXT`, `DT_ID`, `DT_IDREF`, `DT_ANY_URI`, `DT_NON_EMPTY`, `dtEnum(values)` — all `Datatype`.

- [ ] **Step 1: Write the failing test**

Create `src/schema/datatypes.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { DT_ID, DT_NON_EMPTY, dtEnum, DT_TEXT } from './datatypes.js'

describe('DT_ID', () => {
  it('accepts XML names without colons', () => {
    expect(DT_ID.allows('uid')).toBe(true)
    expect(DT_ID.allows('_x-1.2')).toBe(true)
  })
  it('rejects names starting with a digit or containing a colon', () => {
    expect(DT_ID.allows('1')).toBe(false)
    expect(DT_ID.allows('a:b')).toBe(false)
  })
  it('describes itself the way EPUBCheck does', () => {
    expect(DT_ID.describe('1')).toBe('an XML name without colons')
  })
})

describe('DT_NON_EMPTY', () => {
  it('rejects empty and whitespace-only values', () => {
    expect(DT_NON_EMPTY.allows('')).toBe(false)
    expect(DT_NON_EMPTY.allows('   ')).toBe(false)
    expect(DT_NON_EMPTY.allows('x')).toBe(true)
  })
  it('reports the actual token length', () => {
    expect(DT_NON_EMPTY.describe('')).toBe(
      'a string with length at least 1 (actual length was 0)',
    )
  })
})

describe('dtEnum', () => {
  it('accepts only the listed values', () => {
    const dt = dtEnum(['yes', 'no'])
    expect(dt.allows('yes')).toBe(true)
    expect(dt.allows('maybe')).toBe(false)
  })
  it('describes alternatives alphabetically', () => {
    expect(dtEnum(['yes', 'no']).describe('maybe')).toBe('equal to "no" or "yes"')
    expect(dtEnum(['2.0']).describe('2.1')).toBe('equal to "2.0"')
  })
})

describe('DT_TEXT', () => {
  it('accepts anything', () => {
    expect(DT_TEXT.allows('')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/schema/datatypes.test.ts`
Expected: FAIL — cannot resolve `./datatypes.js`.

- [ ] **Step 3: Implement**

Create `src/schema/datatypes.ts`:

```ts
import type { Datatype } from './pattern.js'

/**
 * Datatypes used by opf20.rng and package-30.rnc. `describe` returns the tail of
 * EPUBCheck's `... is invalid; must be <tail>`, transcribed from jar output.
 *
 * Deliberately permissive: `property`, `properties`, `languagecode` and `mimetype`
 * are all DT_TEXT. Rejecting a legal media-type or language tag is exactly the
 * false-positive class this change must avoid, and no harness case pins a message
 * for them. See the containment rule in the design doc.
 */

export const DT_TEXT: Datatype = {
  allows: () => true,
  describe: () => 'text',
}

/** xsd:ID / xsd:NCName — an XML name with no colon. */
const NCNAME = /^[A-Za-z_][A-Za-z0-9._-]*$/
export const DT_ID: Datatype = {
  allows: (v) => NCNAME.test(v),
  describe: () => 'an XML name without colons',
}

/**
 * xsd:IDREF. Lexically identical to ID; referential integrity is NOT enforced —
 * `<spine toc="nope">` produces only OPF-049 from the semantic checks, no RSC-005.
 */
export const DT_IDREF: Datatype = DT_ID

/** xsd:anyURI. Jing accepts essentially everything here; kept permissive on purpose. */
export const DT_ANY_URI: Datatype = DT_TEXT

/** `<data type="token"><param name="minLength">1</param></data>` / `datatype.string.nonempty`. */
export const DT_NON_EMPTY: Datatype = {
  allows: (v) => v.trim().length >= 1,
  describe: (v) =>
    `a string with length at least 1 (actual length was ${v.trim().length})`,
}

/** A RelaxNG `<choice>` of `<value>`s. Alternatives are listed alphabetically. */
export function dtEnum(values: readonly string[]): Datatype {
  const sorted = [...values].sort()
  const quoted = sorted.map((v) => `"${v}"`)
  const tail =
    quoted.length < 2
      ? quoted.join('')
      : `${quoted.slice(0, -1).join(', ')} or ${quoted[quoted.length - 1]}`
  return {
    allows: (v) => sorted.includes(v),
    describe: () => `equal to ${tail}`,
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/schema/datatypes.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/schema/datatypes.ts src/schema/datatypes.test.ts
git commit -m "feat: RelaxNG datatypes with EPUBCheck message tails"
```

---
### Task 4: Derivative algorithm

James Clark's algorithm over the pattern types from Task 2.

**Files:**
- Create: `src/schema/derivative.ts`
- Test: `src/schema/derivative.test.ts`

**Interfaces:**
- Consumes: everything from `src/schema/pattern.js`.
- Produces: `startTagOpenDeriv(p, ns, local)`, `attDeriv(p, attr)`, `startTagCloseDeriv(p)`, `textDeriv(p, s)`, `endTagDeriv(p)`, `applyAfter(f, p)`.

- [ ] **Step 1: Write the failing test**

Create `src/schema/derivative.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  EMPTY, NOT_ALLOWED, TEXT, element, attribute, name, group, oneOrMore,
  optional, all, nullable, data,
} from './pattern.js'
import {
  startTagOpenDeriv, attDeriv, startTagCloseDeriv, textDeriv, endTagDeriv,
} from './derivative.js'
import { DT_ID } from './datatypes.js'

const N = (local: string) => name(undefined, local, local)
const item = element(N('item'), EMPTY)

describe('startTagOpenDeriv', () => {
  it('accepts a matching element and rejects a non-matching one', () => {
    expect(startTagOpenDeriv(item, undefined, 'item').k).not.toBe('notAllowed')
    expect(startTagOpenDeriv(item, undefined, 'zzz').k).toBe('notAllowed')
  })
  it('walks past a nullable first member of a group', () => {
    const p = group(optional(element(N('a'), EMPTY)), element(N('b'), EMPTY))
    expect(startTagOpenDeriv(p, undefined, 'b').k).not.toBe('notAllowed')
  })
  it('does not walk past a required first member of a group', () => {
    const p = group(element(N('a'), EMPTY), element(N('b'), EMPTY))
    expect(startTagOpenDeriv(p, undefined, 'b').k).toBe('notAllowed')
  })
  it('accepts either side of an interleave in any order', () => {
    const p = all(element(N('a'), EMPTY), element(N('b'), EMPTY))
    expect(startTagOpenDeriv(p, undefined, 'b').k).not.toBe('notAllowed')
    expect(startTagOpenDeriv(p, undefined, 'a').k).not.toBe('notAllowed')
  })
})

describe('attDeriv and startTagCloseDeriv', () => {
  const withId = element(N('e'), attribute(N('id'), data(DT_ID)))

  it('consumes a declared attribute', () => {
    const open = startTagOpenDeriv(withId, undefined, 'e')
    const after = attDeriv(open, { qname: 'id', local: 'id', value: 'ok' })
    expect(after.k).not.toBe('notAllowed')
    expect(startTagCloseDeriv(after).k).not.toBe('notAllowed')
  })
  it('rejects an undeclared attribute', () => {
    const open = startTagOpenDeriv(withId, undefined, 'e')
    expect(attDeriv(open, { qname: 'zz', local: 'zz', value: 'v' }).k).toBe('notAllowed')
  })
  it('rejects a declared attribute whose value fails its datatype', () => {
    const open = startTagOpenDeriv(withId, undefined, 'e')
    expect(attDeriv(open, { qname: 'id', local: 'id', value: '1' }).k).toBe('notAllowed')
  })
  it('leaves a required-but-absent attribute non-nullable at close', () => {
    const open = startTagOpenDeriv(withId, undefined, 'e')
    // nullable() is unconditionally false for an `after`-shaped pattern, so this
    // only discriminates once endTagDeriv has resolved the content model.
    expect(nullable(endTagDeriv(startTagCloseDeriv(open)))).toBe(false)
  })
  it('is nullable at close once the required attribute has been supplied', () => {
    const open = startTagOpenDeriv(withId, undefined, 'e')
    const supplied = attDeriv(open, { qname: 'id', local: 'id', value: 'ok' })
    expect(nullable(endTagDeriv(startTagCloseDeriv(supplied)))).toBe(true)
  })
})

describe('textDeriv and endTagDeriv', () => {
  it('accepts text against a text pattern and rejects it against empty', () => {
    expect(textDeriv(TEXT, 'x').k).not.toBe('notAllowed')
    expect(textDeriv(EMPTY, 'x').k).toBe('notAllowed')
  })
  it('closes an element once its content is satisfied', () => {
    const p = startTagCloseDeriv(startTagOpenDeriv(oneOrMore(item), undefined, 'item'))
    expect(nullable(endTagDeriv(p))).toBe(true)
  })
  it('leaves an unsatisfied required child non-nullable', () => {
    const parent = element(N('spine'), oneOrMore(item))
    const p = startTagCloseDeriv(startTagOpenDeriv(parent, undefined, 'spine'))
    expect(nullable(endTagDeriv(p))).toBe(false)
  })
  it('rejects everything from notAllowed', () => {
    expect(textDeriv(NOT_ALLOWED, 'x').k).toBe('notAllowed')
    expect(endTagDeriv(NOT_ALLOWED).k).toBe('notAllowed')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/schema/derivative.test.ts`
Expected: FAIL — cannot resolve `./derivative.js`.

- [ ] **Step 3: Implement**

Create `src/schema/derivative.ts`:

```ts
import {
  EMPTY, NOT_ALLOWED, after, choice, deref, group, interleave, nameMatches,
  nullable, oneOrMore, type Pattern,
} from './pattern.js'

/** The attribute shape the engine consumes (a structural subset of XmlAttr). */
export interface AttrLike {
  qname: string
  local: string
  ns?: string
  value: string
}

/** Rewrite the continuation of every `after` in p, per Clark's applyAfter. */
export function applyAfter(f: (p: Pattern) => Pattern, p: Pattern): Pattern {
  const d = deref(p)
  switch (d.k) {
    case 'after':
      return after(d.p1, f(d.p2))
    case 'choice':
      return choice(applyAfter(f, d.p1), applyAfter(f, d.p2))
    default:
      return NOT_ALLOWED
  }
}

export function startTagOpenDeriv(p: Pattern, ns: string | undefined, local: string): Pattern {
  const d = deref(p)
  switch (d.k) {
    case 'element':
      return nameMatches(d.name, ns, local) ? after(d.p, EMPTY) : NOT_ALLOWED
    case 'choice':
      return choice(startTagOpenDeriv(d.p1, ns, local), startTagOpenDeriv(d.p2, ns, local))
    case 'interleave':
      return choice(
        applyAfter((q) => interleave(q, d.p2), startTagOpenDeriv(d.p1, ns, local)),
        applyAfter((q) => interleave(d.p1, q), startTagOpenDeriv(d.p2, ns, local)),
      )
    case 'oneOrMore':
      return applyAfter(
        (q) => group(q, choice(oneOrMore(d.p), EMPTY)),
        startTagOpenDeriv(d.p, ns, local),
      )
    case 'group': {
      const x = applyAfter((q) => group(q, d.p2), startTagOpenDeriv(d.p1, ns, local))
      return nullable(d.p1) ? choice(x, startTagOpenDeriv(d.p2, ns, local)) : x
    }
    case 'after':
      return applyAfter((q) => after(q, d.p2), startTagOpenDeriv(d.p1, ns, local))
    default:
      return NOT_ALLOWED
  }
}

export function attDeriv(p: Pattern, att: AttrLike): Pattern {
  const d = deref(p)
  switch (d.k) {
    case 'after':
      return after(attDeriv(d.p1, att), d.p2)
    case 'choice':
      return choice(attDeriv(d.p1, att), attDeriv(d.p2, att))
    case 'group':
      return choice(group(attDeriv(d.p1, att), d.p2), group(d.p1, attDeriv(d.p2, att)))
    case 'interleave':
      return choice(
        interleave(attDeriv(d.p1, att), d.p2),
        interleave(d.p1, attDeriv(d.p2, att)),
      )
    case 'oneOrMore':
      return group(attDeriv(d.p, att), choice(oneOrMore(d.p), EMPTY))
    case 'attribute':
      return nameMatches(d.name, att.ns, att.local) && valueMatches(d.p, att.value)
        ? EMPTY
        : NOT_ALLOWED
    default:
      return NOT_ALLOWED
  }
}

/** Does an attribute's value satisfy the attribute's content pattern? */
function valueMatches(p: Pattern, value: string): boolean {
  const d = deref(p)
  switch (d.k) {
    case 'text':
    case 'empty':
      return true
    case 'data':
      return d.type.allows(value)
    case 'choice':
      return valueMatches(d.p1, value) || valueMatches(d.p2, value)
    default:
      return false
  }
}

/** Discard the attribute alternatives once the start tag is closed. */
export function startTagCloseDeriv(p: Pattern): Pattern {
  const d = deref(p)
  switch (d.k) {
    case 'after':
      return after(startTagCloseDeriv(d.p1), d.p2)
    case 'choice':
      return choice(startTagCloseDeriv(d.p1), startTagCloseDeriv(d.p2))
    case 'group':
      return group(startTagCloseDeriv(d.p1), startTagCloseDeriv(d.p2))
    case 'interleave':
      return interleave(startTagCloseDeriv(d.p1), startTagCloseDeriv(d.p2))
    case 'oneOrMore':
      return oneOrMore(startTagCloseDeriv(d.p))
    case 'attribute':
      return NOT_ALLOWED
    default:
      return d
  }
}

export function textDeriv(p: Pattern, s: string): Pattern {
  const d = deref(p)
  switch (d.k) {
    case 'text':
      return d
    case 'data':
      return d.type.allows(s) ? EMPTY : NOT_ALLOWED
    case 'choice':
      return choice(textDeriv(d.p1, s), textDeriv(d.p2, s))
    case 'interleave':
      return choice(
        interleave(textDeriv(d.p1, s), d.p2),
        interleave(d.p1, textDeriv(d.p2, s)),
      )
    case 'group': {
      const x = group(textDeriv(d.p1, s), d.p2)
      return nullable(d.p1) ? choice(x, textDeriv(d.p2, s)) : x
    }
    case 'after':
      return after(textDeriv(d.p1, s), d.p2)
    case 'oneOrMore':
      return group(textDeriv(d.p, s), choice(oneOrMore(d.p), EMPTY))
    default:
      return NOT_ALLOWED
  }
}

export function endTagDeriv(p: Pattern): Pattern {
  const d = deref(p)
  switch (d.k) {
    case 'after':
      return nullable(d.p1) ? d.p2 : NOT_ALLOWED
    case 'choice':
      return choice(endTagDeriv(d.p1), endTagDeriv(d.p2))
    default:
      return NOT_ALLOWED
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/schema/derivative.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/schema/derivative.ts src/schema/derivative.test.ts
git commit -m "feat: RelaxNG derivative algorithm (Clark) scoped to OPF grammars"
```

---
### Task 5: Expected-name projection

The dynamic lists in EPUBCheck's messages are the accepted-name set of the current derivative. This task extracts them.

**Files:**
- Create: `src/schema/expected.ts`
- Test: `src/schema/expected.test.ts`

**Interfaces:**
- Produces: `expectedElements(p): string[]` (sorted display names, wildcard rendered as `an element from another namespace`, last), `expectedAttributes(p): string[]` (sorted display names), `requiredElements(p): string[]`, `requiredAttributes(p): string[]`, `grammarNames(p): Set<string>`.

- [ ] **Step 1: Write the failing test**

Create `src/schema/expected.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  EMPTY, element, attribute, name, anyNameExcept, group, optional, all,
  oneOrMore, data, seq,
} from './pattern.js'
import { startTagOpenDeriv, startTagCloseDeriv } from './derivative.js'
import {
  expectedElements, expectedAttributes, requiredElements, requiredAttributes, grammarNames,
} from './expected.js'
import { DT_TEXT } from './datatypes.js'

const N = (local: string) => name(undefined, local, local)
const el = (local: string) => element(N(local), EMPTY)

describe('expectedElements', () => {
  it('lists alternatives alphabetically', () => {
    expect(expectedElements(all(el('tours'), el('guide')))).toEqual(['guide', 'tours'])
  })
  it('stops at a required member of a sequence', () => {
    expect(expectedElements(seq(el('metadata'), el('manifest')))).toEqual(['metadata'])
  })
  it('sees past an optional member of a sequence', () => {
    expect(expectedElements(seq(optional(el('tours')), el('guide')))).toEqual(['guide', 'tours'])
  })
  it('renders a wildcard last, regardless of sort order', () => {
    const p = all(el('meta'), element(anyNameExcept(['http://x']), EMPTY))
    expect(expectedElements(p)).toEqual(['meta', 'an element from another namespace'])
  })
})

describe('expectedAttributes', () => {
  it('lists only attributes not yet consumed', () => {
    const e = element(
      N('meta'),
      all(attribute(N('name'), data(DT_TEXT)), attribute(N('id'), data(DT_TEXT))),
    )
    const open = startTagOpenDeriv(e, undefined, 'meta')
    expect(expectedAttributes(open)).toEqual(['id', 'name'])
  })
})

describe('requiredElements and requiredAttributes', () => {
  it('names the unsatisfied required child of an incomplete element', () => {
    const spine = element(N('spine'), oneOrMore(el('itemref')))
    const p = startTagCloseDeriv(startTagOpenDeriv(spine, undefined, 'spine'))
    expect(requiredElements(p)).toEqual(['itemref'])
  })
  it('names unsatisfied required attributes alphabetically', () => {
    const e = element(
      N('item'),
      all(attribute(N('media-type'), data(DT_TEXT)), attribute(N('href'), data(DT_TEXT))),
    )
    const open = startTagOpenDeriv(e, undefined, 'item')
    expect(requiredAttributes(open)).toEqual(['href', 'media-type'])
  })
  it('ignores optional attributes', () => {
    const e = element(N('e'), optional(attribute(N('id'), data(DT_TEXT))))
    expect(requiredAttributes(startTagOpenDeriv(e, undefined, 'e'))).toEqual([])
  })
})

describe('grammarNames', () => {
  it('collects every element name reachable in the grammar', () => {
    const g = element(N('package'), group(el('metadata'), el('manifest')))
    expect(grammarNames(g)).toEqual(new Set(['package', 'metadata', 'manifest']))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/schema/expected.test.ts`
Expected: FAIL — cannot resolve `./expected.js`.

- [ ] **Step 3: Implement**

Create `src/schema/expected.ts`:

```ts
import { deref, displayOf, nullable, type Pattern } from './pattern.js'

const WILDCARD = 'an element from another namespace'

/** Sort display names lexicographically, with the foreign-namespace wildcard last. */
function order(names: Set<string>): string[] {
  const out = [...names].filter((n) => n !== WILDCARD).sort()
  if (names.has(WILDCARD)) out.push(WILDCARD)
  return out
}

/**
 * Element names the pattern will accept as the next child. This is exactly the list
 * EPUBCheck prints after `expected`, which is why it tracks interleave state for free.
 */
export function expectedElements(p: Pattern): string[] {
  const out = new Set<string>()
  collectElements(p, out)
  return order(out)
}

function collectElements(p: Pattern, out: Set<string>): void {
  const d = deref(p)
  switch (d.k) {
    case 'element':
      out.add(displayOf(d.name))
      return
    case 'choice':
    case 'interleave':
      collectElements(d.p1, out)
      collectElements(d.p2, out)
      return
    case 'group':
      collectElements(d.p1, out)
      if (nullable(d.p1)) collectElements(d.p2, out)
      return
    case 'oneOrMore':
      collectElements(d.p, out)
      return
    case 'after':
      collectElements(d.p1, out)
      return
    default:
  }
}

/** Attribute display names still accepted at this point in the start tag. */
export function expectedAttributes(p: Pattern): string[] {
  const out = new Set<string>()
  collectAttributes(p, out)
  return [...out].sort()
}

function collectAttributes(p: Pattern, out: Set<string>): void {
  const d = deref(p)
  switch (d.k) {
    case 'attribute':
      out.add(displayOf(d.name))
      return
    case 'choice':
    case 'group':
    case 'interleave':
      collectAttributes(d.p1, out)
      collectAttributes(d.p2, out)
      return
    case 'oneOrMore':
      collectAttributes(d.p, out)
      return
    case 'after':
      collectAttributes(d.p1, out)
      return
    default:
  }
}

/**
 * Element names that MUST still appear for the pattern to be satisfiable.
 * Used for `element "P" incomplete; missing required element "C"`, which
 * EPUBCheck reports one at a time.
 */
export function requiredElements(p: Pattern): string[] {
  const out = new Set<string>()
  collectRequired(p, out, 'element')
  return order(out)
}

/** Attribute names that MUST still appear. Drives the missing-required-attribute message. */
export function requiredAttributes(p: Pattern): string[] {
  const out = new Set<string>()
  collectRequired(p, out, 'attribute')
  return [...out].sort()
}

/**
 * Walk only the branches that cannot be skipped: a `choice` where either side is
 * nullable requires nothing, and a nullable subtree contributes nothing.
 */
function collectRequired(p: Pattern, out: Set<string>, want: 'element' | 'attribute'): void {
  const d = deref(p)
  if (nullable(d)) return
  switch (d.k) {
    case 'element':
    case 'attribute':
      if (d.k === want) out.add(displayOf(d.name))
      return
    case 'group':
    case 'interleave':
      collectRequired(d.p1, out, want)
      collectRequired(d.p2, out, want)
      return
    case 'oneOrMore':
      collectRequired(d.p, out, want)
      return
    case 'after':
      collectRequired(d.p1, out, want)
      return
    case 'choice': {
      // Only a name required by BOTH sides is genuinely required.
      const a = new Set<string>()
      const b = new Set<string>()
      collectRequired(d.p1, a, want)
      collectRequired(d.p2, b, want)
      for (const n of a) if (b.has(n)) out.add(n)
      return
    }
    default:
  }
}

/**
 * Every element name that appears anywhere in the grammar. Drives the
 * `not allowed anywhere` vs `not allowed here` split: a name absent from this
 * set is "anywhere", a name present but not currently accepted is "here".
 */
export function grammarNames(root: Pattern): Set<string> {
  const out = new Set<string>()
  const seen = new Set<Pattern>()
  const walk = (p: Pattern): void => {
    if (seen.has(p)) return
    seen.add(p)
    const d = deref(p)
    switch (d.k) {
      case 'element':
        out.add(displayOf(d.name))
        walk(d.p)
        return
      case 'attribute':
        return
      case 'choice':
      case 'group':
      case 'interleave':
      case 'after':
        walk(d.p1)
        walk(d.p2)
        return
      case 'oneOrMore':
        walk(d.p)
        return
      default:
    }
  }
  walk(root)
  return out
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/schema/expected.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/schema/expected.ts src/schema/expected.test.ts
git commit -m "feat: expected-name projection over RelaxNG derivatives"
```

---
### Task 6: Message shapes

The ten detail strings, transcribed from EPUBCheck 5.3.0. Includes the PR #28 document-order regression test.

**Files:**
- Create: `src/schema/messages.ts`
- Test: `src/schema/messages.test.ts`

**Interfaces:**
- Produces: `joinOr(items)`, `joinAnd(items)`, `quoteAll(names)`, and detail builders `unknownAttribute`, `noAttributesAllowed`, `missingAttributes`, `textNotAllowed`, `unknownElement`, `elementNotAllowedYet`, `incompleteMissingElement`, `incompleteExpected`, `invalidAttributeValue`, `invalidCharacterContent`.

- [ ] **Step 1: Write the failing test**

Create `src/schema/messages.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  joinOr, unknownAttribute, noAttributesAllowed, missingAttributes, textNotAllowed,
  unknownElement, elementNotAllowedYet, incompleteMissingElement, incompleteExpected,
  invalidAttributeValue, invalidCharacterContent, expectedClause,
} from './messages.js'

describe('joinOr', () => {
  it('joins with commas and a final or', () => {
    expect(joinOr(['a'])).toBe('a')
    expect(joinOr(['a', 'b'])).toBe('a or b')
    expect(joinOr(['a', 'b', 'c'])).toBe('a, b or c')
  })
})

describe('expectedClause', () => {
  it('puts the end-tag first and joins nested', () => {
    expect(expectedClause(['itemref'], true)).toBe('the element end-tag or element "itemref"')
    expect(expectedClause(['guide', 'tours'], true)).toBe(
      'the element end-tag or element "guide" or "tours"',
    )
    expect(expectedClause(['item'], false)).toBe('element "item"')
  })
  it('renders the foreign-namespace wildcard as its own alternative', () => {
    expect(
      expectedClause(['dc:title', 'meta', 'an element from another namespace'], true),
    ).toBe(
      'the element end-tag, element "dc:title" or "meta" or an element from another namespace',
    )
  })
  it('degrades to the end-tag alone', () => {
    expect(expectedClause([], true)).toBe('the element end-tag')
  })
})

describe('attribute details', () => {
  // Regression for PR #28: the expected list narrows by DOCUMENT ORDER, so a
  // `property` written before `name`/`content` still lists all five.
  it('lists every attribute not yet consumed', () => {
    expect(unknownAttribute('property', ['content', 'id', 'name', 'scheme', 'xml:lang'])).toBe(
      'attribute "property" not allowed here; expected attribute "content", "id", "name", "scheme" or "xml:lang"',
    )
  })
  it('switches shape when nothing is left to expect', () => {
    expect(noAttributesAllowed('foo')).toBe('found attribute "foo", but no attributes allowed here')
  })
  it('pluralises missing required attributes and joins with and', () => {
    expect(missingAttributes('item', ['media-type'])).toBe(
      'element "item" missing required attribute "media-type"',
    )
    expect(missingAttributes('meta', ['content', 'name'])).toBe(
      'element "meta" missing required attributes "content" and "name"',
    )
  })
  it('reports an invalid attribute value', () => {
    expect(invalidAttributeValue('id', 'an XML name without colons')).toBe(
      'value of attribute "id" is invalid; must be an XML name without colons',
    )
  })
})

describe('content details', () => {
  it('reports disallowed text', () => {
    expect(textNotAllowed()).toBe('text not allowed here; expected the element end-tag')
  })
  it('distinguishes anywhere from here', () => {
    expect(unknownElement('zzz', 'anywhere', ['itemref'], true)).toBe(
      'element "zzz" not allowed anywhere; expected the element end-tag or element "itemref"',
    )
    expect(unknownElement('x:foo', 'here', ['item'], false)).toBe(
      'element "x:foo" not allowed here; expected element "item"',
    )
  })
  it('reports an element that is merely premature', () => {
    expect(elementNotAllowedYet('tours', 'spine')).toBe(
      'element "tours" not allowed yet; missing required element "spine"',
    )
  })
  it('reports an incomplete parent', () => {
    expect(incompleteMissingElement('spine', 'itemref')).toBe(
      'element "spine" incomplete; missing required element "itemref"',
    )
    expect(incompleteExpected('metadata', ['dc:title', 'meta'], false)).toBe(
      'element "metadata" incomplete; expected element "dc:title" or "meta"',
    )
  })
  it('reports invalid character content', () => {
    expect(
      invalidCharacterContent('dc:identifier', 'a string with length at least 1 (actual length was 0)'),
    ).toBe(
      'character content of element "dc:identifier" invalid; must be a string with length at least 1 (actual length was 0)',
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/schema/messages.test.ts`
Expected: FAIL — cannot resolve `./messages.js`.

- [ ] **Step 3: Implement**

Create `src/schema/messages.ts`:

```ts
/**
 * The RSC-005 detail strings EPUBCheck 5.3.0 emits for RelaxNG failures, transcribed
 * from jar output rather than paraphrased. Ten shapes, verified by the differential
 * harness in test/differential.
 */

const WILDCARD = 'an element from another namespace'

/** `a`, `a or b`, `a, b or c` — EPUBCheck's list style, applied recursively. */
export function joinOr(items: readonly string[]): string {
  if (items.length < 2) return items.join('')
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`
}

/** Same, with a final `and`. Used only for missing required attributes. */
export function joinAnd(items: readonly string[]): string {
  if (items.length < 2) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

export function quoteAll(names: readonly string[]): string[] {
  return names.map((n) => `"${n}"`)
}

/**
 * The `expected …` clause. EPUBCheck nests joinOr: the top level is
 * [end-tag?, element-list?, wildcard?], and the element list is itself a joinOr.
 * That is why `the element end-tag or element "guide" or "tours"` has two `or`s
 * while the long metadata list uses a comma after the end-tag.
 */
export function expectedClause(names: readonly string[], endTagAllowed: boolean): string {
  const parts: string[] = []
  if (endTagAllowed) parts.push('the element end-tag')
  const elements = names.filter((n) => n !== WILDCARD)
  if (elements.length > 0) parts.push(`element ${joinOr(quoteAll(elements))}`)
  if (names.includes(WILDCARD)) parts.push(WILDCARD)
  return joinOr(parts)
}

export function unknownAttribute(qname: string, expected: readonly string[]): string {
  return `attribute "${qname}" not allowed here; expected attribute ${joinOr(quoteAll(expected))}`
}

export function noAttributesAllowed(qname: string): string {
  return `found attribute "${qname}", but no attributes allowed here`
}

export function missingAttributes(elementName: string, missing: readonly string[]): string {
  const plural = missing.length > 1 ? 's' : ''
  return `element "${elementName}" missing required attribute${plural} ${joinAnd(quoteAll(missing))}`
}

export function invalidAttributeValue(qname: string, describe: string): string {
  return `value of attribute "${qname}" is invalid; must be ${describe}`
}

export function invalidCharacterContent(elementName: string, describe: string): string {
  return `character content of element "${elementName}" invalid; must be ${describe}`
}

export function textNotAllowed(): string {
  return 'text not allowed here; expected the element end-tag'
}

/**
 * `anywhere` when the name occurs nowhere in the grammar; `here` when it occurs
 * elsewhere but is not currently accepted. A foreign-namespace element at package
 * level is `here`, because the wildcard makes it legal inside metadata.
 */
export function unknownElement(
  qname: string,
  scope: 'anywhere' | 'here',
  expected: readonly string[],
  endTagAllowed: boolean,
): string {
  return `element "${qname}" not allowed ${scope}; expected ${expectedClause(expected, endTagAllowed)}`
}

export function elementNotAllowedYet(qname: string, missingRequired: string): string {
  return `element "${qname}" not allowed yet; missing required element "${missingRequired}"`
}

export function incompleteMissingElement(parent: string, missing: string): string {
  return `element "${parent}" incomplete; missing required element "${missing}"`
}

export function incompleteExpected(
  parent: string,
  expected: readonly string[],
  endTagAllowed: boolean,
): string {
  return `element "${parent}" incomplete; expected ${expectedClause(expected, endTagAllowed)}`
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/schema/messages.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/schema/messages.ts src/schema/messages.test.ts
git commit -m "feat: RSC-005 detail strings for RelaxNG failures"
```

---
### Task 7: Validating driver

Walks an `XmlNode` tree against a grammar, recovers from each failure so multiple messages are reported per element (as the jar does), and emits `RSC-005`.

Recovery rule, confirmed against the jar: an unknown attribute leaves the pattern **unchanged**, which is why two unknown attributes on one element report the *same* expected list.

**Files:**
- Create: `src/schema/validate.ts`
- Test: `src/schema/validate.test.ts`

**Interfaces:**
- Consumes: Tasks 2–6.
- Produces: `Grammar { root: Pattern; names: Set<string> }`, `makeGrammar(root)`, `validateAgainst(grammar, node, path): Message[]`.

- [ ] **Step 1: Write the failing test**

Create `src/schema/validate.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseXml } from '../io/xml.js'
import {
  EMPTY, element, attribute, name, data, all, oneOrMore, optional, seq,
} from './pattern.js'
import { DT_TEXT, DT_ID } from './datatypes.js'
import { makeGrammar, validateAgainst } from './validate.js'

const N = (local: string) => name(undefined, local, local)
const NS = 'http://example.com/g'
const EN = (local: string) => name(NS, local, local)

// <root id?><child a* b/>+ </root>
const GRAMMAR = makeGrammar(
  element(
    EN('root'),
    all(
      optional(attribute(N('id'), data(DT_ID))),
      oneOrMore(
        element(EN('child'), all(attribute(N('a'), data(DT_TEXT)), optional(attribute(N('b'), data(DT_TEXT))))),
      ),
    ),
  ),
)

const run = (xml: string) => {
  const root = parseXml(new TextEncoder().encode(xml), 'p.opf').root!
  return validateAgainst(GRAMMAR, root, 'p.opf').map((m) => m.message)
}

const detail = (s: string) => `Error while parsing file 'p.opf': ${s}`

describe('validateAgainst', () => {
  it('accepts a valid document', () => {
    expect(run(`<root xmlns="${NS}" id="r"><child a="1"/></root>`)).toEqual([])
  })

  it('reports every unknown attribute with the same expected list', () => {
    expect(run(`<root xmlns="${NS}"><child z="1" y="2" a="3"/></root>`)).toEqual([
      detail('attribute "z" not allowed here; expected attribute "a" or "b"'),
      detail('attribute "y" not allowed here; expected attribute "a" or "b"'),
    ])
  })

  it('narrows the expected list by document order', () => {
    expect(run(`<root xmlns="${NS}"><child b="1" z="2" a="3"/></root>`)).toEqual([
      detail('attribute "z" not allowed here; expected attribute "a"'),
    ])
  })

  it('reports a missing required attribute', () => {
    expect(run(`<root xmlns="${NS}"><child b="1"/></root>`)).toEqual([
      detail('element "child" missing required attribute "a"'),
    ])
  })

  it('reports an invalid attribute value', () => {
    expect(run(`<root xmlns="${NS}" id="1"><child a="x"/></root>`)).toEqual([
      detail('value of attribute "id" is invalid; must be an XML name without colons'),
    ])
  })

  it('reports text in an empty content model', () => {
    expect(run(`<root xmlns="${NS}"><child a="1">oops</child></root>`)).toEqual([
      detail('text not allowed here; expected the element end-tag'),
    ])
  })

  it('ignores whitespace-only text', () => {
    expect(run(`<root xmlns="${NS}">\n  <child a="1"/>\n</root>`)).toEqual([])
  })

  it('distinguishes an unknown name from a misplaced known one', () => {
    expect(run(`<root xmlns="${NS}"><child a="1"/><zzz/></root>`)).toEqual([
      detail('element "zzz" not allowed anywhere; expected the element end-tag or element "child"'),
    ])
    expect(run(`<root xmlns="${NS}"><child a="1"><root/></child></root>`)).toEqual([
      detail('element "root" not allowed here; expected the element end-tag'),
    ])
  })

  it('reports an incomplete parent', () => {
    expect(run(`<root xmlns="${NS}"></root>`)).toEqual([
      detail('element "root" incomplete; missing required element "child"'),
    ])
  })

  it('attaches the offending element location', () => {
    const root = parseXml(new TextEncoder().encode(`<root xmlns="${NS}"><child/></root>`), 'p.opf').root!
    const messages = validateAgainst(GRAMMAR, root, 'p.opf')
    expect(messages[0]!.id).toBe('RSC-005')
    expect(messages[0]!.location?.path).toBe('p.opf')
    expect(messages[0]!.location?.line).toBe(1)
  })
})

describe('ordering', () => {
  const ORDERED = makeGrammar(
    element(EN('pkg'), seq(element(EN('a'), EMPTY), element(EN('b'), EMPTY), optional(element(EN('c'), EMPTY)))),
  )
  const runOrdered = (xml: string) => {
    const root = parseXml(new TextEncoder().encode(xml), 'p.opf').root!
    return validateAgainst(ORDERED, root, 'p.opf').map((m) => m.message)
  }

  it('reports a premature element as "not allowed yet"', () => {
    expect(runOrdered(`<pkg xmlns="${NS}"><a/><c/><b/></pkg>`)).toEqual([
      detail('element "c" not allowed yet; missing required element "b"'),
      detail('element "b" not allowed here; expected the element end-tag or element "c"'),
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/schema/validate.test.ts`
Expected: FAIL — cannot resolve `./validate.js`.

- [ ] **Step 3: Implement**

Create `src/schema/validate.ts`:

```ts
import type { XmlNode, XmlAttr } from '../io/xml.js'
import { msg, type Message } from '../messages/format.js'
import { NOT_ALLOWED, deref, nullable, type Datatype, type Pattern } from './pattern.js'
import {
  attDeriv, endTagDeriv, startTagCloseDeriv, startTagOpenDeriv, textDeriv,
} from './derivative.js'
import {
  expectedAttributes, expectedElements, grammarNames, requiredAttributes, requiredElements,
} from './expected.js'
import {
  elementNotAllowedYet, incompleteExpected, incompleteMissingElement, invalidAttributeValue,
  missingAttributes, noAttributesAllowed, textNotAllowed, unknownAttribute, unknownElement,
} from './messages.js'

export interface Grammar {
  root: Pattern
  /** Every element display name in the grammar; drives the anywhere/here split. */
  names: Set<string>
}

export function makeGrammar(root: Pattern): Grammar {
  return { root, names: grammarNames(root) }
}

/**
 * Details the driver deliberately does not emit. Nothing is listed today; entries
 * are added only when the differential harness shows a case the engine cannot
 * reproduce exactly. Silence beats approximate wording — see the design doc's
 * containment rule.
 */
const SUPPRESSED: readonly string[] = []

/** Qualified name as written, which is the form EPUBCheck echoes. */
function qnameOf(node: XmlNode): string {
  return node.prefix ? `${node.prefix}:${node.name}` : (node.name ?? '')
}

export function validateAgainst(grammar: Grammar, root: XmlNode, path: string): Message[] {
  const messages: Message[] = []
  const emit = (node: XmlNode, detail: string): void => {
    if (SUPPRESSED.includes(detail)) return
    messages.push(msg('RSC-005', node.loc, path, detail))
  }

  /**
   * Consume one element against `p`, returning the pattern that follows it.
   * On an unrecognised element the pattern is returned unchanged, so the walk
   * continues and later siblings are still checked.
   */
  const childDeriv = (p: Pattern, node: XmlNode): Pattern => {
    const opened = startTagOpenDeriv(p, node.ns, node.name ?? '')
    if (opened.k === 'notAllowed') {
      reportUnknownElement(p, node)
      return p
    }
    const afterAttrs = deriveAttributes(opened, node)
    const closed = startTagCloseDeriv(afterAttrs)
    reportMissingAttributes(afterAttrs, node)
    const content = deriveChildren(closed, node)
    const ended = endTagDeriv(content)
    if (ended.k === 'notAllowed') {
      reportIncomplete(content, node)
      // Recover by closing the element anyway, keeping the continuation the
      // start tag established, so later siblings are still checked.
      return forceEnd(content)
    }
    return ended
  }

  /** Close an element whose content was invalid, keeping the parent's continuation. */
  const forceEnd = (content: Pattern): Pattern => {
    const d = deref(content)
    switch (d.k) {
      case 'after':
        return d.p2
      case 'choice': {
        const a = forceEnd(d.p1)
        return a.k === 'notAllowed' ? forceEnd(d.p2) : a
      }
      default:
        return NOT_ALLOWED
    }
  }

  const reportUnknownElement = (p: Pattern, node: XmlNode): void => {
    const qname = qnameOf(node)
    const expected = expectedElements(p)
    const endTagAllowed = nullable(p)
    // "yet" when the name IS reachable later in this sequence but a required
    // predecessor is outstanding.
    const required = requiredElements(p)
    if (required.length > 0 && reachableLater(p, node) && !expected.includes(qname)) {
      emit(node, elementNotAllowedYet(qname, required[0]!))
      return
    }
    const scope = grammar.names.has(qname) ? 'here' : 'anywhere'
    emit(node, unknownElement(qname, scope, expected, endTagAllowed))
  }

  /** Would this element be accepted once the outstanding required elements arrived? */
  const reachableLater = (p: Pattern, node: XmlNode): boolean => {
    const local = node.name ?? ''
    const probe = (q: Pattern): boolean => {
      const d = deref(q)
      switch (d.k) {
        case 'group':
          return probe(d.p1) || probe(d.p2)
        case 'choice':
        case 'interleave':
          return probe(d.p1) || probe(d.p2)
        case 'oneOrMore':
          return probe(d.p)
        case 'after':
          return probe(d.p1)
        case 'element':
          return startTagOpenDeriv(d, node.ns, local).k !== 'notAllowed'
        default:
          return false
      }
    }
    return probe(p)
  }

  const deriveAttributes = (opened: Pattern, node: XmlNode): Pattern => {
    let p = opened
    for (const attr of node.attributes ?? []) {
      const next = attDeriv(p, attr)
      if (next.k !== 'notAllowed') {
        p = next
        continue
      }
      reportBadAttribute(p, node, attr)
      // Leave `p` unchanged: the jar reports the same expected list for a second
      // unknown attribute on the same element.
    }
    return p
  }

  const reportBadAttribute = (p: Pattern, node: XmlNode, attr: XmlAttr): void => {
    // A declared attribute whose VALUE failed its datatype reports differently
    // from an undeclared one.
    const expected = expectedAttributes(p)
    if (expected.includes(attr.qname)) {
      const dt = datatypeFor(p, attr)
      if (dt) {
        emit(node, invalidAttributeValue(attr.qname, dt.describe(attr.value)))
        return
      }
    }
    if (expected.length === 0) {
      emit(node, noAttributesAllowed(attr.qname))
      return
    }
    emit(node, unknownAttribute(attr.qname, expected))
  }

  const reportMissingAttributes = (afterAttrs: Pattern, node: XmlNode): void => {
    const missing = requiredAttributes(afterAttrs)
    if (missing.length > 0) emit(node, missingAttributes(qnameOf(node), missing))
  }

  const deriveChildren = (closed: Pattern, node: XmlNode): Pattern => {
    let p = closed
    for (const child of node.children ?? []) {
      if (child.type === 'text') {
        // parseXml already discards whitespace-only text, which is why an
        // `<empty/>` model tolerates indentation.
        const next = textDeriv(p, child.text ?? '')
        if (next.k === 'notAllowed') {
          emit(node, textNotAllowed())
          continue
        }
        p = next
        continue
      }
      p = childDeriv(p, child)
    }
    return p
  }

  const reportIncomplete = (content: Pattern, node: XmlNode): void => {
    const inner = innerOf(content)
    const required = requiredElements(inner)
    if (required.length > 0) {
      emit(node, incompleteMissingElement(qnameOf(node), required[0]!))
      return
    }
    emit(node, incompleteExpected(qnameOf(node), expectedElements(inner), nullable(inner)))
  }

  /** The still-open content pattern inside an `after`. */
  const innerOf = (p: Pattern): Pattern => {
    const d = deref(p)
    switch (d.k) {
      case 'after':
        return d.p1
      case 'choice': {
        const a = innerOf(d.p1)
        return a.k === 'notAllowed' ? innerOf(d.p2) : a
      }
      default:
        return d
    }
  }

  /** Find the datatype a declared attribute failed against. */
  const datatypeFor = (p: Pattern, attr: XmlAttr): Datatype | undefined => {
    let found: Datatype | undefined
    const walk = (q: Pattern): void => {
      const d = deref(q)
      switch (d.k) {
        case 'attribute': {
          if (found) return
          const inner = deref(d.p)
          if (inner.k === 'data') found = inner.type
          return
        }
        case 'choice':
        case 'group':
        case 'interleave':
        case 'after':
          walk(d.p1)
          walk(d.p2)
          return
        case 'oneOrMore':
          walk(d.p)
          return
        default:
      }
    }
    // Restrict the search to attributes matching this qname.
    const matching = expectedAttributes(p).includes(attr.qname)
    if (matching) walk(p)
    return found
  }

  childDeriv(grammar.root, root)
  return messages
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/schema/validate.test.ts && npm run typecheck && npm run lint`
Expected: PASS. If the ordering test's message order differs, adjust the walk to report the premature element before continuing — do not change the expected strings, which are transcribed from the jar.

- [ ] **Step 5: Commit**

```bash
git add src/schema/validate.ts src/schema/validate.test.ts
git commit -m "feat: schema-validating driver with jar-matching error recovery"
```

---
### Task 8: The OPF 2.0 grammar

**Files:**
- Create: `src/schema/opf20.ts`
- Test: `src/schema/opf20.test.ts`

**Interfaces:**
- Produces: `OPF20: Grammar`.

- [ ] **Step 1: Write the failing test**

Create `src/schema/opf20.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseXml } from '../io/xml.js'
import { validateAgainst } from './validate.js'
import { OPF20 } from './opf20.js'

const OPF_NS = 'http://www.idpf.org/2007/opf'
const DC_NS = 'http://purl.org/dc/elements/1.1/'

const PKG = (metadata: string, rest = '') =>
  `<package xmlns="${OPF_NS}" xmlns:dc="${DC_NS}" xmlns:opf="${OPF_NS}" ` +
  `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="2.0" unique-identifier="uid">` +
  `<metadata>${metadata}</metadata>` +
  `<manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest>` +
  `<spine toc="ncx"><itemref idref="ncx"/></spine>${rest}</package>`

const BASE =
  `<dc:identifier id="uid">urn:uuid:0</dc:identifier><dc:title>T</dc:title><dc:language>en</dc:language>`

const run = (xml: string) =>
  validateAgainst(OPF20, parseXml(new TextEncoder().encode(xml), 'p.opf').root!, 'p.opf')
    .map((m) => m.message.replace("Error while parsing file 'p.opf': ", ''))

describe('OPF 2.0 grammar', () => {
  it('accepts a minimal valid package', () => {
    expect(run(PKG(BASE))).toEqual([])
  })

  // These four are the false-positive cases the design doc flags as highest risk.
  it('accepts opf: attributes on their sanctioned dc elements', () => {
    expect(run(PKG(`${BASE}<dc:creator opf:role="aut" opf:file-as="D, J">J D</dc:creator>`))).toEqual([])
    expect(run(PKG(`${BASE}<dc:date opf:event="publication">2001</dc:date>`))).toEqual([])
    expect(
      run(PKG(`<dc:identifier id="uid" opf:scheme="ISBN">9780000000000</dc:identifier><dc:title>T</dc:title><dc:language>en</dc:language>`)),
    ).toEqual([])
    expect(run(PKG(`${BASE}<dc:date xsi:type="dcterms:W3CDTF">2001</dc:date>`))).toEqual([])
  })

  it('accepts an unknown guide reference type and an absent title', () => {
    expect(run(PKG(BASE, '<guide><reference type="banana" href="a.xhtml"/></guide>'))).toEqual([])
  })

  it('accepts foreign-namespace elements inside metadata, in any position', () => {
    expect(run(PKG(`${BASE}<x:foo xmlns:x="http://example.com/x">v</x:foo>`))).toEqual([])
    expect(run(PKG(`<x:foo xmlns:x="http://example.com/x"/>${BASE}`))).toEqual([])
  })

  it('accepts metadata children in any order', () => {
    expect(
      run(PKG(`<dc:language>en</dc:language><dc:title>T</dc:title><dc:identifier id="uid">u</dc:identifier>`)),
    ).toEqual([])
  })

  it('rejects opf:file-as on dc:title', () => {
    expect(run(PKG(`<dc:identifier id="uid">u</dc:identifier><dc:title opf:file-as="T">T</dc:title><dc:language>en</dc:language>`))).toEqual([
      'attribute "opf:file-as" not allowed here; expected attribute "id" or "xml:lang"',
    ])
  })

  it('rejects an EPUB 3 meta three ways', () => {
    expect(run(PKG(`${BASE}<meta property="dcterms:modified">2019-01-01T00:00:00Z</meta>`))).toEqual([
      'attribute "property" not allowed here; expected attribute "content", "id", "name", "scheme" or "xml:lang"',
      'element "meta" missing required attributes "content" and "name"',
      'text not allowed here; expected the element end-tag',
    ])
  })

  it('rejects EPUB 3 attributes on item and itemref', () => {
    const xml = PKG(BASE).replace('media-type="application/x-dtbncx+xml"', 'media-type="application/x-dtbncx+xml" properties="nav"')
    expect(run(xml)).toEqual([
      'attribute "properties" not allowed here; expected attribute "fallback", "fallback-style", "required-modules" or "required-namespace"',
    ])
  })

  it('requires the spine toc attribute', () => {
    expect(run(PKG(BASE).replace('<spine toc="ncx">', '<spine>'))).toEqual([
      'element "spine" missing required attribute "toc"',
    ])
  })

  it('reports an empty dc:identifier', () => {
    expect(run(PKG(`<dc:identifier id="uid"></dc:identifier><dc:title>T</dc:title><dc:language>en</dc:language>`))).toEqual([
      'character content of element "dc:identifier" invalid; must be a string with length at least 1 (actual length was 0)',
    ])
  })

  it('reports missing required metadata one at a time', () => {
    expect(run(PKG(`<dc:identifier id="uid">u</dc:identifier><dc:language>en</dc:language>`))).toEqual([
      'element "metadata" incomplete; missing required element "dc:title"',
    ])
  })

  it('enforces package child order', () => {
    const xml = PKG(BASE, '<guide><reference type="text" href="a.xhtml"/></guide>')
      .replace('<spine toc="ncx"><itemref idref="ncx"/></spine>', '')
    expect(run(xml)).toEqual([
      'element "guide" not allowed yet; missing required element "spine"',
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/schema/opf20.test.ts`
Expected: FAIL — cannot resolve `./opf20.js`.

- [ ] **Step 3: Implement**

Create `src/schema/opf20.ts`:

```ts
import {
  TEXT, all, attribute, anyNameExcept, choice, data, element, name, oneOrMore,
  optional, ref, seq, zeroOrMore, type Pattern,
} from './pattern.js'
import { DT_ANY_URI, DT_ID, DT_IDREF, DT_NON_EMPTY, dtEnum } from './datatypes.js'
import { makeGrammar, type Grammar } from './validate.js'

/**
 * OPF 2.0, transcribed from `com/adobe/epubcheck/schema/20/rng/opf20.rng`
 * (revision 20070222) as bundled in EPUBCheck 5.3.0. Definition names below mirror
 * the RNG's `define` names so the two can be diffed by eye.
 */

const OPF = 'http://www.idpf.org/2007/opf'
const DC = 'http://purl.org/dc/elements/1.1/'
const XML = 'http://www.w3.org/XML/1998/namespace'
const XSI = 'http://www.w3.org/2001/XMLSchema-instance'
const OEB = 'http://openebook.org/namespaces/oeb-package/1.0/'

const opfEl = (local: string, p: Pattern) => element(name(OPF, local, local), p)
const dcEl = (local: string, p: Pattern) => element(name(DC, local, `dc:${local}`), p)

/** Attributes are unprefixed unless the RNG gives them an `ns`. */
const attr = (local: string, p: Pattern) => attribute(name(undefined, local, local), p)
const optId = optional(attr('id', data(DT_ID)))
const optXmlLang = optional(attribute(name(XML, 'lang', 'xml:lang'), TEXT))
const optXsiType = optional(attribute(name(XSI, 'type', 'xsi:type'), TEXT))
const optFileAs = optional(attribute(name(OPF, 'file-as', 'opf:file-as'), TEXT))
const optRole = optional(attribute(name(OPF, 'role', 'opf:role'), TEXT))
const optScheme = optional(attribute(name(OPF, 'scheme', 'opf:scheme'), TEXT))
const optEvent = optional(attribute(name(OPF, 'event', 'opf:event'), TEXT))

/** `DC.metadata-common-content` — free text. */
const DC_COMMON = TEXT
/** `DC.metadata-required-content` — token, minLength 1. */
const DC_REQUIRED = data(DT_NON_EMPTY)

const dcIdentifier = dcEl('identifier', all(optId, optXsiType, optScheme, DC_REQUIRED))
const dcTitle = dcEl('title', all(optId, optXmlLang, DC_COMMON))
const dcLanguage = dcEl('language', all(optId, optXsiType, DC_COMMON))

/** `DC.optional-metadata-element`. */
const dcOptional = [
  dcEl('contributor', all(optId, optXmlLang, optFileAs, optRole, DC_COMMON)),
  dcEl('coverage', all(optId, optXmlLang, DC_COMMON)),
  dcEl('creator', all(optId, optXmlLang, optFileAs, optRole, DC_COMMON)),
  dcEl('date', all(optId, optXsiType, optEvent, DC_COMMON)),
  dcEl('description', all(optId, optXmlLang, DC_COMMON)),
  dcEl('format', all(optId, optXsiType, DC_COMMON)),
  dcEl('publisher', all(optId, optXmlLang, DC_COMMON)),
  dcEl('relation', all(optId, optXmlLang, DC_COMMON)),
  dcEl('rights', all(optId, optXmlLang, DC_COMMON)),
  dcEl('source', all(optId, optXmlLang, DC_COMMON)),
  dcEl('subject', all(optId, optXmlLang, DC_COMMON)),
  dcEl('type', all(optId, optXsiType, DC_COMMON)),
].reduce(choice)

/** `OPF20.meta-element` — empty content model. */
const meta = opfEl(
  'meta',
  all(optId, optXmlLang, attr('name', TEXT), attr('content', TEXT), optional(attr('scheme', TEXT))),
)

/**
 * `OPF20.any-other-element` — anything outside the OPF, OEB 1.2 and DC namespaces,
 * with any attributes, any text, and recursively any more of the same. This wildcard
 * is why a foreign-namespace `dcterms:modified` element inside `<metadata>` is clean.
 */
const anyOther: Pattern = element(
  anyNameExcept([OPF, OEB, DC]),
  zeroOrMore(
    choice(
      choice(attribute(anyNameExcept([]), TEXT), TEXT),
      ref(() => anyOther),
    ),
  ),
)

const dcMetadata = opfEl(
  'dc-metadata',
  all(optId, oneOrMore(dcTitle), oneOrMore(dcLanguage), oneOrMore(dcIdentifier), zeroOrMore(dcOptional)),
)
const xMetadata = opfEl('x-metadata', all(optId, zeroOrMore(meta), zeroOrMore(anyOther)))

/** `OPF20.metadata-content` — a choice of the OEB 1.2 branch and the EPUB 2 branch. */
const metadataContent = choice(
  all(dcMetadata, optional(xMetadata)),
  all(
    oneOrMore(dcTitle),
    oneOrMore(dcLanguage),
    oneOrMore(dcIdentifier),
    zeroOrMore(dcOptional),
    zeroOrMore(meta),
    zeroOrMore(anyOther),
  ),
)

const metadata = opfEl('metadata', all(optId, metadataContent))

const item = opfEl(
  'item',
  all(
    attr('id', data(DT_ID)),
    attr('href', data(DT_ANY_URI)),
    attr('media-type', TEXT),
    optional(attr('fallback', data(DT_IDREF))),
    optional(attr('fallback-style', data(DT_IDREF))),
    // `required-modules` is legal only alongside `required-namespace`.
    optional(all(attr('required-namespace', TEXT), optional(attr('required-modules', TEXT)))),
  ),
)
const manifest = opfEl('manifest', all(optId, oneOrMore(item)))

const itemref = opfEl(
  'itemref',
  all(optId, attr('idref', data(DT_IDREF)), optional(attr('linear', data(dtEnum(['yes', 'no']))))),
)
const spine = opfEl('spine', all(optId, attr('toc', data(DT_IDREF)), oneOrMore(itemref)))

const site = opfEl('site', all(optId, attr('title', TEXT), attr('href', data(DT_ANY_URI))))
const tour = opfEl('tour', all(optId, attr('title', TEXT), oneOrMore(site)))
const tours = opfEl('tours', all(optId, oneOrMore(tour)))

const reference = opfEl(
  'reference',
  all(optId, attr('type', TEXT), optional(attr('title', TEXT)), attr('href', data(DT_ANY_URI))),
)
const guide = opfEl('guide', all(optId, oneOrMore(reference)))

/** `OPF20.package-element` — note the package children are an ordered sequence. */
const pkg = opfEl(
  'package',
  all(
    attr('version', data(dtEnum(['2.0']))),
    attr('unique-identifier', data(DT_IDREF)),
    optId,
    seq(metadata, manifest, spine, optional(tours), optional(guide)),
  ),
)

export const OPF20: Grammar = makeGrammar(pkg)
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/schema/opf20.test.ts && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/schema/opf20.ts src/schema/opf20.test.ts
git commit -m "feat: OPF 2.0 grammar transcribed from opf20.rng"
```

---
### Task 9: The package-30 grammar

**Files:**
- Create: `src/schema/package30.ts`
- Test: `src/schema/package30.test.ts`

**Interfaces:**
- Produces: `PACKAGE30: Grammar`.

- [ ] **Step 1: Write the failing test**

Create `src/schema/package30.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseXml } from '../io/xml.js'
import { validateAgainst } from './validate.js'
import { PACKAGE30 } from './package30.js'

const OPF_NS = 'http://www.idpf.org/2007/opf'
const DC_NS = 'http://purl.org/dc/elements/1.1/'

const PKG = (metadata: string) =>
  `<package xmlns="${OPF_NS}" xmlns:dc="${DC_NS}" version="3.0" unique-identifier="uid">` +
  `<metadata>${metadata}</metadata>` +
  `<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest>` +
  `<spine><itemref idref="nav"/></spine></package>`

const BASE =
  `<dc:identifier id="uid">urn:uuid:0</dc:identifier><dc:title>T</dc:title><dc:language>en</dc:language>` +
  `<meta property="dcterms:modified">2019-01-01T00:00:00Z</meta>`

const run = (xml: string) =>
  validateAgainst(PACKAGE30, parseXml(new TextEncoder().encode(xml), 'p.opf').root!, 'p.opf')
    .map((m) => m.message.replace("Error while parsing file 'p.opf': ", ''))

describe('package-30 grammar', () => {
  it('accepts a minimal valid EPUB 3 package', () => {
    expect(run(PKG(BASE))).toEqual([])
  })

  it('accepts the legacy name/content meta form', () => {
    expect(run(PKG(`${BASE}<meta name="cover" content="nav"/>`))).toEqual([])
  })

  it('accepts link, refines and i18n attributes', () => {
    expect(run(PKG(`${BASE}<link rel="cc:license" href="http://example.com/l"/><dc:title id="t" dir="ltr" xml:lang="en">T2</dc:title>`))).toEqual([])
  })

  it('accepts spine page-progression-direction and itemref properties', () => {
    expect(run(PKG(BASE).replace('<spine>', '<spine page-progression-direction="rtl">'))).toEqual([])
  })

  it('rejects an OPF 2.0 spine toc idref datatype violation', () => {
    expect(run(PKG(BASE).replace('<spine>', '<spine toc="1">'))).toEqual([
      'value of attribute "toc" is invalid; must be an XML name without colons',
    ])
  })

  it('rejects an unknown attribute on item', () => {
    expect(run(PKG(BASE).replace('properties="nav"', 'properties="nav" bogus="x"'))).toEqual([
      'attribute "bogus" not allowed here; expected attribute "fallback" or "media-overlay"',
    ])
  })

  it('rejects a meta that is neither form', () => {
    expect(run(PKG(`${BASE}<meta scheme="s">v</meta>`))).toEqual([
      'element "meta" missing required attribute "property"',
    ])
  })

  it('rejects dir outside its enumeration', () => {
    expect(run(PKG(`${BASE}<dc:title dir="sideways">T2</dc:title>`))).toEqual([
      'value of attribute "dir" is invalid; must be equal to "auto", "ltr" or "rtl"',
    ])
  })

  it('requires dc:title', () => {
    expect(run(PKG(`<dc:identifier id="uid">u</dc:identifier><dc:language>en</dc:language>`))).toEqual([
      'element "metadata" incomplete; missing required element "dc:title"',
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/schema/package30.test.ts`
Expected: FAIL — cannot resolve `./package30.js`.

- [ ] **Step 3: Implement**

Create `src/schema/package30.ts`:

```ts
import {
  TEXT, all, attribute, choice, data, element, name, oneOrMore, optional,
  ref, seq, zeroOrMore, type Pattern,
} from './pattern.js'
import { DT_ANY_URI, DT_ID, DT_IDREF, DT_NON_EMPTY, dtEnum } from './datatypes.js'
import { makeGrammar, type Grammar } from './validate.js'

/**
 * EPUB 3 package documents, transcribed from
 * `com/adobe/epubcheck/schema/30/package-30.rnc` as bundled in EPUBCheck 5.3.0.
 * Definition names mirror the RNC's so the two can be diffed by eye.
 *
 * `datatype.property`, `datatype.properties`, `datatype.mimetype` and
 * `datatype.languagecode` are all treated as free text; see the containment rule.
 */

const OPF = 'http://www.idpf.org/2007/opf'
const DC = 'http://purl.org/dc/elements/1.1/'
const XML = 'http://www.w3.org/XML/1998/namespace'

const opfEl = (local: string, p: Pattern) => element(name(OPF, local, local), p)
const dcEl = (local: string, p: Pattern) => element(name(DC, local, `dc:${local}`), p)
const attr = (local: string, p: Pattern) => attribute(name(undefined, local, local), p)

const optId = optional(attr('id', data(DT_ID)))
/** `opf.i18n.attrs` */
const i18n = all(
  optional(attribute(name(XML, 'lang', 'xml:lang'), TEXT)),
  optional(attr('dir', data(dtEnum(['ltr', 'rtl', 'auto'])))),
)
const optProperties = optional(attr('properties', TEXT))
const optRefines = optional(attr('refines', data(DT_ANY_URI)))

/** `opf.dc.attlist` */
const dcAttlist = all(optId, i18n)
const NONEMPTY = data(DT_NON_EMPTY)

const dcIdentifier = dcEl('identifier', all(optId, NONEMPTY))
const dcTitle = dcEl('title', all(dcAttlist, NONEMPTY))
const dcLanguage = dcEl('language', all(optId, NONEMPTY))
const dcDate = dcEl('date', all(optId, NONEMPTY))
const dcSimple = (local: string) => dcEl(local, all(optId, NONEMPTY))
const dcRich = (local: string) => dcEl(local, all(dcAttlist, NONEMPTY))

/** `opf.dc.elems` — an interleave, so order is free. */
const dcElems = all(
  oneOrMore(dcIdentifier),
  oneOrMore(dcTitle),
  oneOrMore(dcLanguage),
  optional(dcDate),
  zeroOrMore(dcRich('source')),
  zeroOrMore(dcSimple('type')),
  zeroOrMore(dcSimple('format')),
  zeroOrMore(dcRich('creator')),
  zeroOrMore(dcRich('subject')),
  zeroOrMore(dcRich('description')),
  zeroOrMore(dcRich('publisher')),
  zeroOrMore(dcRich('contributor')),
  zeroOrMore(dcRich('relation')),
  zeroOrMore(dcRich('coverage')),
  zeroOrMore(dcRich('rights')),
)

/** `opf.epub3.meta.content` */
const epub3Meta = all(
  attr('property', TEXT),
  optRefines,
  optId,
  optional(attr('scheme', TEXT)),
  i18n,
  NONEMPTY,
)
/** `opf.epub2.meta.content` — the legacy form. */
const epub2Meta = all(attr('name', TEXT), attr('content', TEXT))
const meta = opfEl('meta', choice(epub3Meta, epub2Meta))

const link = opfEl(
  'link',
  all(
    attr('href', data(DT_ANY_URI)),
    optional(attr('hreflang', TEXT)),
    attr('rel', TEXT),
    optId,
    optRefines,
    optional(attr('media-type', TEXT)),
    optProperties,
  ),
)

const metadata = opfEl('metadata', all(optId, i18n, dcElems, zeroOrMore(meta), zeroOrMore(link)))

const item = opfEl(
  'item',
  all(
    attr('id', data(DT_ID)),
    attr('href', data(DT_ANY_URI)),
    attr('media-type', TEXT),
    optional(attr('fallback', data(DT_IDREF))),
    optional(attr('media-overlay', data(DT_IDREF))),
    optProperties,
  ),
)
const manifest = opfEl('manifest', all(optId, oneOrMore(item)))

const itemref = opfEl(
  'itemref',
  all(
    attr('idref', data(DT_IDREF)),
    optional(attr('linear', data(dtEnum(['yes', 'no'])))),
    optId,
    optProperties,
  ),
)
const spine = opfEl(
  'spine',
  all(
    optId,
    optional(attr('toc', data(DT_IDREF))),
    optional(attr('page-progression-direction', data(dtEnum(['ltr', 'rtl', 'default'])))),
    oneOrMore(itemref),
  ),
)

const reference = opfEl(
  'reference',
  all(attr('href', data(DT_ANY_URI)), attr('type', TEXT), optional(attr('title', TEXT))),
)
const guide = opfEl('guide', oneOrMore(reference))

const mediaType = opfEl('mediaType', all(attr('media-type', TEXT), attr('handler', data(DT_IDREF))))
const bindings = opfEl('bindings', oneOrMore(mediaType))

/** `opf.collection` is the one recursive production, hence the `ref` indirection. */
const collectionLink = opfEl(
  'link',
  all(attr('href', data(DT_ANY_URI)), optional(attr('rel', TEXT)), optId, optional(attr('media-type', TEXT))),
)
const collectionMetadata = opfEl(
  'metadata',
  all(
    optId,
    i18n,
    all(
      zeroOrMore(dcIdentifier), zeroOrMore(dcTitle), zeroOrMore(dcLanguage), zeroOrMore(dcDate),
      zeroOrMore(dcRich('source')), zeroOrMore(dcSimple('type')), zeroOrMore(dcSimple('format')),
      zeroOrMore(dcRich('creator')), zeroOrMore(dcRich('subject')), zeroOrMore(dcRich('description')),
      zeroOrMore(dcRich('publisher')), zeroOrMore(dcRich('contributor')), zeroOrMore(dcRich('relation')),
      zeroOrMore(dcRich('coverage')), zeroOrMore(dcRich('rights')),
    ),
    zeroOrMore(opfEl('meta', epub3Meta)),
    zeroOrMore(link),
  ),
)
const collectionRef: Pattern = ref(() => collection)
const collection: Pattern = opfEl(
  'collection',
  all(
    all(optId, i18n, attr('role', TEXT)),
    seq(
      optional(collectionMetadata),
      choice(oneOrMore(collectionRef), seq(zeroOrMore(collectionRef), oneOrMore(collectionLink))),
    ),
  ),
)

const pkg = opfEl(
  'package',
  all(
    attr('version', data(dtEnum(['3.0']))),
    attr('unique-identifier', data(DT_IDREF)),
    optId,
    optional(attr('prefix', TEXT)),
    i18n,
    seq(metadata, manifest, spine, optional(guide), optional(bindings), zeroOrMore(collection)),
  ),
)

export const PACKAGE30: Grammar = makeGrammar(pkg)
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/schema/package30.test.ts && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/schema/package30.ts src/schema/package30.test.ts
git commit -m "feat: package-30 grammar transcribed from package-30.rnc"
```

---
### Task 10: Schematron rules

Two XPath assertions that are not in the RNG. Unique `id` applies to both versions; duplicate `reference` is EPUB 2 only (`schema/20/sch/opf.sch`).

**Files:**
- Create: `src/schema/schematron.ts`
- Test: `src/schema/schematron.test.ts`

**Interfaces:**
- Produces: `checkUniqueIds(root, path): Message[]`, `checkDuplicateReferences(root, path): Message[]`.

- [ ] **Step 1: Write the failing test**

Create `src/schema/schematron.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseXml } from '../io/xml.js'
import { checkUniqueIds, checkDuplicateReferences } from './schematron.js'

const doc = (s: string) => parseXml(new TextEncoder().encode(s), 'p.opf').root!

describe('checkUniqueIds', () => {
  it('accepts distinct ids', () => {
    expect(checkUniqueIds(doc('<p><a id="x"/><b id="y"/></p>'), 'p.opf')).toEqual([])
  })
  it('reports a repeated id once per offending element', () => {
    const messages = checkUniqueIds(doc('<p><a id="x"/><b id="x"/></p>'), 'p.opf')
    expect(messages.map((m) => m.message)).toEqual([
      "Error while parsing file 'p.opf': The \"id\" attribute does not have a unique value",
      "Error while parsing file 'p.opf': The \"id\" attribute does not have a unique value",
    ])
    expect(messages[0]!.severity).toBe('ERROR')
  })
  it('normalises whitespace before comparing', () => {
    expect(checkUniqueIds(doc('<p><a id=" x "/><b id="x"/></p>'), 'p.opf')).toHaveLength(2)
  })
})

describe('checkDuplicateReferences', () => {
  const guide = (refs: string) => doc(`<package><guide>${refs}</guide></package>`)

  it('accepts distinct references', () => {
    expect(
      checkDuplicateReferences(guide('<reference type="text" href="a"/><reference type="toc" href="b"/>'), 'p.opf'),
    ).toEqual([])
  })
  it('reports a duplicate type+href as a WARNING, case-insensitively', () => {
    const messages = checkDuplicateReferences(
      guide('<reference type="text" href="a"/><reference type="TEXT" href="A"/>'),
      'p.opf',
    )
    expect(messages).toHaveLength(1)
    expect(messages[0]!.id).toBe('RSC-017')
    expect(messages[0]!.severity).toBe('WARNING')
    expect(messages[0]!.message).toBe(
      'Warning while parsing file: Duplicate "reference" elements with the same "type" and "href" attributes',
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/schema/schematron.test.ts`
Expected: FAIL — cannot resolve `./schematron.js`.

- [ ] **Step 3: Implement**

First confirm the catalog carries `RSC-017` with the exact template. Check `src/messages/catalog.ts`; if the entry is absent or worded differently, add/adjust:

```ts
  'RSC-017': { severity: 'WARNING', template: 'Warning while parsing file: %1$s' },
```

Create `src/schema/schematron.ts`:

```ts
import type { XmlNode } from '../io/xml.js'
import { msg, type Message } from '../messages/format.js'

/**
 * The schematron assertions EPUBCheck applies to package documents alongside the
 * RelaxNG grammar (`schema/20/sch/opf.sch`). Both surface through the normal
 * message pipeline rather than the schema layer.
 */

const norm = (s: string): string => s.trim().replace(/\s+/g, ' ')

function walk(node: XmlNode, visit: (n: XmlNode) => void): void {
  for (const child of node.children ?? []) {
    if (child.type !== 'element') continue
    visit(child)
    walk(child, visit)
  }
}

/** `opf_idAttrUnique`: every `id` in the package document must be unique. */
export function checkUniqueIds(root: XmlNode, path: string): Message[] {
  const withId: { node: XmlNode; id: string }[] = []
  const collect = (n: XmlNode): void => {
    const id = n.attrs?.['id']
    if (id !== undefined) withId.push({ node: n, id: norm(id) })
  }
  collect(root)
  walk(root, collect)

  const counts = new Map<string, number>()
  for (const { id } of withId) counts.set(id, (counts.get(id) ?? 0) + 1)

  return withId
    .filter(({ id }) => (counts.get(id) ?? 0) > 1)
    .map(({ node }) =>
      msg('RSC-005', node.loc, path, 'The "id" attribute does not have a unique value'),
    )
}

/**
 * `opf_guideReferenceUnique`: `guide/reference` elements sharing a normalised,
 * lower-cased `type` and `href`. Reported on every occurrence after the first.
 */
export function checkDuplicateReferences(root: XmlNode, path: string): Message[] {
  const refs: XmlNode[] = []
  walk(root, (n) => {
    if (n.name === 'reference') refs.push(n)
  })

  const messages: Message[] = []
  const seen = new Set<string>()
  for (const ref of refs) {
    const key = `${norm(ref.attrs?.['type'] ?? '').toLowerCase()} ${norm(ref.attrs?.['href'] ?? '').toLowerCase()}`
    if (seen.has(key)) {
      messages.push(
        msg(
          'RSC-017',
          ref.loc,
          'Duplicate "reference" elements with the same "type" and "href" attributes',
        ),
      )
    }
    seen.add(key)
  }
  return messages
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/schema/schematron.test.ts && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/schema/schematron.ts src/schema/schematron.test.ts src/messages/catalog.ts
git commit -m "feat: OPF schematron rules (unique id, duplicate guide reference)"
```

---
### Task 11: The differential harness

This was scratch work in PR #2 and PR #28 and was lost both times. It is committed now.

**Files:**
- Create: `test/differential/harness.ts`, `test/differential/cases.ts`, `test/differential/differential.test.ts`
- Modify: `README.md` (a short "Differential testing" section)

**Interfaces:**
- Produces: `runJar(epub)`, `runTs(epub)`, `diffCase(c)`, `CASES: DiffCase[]`.

- [ ] **Step 1: Write the harness**

Create `test/differential/harness.ts`:

```ts
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateEpub } from '../../src/index.js'

export interface Emitted {
  id: string
  severity: string
  message: string
}

export interface DiffCase {
  name: string
  epub: Uint8Array
}

export interface CaseResult {
  name: string
  jar: Emitted[]
  ts: Emitted[]
  match: boolean
}

/** Is the real EPUBCheck jar on PATH? CI without it skips the whole suite. */
export function jarAvailable(): boolean {
  try {
    execFileSync('epubcheck', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** Run the real EPUBCheck and return its messages in report order. */
export function runJar(epub: Uint8Array): Emitted[] {
  const dir = mkdtempSync(join(tmpdir(), 'epubcheck-diff-'))
  const file = join(dir, 'book.epub')
  writeFileSync(file, epub)
  let out = ''
  try {
    out = execFileSync('epubcheck', [file, '--json', '-'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 32 * 1024 * 1024,
    })
  } catch (e) {
    out = (e as { stdout?: string }).stdout ?? ''
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  const start = out.indexOf('{')
  if (start < 0) return []
  const report = JSON.parse(out.slice(start)) as {
    messages?: { ID: string; severity: string; message: string }[]
  }
  return (report.messages ?? []).map((m) => ({
    id: m.ID,
    severity: m.severity,
    message: m.message.replace(/\s+/g, ' ').trim(),
  }))
}

/** Run epubcheck-ts over the same bytes. */
export async function runTs(epub: Uint8Array): Promise<Emitted[]> {
  const report = await validateEpub(epub)
  return report.messages.map((m) => ({
    id: m.id,
    severity: m.severity,
    message: m.message.replace(/\s+/g, ' ').trim(),
  }))
}

/**
 * Message ids EPUBCheck emits that epubcheck-ts does not implement at all. These are
 * filtered from the jar side before comparing, so the harness measures parity on the
 * rules we claim to cover rather than failing on known gaps. Add an id here ONLY when
 * the rule is genuinely out of scope, with a comment saying why.
 */
export const KNOWN_UNIMPLEMENTED = new Set<string>([
  // Populated during Task 13 Step 4 from the first full harness run.
])

/** Compare id, severity and wording as an order-insensitive multiset. */
export async function diffCase(c: DiffCase): Promise<CaseResult> {
  const jar = runJar(c.epub).filter((m) => !KNOWN_UNIMPLEMENTED.has(m.id))
  const ts = await runTs(c.epub)
  const key = (e: Emitted) => `${e.severity} ${e.id} ${e.message}`
  const a = jar.map(key).sort()
  const b = ts.map(key).sort()
  return { name: c.name, jar, ts, match: JSON.stringify(a) === JSON.stringify(b) }
}
```

- [ ] **Step 2: Write the case set**

Create `test/differential/cases.ts`. Port every probe behind the design doc. Structure:

```ts
import { buildEpub, buildEpub2, OPF, OPF2 } from '../fixtures/build.js'
import type { DiffCase } from './harness.js'

const NS_ALL =
  'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf" ' +
  'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"'

/** OPF2 with opf:/xsi: declared, then `find` replaced by `repl`. */
function opf2(find: string, repl: string): Uint8Array {
  const base = OPF2.replace('xmlns:dc="http://purl.org/dc/elements/1.1/"', NS_ALL)
  if (!base.includes(find)) throw new Error(`OPF2 does not contain: ${find}`)
  return buildEpub2({ files: { 'EPUB/package.opf': base.replace(find, repl) } })
}

function opf3(find: string, repl: string): Uint8Array {
  if (!OPF.includes(find)) throw new Error(`OPF does not contain: ${find}`)
  return buildEpub({ files: { 'EPUB/package.opf': OPF.replace(find, repl) } })
}

const TITLE = '<dc:title>Title</dc:title>'
const IDENT = '<dc:identifier id="uid">urn:uuid:00000000-0000-0000-0000-000000000000</dc:identifier>'
const LANG = '<dc:language>en</dc:language>'
const ITEM = '<item id="content" href="content_001.xhtml" media-type="application/xhtml+xml"/>'
const GUIDE = '<guide><reference type="text" title="Text" href="content_001.xhtml"/></guide>'

export const CASES: DiffCase[] = [
  { name: 'epub2 baseline', epub: buildEpub2() },
  { name: 'epub3 baseline', epub: buildEpub() },

  // package
  { name: 'package unknown attr', epub: opf2('version="2.0"', 'version="2.0" prefix="foo: http://x"') },
  { name: 'package epub3 i18n attrs', epub: opf2('version="2.0"', 'version="2.0" dir="ltr" xml:lang="en"') },
  { name: 'package no unique-identifier', epub: opf2(' unique-identifier="uid"', '') },

  // dc:* attribute models
  { name: 'dc:creator opf:role + opf:file-as', epub: opf2(TITLE, `${TITLE}<dc:creator opf:role="aut" opf:file-as="D, J">J D</dc:creator>`) },
  { name: 'dc:date opf:event', epub: opf2(TITLE, `${TITLE}<dc:date opf:event="publication">2001-01-01</dc:date>`) },
  { name: 'dc:identifier opf:scheme', epub: opf2(IDENT, '<dc:identifier id="uid" opf:scheme="uuid">urn:uuid:00000000-0000-0000-0000-000000000000</dc:identifier>') },
  { name: 'dc:subject opf:authority', epub: opf2(TITLE, `${TITLE}<dc:subject opf:authority="BISAC">FIC000000</dc:subject>`) },
  { name: 'dc:title opf:file-as', epub: opf2(TITLE, '<dc:title opf:file-as="Title, The">Title</dc:title>') },
  { name: 'dc:creator unprefixed role', epub: opf2(TITLE, `${TITLE}<dc:creator role="aut">J D</dc:creator>`) },
  { name: 'dc:language xml:lang', epub: opf2(LANG, '<dc:language xml:lang="en">en</dc:language>') },
  { name: 'dc:identifier empty', epub: opf2(IDENT, '<dc:identifier id="uid"></dc:identifier>') },
  { name: 'dc:isbn unknown element', epub: opf2(TITLE, `${TITLE}<dc:isbn>123</dc:isbn>`) },
  { name: 'dc:title child element', epub: opf2(TITLE, '<dc:title>Title<b>x</b></dc:title>') },
  { name: 'dc:creator attr order probe A', epub: opf2(TITLE, `${TITLE}<dc:creator opf:file-as="D" bogus="x" opf:role="aut">J</dc:creator>`) },
  { name: 'dc:creator attr order probe B', epub: opf2(TITLE, `${TITLE}<dc:creator bogus="x" opf:file-as="D" opf:role="aut">J</dc:creator>`) },

  // meta — the PR #28 regression pair
  { name: 'meta property first', epub: opf2(TITLE, `${TITLE}<meta property="dcterms:modified" name="n" content="c"/>`) },
  { name: 'meta property last', epub: opf2(TITLE, `${TITLE}<meta name="n" content="c" property="dcterms:modified"/>`) },
  { name: 'meta bare property', epub: opf2(TITLE, `${TITLE}<meta property="dcterms:modified">2020-01-01T00:00:00Z</meta>`) },
  { name: 'meta valid', epub: opf2(TITLE, `${TITLE}<meta name="cover" content="content"/>`) },

  // manifest / item
  { name: 'item properties', epub: opf2(ITEM, ITEM.replace('/>', ' properties="nav"/>')) },
  { name: 'item missing media-type', epub: opf2(ITEM, '<item id="content" href="content_001.xhtml"/>') },
  { name: 'item missing id and href', epub: opf2(ITEM, '<item media-type="application/xhtml+xml"/>') },
  { name: 'item required-modules alone', epub: opf2(ITEM, ITEM.replace('/>', ' required-modules="mod"/>')) },
  { name: 'item text content', epub: opf2(ITEM, ITEM.replace('/>', '>x</item>')) },
  { name: 'item id not an NCName', epub: opf2(ITEM, ITEM.replace('id="content"', 'id="1"')) },
  { name: 'manifest unknown attr', epub: opf2('<manifest>', '<manifest foo="1">') },
  { name: 'manifest non-item child', epub: opf2('<manifest>', '<manifest><bogus/>') },
  { name: 'duplicate id', epub: opf2(ITEM, ITEM.replace('id="content"', 'id="ncx"')) },

  // spine / itemref
  { name: 'spine missing toc', epub: opf2('<spine toc="ncx">', '<spine>') },
  { name: 'itemref properties', epub: opf2('<itemref idref="content"/>', '<itemref idref="content" properties="page-spread-left"/>') },
  { name: 'itemref linear invalid', epub: opf2('<itemref idref="content"/>', '<itemref idref="content" linear="maybe"/>') },
  { name: 'itemref missing idref', epub: opf2('<itemref idref="content"/>', '<itemref/>') },
  { name: 'spine empty', epub: opf2('<itemref idref="content"/>', '') },
  { name: 'spine non-itemref child', epub: opf2('<itemref idref="content"/>', '<itemref idref="content"/><bogus/>') },

  // guide / reference / tours
  { name: 'reference unknown type', epub: opf2(GUIDE, '<guide><reference type="banana" title="B" href="content_001.xhtml"/></guide>') },
  { name: 'reference no title', epub: opf2(GUIDE, '<guide><reference type="text" href="content_001.xhtml"/></guide>') },
  { name: 'reference missing type', epub: opf2(GUIDE, '<guide><reference title="T" href="content_001.xhtml"/></guide>') },
  { name: 'guide empty', epub: opf2(GUIDE, '<guide></guide>') },
  { name: 'duplicate reference', epub: opf2(GUIDE, '<guide><reference type="text" title="T" href="content_001.xhtml"/><reference type="TEXT" title="T2" href="content_001.xhtml"/></guide>') },
  { name: 'tours valid', epub: opf2(GUIDE, `<tours><tour id="t1" title="Tour"><site title="S" href="content_001.xhtml"/></tour></tours>${GUIDE}`) },
  { name: 'tours empty', epub: opf2(GUIDE, `<tours></tours>${GUIDE}`) },
  { name: 'tour missing title', epub: opf2(GUIDE, `<tours><tour><site title="S" href="content_001.xhtml"/></tour></tours>${GUIDE}`) },

  // ordering
  { name: 'guide before spine', epub: opf2(`<spine toc="ncx"><itemref idref="content"/></spine>${GUIDE}`, `${GUIDE}<spine toc="ncx"><itemref idref="content"/></spine>`) },
  { name: 'tours after guide', epub: opf2(GUIDE, `${GUIDE}<tours><tour title="T"><site title="S" href="content_001.xhtml"/></tour></tours>`) },
  { name: 'unknown top-level element', epub: opf2('</package>', '<bogus/></package>') },
  { name: 'foreign-ns top-level element', epub: opf2('</package>', '<x:foo xmlns:x="http://example.com/x"/></package>') },

  // metadata model
  { name: 'metadata shuffled order', epub: opf2(`${IDENT}${TITLE}${LANG}`, `${LANG}${TITLE}${IDENT}`) },
  { name: 'metadata foreign-ns child', epub: opf2(TITLE, `${TITLE}<x:foo xmlns:x="http://example.com/x">v</x:foo>`) },
  { name: 'metadata no dc:title', epub: opf2(TITLE, '') },
  { name: 'metadata empty', epub: opf2(`${IDENT}${TITLE}${LANG}`, '') },

  // EPUB 3
  { name: 'epub3 item unknown attr', epub: opf3('media-type="application/xhtml+xml" properties="nav"', 'media-type="application/xhtml+xml" properties="nav" bogus="x"') },
  { name: 'epub3 dir invalid', epub: opf3('<dc:title>Title</dc:title>', '<dc:title dir="sideways">Title</dc:title>') },
  { name: 'epub3 legacy name/content meta', epub: opf3('</metadata>', '<meta name="cover" content="content"/></metadata>') },
  { name: 'epub3 spine ppd', epub: opf3('<spine>', '<spine page-progression-direction="rtl">') },
  { name: 'epub3 link element', epub: opf3('</metadata>', '<link rel="cc:license" href="http://example.com/l"/></metadata>') },
  { name: 'epub3 no dc:title', epub: opf3('<dc:title>Title</dc:title>', '') },

  // vendor-realistic (must stay clean)
  ...realistic(),
]

/** Realistic producer output. These must report zero messages from both validators. */
function realistic(): DiffCase[] {
  const uid = '<dc:identifier id="uid" opf:scheme="uuid">urn:uuid:00000000-0000-0000-0000-000000000000</dc:identifier>'
  return [
    {
      name: 'realistic calibre',
      epub: opf2(
        `${IDENT}${TITLE}${LANG}`,
        `${TITLE}<dc:creator opf:file-as="Doe, Jane" opf:role="aut">Jane Doe</dc:creator>` +
          `<dc:contributor opf:file-as="calibre" opf:role="bkp">calibre (3.48.0)</dc:contributor>` +
          `<dc:date>2019-01-01T00:00:00+00:00</dc:date>${LANG}${uid}` +
          `<meta name="calibre:timestamp" content="2019-01-01T00:00:00+00:00"/>` +
          `<meta name="cover" content="content"/>`,
      ),
    },
    {
      name: 'realistic sigil',
      epub: opf2(
        `${IDENT}${TITLE}${LANG}`,
        `${uid}${TITLE}${LANG}<dc:creator opf:role="aut">Jane Doe</dc:creator>` +
          `<dc:publisher>Pub</dc:publisher><dc:date opf:event="publication">2019</dc:date>` +
          `<dc:rights>All rights reserved</dc:rights><dc:subject>Fiction</dc:subject>`,
      ),
    },
    {
      name: 'realistic indesign',
      epub: opf2(
        `${IDENT}${TITLE}${LANG}`,
        `${uid}${TITLE}${LANG}<dc:creator>Jane Doe</dc:creator>` +
          `<dc:date xsi:type="dcterms:W3CDTF">2019-01-01</dc:date>` +
          `<meta name="cover" content="content"/>`,
      ),
    },
  ]
}
```

- [ ] **Step 3: Write the runner**

Create `test/differential/differential.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { CASES } from './cases.js'
import { diffCase, jarAvailable } from './harness.js'

/**
 * Differential parity against the real EPUBCheck jar. This is a verification tool,
 * not a unit test: it needs `epubcheck` on PATH (`brew install epubcheck`) and is
 * opt-in via EPUBCHECK_DIFF=1 so CI without the jar stays green.
 *
 *   EPUBCHECK_DIFF=1 npx vitest run test/differential
 */
const enabled = process.env['EPUBCHECK_DIFF'] === '1' && jarAvailable()

describe.skipIf(!enabled)('differential parity with EPUBCheck 5.3.0', () => {
  for (const c of CASES) {
    it(c.name, async () => {
      const result = await diffCase(c)
      expect(result.ts.map((m) => `${m.severity} ${m.id} ${m.message}`).sort()).toEqual(
        result.jar.map((m) => `${m.severity} ${m.id} ${m.message}`).sort(),
      )
    }, 60_000)
  }
})
```

- [ ] **Step 4: Run the harness and record the BASELINE parity**

Run: `EPUBCHECK_DIFF=1 npx vitest run test/differential 2>&1 | tail -80`

The schema layer is **not wired in yet** — that happens in Task 12 — so most cases are
expected to fail here. That is the point: this run establishes the *before* number.

Two things to do, and only these two:

1. **Record the baseline parity count** (`N/M` cases matching) in the commit message.
   Task 13 records the *after* count, and the pair goes in the PR summary.
2. **Populate `KNOWN_UNIMPLEMENTED`.** Scan the failures for message ids the jar emits
   that epubcheck-ts does not implement at all — check each candidate against
   `test/fixtures/implemented.ts`, and add only ids absent from `IMPLEMENTED_IDS`,
   each with a comment naming the rule. This makes the harness measure parity on the
   rules we claim to cover.

Do **not** change any grammar, message or driver code in this task. Wording mismatches
are Task 12's and Task 13's business, once the layer is actually running.

- [ ] **Step 5: Document and commit**

Add to `README.md` under the existing testing notes:

```markdown
### Differential testing

`test/differential` compares our output against the real EPUBCheck jar case by case.

```bash
brew install epubcheck
EPUBCHECK_DIFF=1 npx vitest run test/differential
```

It is skipped unless `EPUBCHECK_DIFF=1` is set and `epubcheck` is on PATH, so CI without
the jar stays green.
```

Verify the default suite is unaffected before committing:

Run: `npm test && npm run lint && npm run typecheck`
Expected: PASS, with the differential suite skipped (no `EPUBCHECK_DIFF`).

```bash
git add test/differential README.md
git commit -m "test: differential harness against the EPUBCheck jar (baseline parity N/M)"
```

---

### Task 12: Wire in the schema layer and retire the hand-written approximations

This is one atomic behaviour change: the schema layer starts emitting, and the six
hand-written checks it subsumes stop. Splitting it would leave a commit where both
fire and every EPUB reports its schema failures twice, so it lands together and the
suite is green at the end.

**Files:**
- Modify: `src/parse/opf.ts` (add `root`, remove `metas`/`OpfMeta`/`schemaAttrs`)
- Create: `src/checks/schema.ts`
- Modify: `src/validate.ts`, `src/checks/opf.ts`, `src/checks/opf.test.ts`, `src/parse/opf.test.ts`
- Modify: `test/fixtures/implemented.ts`, `test/fixtures/corpus.ts`, `test/integration/**`
- Test: `src/checks/schema.test.ts`

**Interfaces:**
- Consumes: `OPF20`, `PACKAGE30`, `validateAgainst`, `checkUniqueIds`, `checkDuplicateReferences`.
- Produces: `PackageDocument.root: XmlNode`; `validateSchema(pkg, version): Message[]`.


**Files:**
- Modify: `src/parse/opf.ts` (add `root`, remove `metas`/`OpfMeta`/`schemaAttrs`)
- Create: `src/checks/schema.ts`
- Modify: `src/validate.ts`
- Test: `src/checks/schema.test.ts`, and update `src/parse/opf.test.ts`

**Interfaces:**
- Consumes: `OPF20`, `PACKAGE30`, `validateAgainst`, `checkUniqueIds`, `checkDuplicateReferences`.
- Produces: `PackageDocument.root: XmlNode`; `validateSchema(pkg, version): Message[]`.

- [ ] **Step 1: Write the failing test**

Create `src/checks/schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseXml } from '../io/xml.js'
import { validateSchema } from './schema.js'
import type { PackageDocument } from '../parse/opf.js'

const OPF_NS = 'http://www.idpf.org/2007/opf'
const DC_NS = 'http://purl.org/dc/elements/1.1/'

const pkgDoc = (xml: string): PackageDocument =>
  ({
    path: 'EPUB/package.opf',
    root: parseXml(new TextEncoder().encode(xml), 'EPUB/package.opf').root!,
  }) as PackageDocument

const EPUB2 =
  `<package xmlns="${OPF_NS}" xmlns:dc="${DC_NS}" version="2.0" unique-identifier="uid">` +
  `<metadata><dc:identifier id="uid">u</dc:identifier><dc:title>T</dc:title><dc:language>en</dc:language></metadata>` +
  `<manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest>` +
  `<spine toc="ncx"><itemref idref="ncx"/></spine></package>`

const EPUB3 =
  `<package xmlns="${OPF_NS}" xmlns:dc="${DC_NS}" version="3.0" unique-identifier="uid">` +
  `<metadata><dc:identifier id="uid">u</dc:identifier><dc:title>T</dc:title><dc:language>en</dc:language>` +
  `<meta property="dcterms:modified">2019-01-01T00:00:00Z</meta></metadata>` +
  `<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest>` +
  `<spine><itemref idref="nav"/></spine></package>`

describe('validateSchema', () => {
  it('validates an EPUB 2 package against opf20', () => {
    expect(validateSchema(pkgDoc(EPUB2), '2.0')).toEqual([])
    expect(
      validateSchema(pkgDoc(EPUB2.replace('<spine toc="ncx">', '<spine>')), '2.0').map((m) => m.message),
    ).toEqual([
      "Error while parsing file 'EPUB/package.opf': element \"spine\" missing required attribute \"toc\"",
    ])
  })

  it('validates an EPUB 3 package against package-30', () => {
    expect(validateSchema(pkgDoc(EPUB3), '3.3')).toEqual([])
  })

  it('treats an unknown version as EPUB 3, matching the dcterms:modified gating', () => {
    expect(validateSchema(pkgDoc(EPUB3), undefined)).toEqual([])
  })

  it('applies the unique-id schematron rule', () => {
    const dup = EPUB2.replace('id="ncx"', 'id="uid"')
    expect(validateSchema(pkgDoc(dup), '2.0').filter((m) => m.message.includes('unique value'))).toHaveLength(2)
  })

  it('applies the duplicate-reference rule only to EPUB 2', () => {
    const withGuide = EPUB2.replace(
      '</package>',
      '<guide><reference type="text" href="a"/><reference type="text" href="a"/></guide></package>',
    )
    const messages = validateSchema(pkgDoc(withGuide), '2.0')
    expect(messages.filter((m) => m.id === 'RSC-017')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/checks/schema.test.ts`
Expected: FAIL — cannot resolve `./schema.js`.

- [ ] **Step 3: Implement**

In `src/parse/opf.ts`:

1. Delete the `OpfMeta` interface, the `metas` field, the `schemaAttrs` helper, and the `metas.push({...})` block inside the metadata loop. Delete the now-unused `OPF_NS` constant if nothing else uses it.
2. Add to `PackageDocument`, after `path`:

```ts
  /**
   * The parsed package document, retained so the schema layer can validate the
   * whole tree. The typed projections below stay for the semantic checks.
   */
  root: XmlNode
```

3. Add `root,` to the `pkg` object literal (after `path: opfPath,`).
4. Ensure `XmlNode` is imported as a type: the existing import becomes
   `import { parseXml, childElements, type XmlNode } from '../io/xml.js'` (it already is).

Create `src/checks/schema.ts`:

```ts
import type { Message } from '../messages/format.js'
import type { PackageDocument } from '../parse/opf.js'
import { majorVersion, type EpubVersion } from '../versions.js'
import { validateAgainst } from '../schema/validate.js'
import { OPF20 } from '../schema/opf20.js'
import { PACKAGE30 } from '../schema/package30.js'
import { checkDuplicateReferences, checkUniqueIds } from '../schema/schematron.js'

/**
 * Validate the package document against its RelaxNG grammar, the way EPUBCheck does.
 * An unknown version is treated as EPUB 3, matching the gating the dcterms:modified
 * rule and checkEpub2 already use.
 */
export function validateSchema(pkg: PackageDocument, version: EpubVersion | undefined): Message[] {
  const isEpub2 = version !== undefined && majorVersion(version) === '2.0'
  const grammar = isEpub2 ? OPF20 : PACKAGE30

  const messages: Message[] = [
    ...validateAgainst(grammar, pkg.root, pkg.path),
    ...checkUniqueIds(pkg.root, pkg.path),
  ]
  // opf_guideReferenceUnique is in schema/20/sch/opf.sch only.
  if (isEpub2) messages.push(...checkDuplicateReferences(pkg.root, pkg.path))
  return messages
}
```

In `src/validate.ts`:

1. Add the import: `import { validateSchema } from './checks/schema.js'`
2. Inside `if (pkg) { ... }`, immediately after `messages.push(...validateOpf(pkg, container, target))`, add:

```ts
      messages.push(...validateSchema(pkg, target))
```

In `src/parse/opf.test.ts`, delete the `metas` describe block added by PR #28 and add:

```ts
  it('retains the parsed root for the schema layer', () => {
    const { pkg } = parseOpf(containerWith(OPF))
    expect(pkg!.root.name).toBe('package')
  })
```

(adapting `containerWith` to whatever helper that file already uses).


- [ ] **Step 4: Delete the superseded checks**

- [ ] **Step 2: Delete the superseded code**

In `src/checks/opf.ts`:

1. Delete `OPF2_META_REQUIRED_ATTRS`, `OPF2_META_ALLOWED_ATTRS`, `quotedList` and the whole `checkEpub2Metas` function, plus the `messages.push(...checkEpub2Metas(pkg))` call and its comment inside `checkEpub2`.
2. In `checkPackage`, delete the three `RSC-005` pushes for missing `dc:identifier` / `dc:title` / `dc:language` (the schema layer emits `element "metadata" incomplete; missing required element "dc:title"`). Keep `OPF-048`, `OPF-030` and the `dcterms:modified` rule, which are not RNG-derived.
3. In `checkManifest`, delete the `RSC-005` push for a missing `id`/`href`/`media-type` and the `Duplicate manifest item id` push (keep the `seenIds` set only if still used; if not, delete it too). Keep `OPF-040`, `OPF-074`, `OPF-099` and `RSC-001`.
4. In `checkSpineAndNav`, delete the `spinePresent` and `spine.length === 0` `RSC-005` pushes and restructure to:

```ts
  const ids = new Set(pkg.manifest.map((i) => i.id).filter((id): id is string => Boolean(id)))
  for (const ref of pkg.spine) {
    if (ref.idref && !ids.has(ref.idref)) {
      messages.push(msg('OPF-049', ref.loc, ref.idref))
    }
  }
  if (pkg.spine.length > 0 && !pkg.spine.some((s) => s.linear)) {
    messages.push(msg('OPF-033', pkg.loc))
  }
```

5. In `checkEpub2`, delete the `RSC-005` push for a missing `toc` attribute, keeping the `OPF-049`/`OPF-050` branches:

```ts
  if (pkg.spinePresent && pkg.spineToc !== undefined) {
    const tocItem = byId.get(pkg.spineToc)
    if (tocItem === undefined) {
      messages.push(msg('OPF-049', pkg.spineLoc ?? pkg.loc, pkg.spineToc))
    } else if (tocItem.mediaType !== NCX_MEDIA_TYPE) {
      messages.push(msg('OPF-050', tocItem.loc))
    }
  }
```

- [ ] **Step 3: Update the unit tests**

In `src/checks/opf.test.ts`, delete the `checkEpub2Metas` describe block added by PR #28 and any assertion on the six deleted message strings. Assertions on `OPF-*` ids stay.


- [ ] **Step 5: Add RSC-017 to the implemented set**

In `test/fixtures/implemented.ts`, add `'RSC-017'` to the resources line if absent.

- [ ] **Step 6: Rebaseline existing expectations against the jar**

Run: `npm test 2>&1 | tail -60`

Existing corpus and integration expectations will fail where the schema layer
legitimately adds messages — a missing `unique-identifier`, for example, now gains an
`RSC-005` alongside today's `OPF-048`/`OPF-030`.

For **every** failing expectation, confirm the new output against the jar before
changing it. The harness from Task 11 is the tool:

```bash
EPUBCHECK_DIFF=1 npx vitest run test/differential
```

If a fixture has no differential case, add one to `test/differential/cases.ts` rather
than guessing. Take the id/severity multiset from the jar's output, filtered to ids in
`IMPLEMENTED_IDS`.

**Change the fixture's `expected`, never the assertion logic.** A rebaseline that is
not justified by jar output is a bug being enshrined. Add a comment on any non-obvious
one:

```ts
    // The schema layer now also reports the RNG failure the jar emits alongside
    // OPF-048/OPF-030 for a missing unique-identifier.
```

If a failure is a message the jar does **not** emit, that is a false positive in the
new code — fix the grammar or driver, or add the detail to `SUPPRESSED` in
`src/schema/validate.ts` with a comment. Do not rebaseline it away.

- [ ] **Step 7: Run everything**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all green. Record the test count; the baseline before this plan was 374.

- [ ] **Step 8: Commit**

```bash
git add src/parse/opf.ts src/parse/opf.test.ts src/checks/schema.ts src/checks/schema.test.ts \
        src/checks/opf.ts src/checks/opf.test.ts src/validate.ts \
        test/fixtures/implemented.ts test/fixtures/corpus.ts test/integration
git commit -m "feat: validate package documents against their RelaxNG grammar

Retires six hand-written approximations the schema layer now covers, and
rebaselines corpus expectations against EPUBCheck 5.3.0 output."
```

---
### Task 13: New corpus fixtures

Task 12 rebaselined the *existing* fixtures. This task adds the new valid/invalid pairs
that lock in the content model, and records the final differential parity.

**Files:**
- Modify: `test/fixtures/corpus.ts`

- [ ] **Step 1: Add fixture pairs**

Append to `test/fixtures/corpus.ts`, following the file's existing `{ area, name, epub, expected }` shape.

First add these local helpers near the other EPUB 2 fixtures in that file (mirroring
`test/differential/cases.ts` so the two stay recognisably the same fixtures):

```ts
const SCHEMA_NS =
  'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf" ' +
  'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"'

/** OPF2 with opf:/xsi: declared, then `find` replaced by `repl`. */
function schemaEpub2(find: string, repl: string): Uint8Array {
  const base = OPF2.replace('xmlns:dc="http://purl.org/dc/elements/1.1/"', SCHEMA_NS)
  if (!base.includes(find)) throw new Error(`OPF2 does not contain: ${find}`)
  return buildEpub2({ files: { 'EPUB/package.opf': base.replace(find, repl) } })
}

const S_TITLE = '<dc:title>Title</dc:title>'
const S_IDENT = '<dc:identifier id="uid">urn:uuid:00000000-0000-0000-0000-000000000000</dc:identifier>'
const S_LANG = '<dc:language>en</dc:language>'
const S_ITEM = '<item id="content" href="content_001.xhtml" media-type="application/xhtml+xml"/>'
const S_GUIDE = '<guide><reference type="text" title="Text" href="content_001.xhtml"/></guide>'
```

Then append the fixtures. The "clean" entries pin zero output, which is what makes
them load-bearing against future false positives:

```ts
  // --- OPF 2.0 content model (schema layer) ---
  {
    area: 'opf2-schema',
    name: 'realistic calibre metadata is clean',
    epub: schemaEpub2(
      `${S_IDENT}${S_TITLE}${S_LANG}`,
      `${S_TITLE}<dc:creator opf:file-as="Doe, Jane" opf:role="aut">Jane Doe</dc:creator>` +
        `<dc:contributor opf:file-as="calibre" opf:role="bkp">calibre (3.48.0)</dc:contributor>` +
        `<dc:date>2019-01-01T00:00:00+00:00</dc:date>${S_LANG}` +
        `<dc:identifier id="uid" opf:scheme="uuid">urn:uuid:00000000-0000-0000-0000-000000000000</dc:identifier>` +
        `<meta name="calibre:timestamp" content="2019-01-01T00:00:00+00:00"/>` +
        `<meta name="cover" content="content"/>`,
    ),
    expected: [],
  },
  {
    area: 'opf2-schema',
    name: 'realistic sigil metadata is clean',
    epub: schemaEpub2(
      `${S_IDENT}${S_TITLE}${S_LANG}`,
      `${S_IDENT}${S_TITLE}${S_LANG}<dc:creator opf:role="aut">Jane Doe</dc:creator>` +
        `<dc:publisher>Pub</dc:publisher><dc:date opf:event="publication">2019</dc:date>` +
        `<dc:rights>All rights reserved</dc:rights><dc:subject>Fiction</dc:subject>`,
    ),
    expected: [],
  },
  {
    area: 'opf2-schema',
    name: 'foreign-namespace metadata child is clean',
    epub: schemaEpub2(S_TITLE, `${S_TITLE}<dcterms:modified xmlns:dcterms="http://purl.org/dc/terms/">2019-01-01T00:00:00Z</dcterms:modified>`),
    expected: [],
  },
  {
    area: 'opf2-schema',
    name: 'metadata children in any order are clean',
    epub: schemaEpub2(`${S_IDENT}${S_TITLE}${S_LANG}`, `${S_LANG}${S_TITLE}${S_IDENT}`),
    expected: [],
  },
  {
    area: 'opf2-schema',
    name: 'unknown guide reference type is clean',
    epub: schemaEpub2(S_GUIDE, '<guide><reference type="banana" href="content_001.xhtml"/></guide>'),
    expected: [],
  },
  {
    area: 'opf2-schema',
    name: 'tours are clean',
    epub: schemaEpub2(
      S_GUIDE,
      `<tours><tour id="t1" title="Tour"><site title="S" href="content_001.xhtml"/></tour></tours>${S_GUIDE}`,
    ),
    expected: [],
  },
  {
    area: 'opf2-schema',
    name: 'opf:file-as on dc:title is rejected',
    epub: schemaEpub2(S_TITLE, '<dc:title opf:file-as="Title, The">Title</dc:title>'),
    expected: [{ id: 'RSC-005', severity: 'ERROR' }],
  },
  {
    area: 'opf2-schema',
    name: 'dc:language xml:lang is rejected',
    epub: schemaEpub2(S_LANG, '<dc:language xml:lang="en">en</dc:language>'),
    expected: [{ id: 'RSC-005', severity: 'ERROR' }],
  },
  {
    area: 'opf2-schema',
    name: 'empty dc:identifier is rejected',
    epub: schemaEpub2(S_IDENT, '<dc:identifier id="uid"></dc:identifier>'),
    expected: [{ id: 'RSC-005', severity: 'ERROR' }],
  },
  {
    area: 'opf2-schema',
    name: 'missing dc:title is reported once',
    epub: schemaEpub2(S_TITLE, ''),
    expected: [{ id: 'RSC-005', severity: 'ERROR' }],
  },
  {
    area: 'opf2-schema',
    name: 'item properties attribute is rejected',
    epub: schemaEpub2(S_ITEM, S_ITEM.replace('/>', ' properties="nav"/>')),
    expected: [{ id: 'RSC-005', severity: 'ERROR' }],
  },
  {
    area: 'opf2-schema',
    name: 'itemref linear value is enumerated',
    epub: schemaEpub2('<itemref idref="content"/>', '<itemref idref="content" linear="maybe"/>'),
    expected: [{ id: 'RSC-005', severity: 'ERROR' }],
  },
  {
    area: 'opf2-schema',
    name: 'spine missing toc',
    epub: schemaEpub2('<spine toc="ncx">', '<spine>'),
    expected: [{ id: 'RSC-005', severity: 'ERROR' }],
  },
  {
    area: 'opf2-schema',
    name: 'guide reference missing type',
    epub: schemaEpub2(S_GUIDE, '<guide><reference title="T" href="content_001.xhtml"/></guide>'),
    expected: [{ id: 'RSC-005', severity: 'ERROR' }],
  },
  {
    area: 'opf2-schema',
    name: 'tour missing title',
    epub: schemaEpub2(
      S_GUIDE,
      `<tours><tour><site title="S" href="content_001.xhtml"/></tour></tours>${S_GUIDE}`,
    ),
    expected: [{ id: 'RSC-005', severity: 'ERROR' }],
  },
  {
    area: 'opf2-schema',
    name: 'duplicate guide reference warns',
    epub: schemaEpub2(
      S_GUIDE,
      '<guide><reference type="text" title="T" href="content_001.xhtml"/>' +
        '<reference type="TEXT" title="T2" href="content_001.xhtml"/></guide>',
    ),
    expected: [{ id: 'RSC-017', severity: 'WARNING' }],
  },
  {
    area: 'opf2-schema',
    name: 'guide before spine breaks package order',
    epub: schemaEpub2(
      `<spine toc="ncx"><itemref idref="content"/></spine>${S_GUIDE}`,
      `${S_GUIDE}<spine toc="ncx"><itemref idref="content"/></spine>`,
    ),
    expected: [
      { id: 'RSC-005', severity: 'ERROR' },
      { id: 'RSC-005', severity: 'ERROR' },
    ],
  },
```

And the EPUB 3 equivalents, using the existing `buildEpub`/`OPF` helpers:

```ts
  // --- package-30 content model (schema layer) ---
  {
    area: 'opf3-schema',
    name: 'legacy name/content meta is clean in EPUB 3',
    epub: buildEpub({
      files: {
        'EPUB/package.opf': OPF.replace('</metadata>', '<meta name="cover" content="content"/></metadata>'),
      },
    }),
    expected: [],
  },
  {
    area: 'opf3-schema',
    name: 'metadata link is clean',
    epub: buildEpub({
      files: {
        'EPUB/package.opf': OPF.replace(
          '</metadata>',
          '<link rel="cc:license" href="http://example.com/l"/></metadata>',
        ),
      },
    }),
    expected: [],
  },
  {
    area: 'opf3-schema',
    name: 'page-progression-direction is clean',
    epub: buildEpub({
      files: { 'EPUB/package.opf': OPF.replace('<spine>', '<spine page-progression-direction="rtl">') },
    }),
    expected: [],
  },
  {
    area: 'opf3-schema',
    name: 'unknown attribute on item is rejected',
    epub: buildEpub({
      files: { 'EPUB/package.opf': OPF.replace('properties="nav"', 'properties="nav" bogus="x"') },
    }),
    expected: [{ id: 'RSC-005', severity: 'ERROR' }],
  },
  {
    area: 'opf3-schema',
    name: 'dir outside its enumeration is rejected',
    epub: buildEpub({
      files: { 'EPUB/package.opf': OPF.replace('<dc:title>Title</dc:title>', '<dc:title dir="sideways">Title</dc:title>') },
    }),
    expected: [{ id: 'RSC-005', severity: 'ERROR' }],
  },
```

**Do not trust the counts above without checking.** They are the expected shape, but
`expected` is an exact multiset over *all* messages the fixture produces, so a fixture
may also carry `OPF-*` messages from the semantic checks. For each fixture, confirm
against the jar before accepting it:

```bash
EPUBCHECK_DIFF=1 npx vitest run test/differential -t '<case name>'
```

Take the id/severity multiset from the jar's output, filtered to ids in
`IMPLEMENTED_IDS`. If a fixture's real output differs from what is written above,
change the fixture's `expected` — never the assertion logic.

- [ ] **Step 2: Record the final differential parity**

Run: `EPUBCHECK_DIFF=1 npx vitest run test/differential 2>&1 | tail -80`

Record the `N/M` count. Task 11's commit message holds the baseline; this is the
*after* number, and the pair goes in the PR summary.

Any case still failing must be classified, not ignored:

- **wording differs on a message we emit** → fix the grammar or `messages.ts`.
- **we emit something the jar does not** → a false positive; fix it, or add the detail
  to `SUPPRESSED` in `src/schema/validate.ts` with a comment.
- **jar emits an id we do not implement** → add it to `KNOWN_UNIMPLEMENTED` with a
  comment, having confirmed it is absent from `IMPLEMENTED_IDS`.

- [ ] **Step 3: Run everything**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all green. Record the final test count for the PR summary (baseline was 374).

- [ ] **Step 4: Commit**

```bash
git add test/fixtures/corpus.ts test/differential src/schema
git commit -m "test: corpus fixtures pinning the OPF content model"
```

---

## Final verification

- [ ] `npm test` — all green; note the count against the 374 baseline.
- [ ] `npm run lint`, `npm run typecheck`, `npm run build` — all green.
- [ ] `EPUBCHECK_DIFF=1 npx vitest run test/differential` — record baseline and final parity.
- [ ] Write the PR summary covering: per-element migration impact, the before/after parity counts, everything in `SUPPRESSED` and why, everything in `KNOWN_UNIMPLEMENTED` and why, and which elements were left unvalidated because the false-positive risk outweighed the coverage.

---