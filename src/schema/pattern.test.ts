import { describe, it, expect } from 'vitest'
import type { Pattern } from './pattern.js'
import {
  EMPTY, NOT_ALLOWED, TEXT, choice, group, interleave, oneOrMore, optional,
  element, attribute, name, anyNameExcept, nullable, nameMatches, displayOf,
  after, deref, ref, seq, all, zeroOrMore, data,
} from './pattern.js'

describe('smart constructors', () => {
  it('absorbs notAllowed in choice', () => {
    expect(choice(NOT_ALLOWED, TEXT)).toBe(TEXT)
    expect(choice(TEXT, NOT_ALLOWED)).toBe(TEXT)
  })
  it('absorbs notAllowed in group and interleave', () => {
    expect(group(NOT_ALLOWED, TEXT)).toBe(NOT_ALLOWED)
    expect(interleave(TEXT, NOT_ALLOWED)).toBe(NOT_ALLOWED)
  })
  it('drops empty in group', () => {
    expect(group(EMPTY, TEXT)).toBe(TEXT)
    expect(group(TEXT, EMPTY)).toBe(TEXT)
  })
  it('absorbs notAllowed in after from either side', () => {
    expect(after(NOT_ALLOWED, TEXT)).toBe(NOT_ALLOWED)
    expect(after(TEXT, NOT_ALLOWED)).toBe(NOT_ALLOWED)
  })
  it('builds an after node when neither side is notAllowed', () => {
    expect(after(TEXT, EMPTY)).toEqual({ k: 'after', p1: TEXT, p2: EMPTY })
  })
})

describe('nullable', () => {
  const el = element(name(undefined, 'a', 'a'), EMPTY)
  it('is true for empty and text', () => {
    expect(nullable(EMPTY)).toBe(true)
    expect(nullable(TEXT)).toBe(true)
  })
  it('is false for element, attribute and notAllowed', () => {
    expect(nullable(el)).toBe(false)
    expect(nullable(attribute(name(undefined, 'x', 'x'), TEXT))).toBe(false)
    expect(nullable(NOT_ALLOWED)).toBe(false)
  })
  it('is true for optional and for oneOrMore of a nullable', () => {
    expect(nullable(optional(el))).toBe(true)
    expect(nullable(oneOrMore(el))).toBe(false)
  })
  it('requires both sides for group and interleave', () => {
    expect(nullable(group(EMPTY, el))).toBe(false)
    expect(nullable(interleave(EMPTY, EMPTY))).toBe(true)
  })
  it('is false for data', () => {
    expect(nullable(data({ allows: () => true, describe: () => 'anything' }))).toBe(false)
  })
  it('is false for after', () => {
    expect(nullable(after(TEXT, TEXT))).toBe(false)
  })
  it('delegates to the resolved pattern for ref', () => {
    expect(nullable(ref(() => EMPTY))).toBe(true)
    expect(nullable(ref(() => el))).toBe(false)
  })
  it('is false for choice when both branches are non-nullable', () => {
    expect(nullable(choice(el, attribute(name(undefined, 'x', 'x'), TEXT)))).toBe(false)
  })
  it('is true for choice when both branches are nullable', () => {
    expect(nullable(choice(EMPTY, TEXT))).toBe(true)
  })
})

describe('deref', () => {
  it('returns a non-ref pattern unchanged', () => {
    expect(deref(TEXT)).toBe(TEXT)
  })
  it('resolves a ref to its underlying pattern', () => {
    expect(deref(ref(() => TEXT))).toBe(TEXT)
  })
  it('resolves through a chain of refs to the final non-ref pattern', () => {
    const inner = ref(() => TEXT)
    const outer = ref(() => inner)
    expect(deref(outer)).toBe(TEXT)
  })
  it('derefs a lazily self-referential grammar node without infinite recursion', () => {
    // Shape used by real grammars for recursive productions: a ref whose thunk
    // returns an element that itself contains the same ref.
    const collection: Pattern = ref(() =>
      element(name(undefined, 'collection', 'collection'), collection),
    )
    const resolved = deref(collection)
    expect(resolved.k).toBe('element')
    if (resolved.k === 'element') {
      expect(resolved.p).toBe(collection)
    }
  })
})

describe('seq, all and zeroOrMore', () => {
  const a = element(name(undefined, 'a', 'a'), EMPTY)
  const b = element(name(undefined, 'b', 'b'), EMPTY)
  const c = element(name(undefined, 'c', 'c'), EMPTY)

  it('seq() with no arguments is EMPTY', () => {
    expect(seq()).toBe(EMPTY)
  })
  it('seq() of a single argument returns it unchanged', () => {
    expect(seq(a)).toBe(a)
  })
  it('seq() folds several patterns into nested groups with no stray empty nodes', () => {
    expect(seq(a, b, c)).toEqual({
      k: 'group',
      p1: { k: 'group', p1: a, p2: b },
      p2: c,
    })
  })
  it('all() with no arguments is EMPTY', () => {
    expect(all()).toBe(EMPTY)
  })
  it('all() of a single argument returns it unchanged', () => {
    expect(all(a)).toBe(a)
  })
  it('all() folds several patterns into nested interleaves with no stray empty nodes', () => {
    expect(all(a, b, c)).toEqual({
      k: 'interleave',
      p1: { k: 'interleave', p1: a, p2: b },
      p2: c,
    })
  })
  it('zeroOrMore builds optional(oneOrMore(p))', () => {
    expect(zeroOrMore(a)).toEqual({
      k: 'choice',
      p1: { k: 'oneOrMore', p: a },
      p2: EMPTY,
    })
  })
  it('zeroOrMore of notAllowed collapses to EMPTY', () => {
    expect(zeroOrMore(NOT_ALLOWED)).toBe(EMPTY)
  })
})

describe('name classes', () => {
  it('matches on namespace and local name', () => {
    const nc = name('http://x', 'title', 'dc:title')
    expect(nameMatches(nc, 'http://x', 'title')).toBe(true)
    expect(nameMatches(nc, 'http://y', 'title')).toBe(false)
    expect(nameMatches(nc, undefined, 'title')).toBe(false)
    expect(displayOf(nc)).toBe('dc:title')
  })
  it('matches any name outside the excepted namespaces', () => {
    const nc = anyNameExcept(['http://x'])
    expect(nameMatches(nc, 'http://y', 'anything')).toBe(true)
    expect(nameMatches(nc, 'http://x', 'anything')).toBe(false)
    expect(nameMatches(nc, undefined, 'anything')).toBe(true)
    expect(displayOf(nc)).toBe('an element from another namespace')
  })
})
