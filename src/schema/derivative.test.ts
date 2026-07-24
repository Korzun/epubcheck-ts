import { describe, it, expect } from 'vitest'
import {
  EMPTY, NOT_ALLOWED, TEXT, element, attribute, name, group, oneOrMore,
  optional, all, nullable, data, choice, after, ref, type Pattern,
} from './pattern.js'
import {
  startTagOpenDeriv, attDeriv, startTagCloseDeriv, textDeriv, endTagDeriv, applyAfter,
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
  it('derefs a ref node before matching, for recursive productions', () => {
    // Simulates a self-recursive production: collection = element('collection', optional(ref(() => collection)))
    const recursive: Pattern = ref(() => element(N('collection'), optional(recursive)))
    expect(startTagOpenDeriv(recursive, undefined, 'collection').k).not.toBe('notAllowed')
    expect(startTagOpenDeriv(recursive, undefined, 'zzz').k).toBe('notAllowed')
  })
})

describe('attDeriv and startTagCloseDeriv', () => {
  const withId = element(N('e'), attribute(N('id'), data(DT_ID)))

  it('consumes a declared attribute', () => {
    const open = startTagOpenDeriv(withId, undefined, 'e')
    const after1 = attDeriv(open, { qname: 'id', local: 'id', value: 'ok' })
    expect(after1.k).not.toBe('notAllowed')
    expect(startTagCloseDeriv(after1).k).not.toBe('notAllowed')
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
    expect(nullable(startTagCloseDeriv(open))).toBe(false)
  })
  it('does not allow the same attribute to be consumed twice', () => {
    const open = startTagOpenDeriv(withId, undefined, 'e')
    const after1 = attDeriv(open, { qname: 'id', local: 'id', value: 'ok' })
    // A second occurrence of `id` should be rejected: the pattern has already
    // discarded the `attribute` alternative that matched it.
    const after2 = attDeriv(after1, { qname: 'id', local: 'id', value: 'ok' })
    expect(after2.k).toBe('notAllowed')
  })
  it('discards unconsumed optional attributes at close while leaving required ones outstanding', () => {
    const p = element(
      N('e'),
      group(
        attribute(N('req'), data(DT_ID)),
        optional(attribute(N('opt'), data(DT_ID))),
      ),
    )
    const open = startTagOpenDeriv(p, undefined, 'e')
    // Only the required attribute is supplied; the optional one is left untouched.
    const afterReq = attDeriv(open, { qname: 'req', local: 'req', value: 'ok' })
    const closed = startTagCloseDeriv(afterReq)
    // The optional attribute's alternative is discarded (no notAllowed leftover
    // blocking closure), and since the required one was consumed, the element's
    // content is fully satisfied once the end tag is reached.
    expect(nullable(endTagDeriv(closed))).toBe(true)

    // But if the required attribute was never supplied, it is still outstanding.
    const closedWithoutReq = startTagCloseDeriv(open)
    expect(nullable(endTagDeriv(closedWithoutReq))).toBe(false)
  })
})

describe('textDeriv and endTagDeriv', () => {
  it('accepts text against a text pattern and rejects it against empty', () => {
    expect(textDeriv(TEXT, 'x').k).not.toBe('notAllowed')
    expect(textDeriv(EMPTY, 'x').k).toBe('notAllowed')
  })
  it('accepts a value that satisfies a data pattern and rejects one that does not', () => {
    expect(textDeriv(data(DT_ID), 'ok').k).not.toBe('notAllowed')
    expect(textDeriv(data(DT_ID), '1nope').k).toBe('notAllowed')
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

describe('applyAfter', () => {
  it('rewrites the continuation of an after node', () => {
    const p = after(EMPTY, item)
    const rewritten = applyAfter((cont) => group(cont, item), p)
    expect(rewritten.k).toBe('after')
    if (rewritten.k === 'after') {
      expect(rewritten.p1).toEqual(EMPTY)
      // group(item, item) collapses only if either side is empty/notAllowed, so
      // this should be a genuine group node combining the two continuations.
      expect(rewritten.p2.k).toBe('group')
    }
  })
  it('distributes across a choice, rewriting each branch independently', () => {
    const p = choice(after(EMPTY, item), after(TEXT, EMPTY))
    const rewritten = applyAfter((cont) => group(cont, item), p)
    expect(rewritten.k).toBe('choice')
  })
  it('returns notAllowed for anything that is not an after or a choice of afters', () => {
    expect(applyAfter((cont) => cont, EMPTY).k).toBe('notAllowed')
    expect(applyAfter((cont) => cont, item).k).toBe('notAllowed')
    expect(applyAfter((cont) => cont, NOT_ALLOWED).k).toBe('notAllowed')
  })
})
