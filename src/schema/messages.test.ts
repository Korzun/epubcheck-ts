import { describe, it, expect } from 'vitest'
import {
  joinOr, joinAnd, quoteAll, unknownAttribute, noAttributesAllowed, missingAttributes, textNotAllowed,
  unknownElement, elementNotAllowedYet, incompleteMissingElement, incompleteExpected,
  invalidAttributeValue, invalidCharacterContent, expectedClause,
} from './messages.js'

describe('joinOr', () => {
  it('joins with commas and a final or', () => {
    expect(joinOr(['a'])).toBe('a')
    expect(joinOr(['a', 'b'])).toBe('a or b')
    expect(joinOr(['a', 'b', 'c'])).toBe('a, b or c')
  })
})

describe('joinAnd', () => {
  it('joins with commas and a final and', () => {
    expect(joinAnd(['a'])).toBe('a')
    expect(joinAnd(['a', 'b'])).toBe('a and b')
    expect(joinAnd(['a', 'b', 'c'])).toBe('a, b and c')
  })
})

describe('quoteAll', () => {
  it('wraps every name in double quotes, preserving order', () => {
    expect(quoteAll(['content', 'id', 'name'])).toEqual(['"content"', '"id"', '"name"'])
  })
  it('returns an empty array for an empty input', () => {
    expect(quoteAll([])).toEqual([])
  })
})

describe('expectedClause', () => {
  it('puts the end-tag first and joins nested', () => {
    expect(expectedClause(['itemref'], true)).toBe('the element end-tag or element "itemref"')
    expect(expectedClause(['guide', 'tours'], true)).toBe(
      'the element end-tag or element "guide" or "tours"',
    )
    expect(expectedClause(['item'], false)).toBe('element "item"')
  })
  it('renders the foreign-namespace wildcard as its own alternative', () => {
    expect(
      expectedClause(['dc:title', 'meta', 'an element from another namespace'], true),
    ).toBe(
      'the element end-tag, element "dc:title" or "meta" or an element from another namespace',
    )
  })
  it('degrades to the end-tag alone', () => {
    expect(expectedClause([], true)).toBe('the element end-tag')
  })
  it('renders the wildcard alone with no element names and no end-tag', () => {
    expect(expectedClause(['an element from another namespace'], false)).toBe(
      'an element from another namespace',
    )
  })
  it('is empty when neither end-tag, names, nor wildcard are present', () => {
    expect(expectedClause([], false)).toBe('')
  })
})

describe('attribute details', () => {
  // Regression for PR #28: the expected list narrows by DOCUMENT ORDER, so a
  // `property` written before `name`/`content` still lists all five.
  it('lists every attribute not yet consumed', () => {
    expect(unknownAttribute('property', ['content', 'id', 'name', 'scheme', 'xml:lang'])).toBe(
      'attribute "property" not allowed here; expected attribute "content", "id", "name", "scheme" or "xml:lang"',
    )
  })
  it('switches shape when nothing is left to expect', () => {
    expect(noAttributesAllowed('foo')).toBe('found attribute "foo", but no attributes allowed here')
  })
  it('pluralises missing required attributes and joins with and', () => {
    expect(missingAttributes('item', ['media-type'])).toBe(
      'element "item" missing required attribute "media-type"',
    )
    expect(missingAttributes('meta', ['content', 'name'])).toBe(
      'element "meta" missing required attributes "content" and "name"',
    )
  })
  it('reports an invalid attribute value', () => {
    expect(invalidAttributeValue('id', 'an XML name without colons')).toBe(
      'value of attribute "id" is invalid; must be an XML name without colons',
    )
  })
})

describe('content details', () => {
  it('reports disallowed text', () => {
    expect(textNotAllowed()).toBe('text not allowed here; expected the element end-tag')
  })
  it('distinguishes anywhere from here', () => {
    expect(unknownElement('zzz', 'anywhere', ['itemref'], true)).toBe(
      'element "zzz" not allowed anywhere; expected the element end-tag or element "itemref"',
    )
    expect(unknownElement('x:foo', 'here', ['item'], false)).toBe(
      'element "x:foo" not allowed here; expected element "item"',
    )
  })
  it('reports unknown element with an empty expected list as end-tag only', () => {
    expect(unknownElement('zzz', 'here', [], true)).toBe(
      'element "zzz" not allowed here; expected the element end-tag',
    )
  })
  it('reports an element that is merely premature', () => {
    expect(elementNotAllowedYet('tours', 'spine')).toBe(
      'element "tours" not allowed yet; missing required element "spine"',
    )
  })
  it('reports an incomplete parent', () => {
    expect(incompleteMissingElement('spine', 'itemref')).toBe(
      'element "spine" incomplete; missing required element "itemref"',
    )
    expect(incompleteExpected('metadata', ['dc:title', 'meta'], false)).toBe(
      'element "metadata" incomplete; expected element "dc:title" or "meta"',
    )
  })
  it('reports invalid character content', () => {
    expect(
      invalidCharacterContent('dc:identifier', 'a string with length at least 1 (actual length was 0)'),
    ).toBe(
      'character content of element "dc:identifier" invalid; must be a string with length at least 1 (actual length was 0)',
    )
  })
})
