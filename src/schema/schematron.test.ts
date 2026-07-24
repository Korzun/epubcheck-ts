import { describe, it, expect } from 'vitest'
import { parseXml } from '../io/xml.js'
import { checkUniqueIds, checkDuplicateReferences } from './schematron.js'

const doc = (s: string) => parseXml(new TextEncoder().encode(s), 'p.opf').root!

describe('checkUniqueIds', () => {
  it('accepts distinct ids', () => {
    expect(checkUniqueIds(doc('<p><a id="x"/><b id="y"/></p>'), 'p.opf')).toEqual([])
  })

  it('reports a repeated id once per offending element', () => {
    const messages = checkUniqueIds(doc('<p><a id="x"/><b id="x"/></p>'), 'p.opf')
    expect(messages.map((m) => m.message)).toEqual([
      "Error while parsing file 'p.opf': The \"id\" attribute does not have a unique value",
      "Error while parsing file 'p.opf': The \"id\" attribute does not have a unique value",
    ])
    expect(messages[0]!.severity).toBe('ERROR')
    expect(messages[0]!.id).toBe('RSC-005')
  })

  it('reports a triple-repeated id once per offending element (three messages)', () => {
    const messages = checkUniqueIds(doc('<p><a id="x"/><b id="x"/><c id="x"/></p>'), 'p.opf')
    expect(messages).toHaveLength(3)
  })

  it('normalises whitespace before comparing', () => {
    expect(checkUniqueIds(doc('<p><a id=" x "/><b id="x"/></p>'), 'p.opf')).toHaveLength(2)
  })

  it('does not flag a unique id among other duplicated or unique ids', () => {
    const messages = checkUniqueIds(doc('<p><a id="x"/><b id="x"/><c id="unique"/></p>'), 'p.opf')
    expect(messages).toHaveLength(2)
  })
})

describe('checkDuplicateReferences', () => {
  const guide = (refs: string) => doc(`<package><guide>${refs}</guide></package>`)

  it('accepts distinct references', () => {
    expect(
      checkDuplicateReferences(guide('<reference type="text" href="a"/><reference type="toc" href="b"/>'), 'p.opf'),
    ).toEqual([])
  })

  it('reports a duplicate type+href once per offending element (two messages)', () => {
    const messages = checkDuplicateReferences(
      guide('<reference type="text" href="a"/><reference type="text" href="a"/>'),
      'p.opf',
    )
    expect(messages).toHaveLength(2)
    expect(messages[0]!.id).toBe('RSC-017')
    expect(messages[0]!.severity).toBe('WARNING')
    expect(messages[0]!.message).toBe(
      'Warning while parsing file: Duplicate "reference" elements with the same "type" and "href" attributes',
    )
  })

  it('reports a triple duplicate type+href once per offending element (three messages)', () => {
    const messages = checkDuplicateReferences(
      guide(
        '<reference type="text" href="a"/><reference type="text" href="a"/><reference type="text" href="a"/>',
      ),
      'p.opf',
    )
    expect(messages).toHaveLength(3)
  })

  it('treats type/href comparison as case-insensitive', () => {
    const messages = checkDuplicateReferences(
      guide('<reference type="text" href="a"/><reference type="TEXT" href="A"/>'),
      'p.opf',
    )
    expect(messages).toHaveLength(2)
  })

  it('does not flag references sharing type but differing href', () => {
    expect(
      checkDuplicateReferences(
        guide('<reference type="text" href="a"/><reference type="text" href="b"/>'),
        'p.opf',
      ),
    ).toEqual([])
  })
})
