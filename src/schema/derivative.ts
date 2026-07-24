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
