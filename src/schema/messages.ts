/**
 * The RSC-005 detail strings EPUBCheck 5.3.0 emits for RelaxNG failures, transcribed
 * from jar output rather than paraphrased. Ten shapes, verified by the differential
 * harness in test/differential.
 */

const WILDCARD = 'an element from another namespace'

/** `a`, `a or b`, `a, b or c` — EPUBCheck's list style, applied recursively. */
export function joinOr(items: readonly string[]): string {
  if (items.length < 2) return items.join('')
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`
}

/** Same, with a final `and`. Used by the two "missing required …" shapes. */
export function joinAnd(items: readonly string[]): string {
  if (items.length < 2) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

export function quoteAll(names: readonly string[]): string[] {
  return names.map((n) => `"${n}"`)
}

/**
 * The `expected …` clause. EPUBCheck nests joinOr: the top level is
 * [end-tag?, element-list?, wildcard?], and the element list is itself a joinOr.
 * That is why `the element end-tag or element "guide" or "tours"` has two `or`s
 * while the long metadata list uses a comma after the end-tag.
 */
export function expectedClause(names: readonly string[], endTagAllowed: boolean): string {
  const parts: string[] = []
  if (endTagAllowed) parts.push('the element end-tag')
  const elements = names.filter((n) => n !== WILDCARD)
  if (elements.length > 0) parts.push(`element ${joinOr(quoteAll(elements))}`)
  if (names.includes(WILDCARD)) parts.push(WILDCARD)
  return joinOr(parts)
}

export function unknownAttribute(qname: string, expected: readonly string[]): string {
  return `attribute "${qname}" not allowed here; expected attribute ${joinOr(quoteAll(expected))}`
}

export function noAttributesAllowed(qname: string): string {
  return `found attribute "${qname}", but no attributes allowed here`
}

export function missingAttributes(elementName: string, missing: readonly string[]): string {
  const plural = missing.length > 1 ? 's' : ''
  return `element "${elementName}" missing required attribute${plural} ${joinAnd(quoteAll(missing))}`
}

export function invalidAttributeValue(qname: string, describe: string): string {
  return `value of attribute "${qname}" is invalid; must be ${describe}`
}

export function invalidCharacterContent(elementName: string, describe: string): string {
  return `character content of element "${elementName}" invalid; must be ${describe}`
}

export function textNotAllowed(): string {
  return 'text not allowed here; expected the element end-tag'
}

/**
 * `anywhere` when the name occurs nowhere in the grammar; `here` when it occurs
 * elsewhere but is not currently accepted. A foreign-namespace element at package
 * level is `here`, because the wildcard makes it legal inside metadata.
 */
export function unknownElement(
  qname: string,
  scope: 'anywhere' | 'here',
  expected: readonly string[],
  endTagAllowed: boolean,
): string {
  return `element "${qname}" not allowed ${scope}; expected ${expectedClause(expected, endTagAllowed)}`
}

export function elementNotAllowedYet(qname: string, missingRequired: string): string {
  return `element "${qname}" not allowed yet; missing required element "${missingRequired}"`
}

/**
 * Every still-outstanding requirement is listed, pluralised and joined with `and` —
 * exactly parallel to `missingAttributes`. EPUB 2 `<metadata>` reports
 * `missing required element "dc:title"` with one outstanding and
 * `missing required elements "dc:language" and "dc:title"` with two.
 */
export function incompleteMissingElement(parent: string, missing: readonly string[]): string {
  const plural = missing.length > 1 ? 's' : ''
  return `element "${parent}" incomplete; missing required element${plural} ${joinAnd(quoteAll(missing))}`
}

export function incompleteExpected(
  parent: string,
  expected: readonly string[],
  endTagAllowed: boolean,
): string {
  return `element "${parent}" incomplete; expected ${expectedClause(expected, endTagAllowed)}`
}
