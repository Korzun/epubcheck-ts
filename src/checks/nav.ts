import { findDescendants, textContent } from '../io/xml.js'
import { getResource, type EpubContainer } from '../io/zip.js'
import { resolvePath, isRemote } from '../util/path.js'
import { msg, type Message } from '../messages/format.js'
import type { NavDocument, NavSection } from '../parse/nav.js'
import type { ManifestItem, PackageDocument } from '../parse/opf.js'

function hasType(section: NavSection, type: string): boolean {
  return section.types.includes(type)
}

export function validateNav(
  nav: NavDocument,
  pkg: PackageDocument,
  container: EpubContainer,
): Message[] {
  return [...checkOccurrence(nav), ...checkContent(nav), ...checkLinks(nav, pkg, container), ...checkReadingOrder(nav, pkg)]
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

function checkLinks(nav: NavDocument, pkg: PackageDocument, container: EpubContainer): Message[] {
  const messages: Message[] = []

  // Container paths declared in the manifest (manifest hrefs resolve against the OPF path).
  const manifestPaths = new Set<string>()
  for (const item of pkg.manifest) {
    if (item.href && !isRemote(item.href)) manifestPaths.add(resolvePath(pkg.path, item.href))
  }

  for (const section of nav.sections) {
    const label = section.types[0] ?? 'toc'
    for (const a of findDescendants(section.node, 'a')) {
      const href = a.attrs?.['href']
      if (!href) continue
      if (isRemote(href)) {
        messages.push(msg('NAV-010', a.loc, label, href))
        continue
      }
      const target = resolvePath(nav.path, href) // resolvePath strips the fragment
      if (!getResource(container, target)) {
        messages.push(msg('RSC-007', a.loc, href))
      } else if (!manifestPaths.has(target)) {
        messages.push(msg('RSC-008', a.loc, href))
      }
    }
  }

  return messages
}

function checkReadingOrder(nav: NavDocument, pkg: PackageDocument): Message[] {
  const messages: Message[] = []

  // Container path of each spine item → its spine position (index).
  const itemById = new Map<string, ManifestItem>()
  for (const item of pkg.manifest) {
    if (item.id !== undefined) itemById.set(item.id, item)
  }
  const spinePos = new Map<string, number>()
  pkg.spine.forEach((s, i) => {
    if (s.idref === undefined) return
    const item = itemById.get(s.idref)
    if (item?.href && !isRemote(item.href)) spinePos.set(resolvePath(pkg.path, item.href), i)
  })

  for (const section of nav.sections) {
    if (!hasType(section, 'toc')) continue // NAV-011 applies to the toc nav only
    let lastPos = -1
    for (const a of findDescendants(section.node, 'a')) {
      const href = a.attrs?.['href']
      if (!href || isRemote(href)) continue
      const target = resolvePath(nav.path, href) // strips the fragment
      const pos = spinePos.get(target)
      if (pos === undefined) continue // target not in the spine → skipped (epubcheck behavior)
      if (pos < lastPos) messages.push(msg('NAV-011', a.loc, 'toc', target, 'spine'))
      lastPos = pos
    }
  }

  return messages
}

function checkContent(nav: NavDocument): Message[] {
  const messages: Message[] = []

  for (const section of nav.sections) {
    const anchors = findDescendants(section.node, 'a')

    for (const a of anchors) {
      if (!a.attrs?.['href']) {
        messages.push(msg('RSC-005', a.loc, nav.path, 'An "a" element in the navigation document must have an href attribute.'))
      }
      if (textContent(a).trim() === '') {
        messages.push(msg('RSC-005', a.loc, nav.path, 'Anchors within nav elements must contain text.'))
      }
    }

    for (const span of findDescendants(section.node, 'span')) {
      if (textContent(span).trim() === '') {
        messages.push(msg('RSC-005', span.loc, nav.path, 'Spans within nav elements must contain text.'))
      }
    }

    if (hasType(section, 'landmarks')) {
      const seen = new Set<string>()
      for (const a of anchors) {
        const type = a.attrs?.['epub:type']
        if (!type) {
          messages.push(msg('RSC-005', a.loc, nav.path, 'Missing epub:type attribute on anchor inside "landmarks" nav element.'))
          continue
        }
        const href = a.attrs?.['href'] ?? ''
        const key = `${type}::${href}`
        if (seen.has(key)) {
          messages.push(msg('RSC-005', a.loc, nav.path, `Another landmark was found with the same epub:type and reference to "${href}".`))
        } else {
          seen.add(key)
        }
      }
    }
  }

  return messages
}
