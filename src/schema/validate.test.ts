import { describe, it, expect } from 'vitest'
import { parseXml } from '../io/xml.js'
import {
  EMPTY, TEXT, element, attribute, name, anyNameExcept, data, all, choice, oneOrMore,
  optional, seq, group,
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

  // The recovery forgives the missing `b` AND consumes the premature `c`, so the walk
  // resumes past `c` with nothing left to expect. This synthetic case is the exact
  // shape of the jar's EPUB 2 `<guide>`-before-`<spine>` probe (see opf20.test.ts),
  // which likewise reports the bare end-tag expectation on the later element.
  it('reports a premature element as "not allowed yet" and continues after it', () => {
    expect(runOrdered(`<pkg xmlns="${NS}"><a/><c/><b/></pkg>`)).toEqual([
      detail('element "c" not allowed yet; missing required element "b"'),
      detail('element "b" not allowed here; expected the element end-tag'),
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

  // The forgiving close must forgive the ATTRIBUTE only: `<spine/>` is missing its
  // required `toc` AND its required `itemref` content, and the jar reports both.
  // A close that returned EMPTY would swallow the second message.
  it("keeps the element's own content requirement", () => {
    expect(runSpine(`<spine xmlns="${NS}"/>`)).toEqual([
      detail('element "spine" missing required attribute "toc"'),
      detail('element "spine" incomplete; missing required element "itemref"'),
    ])
  })

  // Jar ground truth: `<itemref idref="1"/>` where `idref` is required and `1` is not
  // an NCName produces ONE message. The attribute was supplied, so it is not missing.
  it('does not also report an attribute whose value was invalid as missing', () => {
    expect(runSpine(`<spine xmlns="${NS}" toc="t"><itemref idref="1"/></spine>`)).toEqual([
      detail('value of attribute "idref" is invalid; must be an XML name without colons'),
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

// Shapes 8 and 9 of the incomplete-parent message, at driver level.
describe('incomplete parent', () => {
  // Two outstanding requirements are listed together, alphabetically, joined with
  // `and` — the jar's EPUB 2 `<metadata>` probe reports
  // `missing required elements "dc:language" and "dc:title"`, not just one of them.
  it('lists every outstanding required element', () => {
    const TWO = makeGrammar(
      element(EN('metadata'), all(element(EN('title'), EMPTY), element(EN('language'), EMPTY))),
    )
    const root = parseXml(new TextEncoder().encode(`<metadata xmlns="${NS}"/>`), 'p.opf').root!
    expect(validateAgainst(TWO, root, 'p.opf').map((m) => m.message)).toEqual([
      detail('element "metadata" incomplete; missing required elements "language" and "title"'),
    ])
  })

  // Nothing is required by BOTH branches of the choice, so the message falls through
  // to the expected-list shape. The valid sibling that follows pins that closing the
  // incomplete element keeps the parent's continuation.
  it('falls back to the expected list and carries on with the next sibling', () => {
    const CHOICE = makeGrammar(
      element(
        EN('doc'),
        seq(
          element(EN('e'), choice(element(EN('a'), EMPTY), element(EN('b'), EMPTY))),
          element(EN('z'), attribute(N('k'), data(DT_TEXT))),
        ),
      ),
    )
    const root = parseXml(new TextEncoder().encode(`<doc xmlns="${NS}"><e/><z/></doc>`), 'p.opf').root!
    expect(validateAgainst(CHOICE, root, 'p.opf').map((m) => m.message)).toEqual([
      detail('element "e" incomplete; expected element "a" or "b"'),
      detail('element "z" missing required attribute "k"'),
    ])
  })
})

// D1: a text content model that rejects a child element offers `or text`, because
// character data is still acceptable at that position — mirrors the jar's
// `<dc:title>Title<b/></dc:title>` -> `expected the element end-tag or text`.
describe('text content model offers "or text"', () => {
  const TITLE = makeGrammar(
    element(EN('doc'), oneOrMore(element(EN('title'), TEXT))),
  )
  const runTitle = (xml: string) => {
    const root = parseXml(new TextEncoder().encode(xml), 'p.opf').root!
    return validateAgainst(TITLE, root, 'p.opf').map((m) => m.message)
  }

  it('appends "or text" when a child element intrudes on a text model', () => {
    expect(runTitle(`<doc xmlns="${NS}"><title>Text<b/></title></doc>`)).toEqual([
      detail('element "b" not allowed anywhere; expected the element end-tag or text'),
    ])
  })

  // Guard: an empty (element-only, no text) model must NOT gain "or text".
  it('does not append "or text" for a non-text model', () => {
    expect(run(`<root xmlns="${NS}"><child a="1"><root/></child></root>`)).toEqual([
      detail('element "root" not allowed here; expected the element end-tag'),
    ])
  })
})

// D2: the here/anywhere split is wildcard-aware. A foreign-namespace element is
// `here` when a grammar `anyNameExcept` wildcard would accept it somewhere, even
// though it is not a named grammar element.
describe('here/anywhere is wildcard-aware', () => {
  const OPF_NS = 'http://opf'
  // <pkg><meta/>+ </pkg>, where <meta> may contain any foreign-namespace element.
  // The wildcard lives INSIDE meta, so at the top level a stray foreign element is
  // rejected outright (no premature-recovery skips to it) yet still matches the
  // grammar somewhere -> the here/anywhere split, not the "not allowed yet" path.
  const WILD = makeGrammar(
    element(
      name(OPF_NS, 'pkg', 'pkg'),
      oneOrMore(
        element(
          name(OPF_NS, 'meta', 'meta'),
          optional(element(anyNameExcept([OPF_NS]), EMPTY)),
        ),
      ),
    ),
  )
  const runWild = (xml: string) => {
    const root = parseXml(new TextEncoder().encode(xml), 'p.opf').root!
    return validateAgainst(WILD, root, 'p.opf').map((m) => m.message)
  }

  it('classifies a foreign-namespace element the wildcard accepts as "here"', () => {
    // After a valid <meta>, <x:foo> is rejected at the top level, but the wildcard
    // inside <meta> accepts it somewhere -> "here", not "anywhere".
    expect(
      runWild(`<pkg xmlns="${OPF_NS}"><meta/><x:foo xmlns:x="http://example.com/x"/></pkg>`),
    ).toEqual([
      detail('element "x:foo" not allowed here; expected the element end-tag or element "meta"'),
    ])
  })

  it('keeps an unprefixed element in the excepted namespace as "anywhere"', () => {
    // <zzz> inherits the OPF namespace, which the wildcard excepts, and there is no
    // named `zzz` element -> nothing in the grammar could ever accept it -> "anywhere".
    expect(runWild(`<pkg xmlns="${OPF_NS}"><meta/><zzz/></pkg>`)).toEqual([
      detail('element "zzz" not allowed anywhere; expected the element end-tag or element "meta"'),
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
