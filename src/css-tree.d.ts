/**
 * Minimal type declarations for css-tree v3.
 * css-tree 3.x ships no bundled .d.ts files; this shim declares only what epubcheck-ts uses.
 */
declare module 'css-tree' {
  interface Position {
    offset: number
    line: number
    column: number
  }
  export interface CssLocation {
    source: string
    start: Position
    end: Position
  }
  export interface CssNode {
    type: string
    loc?: CssLocation | null
  }
  /** A url() token. In v3, `.value` is a plain string with quotes already stripped. */
  export interface Url extends CssNode {
    type: 'Url'
    value: string
  }
  export interface Atrule extends CssNode {
    type: 'Atrule'
    name: string
    prelude: CssNode | null
    block: CssNode | null
  }
  export interface Declaration extends CssNode {
    type: 'Declaration'
    property: string
    value: CssNode
  }
  export interface StringNode extends CssNode {
    type: 'String'
    value: string
  }
  export interface AtrulePrelude extends CssNode {
    type: 'AtrulePrelude'
  }
  export interface ParseError extends Error {
    line: number
    column: number
  }
  export interface ParseOptions {
    positions?: boolean
    onParseError?: (error: ParseError) => void
  }
  type WalkerFn = (node: CssNode) => void
  type WalkerOptions = { enter?: WalkerFn; leave?: WalkerFn }
  export function parse(text: string, options?: ParseOptions): CssNode
  export function walk(ast: CssNode, walker: WalkerFn | WalkerOptions): void
  export function generate(node: CssNode): string
}
