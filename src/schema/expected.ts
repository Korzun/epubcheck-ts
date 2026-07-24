import {
  ANY_OTHER_NAMESPACE_DISPLAY, deref, displayOf, nameMatches, nullable,
  type NameClass, type Pattern,
} from './pattern.js'

const WILDCARD = ANY_OTHER_NAMESPACE_DISPLAY

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

/**
 * Whether the pattern's current content position can consume a text node — i.e. a
 * reachable `text` or `data` pattern. Mirrors `collectElements`' traversal: an
 * `element` there is a boundary (the next thing accepted is that element, not
 * text), so element nodes contribute nothing. Drives the `or text` alternative
 * EPUBCheck appends for a text content model, e.g. `dc:title`'s
 * `expected the element end-tag or text`.
 */
export function acceptsText(p: Pattern): boolean {
  const d = deref(p)
  switch (d.k) {
    case 'text':
    case 'data':
      return true
    case 'choice':
    case 'interleave':
      return acceptsText(d.p1) || acceptsText(d.p2)
    case 'group':
      return acceptsText(d.p1) || (nullable(d.p1) && acceptsText(d.p2))
    case 'oneOrMore':
      return acceptsText(d.p)
    case 'after':
      return acceptsText(d.p1)
    default:
      return false
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
 * Drives `element "P" incomplete; missing required element(s) …`, which lists
 * every outstanding name, alphabetically — so the whole list is the caller's
 * message, not just its head.
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
 * Max `ref` expansions before `walkGrammarElements` gives up and throws. Real
 * grammars expand a `ref` a few dozen times at most, so this can only trip on a
 * `ref` thunk that keeps producing fresh patterns (unbounded genuine recursion).
 */
const REF_EXPANSION_LIMIT = 10000

/**
 * Visit every element name-class reachable in the grammar, short-circuiting the
 * moment `visit` returns true. Drives `grammarAcceptsElementName` — the
 * `not allowed anywhere` vs `not allowed here` split — and is written once so
 * the termination guards are reasoned about once.
 *
 * Two termination guards, for two different ways a grammar can be recursive:
 *  - `seen` guards by pattern OBJECT IDENTITY. This catches a memoized `ref` cell
 *    (resolve() always returns the same object) and, as a bonus, any sub-pattern
 *    reachable via more than one path.
 *  - `seenThunks` guards by the identity of a `ref`'s `resolve` FUNCTION. A
 *    self-recursive builder (e.g. `function collectionPattern() { return
 *    element(..., ref(collectionPattern)) }`) builds a fresh object graph on
 *    every call, so `seen` alone never re-hits and the walk would recurse
 *    until the stack overflows. `resolve` itself is a stable function
 *    reference (a named function or a module-level const arrow), so tracking
 *    it terminates for both construction styles.
 *
 * Both guards are defeated by wrapping the recursive call in a fresh arrow, e.g.
 * `ref(() => collectionPattern())`: that allocates a new `Pattern` AND a new
 * closure on every expansion, so neither `seen` nor `seenThunks` ever re-hits.
 * `REF_EXPANSION_LIMIT` above is a backstop for exactly that case: it turns an
 * eventual stack overflow (which gives no hint what to fix) into an immediate,
 * actionable error.
 *
 * The walk itself is written with an explicit worklist array rather than
 * recursive calls, on purpose: a runaway `ref` chain is a linear structure
 * (ref -> choice -> ref -> choice -> ...), so a recursive walk's native call
 * stack would grow one frame per expansion and hit the JS engine's own stack
 * limit (a bare RangeError, no message) at only a few thousand expansions —
 * well before `REF_EXPANSION_LIMIT` is reached. The explicit stack keeps
 * native call depth flat regardless of how many expansions occur, so the
 * counter above is what actually fires.
 */
function walkGrammarElements(root: Pattern, visit: (nc: NameClass) => boolean): void {
  const seen = new Set<Pattern>()
  const seenThunks = new Set<() => Pattern>()
  let refExpansions = 0
  const stack: Pattern[] = [root]
  while (stack.length > 0) {
    const p = stack.pop()!
    if (seen.has(p)) continue
    seen.add(p)
    if (p.k === 'ref') {
      if (seenThunks.has(p.resolve)) continue
      seenThunks.add(p.resolve)
      refExpansions++
      if (refExpansions > REF_EXPANSION_LIMIT) {
        throw new Error(
          'walkGrammarElements: a ref thunk keeps producing fresh patterns, so no cycle guard ' +
            'can fire (object identity and resolve-function identity are both defeated by ' +
            'a new object graph on every call). This usually means a recursive production ' +
            'was written as `ref(() => builder())`, wrapping the recursive call in a fresh ' +
            'arrow on every expansion. Fix it by memoizing the recursive production as a ' +
            'module-level `const` (a memoized cell), or by passing the builder function ' +
            'directly to ref, e.g. `ref(builder)` instead of `ref(() => builder())`.',
        )
      }
    }
    const d = deref(p)
    switch (d.k) {
      case 'element':
        if (visit(d.name)) return
        stack.push(d.p)
        break
      case 'attribute':
        break
      case 'choice':
      case 'group':
      case 'interleave':
      case 'after':
        stack.push(d.p1)
        stack.push(d.p2)
        break
      case 'oneOrMore':
        stack.push(d.p)
        break
      default:
    }
  }
}

/**
 * Whether SOME element name-class in the grammar — INCLUDING a foreign-namespace
 * wildcard — matches this `(ns, local)`. Drives the `here`/`anywhere` split: a
 * name is `here` (present in the grammar, just not valid at this position) when
 * this returns true, and `anywhere` only when nothing in the grammar could ever
 * match it. A foreign-namespace element at package level is `here`, because the
 * `anyNameExcept` wildcard inside `metadata` accepts it somewhere.
 */
export function grammarAcceptsElementName(
  root: Pattern,
  ns: string | undefined,
  local: string,
): boolean {
  let found = false
  walkGrammarElements(root, (nc) => (found = nameMatches(nc, ns, local)))
  return found
}
