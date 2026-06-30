import * as csstree from 'css-tree'
import { getResource, type EpubContainer } from '../io/zip.js'
import { resolvePath } from '../util/path.js'
import { msg, type Location, type Message } from '../messages/format.js'
import type { ManifestItem } from './opf.js'

export type CssRefType = 'generic' | 'font' | 'import'
export interface CssRef {
  url: string
  type: CssRefType
  loc: Location
}
export interface CssDeclaration {
  property: string
  value: string
  loc: Location
}
export interface FontFace {
  declarationCount: number
  loc: Location
}
export interface CssDocument {
  path: string
  refs: CssRef[]
  declarations: CssDeclaration[]
  fontFaces: FontFace[]
}
export interface CssAnalysis {
  parsed: boolean
  refs: CssRef[]
  declarations: CssDeclaration[]
  fontFaces: FontFace[]
  messages: Message[]
}

function locOf(node: { loc?: csstree.CssLocation | null } | null | undefined, path: string): Location {
  const start = node?.loc?.start
  return start ? { path, line: start.line, column: start.column } : { path }
}

function stripQuotes(raw: string): string {
  const t = raw.trim()
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    return t.slice(1, -1)
  }
  return t
}

/**
 * Extract the URL string from a css-tree Url node.
 * In v3, node.value is already a plain string with quotes stripped by the parser.
 */
function urlValue(node: csstree.Url): string {
  return stripQuotes(node.value)
}

/** The import target from an @import at-rule prelude (Url or String). */
function importTarget(atrule: csstree.Atrule): string | undefined {
  const prelude = atrule.prelude
  if (!prelude || prelude.type !== 'AtrulePrelude') return undefined
  let result: string | undefined
  csstree.walk(prelude, (n) => {
    if (result !== undefined) return
    if (n.type === 'Url') result = urlValue(n as csstree.Url)
    else if (n.type === 'String') result = stripQuotes((n as csstree.StringNode).value)
  })
  return result
}

function countDeclarations(atrule: csstree.Atrule): number {
  let count = 0
  if (atrule.block) {
    csstree.walk(atrule.block, (n) => {
      if (n.type === 'Declaration') count++
    })
  }
  return count
}

export function analyzeCss(
  text: string,
  path: string,
  context: 'stylesheet' | 'declarationList',
): CssAnalysis {
  const messages: Message[] = []
  const refs: CssRef[] = []
  const declarations: CssDeclaration[] = []
  const fontFaces: FontFace[] = []

  let ast: csstree.CssNode
  try {
    ast = csstree.parse(text, {
      positions: true,
      context,
      onParseError(error) {
        messages.push(msg('CSS-008', { path, line: error.line, column: error.column }, error.message))
      },
    })
  } catch (error) {
    messages.push(msg('CSS-008', { path }, error instanceof Error ? error.message : String(error)))
    return { parsed: false, refs, declarations, fontFaces, messages }
  }

  const atruleStack: string[] = []
  const pushRef = (url: string, type: CssRefType, loc: Location): void => {
    if (url.trim() === '') messages.push(msg('CSS-002', loc))
    else refs.push({ url, type, loc })
  }

  csstree.walk(ast, {
    enter: (node) => {
      if (node.type === 'Atrule') {
        const atrule = node as csstree.Atrule
        if (atrule.name === 'import') {
          const url = importTarget(atrule)
          if (url !== undefined) pushRef(url, 'import', locOf(atrule, path))
        } else if (atrule.name === 'font-face') {
          fontFaces.push({ declarationCount: countDeclarations(atrule), loc: locOf(atrule, path) })
        }
        atruleStack.push(atrule.name)
      } else if (node.type === 'Url') {
        // @import url() is handled at the Atrule level; skip it here to avoid double-counting.
        if (atruleStack[atruleStack.length - 1] !== 'import') {
          const urlNode = node as csstree.Url
          const type: CssRefType = atruleStack[atruleStack.length - 1] === 'font-face' ? 'font' : 'generic'
          pushRef(urlValue(urlNode), type, locOf(urlNode, path))
        }
      } else if (node.type === 'Declaration') {
        const decl = node as csstree.Declaration
        declarations.push({ property: decl.property.toLowerCase(), value: csstree.generate(decl.value), loc: locOf(decl, path) })
      }
    },
    leave: (node) => {
      if (node.type === 'Atrule') atruleStack.pop()
    },
  })

  return { parsed: true, refs, declarations, fontFaces, messages }
}

/**
 * Detect a CSS file's declared encoding from a leading BOM or an `@charset`
 * rule (which, per the CSS syntax, must be the very first bytes). Returns the
 * lowercased encoding name, or undefined when none is declared (assume UTF-8).
 */
function detectCssCharset(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be'
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le'
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8' // UTF-8 BOM
  const prefix = '@charset "'
  let head = ''
  for (let i = 0; i < Math.min(bytes.length, 100); i++) head += String.fromCharCode(bytes[i] ?? 0)
  if (head.startsWith(prefix)) {
    const end = head.indexOf('"', prefix.length)
    if (end > prefix.length) return head.slice(prefix.length, end).toLowerCase()
  }
  return undefined
}

export function parseCss(
  item: ManifestItem,
  container: EpubContainer,
): { css?: CssDocument; messages: Message[] } {
  const opfPath = container.rootfiles[0]
  if (!opfPath || !item.href) return { messages: [] }

  const path = resolvePath(opfPath, item.href)
  const resource = getResource(container, path)
  if (!resource) return { messages: [] } // missing file is reported as RSC-001 by the OPF manifest check

  const charset = detectCssCharset(resource.bytes)
  if (charset !== undefined && charset !== 'utf-8') {
    // Non-UTF-8 CSS: report the encoding rule and skip parsing (decoding as
    // UTF-8 would produce mojibake and spurious CSS-008 errors).
    const message = charset.startsWith('utf-16')
      ? msg('CSS-003', { path })
      : msg('CSS-004', { path }, charset)
    return { messages: [message] }
  }

  const text = new TextDecoder('utf-8').decode(resource.bytes)
  const a = analyzeCss(text, path, 'stylesheet')
  if (!a.parsed) return { messages: a.messages }
  return { css: { path, refs: a.refs, declarations: a.declarations, fontFaces: a.fontFaces }, messages: a.messages }
}
