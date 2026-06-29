import { findDescendants } from '../io/xml.js'
import type { EpubContainer } from '../io/zip.js'
import { msg, type Message } from '../messages/format.js'
import type { NavDocument, NavSection } from '../parse/nav.js'
import type { PackageDocument } from '../parse/opf.js'

function hasType(section: NavSection, type: string): boolean {
  return section.types.includes(type)
}

export function validateNav(
  nav: NavDocument,
  _pkg: PackageDocument,
  _container: EpubContainer,
): Message[] {
  return [...checkOccurrence(nav)]
}

function checkOccurrence(nav: NavDocument): Message[] {
  const messages: Message[] = []
  const tocs = nav.sections.filter((s) => hasType(s, 'toc'))

  if (tocs.length !== 1) {
    messages.push(msg('RSC-005', nav.loc, nav.path, 'Exactly one "toc" nav element must be present.'))
  }
  if (nav.sections.filter((s) => hasType(s, 'page-list')).length > 1) {
    messages.push(msg('RSC-005', nav.loc, nav.path, 'Multiple occurrences of the "page-list" nav element.'))
  }
  if (nav.sections.filter((s) => hasType(s, 'landmarks')).length > 1) {
    messages.push(msg('RSC-005', nav.loc, nav.path, 'Multiple occurrences of the "landmarks" nav element.'))
  }

  const toc = tocs[0]
  if (toc && findDescendants(toc.node, 'ol').length === 0) {
    messages.push(msg('RSC-005', toc.loc, nav.path, 'The "toc" nav element must contain an ol element.'))
  }

  return messages
}
