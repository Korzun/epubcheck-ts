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
/**
 * `resolve` is called lazily to break a cycle in a recursive grammar production.
 * Callers MUST pass a stable function reference: either a memoized cell (a
 * module-level `const` closing over the built pattern) or the recursive builder
 * function itself, passed directly:
 *
 *   const p = ref(collectionPattern)           // safe: stable function reference
 *   const p = ref(() => collection)            // safe: arrow returns a stable const
 *   const p = ref(() => collectionPattern())   // UNSAFE: fresh arrow every call
 *
 * The middle form is what both grammars use (`ref(() => collection)` over a
 * module-level `const`): the arrow is allocated once and returns the same object
 * on every call. The unsafe form instead allocates a new closure (and a new
 * `Pattern` object graph) on every expansion, defeating identity-based cycle guards. The type system does
 * not enforce this — it is caller discipline. `walkGrammarElements` backstops
 * violations: it throws an actionable error rather than overflowing the stack.
 */
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

/** The display string EPUBCheck uses for a wildcard (foreign-namespace) name class. */
export const ANY_OTHER_NAMESPACE_DISPLAY = 'an element from another namespace'

export function displayOf(nc: NameClass): string {
  return nc.k === 'name' ? nc.display : ANY_OTHER_NAMESPACE_DISPLAY
}
