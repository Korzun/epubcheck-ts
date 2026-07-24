import { describe, it, expect } from 'vitest'
import {
  EMPTY, element, attribute, name, anyNameExcept, group, optional, all,
  oneOrMore, data, seq, ref, choice,
} from './pattern.js'
import { startTagOpenDeriv, startTagCloseDeriv, attDeriv } from './derivative.js'
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

describe('grammarNames', () => {
  it('collects every element name reachable in the grammar', () => {
    const g = element(N('package'), group(el('metadata'), el('manifest')))
    expect(grammarNames(g)).toEqual(new Set(['package', 'metadata', 'manifest']))
  })
  it('terminates on a recursive grammar and collects the name once', () => {
    // A ref whose thunk returns an element containing that same ref, e.g. the shape of
    // package-30's `collection` production. Must not loop forever.
    const collectionRef: { current: import('./pattern.js').Pattern } = { current: EMPTY }
    collectionRef.current = element(
      N('collection'),
      optional(ref(() => collectionRef.current)),
    )
    const names = grammarNames(collectionRef.current)
    expect(names).toEqual(new Set(['collection']))
  })
})
