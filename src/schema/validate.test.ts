import { describe, it, expect } from 'vitest'
import { parseXml } from '../io/xml.js'
import {
  EMPTY, element, attribute, name, data, all, oneOrMore, optional, seq, group,
} from './pattern.js'
import { DT_TEXT, DT_ID, DT_IDREF } from './datatypes.js'
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

  it('reports an attribute on a model that declares none', () => {
    expect(runOrdered(`<pkg xmlns="${NS}"><a foo="1"/><b/></pkg>`)).toEqual([
      detail('found attribute "foo", but no attributes allowed here'),
    ])
  })
})

// A missing required attribute must not poison the element's content model:
// `<spine>` without `toc` reports exactly one message, and says nothing about
// its (valid) `itemref` children.
describe('missing required attribute does not cascade', () => {
  const SPINE = makeGrammar(
    element(
      EN('spine'),
      group(
        attribute(N('toc'), data(DT_IDREF)),
        oneOrMore(element(EN('itemref'), attribute(N('idref'), data(DT_IDREF)))),
      ),
    ),
  )
  const runSpine = (xml: string) => {
    const root = parseXml(new TextEncoder().encode(xml), 'p.opf').root!
    return validateAgainst(SPINE, root, 'p.opf').map((m) => m.message)
  }

  it('reports the missing attribute once and validates the children normally', () => {
    expect(runSpine(`<spine xmlns="${NS}"><itemref idref="a"/><itemref idref="b"/></spine>`)).toEqual([
      detail('element "spine" missing required attribute "toc"'),
    ])
  })

  it('still reports genuine child failures alongside it', () => {
    expect(runSpine(`<spine xmlns="${NS}"><itemref/></spine>`)).toEqual([
      detail('element "spine" missing required attribute "toc"'),
      detail('element "itemref" missing required attribute "idref"'),
    ])
  })
})

// Requirement 2 of the recovery rules: the expected-attribute list narrows by
// document order. Attributes consumed BEFORE the offender drop out; ones that
// appear after it do not. Verified against the jar with <dc:creator>.
describe('expected-attribute narrowing', () => {
  const THREE = makeGrammar(
    element(
      EN('e'),
      all(
        optional(attribute(N('p'), data(DT_TEXT))),
        optional(attribute(N('q'), data(DT_TEXT))),
        optional(attribute(N('r'), data(DT_TEXT))),
      ),
    ),
  )
  const runThree = (xml: string) => {
    const root = parseXml(new TextEncoder().encode(xml), 'p.opf').root!
    return validateAgainst(THREE, root, 'p.opf').map((m) => m.message)
  }

  it('lists every declared attribute when the offender comes first', () => {
    expect(runThree(`<e xmlns="${NS}" bogus="x" p="1" r="2"/>`)).toEqual([
      detail('attribute "bogus" not allowed here; expected attribute "p", "q" or "r"'),
    ])
  })

  it('drops attributes seen before the offender but keeps those after it', () => {
    expect(runThree(`<e xmlns="${NS}" p="1" bogus="x" r="2"/>`)).toEqual([
      detail('attribute "bogus" not allowed here; expected attribute "q" or "r"'),
    ])
  })

  // `t` is declared first and accepts anything, so a search that returns the first
  // datatype it meets rather than the failing attribute's would say "must be text".
  it('names the datatype of the failing attribute, not of some other one', () => {
    const MIXED = makeGrammar(
      element(
        EN('m'),
        all(optional(attribute(N('t'), data(DT_TEXT))), optional(attribute(N('i'), data(DT_ID)))),
      ),
    )
    const root = parseXml(new TextEncoder().encode(`<m xmlns="${NS}" i="1" t="anything"/>`), 'p.opf').root!
    expect(validateAgainst(MIXED, root, 'p.opf').map((m) => m.message)).toEqual([
      detail('value of attribute "i" is invalid; must be an XML name without colons'),
    ])
  })
})

describe('recovery', () => {
  it('validates a sibling that follows an invalid element', () => {
    expect(run(`<root xmlns="${NS}"><child a="1">oops</child><child b="2"/></root>`)).toEqual([
      detail('text not allowed here; expected the element end-tag'),
      detail('element "child" missing required attribute "a"'),
    ])
  })

  it('reports each unexpected sibling once, with the same expected list', () => {
    expect(run(`<root xmlns="${NS}"><child a="1"/><zzz/><yyy/></root>`)).toEqual([
      detail('element "zzz" not allowed anywhere; expected the element end-tag or element "child"'),
      detail('element "yyy" not allowed anywhere; expected the element end-tag or element "child"'),
    ])
  })

  it('does not cascade into the children of an element it rejected', () => {
    expect(run(`<root xmlns="${NS}"><child a="1"/><zzz><qqq/><rrr/></zzz></root>`)).toEqual([
      detail('element "zzz" not allowed anywhere; expected the element end-tag or element "child"'),
    ])
  })
})
