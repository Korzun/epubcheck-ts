import type { XmlNode, XmlAttr } from '../io/xml.js'
import { msg, type Message } from '../messages/format.js'
import {
  EMPTY, NOT_ALLOWED, after, choice, deref, group, interleave, nameMatches, nullable, oneOrMore,
  type Datatype, type Pattern,
} from './pattern.js'
import {
  attDeriv, endTagDeriv, startTagCloseDeriv, startTagOpenDeriv, textDeriv,
} from './derivative.js'
import {
  expectedAttributes, expectedElements, grammarNames, requiredAttributes, requiredElements,
} from './expected.js'
import {
  elementNotAllowedYet, incompleteExpected, incompleteMissingElement, invalidAttributeValue,
  invalidCharacterContent, missingAttributes, noAttributesAllowed, textNotAllowed, unknownAttribute,
  unknownElement,
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

/** What walking a start tag's attributes leaves behind. */
interface AttributeWalk {
  /** The pattern with every accepted attribute consumed. */
  pattern: Pattern
  /**
   * Names already reported for an invalid VALUE. They are still outstanding in
   * `pattern` (`attDeriv` rejected them) but must not be reported missing too.
   */
  invalidValued: readonly string[]
}

/** Qualified name as written, which is the form EPUBCheck echoes. */
function qnameOf(node: XmlNode): string {
  return node.prefix ? `${node.prefix}:${node.name}` : (node.name ?? '')
}

/**
 * The still-open content pattern inside an `after`. Everything a message needs to
 * describe — the expected list, and whether the end-tag is allowed — lives here:
 * an `after`'s second half is the PARENT's continuation, and `nullable(after)` is
 * false by definition, so asking the `after` itself would always answer "no
 * end-tag".
 */
function innerOf(p: Pattern): Pattern {
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

/** Close an element whose content was invalid, keeping the parent's continuation. */
function forceEnd(content: Pattern): Pattern {
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

/**
 * Like `startTagCloseDeriv`, but an attribute alternative that was never
 * satisfied is treated as satisfied rather than as `notAllowed`. See
 * `closeStartTag` for why.
 */
function forgiveAttributes(p: Pattern): Pattern {
  const d = deref(p)
  switch (d.k) {
    case 'after':
      return after(forgiveAttributes(d.p1), d.p2)
    case 'choice':
      return choice(forgiveAttributes(d.p1), forgiveAttributes(d.p2))
    case 'group':
      return group(forgiveAttributes(d.p1), forgiveAttributes(d.p2))
    case 'interleave':
      return interleave(forgiveAttributes(d.p1), forgiveAttributes(d.p2))
    case 'oneOrMore':
      return oneOrMore(forgiveAttributes(d.p))
    case 'attribute':
      return EMPTY
    default:
      return d
  }
}

/**
 * The content model to walk the element's children against.
 *
 * A start tag whose required attribute is missing leaves that `attribute` pattern
 * outstanding, and `startTagCloseDeriv` maps it to `notAllowed` — which the smart
 * constructors then propagate through the enclosing `group`/`interleave` until the
 * ENTIRE content model is `notAllowed`. Deriving children from that reports every
 * one of them as "not allowed", a false-positive cascade the jar does not produce:
 * `<spine>` without `toc` yields exactly one message and says nothing about its
 * `itemref` children.
 *
 * `startTagCloseDeriv` returning `notAllowed` can only be caused by an outstanding
 * attribute requirement (it rewrites nothing else, and the pattern was not
 * `notAllowed` when the start tag opened). So forgive that requirement and keep the
 * content model intact; the attribute problem itself is reported separately, one
 * line earlier, by `reportBadAttribute` or `reportMissingAttributes`.
 *
 * Those two do not cover every case: for a `choice` of required attributes with none
 * supplied, `collectRequired`'s choice-intersection finds nothing genuinely required,
 * so nothing is reported and the element is accepted silently. That is the known
 * exception, recorded in the task report rather than approximated with invented
 * wording.
 *
 * Only the attribute half is forgiven — the returned pattern still carries the
 * element's own content requirements, so `<spine/>` reports both its missing `toc`
 * and its missing `itemref`.
 */
function closeStartTag(afterAttrs: Pattern): Pattern {
  const closed = startTagCloseDeriv(afterAttrs)
  return closed.k === 'notAllowed' ? forgiveAttributes(afterAttrs) : closed
}

/**
 * Advance past outstanding required elements until `ns`/`local` would be accepted,
 * WITHOUT consuming it; `undefined` when no amount of skipping helps.
 *
 * This is the recovery for `element "c" not allowed yet; missing required element
 * "b"`: having reported the missing `b`, the walk carries on from the position `c`
 * was aiming at, so the real `<b/>` arriving later is itself reported as
 * out-of-place instead of silently re-satisfying a requirement we already
 * complained about. Element patterns are never descended into, so a `ref`-based
 * recursive grammar cannot loop here.
 */
function skipRequired(p: Pattern, ns: string | undefined, local: string): Pattern | undefined {
  const accepts = (q: Pattern): boolean => startTagOpenDeriv(q, ns, local).k !== 'notAllowed'
  const walk = (q: Pattern): Pattern | undefined => {
    const d = deref(q)
    if (accepts(d)) return d
    switch (d.k) {
      case 'after': {
        const s = walk(d.p1)
        return s && after(s, d.p2)
      }
      case 'group': {
        const s = walk(d.p1)
        if (s) return group(s, d.p2)
        // Nothing in p1 leads to the offender: forgive p1 whole and try p2.
        return walk(d.p2)
      }
      case 'choice':
        return walk(d.p1) ?? walk(d.p2)
      case 'interleave': {
        const a = walk(d.p1)
        if (a) return interleave(a, d.p2)
        const b = walk(d.p2)
        return b && interleave(d.p1, b)
      }
      case 'oneOrMore': {
        const s = walk(d.p)
        return s && group(s, choice(oneOrMore(d.p), EMPTY))
      }
      default:
        return undefined
    }
  }
  return walk(p)
}

/**
 * The datatype the failing value was checked against — the one belonging to the
 * attribute that actually failed, which is why the name class is matched here
 * rather than taking the first `data` in the pattern.
 */
function datatypeFor(p: Pattern, attr: XmlAttr): Datatype | undefined {
  const d = deref(p)
  switch (d.k) {
    case 'attribute': {
      if (!nameMatches(d.name, attr.ns, attr.local)) return undefined
      const inner = deref(d.p)
      return inner.k === 'data' ? inner.type : undefined
    }
    case 'choice':
    case 'group':
    case 'interleave':
      return datatypeFor(d.p1, attr) ?? datatypeFor(d.p2, attr)
    case 'after':
      // p2 is the parent's continuation, which holds no attributes of this element.
      return datatypeFor(d.p1, attr)
    case 'oneOrMore':
      return datatypeFor(d.p, attr)
    default:
      return undefined
  }
}

export function validateAgainst(grammar: Grammar, root: XmlNode, path: string): Message[] {
  const messages: Message[] = []
  const emit = (node: XmlNode, detail: string): void => {
    if (SUPPRESSED.includes(detail)) return
    messages.push(msg('RSC-005', node.loc, path, detail))
  }

  /**
   * Consume one element against `p`, returning the pattern that follows it.
   * Every failure is reported and then recovered from, so later siblings — and
   * the rest of this element's own start tag — are still checked.
   */
  const childDeriv = (p: Pattern, node: XmlNode): Pattern => {
    const opened = startTagOpenDeriv(p, node.ns, node.name ?? '')
    // An element the pattern does not accept is not descended into: the jar's
    // message is about this element's placement, and its children would all be
    // measured against a pattern that has nothing to say about them.
    if (opened.k === 'notAllowed') return recoverUnknownElement(p, node)
    const attrs = deriveAttributes(opened, node)
    reportMissingAttributes(attrs, node)
    const content = deriveChildren(closeStartTag(attrs.pattern), node)
    const ended = endTagDeriv(content)
    if (ended.k === 'notAllowed') {
      reportIncomplete(content, node)
      // Recover by closing the element anyway, keeping the continuation the
      // start tag established, so later siblings are still checked.
      return forceEnd(content)
    }
    return ended
  }

  /** Report an element the pattern rejected, and return the pattern to continue with. */
  const recoverUnknownElement = (p: Pattern, node: XmlNode): Pattern => {
    const qname = qnameOf(node)
    const expected = expectedElements(p)
    // "yet" when the name IS reachable later in this sequence but a required
    // predecessor is outstanding.
    const required = requiredElements(p)
    const skipped = skipRequired(p, node.ns, node.name ?? '')
    if (required.length > 0 && skipped && !expected.includes(qname)) {
      emit(node, elementNotAllowedYet(qname, required[0]!))
      return skipped
    }
    const scope = grammar.names.has(qname) ? 'here' : 'anywhere'
    emit(node, unknownElement(qname, scope, expected, nullable(innerOf(p))))
    // Leave the pattern unchanged, so the next sibling is measured against the
    // same position and reports the same expected list.
    return p
  }

  const deriveAttributes = (opened: Pattern, node: XmlNode): AttributeWalk => {
    let p = opened
    const invalidValued: string[] = []
    for (const attr of node.attributes ?? []) {
      const next = attDeriv(p, attr)
      if (next.k !== 'notAllowed') {
        p = next
        continue
      }
      if (reportBadAttribute(p, node, attr)) invalidValued.push(attr.qname)
      // Leave `p` unchanged: the jar reports the same expected list for a second
      // unknown attribute on the same element. Attributes accepted BEFORE this one
      // are already gone from `p`, which is the document-order narrowing the jar
      // shows on <dc:creator>.
    }
    return { pattern: p, invalidValued }
  }

  /** Reports the attribute; answers whether its VALUE, rather than its name, was at fault. */
  const reportBadAttribute = (p: Pattern, node: XmlNode, attr: XmlAttr): boolean => {
    // A declared attribute whose VALUE failed its datatype reports differently
    // from an undeclared one.
    const expected = expectedAttributes(p)
    if (expected.includes(attr.qname)) {
      const dt = datatypeFor(p, attr)
      if (dt) {
        emit(node, invalidAttributeValue(attr.qname, dt.describe(attr.value)))
        return true
      }
    }
    if (expected.length === 0) {
      emit(node, noAttributesAllowed(attr.qname))
      return false
    }
    emit(node, unknownAttribute(attr.qname, expected))
    return false
  }

  /**
   * A required attribute whose value failed its datatype stays outstanding in the
   * pattern — `attDeriv` rejected it — but it is NOT missing: it was written, and the
   * jar says so once. `<itemref idref="1"/>` yields the invalid-value message alone,
   * with no `missing required attribute "idref"` beside it.
   */
  const reportMissingAttributes = (attrs: AttributeWalk, node: XmlNode): void => {
    const missing = requiredAttributes(attrs.pattern)
      .filter((n) => !attrs.invalidValued.includes(n))
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
      // Every outstanding requirement, not just the first: the jar lists them all,
      // alphabetically and joined with `and`.
      emit(node, incompleteMissingElement(qnameOf(node), required))
      return
    }
    // No text was fed to `textDeriv` at all (the element was empty, or its only text
    // was whitespace that `parseXml` already discarded), yet a `data` datatype is
    // still outstanding: the element's string-value is the empty string, and the jar
    // reports that against the datatype rather than the generic "incomplete" shape —
    // the same way a bad attribute VALUE gets its own message via `datatypeFor`.
    if (inner.k === 'data') {
      emit(node, invalidCharacterContent(qnameOf(node), inner.type.describe('')))
      return
    }
    emit(node, incompleteExpected(qnameOf(node), expectedElements(inner), nullable(inner)))
  }

  childDeriv(grammar.root, root)
  return messages
}
