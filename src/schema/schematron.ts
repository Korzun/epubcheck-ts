import type { XmlNode } from '../io/xml.js'
import { msg, type Message } from '../messages/format.js'

/**
 * The two schematron assertions EPUBCheck applies to package documents alongside
 * the RelaxNG grammar (`schema/20/sch/opf.sch`). Both surface through the normal
 * message pipeline rather than the schema layer, and both fire once per member of
 * the offending group — not once per group, and not skipping the first occurrence
 * (confirmed against EPUBCheck 5.3.0's message-location aggregation: a duplicate
 * pair yields one message with two locations, a triple yields one with three).
 */

/** `normalize-space()`: trim, then collapse internal whitespace runs to one space. */
const norm = (s: string): string => s.trim().replace(/\s+/g, ' ')

/** OPF namespace URI, used to scope `opf:`-qualified schematron contexts. */
const OPF_NS = 'http://www.idpf.org/2007/opf'

function walk(node: XmlNode, visit: (n: XmlNode) => void): void {
  for (const child of node.children ?? []) {
    if (child.type !== 'element') continue
    visit(child)
    walk(child, visit)
  }
}

/**
 * `opf_idAttrUnique`: every `id` in the package document must be unique.
 * `count(//@id[normalize-space(.) = normalize-space(current()/@id)]) = 1` —
 * space-normalised, case-sensitive comparison.
 */
export function checkUniqueIds(root: XmlNode, path: string): Message[] {
  const withId: { node: XmlNode; id: string }[] = []
  const collect = (n: XmlNode): void => {
    const id = n.attrs?.['id']
    if (id !== undefined) withId.push({ node: n, id: norm(id) })
  }
  collect(root)
  walk(root, collect)

  const counts = new Map<string, number>()
  for (const { id } of withId) counts.set(id, (counts.get(id) ?? 0) + 1)

  return withId
    .filter(({ id }) => (counts.get(id) ?? 0) > 1)
    .map(({ node }) => msg('RSC-005', node.loc, path, 'The "id" attribute does not have a unique value'))
}

/**
 * `opf_guideReferenceUnique` (EPUB 2 only, `schema/20/sch/opf.sch`): `opf:reference`
 * elements sharing a `type` and `href` that are both space-normalised and
 * lower-cased — `normalize-space(lower-case(@type))` / `normalize-space(lower-case(@href))`,
 * identical treatment for both attributes. `path` is accepted for signature parity
 * with `checkUniqueIds`; the RSC-017 template carries no filename.
 *
 * The schematron context is `opf:reference`, namespace-qualified — only elements in
 * the OPF namespace are matched, by local name and namespace together. The pair is
 * combined with `JSON.stringify` rather than string concatenation: joining two
 * normalised attributes into a single delimited string is collidable in principle
 * (e.g. `type="a b", href="c"` vs. `type="a", href="b c"`), whereas `JSON.stringify`
 * keeps the two values distinguishable regardless of content.
 */
export function checkDuplicateReferences(root: XmlNode, _path: string): Message[] {
  const refs: XmlNode[] = []
  walk(root, (n) => {
    if (n.name === 'reference' && n.ns === OPF_NS) refs.push(n)
  })

  const key = (n: XmlNode): string =>
    JSON.stringify([norm(n.attrs?.['type'] ?? '').toLowerCase(), norm(n.attrs?.['href'] ?? '').toLowerCase()])

  const counts = new Map<string, number>()
  for (const ref of refs) {
    const k = key(ref)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }

  return refs
    .filter((ref) => (counts.get(key(ref)) ?? 0) > 1)
    .map((ref) =>
      msg('RSC-017', ref.loc, 'Duplicate "reference" elements with the same "type" and "href" attributes'),
    )
}
