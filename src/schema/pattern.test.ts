import { describe, it, expect } from 'vitest'
import {
  EMPTY, NOT_ALLOWED, TEXT, choice, group, interleave, oneOrMore, optional,
  element, attribute, name, anyNameExcept, nullable, nameMatches, displayOf,
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
