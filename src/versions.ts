import { BLESSED_FONT_TYPES } from './util/media-types.js'

/** Every EPUB revision this validator accepts as a target. */
export type EpubVersion = '2.0' | '2.0.1' | '3.0' | '3.0.1' | '3.2' | '3.3'

// Gating rank. Revisions that share a validation profile share a rank:
// 2.0/2.0.1 → 20, 3.0/3.0.1 → 30, 3.2 → 32, 3.3 → 33.
const RANK: Record<EpubVersion, number> = {
  '2.0': 20,
  '2.0.1': 20,
  '3.0': 30,
  '3.0.1': 30,
  '3.2': 32,
  '3.3': 33,
}

export function majorVersion(v: EpubVersion): '2.0' | '3.0' {
  return RANK[v] < 30 ? '2.0' : '3.0'
}

export function atLeast(v: EpubVersion, floor: EpubVersion): boolean {
  return RANK[v] >= RANK[floor]
}

// Core Media Types common to every EPUB 3 revision. Fonts are treated uniformly
// across 3.x (the shared blessed-font set); over-accepting a font is low-risk and
// preserves prior behavior. Revision gating below applies to the high-confidence
// image/script deltas.
const CORE_BASE: readonly string[] = [
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/svg+xml',
  'audio/mpeg',
  'audio/mp4',
  'application/xhtml+xml',
  'text/javascript',
  'text/css',
  'application/pls+xml',
  'application/smil+xml',
]

/** Exact-match Core Media Types for a revision. (video/* and Opus are handled
 * by prefix/pattern at the call site — see checks/content.ts.) */
export function coreMediaTypes(v: EpubVersion): ReadonlySet<string> {
  const set = new Set<string>([...CORE_BASE, ...BLESSED_FONT_TYPES])
  if (atLeast(v, '3.2')) set.add('application/javascript')
  if (atLeast(v, '3.3')) {
    set.add('image/webp')
    set.add('application/ecmascript')
    set.delete('application/pls+xml') // PLS dropped as a Core Media Type in 3.3
  }
  return set
}

/** NCX media type — the EPUB 2 navigation document (also valid as an EPUB 3 legacy compat doc). */
export const NCX_MEDIA_TYPE = 'application/x-dtbncx+xml'

/** EPUB 2 blessed image types (epubcheck OPFChecker.isBlessedImageType, VERSION_2). */
export const EPUB2_IMAGE_TYPES: ReadonlySet<string> = new Set<string>([
  'image/gif',
  'image/png',
  'image/jpeg',
  'image/svg+xml',
])

/** EPUB 2 style types: blessed + deprecated-blessed (epubcheck isBlessedStyleType / isDeprecatedBlessedStyleType). */
export const EPUB2_STYLE_TYPES: ReadonlySet<string> = new Set<string>([
  'text/css',
  'text/x-oeb1-css',
])

// Blessed content-document types per major (epubcheck isBlessedItemType + isDeprecatedBlessedItemType).
const BLESSED_CONTENT_V2: ReadonlySet<string> = new Set<string>([
  'application/xhtml+xml',
  'application/x-dtbook+xml',
  'text/x-oeb1-document', // deprecated-blessed
  'text/html', // deprecated-blessed
])
const BLESSED_CONTENT_V3: ReadonlySet<string> = new Set<string>([
  'application/xhtml+xml',
  'image/svg+xml',
  'text/x-oeb1-document', // deprecated-blessed
  'text/html', // deprecated-blessed
])

/** Content-document types acceptable as hyperlink/guide/spine targets for a revision. */
export function blessedContentTypes(v: EpubVersion): ReadonlySet<string> {
  return majorVersion(v) === '2.0' ? BLESSED_CONTENT_V2 : BLESSED_CONTENT_V3
}
