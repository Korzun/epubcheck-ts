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
