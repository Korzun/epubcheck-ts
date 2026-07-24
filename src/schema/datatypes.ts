import type { Datatype } from './pattern.js'
import { joinOr, quoteAll } from './messages.js'

/**
 * Datatypes used by opf20.rng and package-30.rnc. `describe` returns the tail of
 * EPUBCheck's `... is invalid; must be <tail>`, transcribed from jar output.
 *
 * Deliberately permissive: `property`, `properties`, `languagecode` and `mimetype`
 * are all DT_TEXT. Rejecting a legal media-type or language tag is exactly the
 * false-positive class this change must avoid, and no harness case pins a message
 * for them. See the containment rule in the design doc.
 */

export const DT_TEXT: Datatype = {
  allows: () => true,
  describe: () => 'text',
}

/** xsd:ID / xsd:NCName — an XML name with no colon. */
const NCNAME = /^[A-Za-z_][A-Za-z0-9._-]*$/
export const DT_ID: Datatype = {
  allows: (v) => NCNAME.test(v),
  describe: () => 'an XML name without colons',
}

/**
 * xsd:IDREF. Lexically identical to ID; referential integrity is NOT enforced —
 * `<spine toc="nope">` produces only OPF-049 from the semantic checks, no RSC-005.
 */
export const DT_IDREF: Datatype = DT_ID

/** xsd:anyURI. Jing accepts essentially everything here; kept permissive on purpose. */
export const DT_ANY_URI: Datatype = DT_TEXT

/** `<data type="token"><param name="minLength">1</param></data>` / `datatype.string.nonempty`. */
export const DT_NON_EMPTY: Datatype = {
  allows: (v) => v.trim().length >= 1,
  describe: (v) =>
    `a string with length at least 1 (actual length was ${v.trim().length})`,
}

/** A RelaxNG `<choice>` of `<value>`s. Alternatives are listed alphabetically. */
export function dtEnum(values: readonly string[]): Datatype {
  const sorted = [...values].sort()
  const tail = joinOr(quoteAll(sorted))
  return {
    allows: (v) => sorted.includes(v),
    describe: () => `equal to ${tail}`,
  }
}
