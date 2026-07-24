import { describe, it, expect } from 'vitest'
import {
  EMPTY, TEXT, element, attribute, name, anyNameExcept, group, optional, all,
  oneOrMore, data, seq, ref, choice, interleave,
} from './pattern.js'
import { startTagOpenDeriv, startTagCloseDeriv, attDeriv } from './derivative.js'
import {
  acceptsText, expectedElements, expectedAttributes, requiredElements, requiredAttributes,
  grammarAcceptsElementName,
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
  it('renders a wildcard last even when it sorts before other names alphabetically', () => {
    // "an element from another namespace" would sort before "zzz" and "guide" alphabetically,
    // but must always be forced to the end regardless of sort order.
    const p = all(el('zzz'), el('aaa'), element(anyNameExcept(['http://x']), EMPTY))
    expect(expectedElements(p)).toEqual(['aaa', 'zzz', 'an element from another namespace'])
  })
  it('sees through an after-shaped pattern (mid-element state)', () => {
    // This is the exact shape the driver queries against: after opening a start
    // tag, the remaining content model is wrapped in `after`.
    const spine = element(N('spine'), oneOrMore(el('itemref')))
    const p = startTagCloseDeriv(startTagOpenDeriv(spine, undefined, 'spine'))
    expect(expectedElements(p)).toEqual(['itemref'])
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
  it('narrows after attDeriv consumes an attribute (document-order narrowing)', () => {
    const e = element(
      N('meta'),
      all(attribute(N('name'), data(DT_TEXT)), attribute(N('id'), data(DT_TEXT))),
    )
    const open = startTagOpenDeriv(e, undefined, 'meta')
    const afterName = attDeriv(open, { qname: 'name', local: 'name', value: 'x' })
    expect(expectedAttributes(afterName)).toEqual(['id'])
  })
  it('recurses into both sides of a raw group, not only via interleave/choice/after', () => {
    // Every other test above reaches collectAttributes's group case indirectly, via
    // all() (interleave) or choice/after. Exercise `group` directly: attribute patterns
    // are never nullable, so a regression that wrongly gated the group branch on
    // `nullable(p1)` (mirroring collectElements's group handling) would silently drop
    // p2 here and this test would catch it.
    const p = group(attribute(N('a'), data(DT_TEXT)), attribute(N('b'), data(DT_TEXT)))
    expect(expectedAttributes(p)).toEqual(['a', 'b'])
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
  it('does not report a name required on only one side of a choice', () => {
    // A name required by only ONE branch of a choice is not genuinely required,
    // since the other branch could be taken without it.
    const p = choice(seq(el('a'), el('b')), el('a'))
    expect(requiredElements(p)).toEqual(['a'])
  })
  it('reports nothing required when the choice sides share no required names', () => {
    const p = choice(el('a'), el('b'))
    expect(requiredElements(p)).toEqual([])
  })
})

describe('acceptsText', () => {
  it('is true for a bare text content model', () => {
    expect(acceptsText(TEXT)).toBe(true)
  })
  it('is true for a data content model', () => {
    expect(acceptsText(data(DT_TEXT))).toBe(true)
  })
  it('is false for a pure element content model', () => {
    expect(acceptsText(el('child'))).toBe(false)
  })
  it('is false for an empty content model', () => {
    expect(acceptsText(EMPTY)).toBe(false)
  })
  it('sees text reachable through a choice or interleave', () => {
    expect(acceptsText(choice(el('a'), TEXT))).toBe(true)
    expect(acceptsText(interleave(el('a'), TEXT))).toBe(true)
  })
  it('sees text only past a nullable head of a group', () => {
    // text sits in p2; it is reachable only when p1 can be skipped.
    expect(acceptsText(group(optional(el('a')), TEXT))).toBe(true)
    // a required element head blocks the text position: the next thing accepted is
    // the element, not text.
    expect(acceptsText(group(el('a'), TEXT))).toBe(false)
  })
  it('sees text in the head of a group even when the tail is elements', () => {
    expect(acceptsText(group(TEXT, el('a')))).toBe(true)
  })
  it('sees text under oneOrMore and through an after front half', () => {
    expect(acceptsText(oneOrMore(TEXT))).toBe(true)
    // The exact mid-element shape the driver queries: <dc:title> after its start
    // tag, still offering text as its content.
    const title = element(N('title'), TEXT)
    const mid = startTagCloseDeriv(startTagOpenDeriv(title, undefined, 'title'))
    expect(acceptsText(mid)).toBe(true)
  })
})

describe('grammarAcceptsElementName', () => {
  it('matches a named element anywhere in the grammar', () => {
    const g = element(N('package'), group(el('metadata'), el('manifest')))
    expect(grammarAcceptsElementName(g, undefined, 'manifest')).toBe(true)
  })
  it('is false for a name that appears nowhere in the grammar', () => {
    const g = element(N('package'), group(el('metadata'), el('manifest')))
    expect(grammarAcceptsElementName(g, undefined, 'zzz')).toBe(false)
  })
  it('matches via a foreign-namespace wildcard', () => {
    // The `anyNameExcept` accepts any namespace except the excepted ones, so a
    // foreign-namespace element matches SOMEWHERE even though it is not a named
    // grammar element — this is what makes `<x:foo>` `here`, not `anywhere`.
    const g = element(N('package'), element(anyNameExcept(['http://opf']), EMPTY))
    expect(grammarAcceptsElementName(g, 'http://example.com/x', 'foo')).toBe(true)
  })
  it('is false for a namespace excepted from the wildcard', () => {
    // An unprefixed OPF element or a DC element falls in an excepted namespace, so
    // the wildcard does NOT match it: absent a named grammar element it is `anywhere`.
    const g = element(N('package'), element(anyNameExcept(['http://opf', 'http://dc']), EMPTY))
    expect(grammarAcceptsElementName(g, 'http://opf', 'zzz')).toBe(false)
    expect(grammarAcceptsElementName(g, 'http://dc', 'isbn')).toBe(false)
  })
  it('terminates on a recursive grammar (memoized ref cell)', () => {
    // A ref whose thunk returns an element containing that same ref, e.g. the shape of
    // package-30's `collection` production. Must not loop forever.
    const collectionRef: { current: import('./pattern.js').Pattern } = { current: EMPTY }
    collectionRef.current = element(
      N('collection'),
      optional(ref(() => collectionRef.current)),
    )
    expect(grammarAcceptsElementName(collectionRef.current, undefined, 'collection')).toBe(true)
    expect(grammarAcceptsElementName(collectionRef.current, undefined, 'zzz')).toBe(false)
  })
  it('terminates on a self-recursive builder function, not just a memoized ref cell', () => {
    // Unlike the memoized-cell test above, `collectionPattern` builds a FRESH object
    // graph on every call: each `resolve()` returns a brand-new element/choice/ref
    // triple, so the object-identity `seen` guard alone never re-hits and a
    // naive walk recurses until the stack overflows. Only the ref-thunk guard
    // (tracking `resolve` itself, a stable function reference) stops this.
    function collectionPattern(): import('./pattern.js').Pattern {
      return element(N('collection'), optional(ref(collectionPattern)))
    }
    expect(grammarAcceptsElementName(collectionPattern(), undefined, 'zzz')).toBe(false)
  })
  it('throws an actionable error when a ref thunk wraps the recursive call in a fresh arrow', () => {
    // Neither cycle guard can fire here: `ref(() => collectionPattern())` allocates a
    // fresh closure AND a fresh Pattern object graph on every expansion. This must not
    // silently stack-overflow; it must fail loudly with guidance on how to fix it.
    function collectionPattern(): import('./pattern.js').Pattern {
      return element(N('collection'), optional(ref(() => collectionPattern())))
    }
    // A name absent from the grammar forces a full walk, so the backstop fires.
    expect(() => grammarAcceptsElementName(collectionPattern(), undefined, 'zzz')).toThrow(/memoi/i)
  })
})
